/**
 * Newsletter sign-up with a confirmation step (double opt-in), and the opt-out, on the table that already exists.
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
 * OPT-OUT (Telecommunicatiewet art. 11.7 lid 6, AVG art. 21 lid 3): every address on the list gets a signed
 * unsubscribe link (/api/newsletter/afmelden?token=...). The link does not expire, carries no secret and
 * cannot be derived from the address alone: it is only in mails sent to that address. The click (again a
 * POST behind a button, or the RFC 8058 one-click POST a mail client sends) sets unsubscribedAt in OUR table,
 * which is authoritative, and then flags the contact unsubscribed in the Resend audience, best effort: a
 * Resend failure never fails the opt-out, but the owner is told once per address and direction per server instance
 * (reportResendFailure) so the audience can be fixed by hand before the next broadcast (decision D20); a confirmation
 * that Resend refused is reported the same way. The notice goes out after the response (next/server after()), never in
 * the reader's wait. A confirmation link mailed BEFORE an opt-out cannot undo it (the link's issue time is in the
 * token; compared with the FIRST opt-out timestamp, a repeated click keeps it); only a new sign-up can. An account
 * erasure (src/lib/erasure.ts) flags the contact the same way (forgetNewsletterContactAfterResponse). Nothing else in
 * the app sends marketing mail: the newsletters themselves are Resend Broadcasts sent by the owner, who must put our
 * link in each one.
 *
 * The confirmation link carries an HMAC-SHA256 token over the address and an expiry, keyed with a key derived
 * from CRON_SECRET (else CLERK_SECRET_KEY). No new environment variable (decision D10). Without
 * either secret in production no token can be signed, so sign-up answers "not available" instead of
 * storing an address that can never be confirmed. The unsubscribe token uses the same derived key with a
 * different purpose string inside the signed message (and a different shape), so one can never pass as the other.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { prisma } from "./prisma";
import { env, isDatabaseConfigured } from "./env";
import { logger } from "./logger";
import { rateLimit } from "./ratelimit";
import { sendMail, type SendMailOptions } from "./email";
import { notifyOwner, type NotifyInput } from "./notify";
import { shell, button, esc } from "./emails/layout";

/** Longest valid e-mail address (RFC 5321). Longer input is refused instead of stored. */
export const MAX_EMAIL_LENGTH = 254;
/** How long a confirmation link works. */
export const NEWSLETTER_CONFIRM_TTL_DAYS = 7;
/** Timeout of every outbound call to Resend from this module, in milliseconds (one deadline per operation, not per request). */
export const RESEND_TIMEOUT_MS = 8000;
const HOUR = 60 * 60 * 1000;
/**
 * POST /api/newsletter/afmelden: two buckets, because a POST with a valid token and one without can do different things.
 *   perCaller  POSTs whose token does NOT verify, per caller address and hour: the guard against guessing a token. A POST
 *              with a valid token never counts here. RFC 8058 one-click POSTs come from the MAIL PROVIDER's servers, so
 *              after a broadcast the readers of one provider share a few addresses (and readers behind a carrier NAT share
 *              one), and a 429 would be a refused opt-out (Telecommunicatiewet art. 11.7 lid 6) for a request that can
 *              only ever unsubscribe the one address its token was signed for.
 *   perAddress valid-token POSTs per ADDRESS and hour: bounds what one token can cause (a table write and a Resend call
 *              each; the Resend API's own limit is shared with the order mails). By the time it is reached the opt-out
 *              has been recorded by the first POST (or the database was down and the person was told to retry), so the
 *              429 refuses nothing.
 */
export const UNSUBSCRIBE_RATE_LIMIT = {
  perCaller: { max: 30, windowMs: HOUR },
  perAddress: { max: 10, windowMs: HOUR },
} as const;

const DAY = 86_400_000;
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
/** Inside the signed message of an unsubscribe token; the confirmation token signs `<email>.<expiry>` and never this. */
const UNSUBSCRIBE_PURPOSE = "wasfix-newsletter-unsubscribe-v1";

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

