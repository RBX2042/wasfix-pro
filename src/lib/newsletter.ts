/**
 * Newsletter sign-up with a confirmation step (double opt-in), on the table that already exists.
 *
 * WHY: /api/newsletter and /api/lead-magnet stored whatever address they were given and told the
 * visitor "you are subscribed", so anyone could subscribe somebody else's address, and a failed
 * database write was only logged while the visitor was thanked (rehearsal R2-18). Now:
 *   1. a mail with a signed link goes to that address;
 *   2. once the mail provider has taken it, the address is stored UNCONFIRMED (confirmedAt = null). It is NOT
 *      stored when the mail could not be handed over (no provider, provider error, too many mails to this
 *      address), so a failed sign-up leaves nothing behind; and unconfirmed rows are deleted again after
 *      the link has expired (purgeUnconfirmedSubscribers, from the daily retention run);
 *   3. only the click (a POST from the confirmation page, so a mail scanner that merely opens the
 *      link cannot confirm) sets confirmedAt and adds the address to the Resend audience.
 * No schema change: confirmedAt and unsubscribedAt were already columns, nothing read them.
 *
 * The link carries an HMAC-SHA256 token over the address and an expiry, keyed with a key derived
 * from CRON_SECRET (else CLERK_SECRET_KEY). No new environment variable (decision D10). Without
 * either secret in production no token can be signed, so sign-up answers "not available" instead of
 * storing an address that can never be confirmed.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "./prisma";
import { env, isDatabaseConfigured } from "./env";
import { logger } from "./logger";
import { rateLimit } from "./ratelimit";
import { sendMail } from "./email";
import { shell, button, esc } from "./emails/layout";

/** Longest valid e-mail address (RFC 5321). Longer input is refused instead of stored. */
export const MAX_EMAIL_LENGTH = 254;
/** How long a confirmation link works. */
export const NEWSLETTER_CONFIRM_TTL_DAYS = 7;
/** Timeout of every outbound call to Resend from this module, in milliseconds. */
export const RESEND_TIMEOUT_MS = 8000;

const DAY = 86_400_000;
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");

function signingKey(): Buffer | null {
  const secret = env.CRON_SECRET ?? env.CLERK_SECRET_KEY ?? (env.IS_PRODUCTION ? null : "dev-only-newsletter-signing-secret");
  return secret ? createHmac("sha256", "wasfix-newsletter-confirm-v1").update(secret).digest() : null;
}

/** True when a confirmation link can be signed in this deployment. */
export function newsletterSigningAvailable(): boolean {
  return signingKey() !== null;
}

export function normalizeNewsletterEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** `<base64url(email)>.<expiry seconds>.<base64url(hmac)>`; null when no signing key exists. */
export function signNewsletterToken(email: string, now: number = Date.now()): string | null {
  const key = signingKey();
  if (!key) return null;
  const exp = Math.floor((now + NEWSLETTER_CONFIRM_TTL_DAYS * DAY) / 1000);
  const body = `${b64(normalizeNewsletterEmail(email))}.${exp}`;
  return `${body}.${createHmac("sha256", key).update(body).digest("base64url")}`;
}

/** The address inside a valid, unexpired token; null for anything else (forged, truncated, expired). */
export function verifyNewsletterToken(token: string, now: number = Date.now()): string | null {
  const key = signingKey();
  const parts = String(token ?? "").split(".");
  if (!key || parts.length !== 3) return null;
  const [emailPart, expPart, sigPart] = parts;
  const expected = createHmac("sha256", key).update(`${emailPart}.${expPart}`).digest();
  let given: Buffer;
  try {
    given = Buffer.from(sigPart, "base64url");
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const exp = Number(expPart);
  if (!Number.isFinite(exp) || exp * 1000 < now) return null;
  try {
    const email = Buffer.from(emailPart, "base64url").toString("utf8");
    return email.includes("@") ? email : null;
  } catch {
    return null;
  }
}

/** Add a CONFIRMED address to the Resend audience. Best effort, bounded by a timeout; true when Resend accepted it. */
export async function addToResendAudience(email: string, timeoutMs: number = RESEND_TIMEOUT_MS): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const audienceId = process.env.RESEND_AUDIENCE_ID;
  if (!apiKey || !audienceId) return false;
  try {
    const res = await fetch(`https://api.resend.com/audiences/${audienceId}/contacts`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email, unsubscribed: false }),
      // A slow Resend must not hold the visitor (or a serverless instance) for the platform's whole time limit.
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) logger.warn("[newsletter] Resend audience add failed", { status: res.status });
    return res.ok;
  } catch (err) {
    logger.warn("[newsletter] Resend audience add error", { err: err instanceof Error ? err.name : String(err) });
    return false;
  }
}

export type SubscribeResult =
  /** Stored unconfirmed and the confirmation mail was handed to the mail provider. */
  | { ok: true; status: "mail_sent" }
  /** Already confirmed and active: nothing stored, no mail (so the form cannot be used to mail strangers). */
  | { ok: true; status: "already_subscribed" }
  /** Stored unconfirmed, but the mail could not be sent (no Resend key, provider error, or sent too often to this address). */
  | { ok: true; status: "mail_not_sent"; reason: "no_mail" | "too_often" }
  /** Non-production without a database: nothing stored, nothing mailed (a labelled demo). */
  | { ok: true; status: "demo" }
  /** The address could not be stored (or no confirmation can be signed): the visitor must be told it did NOT work. */
  | { ok: false; reason: "not_stored" | "unavailable" };

