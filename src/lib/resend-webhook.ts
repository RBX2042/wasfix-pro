/**
 * Resend webhooks: verify the signature and read the event. Pure functions: no I/O, no environment, no clock other than the
 * `nowMs` a caller passes (default Date.now()). The route is src/app/api/webhooks/resend/route.ts; why it exists is
 * DECISIONS.md D20 (an opt-out or a spam complaint at Resend must reach our NewsletterSubscriber table).
 *
 * SIGNATURE. Resend signs its webhooks with Svix, and its documentation names the three Svix headers. The scheme, as Svix
 * documents it (and as the `standardwebhooks` package that @clerk/backend ships implements it; scripts/qa-privacy.ts
 * section 5c signs with that package to check this file against an implementation we did not write):
 *   - headers `svix-id`, `svix-timestamp` (whole seconds since the epoch) and `svix-signature`;
 *   - signed content: `${svix-id}.${svix-timestamp}.${raw body}`, the body exactly as received (before any JSON parsing);
 *   - key: the base64-decoded part of the signing secret after its `whsec_` prefix;
 *   - signature: base64(HMAC-SHA256(key, signed content)); the header carries one or more space-separated entries
 *     `v1,<signature>` (several during a secret rotation), and one matching `v1` entry is enough; other versions are skipped;
 *   - a timestamp more than five minutes from now, in either direction, is refused (a captured delivery cannot be replayed
 *     later; within the window a replay is harmless because every action the route takes is idempotent).
 * Comparison is constant-time (node:crypto timingSafeEqual over equal-length byte strings).
 *
 * EVENTS. The shapes below come from Resend's webhook documentation; NONE was observed from here (no network to Resend, no
 * account). The fields this file relies on, and nothing else:
 *   - every event: `type` (string). `created_at` is read for the log only; it does not order anything, because its exact
 *     meaning was not observed and a wrong guess could drop an objection;
 *   - `contact.updated`: `data.email` (string) and `data.unsubscribed` (boolean). Other contact fields (`id`, `audience_id`,
 *     names, timestamps) are not read: an objection is honoured whatever list it was made on;
 *   - `email.complained`: `data.to`, documented as an array of addresses (a single string is accepted too; an entry in the
 *     form `Name <address>` is reduced to the address). Other email fields (`email_id`, `broadcast_id`, `subject`, ...) are
 *     not read;
 *   - every other type (contact.created, contact.deleted, email.sent, email.bounced, ...) is acknowledged and ignored.
 * A handled type whose relied-on fields are missing or of the wrong type is refused as malformed, so that a change of shape
 * shows as failed deliveries in the Resend dashboard instead of being acknowledged silently.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** Svix's tolerance for the signed timestamp, in seconds, both directions. */
export const RESEND_WEBHOOK_TOLERANCE_SECONDS = 5 * 60;
/**
 * Largest body the route reads; it stops reading as soon as a body passes it, also one sent without a Content-Length.
 * This bounds the route only: under `next start` the middleware makes Next read the whole request first (keeping at
 * most 10 MB by default in each of its two copies), on Vercel the platform's limit applies (see readRawBody in the route).
 * Resend's documented events are a few hundred bytes to a few kilobytes.
 */
export const RESEND_WEBHOOK_MAX_BODY_BYTES = 256 * 1024;
/**
 * POST /api/webhooks/resend: deliveries that do NOT carry a valid signature (missing headers, wrong or expired signature,
 * a body too large), per caller and hour; past it the answer is 429 and nothing is logged, so a stranger cannot fill the
 * log. While RESEND_WEBHOOK_SECRET is missing or malformed every POST counts the same way, but the answer stays 503 and
 * only the error line stops. A delivery that verifies never counts and is never refused by it: Resend delivers through
 * Svix, whose servers every event shares, and a 429 there would only delay an opt-out. (The Stripe and Clerk webhook
 * routes have no rate limit at all; this follows the rule of /api/newsletter/afmelden, where only a token that does not
 * verify counts against the caller.)
 */
export const RESEND_WEBHOOK_INVALID_LIMIT = { max: 30, windowMs: 60 * 60 * 1000 } as const;
const SECRET_PREFIX = "whsec_";
/** A Svix secret decodes to 24 bytes (Svix documentation); anything under 16 bytes is not one. */
const MIN_KEY_BYTES = 16;

export type ResendWebhookSecret =
  | { ok: true; key: Buffer }
  /** `missing`: not set. `no_prefix`: does not start with whsec_. `not_base64`: the rest is not base64. `too_short`: decodes to fewer than 16 bytes. */
  | { ok: false; reason: "missing" | "no_prefix" | "not_base64" | "too_short" };

/**
 * The HMAC key inside RESEND_WEBHOOK_SECRET, or why there is none. Stricter than the Svix libraries (which also take a bare
 * base64 key without the prefix): Resend shows the secret with its prefix, and a value without it is far more likely a
 * different key pasted by mistake (an API key re_...) than a bare Svix key. Shared with scripts/preflight.ts, so the
 * preflight's format check is this exact rule. Never includes the secret in what it returns.
 */