/** Constant-time comparison of a base64url signature with the expected digest. */
function signatureMatches(sigPart: string, expected: Buffer): boolean {
  let given: Buffer;
  try {
    given = Buffer.from(sigPart, "base64url");
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The address inside a base64url part, or null when it does not look like one. */
function decodeEmailPart(emailPart: string): string | null {
  try {
    const email = Buffer.from(emailPart, "base64url").toString("utf8");
    return email.includes("@") && email.length <= MAX_EMAIL_LENGTH ? email : null;
  } catch {
    return null;
  }
}

/**
 * The address inside a valid, unexpired confirmation token, and when the link was mailed (`issuedAt`, ms: the expiry
 * minus the TTL, so at most a second before the real moment, as the expiry is whole seconds); null for anything else
 * (forged, truncated, expired). The issue time lets a confirmation leave an opt-out alone that was made AFTER the link
 * went out (confirmNewsletterSubscription).
 */
export function readNewsletterToken(token: string, now: number = Date.now()): { email: string; issuedAt: number } | null {
  const key = signingKey();
  const parts = String(token ?? "").split(".");
  if (!key || parts.length !== 3) return null;
  const [emailPart, expPart, sigPart] = parts;
  const expected = createHmac("sha256", key).update(`${emailPart}.${expPart}`).digest();
  if (!signatureMatches(sigPart, expected)) return null;
  const exp = Number(expPart);
  if (!Number.isFinite(exp) || exp * 1000 < now) return null;
  const email = decodeEmailPart(emailPart);
  return email ? { email, issuedAt: exp * 1000 - NEWSLETTER_CONFIRM_TTL_DAYS * DAY } : null;
}

/** The address inside a valid, unexpired confirmation token; null for anything else (forged, truncated, expired). */
export function verifyNewsletterToken(token: string, now: number = Date.now()): string | null {
  return readNewsletterToken(token, now)?.email ?? null;
}

/**
 * The opt-out token: `<base64url(email)>.<base64url(hmac)>`, signed over `<purpose>.<email part>` with the same key as
 * the confirmation token. No expiry: an opt-out link must keep working for as long as the address is on the list
 * (a key rotation, i.e. a new CRON_SECRET, is the one thing that breaks old links; see DECISIONS D20). Null when no
 * signing key exists.
 */
export function signNewsletterUnsubscribeToken(email: string): string | null {
  const key = signingKey();
  if (!key) return null;
  const emailPart = b64(normalizeNewsletterEmail(email));
  return `${emailPart}.${createHmac("sha256", key).update(`${UNSUBSCRIBE_PURPOSE}.${emailPart}`).digest("base64url")}`;
}

/** The address inside a valid unsubscribe token; null for a forged or truncated one, and for a confirmation token. */
export function verifyNewsletterUnsubscribeToken(token: string): string | null {
  const key = signingKey();
  const parts = String(token ?? "").split(".");
  if (!key || parts.length !== 2) return null;
  const [emailPart, sigPart] = parts;
  const expected = createHmac("sha256", key).update(`${UNSUBSCRIBE_PURPOSE}.${emailPart}`).digest();
  if (!signatureMatches(sigPart, expected)) return null;
  return decodeEmailPart(emailPart);
}

/** The absolute opt-out link for an address (what goes into every mail to it); null when nothing can be signed. */
export function newsletterUnsubscribeUrl(email: string): string | null {
  const token = signNewsletterUnsubscribeToken(email);
  return token ? `${env.APP_URL}/api/newsletter/afmelden?token=${encodeURIComponent(token)}` : null;
}

/**
 * RFC 8058 one-click headers for a mail to this address: a mail client shows its own "unsubscribe" button and POSTs
 * `List-Unsubscribe=One-Click` to the URL, which /api/newsletter/afmelden accepts without a page. Null when nothing
 * can be signed. Used on the mails this module sends; nothing else in the app sends marketing mail (the newsletters
 * are Resend Broadcasts sent by the owner, see DECISIONS D20).
 */
export function listUnsubscribeHeaders(email: string): Record<string, string> | null {
  const url = newsletterUnsubscribeUrl(email);
  return url ? { "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : null;
}

// ─── Resend audience ────────────────────────────────────────────────

let resendTimeoutMs: number = RESEND_TIMEOUT_MS;
/** `<direction>:<address>` pairs whose failed Resend sync has been reported to the owner (once per address and direction per process). */
const resendFailureReported = new Set<string>();

/** For tests only: a short Resend deadline, and forget which addresses were reported. */
export function _setNewsletterStateForTests(opts: { resendTimeoutMs?: number } = {}): void {
  resendTimeoutMs = opts.resendTimeoutMs ?? RESEND_TIMEOUT_MS;
  resendFailureReported.clear();
}

/**
 * Where the audience lives. RESEND_BASE_URL is the same override the Resend SDK honours (the QA suites point it at a
 * local stand-in); in production it is unset and the real API is used.
 */
function resendAudience(): { apiKey: string; base: string } | null {
  const apiKey = process.env.RESEND_API_KEY;
  const audienceId = process.env.RESEND_AUDIENCE_ID;
  if (!apiKey || !audienceId) return null;
  const root = (process.env.RESEND_BASE_URL || "https://api.resend.com").replace(/\/+$/, "");
  return { apiKey, base: `${root}/audiences/${encodeURIComponent(audienceId)}/contacts` };
}

/** One call to the audience API, bounded by what is left of the operation's deadline. Throws on a network error or timeout. */
function resendCall(cfg: { apiKey: string; base: string }, method: "POST" | "PATCH", path: string, body: unknown, deadline: number): Promise<Response> {
  return fetch(`${cfg.base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    // A slow Resend must not hold the visitor (or a serverless instance) for the platform's whole time limit.
    signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
  });
}

const contactPath = (email: string) => `/${encodeURIComponent(email)}`;

/** Why a Resend call threw: a fixed code (never the error text, which can echo the URL or the address). */
function thrownReason(err: unknown, timeoutMs: number): string {
  const name = err instanceof Error ? err.name : String(err);
  return name === "TimeoutError" || name === "AbortError" ? `timeout_${timeoutMs}ms` : "network_error";
}

export type ResendSyncResult =
  /** Resend accepted the change. */
  | { ok: true }
  /** Nothing changed in the audience. `reason` is a fixed code: `not_configured` (no key or no audience id: nothing to keep in step), `http_NNN_then_http_NNN`, `timeout_Nms`, `network_error`. */
  | { ok: false; reason: string };

/**
 * Put a CONFIRMED address on the Resend audience as subscribed. Best effort, both calls bounded by ONE timeout. The
 * contact is UPDATED first (`PATCH {unsubscribed:false}`: an address that opted out earlier is still a contact, flagged
 * unsubscribed, and creating it again would not clear that flag; an update has one documented meaning) and CREATED
 * when the update is refused with ANY non-2xx status, not only 404: what Resend answers for a contact it does not know
 * could not be verified from here, and a wrong guess must not silently stop the audience from growing while our table
 * says the person subscribed. A hang or a network error on the update ends the operation: a second call would not fit
 * in the deadline, and a refused connection would be refused twice.
 */
export async function addToResendAudience(email: string, timeoutMs: number = resendTimeoutMs): Promise<ResendSyncResult> {
  const cfg = resendAudience();
  if (!cfg) return { ok: false, reason: "not_configured" };
  const deadline = Date.now() + timeoutMs;
  try {
    const updated = await resendCall(cfg, "PATCH", contactPath(email), { unsubscribed: false }, deadline);
    if (updated.ok) return { ok: true };
    const created = await resendCall(cfg, "POST", "", { email, unsubscribed: false }, deadline);
    if (created.ok) {
      // 404 is the expected answer for a contact Resend does not know; anything else is worth a line in the log.
      if (updated.status !== 404) logger.warn("[newsletter] Resend audience update refused, contact created instead", { status: updated.status });
      return { ok: true };
    }
    logger.warn("[newsletter] Resend audience update and add both failed", { update: updated.status, create: created.status });
    return { ok: false, reason: `http_${updated.status}_then_http_${created.status}` };
  } catch (err) {
    const reason = thrownReason(err, timeoutMs);
    logger.warn("[newsletter] Resend audience add error", { err: reason });
    return { ok: false, reason };
  }
}

export type ResendUnsubscribeOutcome =
  /** Resend flagged the contact unsubscribed. */
  | "updated"
  /** Resend does not know the address (404): nothing to flag. */
  | "not_in_audience"
  /** Resend answered an error or did not answer in time. The owner is told (once per address and direction per server instance, reportResendFailure). */
  | "failed"
  /** No RESEND_API_KEY or no RESEND_AUDIENCE_ID: there is no audience to keep in step. */
  | "not_configured";

/**
 * Flag an address unsubscribed in the Resend audience (PATCH {unsubscribed: true}). Best effort, bounded by one timeout.
 * Never throws; the caller has already recorded the opt-out in our table.
 */
export async function removeFromResendAudience(email: string, timeoutMs: number = resendTimeoutMs): Promise<{ outcome: ResendUnsubscribeOutcome; reason?: string }> {
  const cfg = resendAudience();
  if (!cfg) return { outcome: "not_configured" };
  try {
    const res = await resendCall(cfg, "PATCH", contactPath(email), { unsubscribed: true }, Date.now() + timeoutMs);
    if (res.ok) return { outcome: "updated" };
    if (res.status === 404) return { outcome: "not_in_audience" };
    logger.warn("[newsletter] Resend audience unsubscribe failed", { status: res.status });
    return { outcome: "failed", reason: `http_${res.status}` };
  } catch (err) {
    const reason = thrownReason(err, timeoutMs);
    logger.warn("[newsletter] Resend audience unsubscribe error", { err: reason });
    return { outcome: "failed", reason };
  }
}

/** Run work after the response has gone out (next/server after()); outside a request, as in the QA suites, it simply runs. */
function afterResponse(fn: () => Promise<unknown>): void {
  try {
    after(fn);
  } catch {
    void fn().catch(() => undefined);
  }
}

/**
 * Tell the owner that the audience and our table disagree for one address, so the contact can be fixed by hand before the
 * next broadcast. Once per address and direction per process (no schema change was allowed, so a serverless host repeats
 * it per instance). The notice goes out AFTER the response: notify.ts asks for after() because its channels may take 3 s,
 * and the reader's answer must not wait for it. Never the address: the channels are shared (notify.ts would redact it
 * anyway); the row id finds it.
 */
function reportResendFailure(direction: "subscribe" | "unsubscribe", email: string, reason: string, rowId: string | null): void {
  const key = `${direction}:${email}`;
  if (resendFailureReported.has(key)) return;
  resendFailureReported.add(key);
  if (resendFailureReported.size > 1000) resendFailureReported.delete(resendFailureReported.values().next().value as string);
  const where = rowId
    ? `Welk adres: NewsletterSubscriber-rij ${rowId} (kolom ${direction === "subscribe" ? "confirmedAt" : "unsubscribedAt"} is zojuist gezet), bijvoorbeeld via npm run db:studio.`
    : "Welk adres: het staat niet (meer) in onze tabel (eerder verwijderd), dus is het van hieruit niet te noemen; vergelijk de audience met de tabel.";
  // A 404 on the CREATE (POST /audiences/{id}/contacts) can only mean the audience path itself is unknown: a contact that
  // does not exist yet cannot be "not found" when it is being created. So that reason points at RESEND_AUDIENCE_ID. An
  // opt-out cannot tell (its single PATCH answers 404 for an unknown contact as well, which is silent by design), so this
  // notice after the first confirmation is the owner's one signal that the id is wrong.
  const audienceHint = /_then_http_404$/.test(reason)
    ? ["Resend antwoordde 404 op het aanmaken van het contact: dat betekent vrijwel zeker dat RESEND_AUDIENCE_ID niet (meer) bestaat. Controleer die eerst; afmeldingen bereiken dan ook geen audience (daar is een 404 stil)."]
    : [];
  const notice: NotifyInput =
    direction === "subscribe"
      ? {
          event: "newsletter.resend_subscribe_failed",
          level: "warn",
          title: "Aanmelding niet doorgegeven aan Resend",
          lines: [
            `Een lezer heeft de aanmelding voor de nieuwsbrief bevestigd. In onze tabel is dit adres abonnee; Resend nam het contact niet aan (${reason}).`,
            ...audienceHint,
            "Zet het contact zelf in de audience in Resend (Audiences) voordat je de volgende nieuwsbrief verstuurt, anders krijgt deze lezer hem niet.",
            where,
          ],
        }
      : {
          event: "newsletter.resend_unsubscribe_failed",
          level: "warn",
          title: "Afmelding niet doorgegeven aan Resend",
          lines: [
            `Een lezer heeft zich afgemeld voor de nieuwsbrief. In onze tabel staat de afmelding; Resend nam hem niet aan (${reason}).`,
            "Zet het contact in Resend (Audiences) zelf op 'unsubscribed' voordat je de volgende nieuwsbrief verstuurt, anders krijgt deze lezer hem nog.",
            where,
          ],
        };
  afterResponse(() => notifyOwner(notice));
}

// ─── Sign-up and confirmation ───────────────────────────────────────

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
  const optOut = newsletterUnsubscribeUrl(email);
  const oneClick = listUnsubscribeHeaders(email);

  // The opt-out link and the RFC 8058 headers go on every mail this module sends; nothing else in the app sends
  // marketing mail. sendMail (src/lib/email.ts) hands `headers` to sendRaw, which passes them to Resend as given.
  const mail: SendMailOptions = {
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
        </p>
        ${optOut ? `<p style="font-size: 13px; color: #666; line-height: 1.5;">
          Elke nieuwsbrief die we sturen bevat een afmeldlink; afmelden gaat direct in. Wil je je nu al afmelden, dan kan dat via deze link: <a href="${esc(optOut)}" style="color:#1a6b6b;">afmelden voor de nieuwsbrief</a>.
        </p>` : ""}`),
    text: `Bevestig je aanmelding voor de WasFix Pro-nieuwsbrief via deze link (${NEWSLETTER_CONFIRM_TTL_DAYS} dagen geldig): ${link}\n\nWas jij het niet? Dan hoef je niets te doen: zonder bevestiging sturen we je niets.${optOut ? `\n\nElke nieuwsbrief die we sturen bevat een afmeldlink; afmelden gaat direct in. Nu al afmelden kan via: ${optOut}` : ""}`,
    ...(oneClick ? { headers: oneClick } : {}),
  };
  const sent = await sendMail(mail);
  if (!sent.ok) return { ok: true, status: "mail_not_sent", reason: "no_mail" };

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

export type ConfirmResult =
  /** confirmedAt set; an opt-out older than the link is cleared and the contact goes back on the audience. */
  | { ok: true; status: "confirmed" }
  /** The address opted out AFTER this link was mailed: the objection stands, nothing changed, no audience call. */
  | { ok: true; status: "opted_out_later" }
  /** The confirmation could NOT be stored: the person must be told to try again. */
  | { ok: false };

/**
 * Mark an address confirmed (the click on the mailed link). An earlier opt-out is cleared only when it is OLDER than the
 * link (`linkIssuedAt`, from readNewsletterToken): a new sign-up plus a new click is a new consent, but a confirmation
 * link stays valid for NEWSLETTER_CONFIRM_TTL_DAYS days, and pressing the button in an old mail must not undo an
 * objection made after it went out (AVG art. 21 lid 3); that person is told the opt-out stands and can sign up again.
 * The link's issue time is known to the second, so an opt-out in the same second as the sign-up counts as later and is
 * kept (harmless: one more sign-up clears it). The clear is one conditional statement, so an opt-out recorded between the
 * read and the write is kept as well. The comparison is with the opt-out timestamp our table holds, which is the FIRST
 * click (a repeated opt-out keeps it, see unsubscribeFromNewsletter): an opt-out repeated after a newer sign-up's link
 * went out is therefore undone by the button in that newer mail, a consent act by the mailbox owner (decision D20
 * names the edge). Then the contact goes back on the audience as subscribed, best effort: when Resend refuses both the
 * update and the create, the confirmation stands and the owner is told once per address and direction per server
 * instance (reportResendFailure).
 */
export async function confirmNewsletterSubscription(email: string, linkIssuedAt: number = Date.now()): Promise<ConfirmResult> {
  let rowId: string | null = null;
  try {
    const now = new Date();
    const existing = await prisma.newsletterSubscriber.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      const hit = await prisma.newsletterSubscriber.updateMany({
        where: { email, OR: [{ unsubscribedAt: null }, { unsubscribedAt: { lt: new Date(linkIssuedAt) } }] },
        data: { confirmedAt: now, unsubscribedAt: null },
      });
      if (hit.count > 0) rowId = existing.id;
      // Nothing matched: the row holds an opt-out newer than the link, or (a rare race) it was deleted since the read.
      else if (await prisma.newsletterSubscriber.findUnique({ where: { email }, select: { id: true } })) return { ok: true, status: "opted_out_later" };
    }
    if (!rowId) {
      // No row (purged after the link's TTL, or the sign-up's row was never stored): the signed link proves the request.
      // An upsert, because a parallel click may have created the row since the read; an opt-out never creates one.
      const row = await prisma.newsletterSubscriber.upsert({
        where: { email },
        update: { confirmedAt: now, unsubscribedAt: null },
        create: { email, source: "newsletter", confirmedAt: now },
        select: { id: true },
      });
      rowId = row.id;
    }
  } catch (err) {
    logger.error("[newsletter] confirmation could not be stored", err);
    return { ok: false };
  }
  const sync = await addToResendAudience(email);
  if (!sync.ok && sync.reason !== "not_configured") reportResendFailure("subscribe", email, sync.reason, rowId);
  return { ok: true, status: "confirmed" };
}

// ─── Opt-out ────────────────────────────────────────────────────────

export type UnsubscribeResult =
  | {
      ok: true;
      /** "unsubscribed": set now. "already": was set before (a second click, same answer). "unknown": no row for this address (purged or erased); nothing stored, same answer. */
      status: "unsubscribed" | "already" | "unknown";
      resend: ResendUnsubscribeOutcome;
    }
  /** The opt-out could NOT be recorded: the person must be told to try again. */
  | { ok: false };

/**
 * Record the opt-out for an address whose token verified. Our table is authoritative and is written first; the Resend
 * audience follows, best effort. Idempotent: the first unsubscribedAt is kept. An address without a row is answered like
 * any other (no enumeration) and gets no row: the token proves we once mailed it, not that it should be stored again.
 */
export async function unsubscribeFromNewsletter(rawEmail: string): Promise<UnsubscribeResult> {
  const email = normalizeNewsletterEmail(rawEmail);
  let status: "unsubscribed" | "already" | "unknown";
  let rowId: string | null = null;
  try {
    const row = await prisma.newsletterSubscriber.findUnique({ where: { email }, select: { id: true, unsubscribedAt: true } });
    if (!row) {
      status = "unknown";
    } else {
      rowId = row.id;
      // Only the first click writes the timestamp: a race between two clicks keeps the earlier one.
      const res = await prisma.newsletterSubscriber.updateMany({ where: { email, unsubscribedAt: null }, data: { unsubscribedAt: new Date() } });
      status = res.count > 0 ? "unsubscribed" : "already";
    }
  } catch (err) {
    logger.error("[newsletter] opt-out could not be stored", err);
    return { ok: false };
  }

  // The audience follows, whether or not we have a row: the token proves we once mailed this address, and a 404 from
  // Resend ("not in the audience") is an answer, not a failure.
  const resend = await removeFromResendAudience(email);
  if (resend.outcome === "failed") reportResendFailure("unsubscribe", email, resend.reason ?? "onbekend", rowId);
  return { ok: true, status, resend: resend.outcome };
}

/**
 * After an account erasure (src/lib/erasure.ts): the NewsletterSubscriber row is gone, so the Resend contact is flagged
 * unsubscribed as well (the same PATCH as an opt-out), best effort and AFTER the response, so the erasure never waits for
 * Resend and never fails on it. The contact itself (the address) stays in the audience, flagged; deleting it there is a
 * manual step in Resend. A 404 ("not in the audience") is an answer; a failure is reported like a failed opt-out, without
 * a row id (the row no longer exists). Does nothing without RESEND_API_KEY and RESEND_AUDIENCE_ID.
 */
export function forgetNewsletterContactAfterResponse(rawEmail: string): void {
  const email = normalizeNewsletterEmail(rawEmail);
  if (!email.includes("@") || email.length > MAX_EMAIL_LENGTH) return;
  afterResponse(async () => {
    const resend = await removeFromResendAudience(email);
    if (resend.outcome === "failed") reportResendFailure("unsubscribe", email, resend.reason ?? "onbekend", null);
  });
}

/**
 * For the owner (GET /api/newsletter/afmeldlinks, admin only): every subscriber (confirmed, not unsubscribed) with
 * its opt-out link, as CSV `email,afmeldlink` (RFC 4180 quoting, CRLF). The owner loads the column into the Resend
 * audience as a contact property and uses it as a merge field in every broadcast, so each newsletter carries OUR link
 * and our table sees the opt-out (decision D20). Null when nothing can be signed. Reads only.
 */
export async function subscriberUnsubscribeLinksCsv(): Promise<string | null> {
  if (!newsletterSigningAvailable()) return null;
  const rows = await prisma.newsletterSubscriber.findMany({
    where: { confirmedAt: { not: null }, unsubscribedAt: null },
    select: { email: true },
    orderBy: { email: "asc" },
  });
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  return `${["email,afmeldlink", ...rows.map((r) => `${q(r.email)},${q(newsletterUnsubscribeUrl(r.email) ?? "")}`)].join("\r\n")}\r\n`;
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