/**
 * Register an address and mail the confirmation link. Never reports success for something that was
 * not stored.
 */
export async function requestNewsletterSubscription(rawEmail: string, source: string): Promise<SubscribeResult> {
  const email = normalizeNewsletterEmail(rawEmail);
  if (email.length > MAX_EMAIL_LENGTH) return { ok: false, reason: "not_stored" };

  if (!isDatabaseConfigured()) {
    // Production without a database stores nothing, so it must not say "subscribed". A local demo may.
    return env.IS_PRODUCTION ? { ok: false, reason: "unavailable" } : { ok: true, status: "demo" };
  }
  if (!newsletterSigningAvailable()) {
    logger.error("[newsletter] no signing secret (CRON_SECRET or CLERK_SECRET_KEY): sign-up refused");
    return { ok: false, reason: "unavailable" };
  }

  // Read first: it proves the database answers and tells whether this address is already subscribed. Nothing is written yet.
  let exists = false;
  try {
    const existing = await prisma.newsletterSubscriber.findUnique({ where: { email }, select: { confirmedAt: true, unsubscribedAt: true } });
    if (existing?.confirmedAt && !existing.unsubscribedAt) return { ok: true, status: "already_subscribed" };
    exists = existing !== null;
  } catch (err) {
    logger.error("[newsletter] sign-up could not be stored", err);
    return { ok: false, reason: "not_stored" };
  }

  // At most 3 confirmation mails per address and day: this form must not be a way to mail a stranger repeatedly.
  if (!(await rateLimit(`newsletter-confirm-mail:${email}`, 3, DAY))) return { ok: true, status: "mail_not_sent", reason: "too_often" };

  const token = signNewsletterToken(email);
  if (!token) return { ok: false, reason: "unavailable" };
  const link = `${env.APP_URL}/api/newsletter/confirm?token=${encodeURIComponent(token)}`;

  const mail = await sendMail({
    template: "newsletter-confirm",
    to: email,
    subject: "Bevestig je aanmelding voor de WasFix Pro-nieuwsbrief",
    html: shell(`
        <h1 style="color: #1a6b6b; font-size: 24px;">Bevestig je aanmelding</h1>
        <p style="font-size: 16px; line-height: 1.6; color: #333;">
          Iemand heeft dit e-mailadres opgegeven voor de WasFix Pro-nieuwsbrief. Klik op de knop om te bevestigen dat jij dat was.
        </p>
        ${button(link, "Ja, meld mij aan")}
        <p style="margin-top: 24px; font-size: 13px; color: #666; line-height: 1.5;">
          Was jij het niet? Dan hoef je niets te doen: zonder bevestiging sturen we je niets. De link werkt ${NEWSLETTER_CONFIRM_TTL_DAYS} dagen.
          Werkt de knop niet, kopieer dan dit adres in je browser: ${esc(link)}
        </p>`),
    text: `Bevestig je aanmelding voor de WasFix Pro-nieuwsbrief via deze link (${NEWSLETTER_CONFIRM_TTL_DAYS} dagen geldig): ${link}\n\nWas jij het niet? Dan hoef je niets te doen: zonder bevestiging sturen we je niets.`,
  });
  if (!mail.ok) return { ok: true, status: "mail_not_sent", reason: "no_mail" };

  // The mail is out: remember the address (unconfirmed) so the owner can see a sign-up is pending and the purge can remove it.
  // A failure here is not the visitor's problem: the link in the mail confirms through an upsert and works without this row.
  if (!exists) {
    await prisma.newsletterSubscriber.create({ data: { email, source } }).catch((err) => {
      // A parallel request created the same row between our read and write: fine, same state.
      if ((err as { code?: string })?.code !== "P2002") logger.warn("[newsletter] unconfirmed row could not be stored", { err: err instanceof Error ? err.message : String(err) });
    });
  }
  return { ok: true, status: "mail_sent" };
}

/** Mark an address confirmed (the click on the mailed link). Returns false when it could not be stored. */
export async function confirmNewsletterSubscription(email: string): Promise<boolean> {
  try {
    const now = new Date();
    await prisma.newsletterSubscriber.upsert({
      where: { email },
      update: { confirmedAt: now, unsubscribedAt: null },
      create: { email, source: "newsletter", confirmedAt: now },
    });
  } catch (err) {
    logger.error("[newsletter] confirmation could not be stored", err);
    return false;
  }
  await addToResendAudience(email);
  return true;
}

/**
 * Delete sign-ups that were never confirmed: the link works NEWSLETTER_CONFIRM_TTL_DAYS days, so after that
 * (plus a week of margin) the row can never become a subscriber any more and has no reason to exist. The privacy
 * page says nothing happens with an address that is not confirmed; this is what keeps that true. Rows that were
 * confirmed once (and possibly unsubscribed since) are never touched.
 */
export const NEWSLETTER_UNCONFIRMED_KEEP_DAYS = NEWSLETTER_CONFIRM_TTL_DAYS + 7;
export async function purgeUnconfirmedSubscribers(now: Date = new Date()): Promise<number> {
  const res = await prisma.newsletterSubscriber.deleteMany({
    where: { confirmedAt: null, createdAt: { lt: new Date(now.getTime() - NEWSLETTER_UNCONFIRMED_KEEP_DAYS * DAY) } },
  });
  return res.count;
}