export function parseResendWebhookSecret(raw: string | null | undefined): ResendWebhookSecret {
  const secret = (raw ?? "").trim();
  if (!secret) return { ok: false, reason: "missing" };
  if (!secret.startsWith(SECRET_PREFIX)) return { ok: false, reason: "no_prefix" };
  const b64 = secret.slice(SECRET_PREFIX.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return { ok: false, reason: "not_base64" };
  const key = Buffer.from(b64, "base64");
  if (key.length < MIN_KEY_BYTES) return { ok: false, reason: "too_short" };
  return { ok: true, key };
}

/** base64(HMAC-SHA256(key, `${id}.${timestamp}.${body}`)): the value after `v1,` in a valid svix-signature entry. */
export function resendWebhookSignature(key: Buffer, id: string, timestamp: string, body: string): string {
  return createHmac("sha256", key).update(`${id}.${timestamp}.${body}`, "utf8").digest("base64");
}

export type SvixHeaders = { id: string | null; timestamp: string | null; signature: string | null };

export type ResendWebhookVerdict =
  | { ok: true }
  /** For the log only; the HTTP answer never says which check failed. */
  | { ok: false; reason: "missing_headers" | "bad_timestamp" | "timestamp_too_old" | "timestamp_too_new" | "no_matching_signature" };

/** Constant-time equality of two strings (false at once when their lengths differ, which is not secret: a signature's length is public). */
function sameString(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Verify one delivery per the Svix scheme in the header comment. `body` is the raw request body, unparsed. */
export function verifyResendWebhook(input: { key: Buffer; headers: SvixHeaders; body: string; nowMs?: number }): ResendWebhookVerdict {
  const id = input.headers.id?.trim() ?? "";
  const timestamp = input.headers.timestamp?.trim() ?? "";
  const signatureHeader = input.headers.signature?.trim() ?? "";
  if (!id || !timestamp || !signatureHeader) return { ok: false, reason: "missing_headers" };
  // Whole seconds, digits only (a Svix timestamp is never negative, fractional or in another notation).
  if (!/^\d{1,15}$/.test(timestamp)) return { ok: false, reason: "bad_timestamp" };
  const now = Math.floor((input.nowMs ?? Date.now()) / 1000);
  const ts = Number(timestamp);
  if (now - ts > RESEND_WEBHOOK_TOLERANCE_SECONDS) return { ok: false, reason: "timestamp_too_old" };
  if (ts - now > RESEND_WEBHOOK_TOLERANCE_SECONDS) return { ok: false, reason: "timestamp_too_new" };
  const expected = resendWebhookSignature(input.key, id, timestamp, input.body);
  for (const entry of signatureHeader.split(" ")) {
    const comma = entry.indexOf(",");
    if (comma < 0 || entry.slice(0, comma) !== "v1") continue;
    if (sameString(entry.slice(comma + 1), expected)) return { ok: true };
  }
  return { ok: false, reason: "no_matching_signature" };
}

export type ResendWebhookEvent =
  /** Resend reports a change to a contact; `unsubscribed` is the contact's flag after the change. */
  | { kind: "contact.updated"; type: "contact.updated"; createdAt: Date | null; email: string; unsubscribed: boolean }
  /** A recipient marked a mail as spam; `to` are the mail's recipients as listed (addresses only, trimmed, lower-cased, no duplicates). */
  | { kind: "email.complained"; type: "email.complained"; createdAt: Date | null; to: string[] }
  /** Any other type: acknowledged, nothing changes. */
  | { kind: "ignored"; type: string; createdAt: Date | null };

export type ResendWebhookParse =
  | { ok: true; event: ResendWebhookEvent }
  | { ok: false; reason: "not_json" | "not_an_event" | "contact_without_email" | "contact_without_unsubscribed_flag" | "complaint_without_recipients" };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** An address as our table stores it (the same rule as normalizeNewsletterEmail: trimmed, lower case); `Name <a@b>` gives `a@b`. Null when there is no `@`. */
function addressOf(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const inner = /<([^<>]*)>\s*$/.exec(v)?.[1] ?? v;
  const email = inner.trim().toLowerCase();
  return email.includes("@") ? email : null;
}

/** Read a VERIFIED body. Defensive: anything that is not the documented shape of a handled type is a reason, never a throw. */
export function parseResendWebhookEvent(body: string): ResendWebhookParse {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { ok: false, reason: "not_json" };
  }
  if (!isRecord(json) || typeof json.type !== "string" || !json.type.trim() || json.type.length > 100) return { ok: false, reason: "not_an_event" };
  const type = json.type.trim();
  const createdRaw = typeof json.created_at === "string" ? Date.parse(json.created_at) : NaN;
  const createdAt = Number.isFinite(createdRaw) ? new Date(createdRaw) : null;
  const data = isRecord(json.data) ? json.data : {};

  if (type === "contact.updated") {
    const email = addressOf(data.email);
    if (!email) return { ok: false, reason: "contact_without_email" };
    if (typeof data.unsubscribed !== "boolean") return { ok: false, reason: "contact_without_unsubscribed_flag" };
    return { ok: true, event: { kind: "contact.updated", type, createdAt, email, unsubscribed: data.unsubscribed } };
  }
  if (type === "email.complained") {
    const listed = Array.isArray(data.to) ? data.to : [data.to];
    const to = [...new Set(listed.map(addressOf).filter((a): a is string => a !== null))];
    if (to.length === 0) return { ok: false, reason: "complaint_without_recipients" };
    return { ok: true, event: { kind: "email.complained", type, createdAt, to } };
  }
  return { ok: true, event: { kind: "ignored", type, createdAt } };
}
