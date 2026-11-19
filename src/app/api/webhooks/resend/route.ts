import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getClientKey, rateLimit } from "@/lib/ratelimit";
import { recordResendOptOut, type ResendReportedOptOut } from "@/lib/newsletter";
import {
  parseResendWebhookEvent,
  parseResendWebhookSecret,
  RESEND_WEBHOOK_INVALID_LIMIT,
  RESEND_WEBHOOK_MAX_BODY_BYTES,
  verifyResendWebhook,
} from "@/lib/resend-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every acknowledgement is this same body, whatever happened to which address: the answer tells nobody who is on the list. */
const acknowledged = () => NextResponse.json({ received: true }, { headers: { "cache-control": "no-store" } });
const refuse = (status: number, error: string) => NextResponse.json({ error }, { status, headers: { "cache-control": "no-store" } });

/**
 * src/lib/logger.ts has no debug level. An event we acknowledge and do not act on is a debug line: written outside
 * production only (where it helps to see what Resend sends), nothing in production (where an owner who subscribed the
 * endpoint to every email event would otherwise get a line per delivered, opened and clicked mail).
 */
function debug(msg: string, data: Record<string, unknown>): void {
  if (process.env.NODE_ENV !== "production") console.debug(`[WasFix ${new Date().toISOString()}] [DEBUG]`, msg, data);
}

type RawBody = { ok: true; body: string } | { ok: false; reason: "body_too_large" | "body_unreadable" };

/**
 * The RAW body as text, read chunk by chunk and abandoned as soon as it passes `max` bytes, also without a
 * Content-Length: the route itself never keeps or decodes more than `max` (the one chunk that crosses it is read and
 * dropped). That bounds the route, NOT what the server receives. The src/middleware.ts matcher includes this path, and
 * for a matched request `next start` copies the body for the middleware and waits until the request has ENDED before
 * this handler runs (next/dist/server/body-streams.js, Next 15.5): it makes TWO copies, one for the middleware and one
 * for this handler, each of at most experimental.middlewareClientMaxBodySize (10 MB by default; the rest is dropped),
 * so up to about 20 MB per request (read in the source, not measured), and a 413 comes only after the sender has
 * finished. On Vercel the platform's request-body limit applies first (not exercised
 * from here). The bytes are decoded once, after concatenation, as UTF-8 the way req.text() decodes them (a leading BOM
 * dropped, invalid sequences replaced), so a character split across two chunks stays whole. Nothing is parsed or
 * re-serialised: the signature covers the bytes as sent.
 */
async function readRawBody(req: NextRequest, max: number): Promise<RawBody> {
  if (!req.body) return { ok: true, body: "" };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "body_too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: "body_unreadable" };
  }
  return { ok: true, body: new TextDecoder("utf-8").decode(Buffer.concat(chunks)) };
}

/**
 * Resend webhook receiver (DECISIONS.md D20): an opt-out made AT Resend (its own unsubscribe link in a broadcast) or a
 * spam complaint must reach our NewsletterSubscriber table, which is authoritative; otherwise the address stays a
 * subscriber here and is back in the next CSV of opt-out links. Configure in Resend: Webhooks, endpoint
 * <NEXT_PUBLIC_APP_URL>/api/webhooks/resend, events contact.updated and email.complained, and put the endpoint's signing
 * secret (whsec_...) in RESEND_WEBHOOK_SECRET.
 *
 *   - Every delivery is verified (Svix scheme, src/lib/resend-webhook.ts) on the RAW body before anything is parsed. Without
 *     a usable secret every delivery is refused with 503 and an error line, in development as in production: an
 *     unsigned event is a stranger unsubscribing people (the line at most RESEND_WEBHOOK_INVALID_LIMIT.max times per
 *     caller and hour; the 503 always). A signature that does not verify: 400, no detail.
 *   - contact.updated with unsubscribed true, and email.complained for each listed address that is in our table: the
 *     opt-out is recorded on the same table path as our own link (src/lib/newsletter.ts recordResendOptOut: first timestamp
 *     kept; a complaint also flags the audience contact, after the response).
 *   - contact.updated with unsubscribed false: NOTHING changes. Consent only comes from our double opt-in; our own
 *     confirmation causes exactly this event (it PATCHes the contact to unsubscribed:false), so it is logged at info.
 *   - Every other type (contact.created, contact.deleted, email.*): acknowledged, no change, a debug line.
 *   - An address we do not know: acknowledged, no change, the same answer (no enumeration). The address is never logged.
 *   - The table cannot be written: 500, so Resend delivers the event again (every step is idempotent). No database
 *     configured at all: 503 with an error line, for the same reason.
 * The event shapes come from Resend's documentation and were not observed from here.
 */
export async function POST(req: NextRequest) {
  /** Counts one delivery that has not verified against its caller; false once the caller is past the hourly limit. */
  const withinUnverifiedLimit = () => {
    const { max, windowMs } = RESEND_WEBHOOK_INVALID_LIMIT;
    return rateLimit(`resend-webhook-invalid:${getClientKey(req)}`, max, windowMs);
  };

  const secret = parseResendWebhookSecret(process.env.RESEND_WEBHOOK_SECRET);
  if (!secret.ok) {
    // Without a secret nothing can verify, so every POST counts as a delivery that did not verify: the error line (which
    // also reaches the owner's error sink) is written for the first ones per caller and hour, after that the same 503
    // without a line, so that strangers cannot fill the log while the secret is missing. The answer stays 503 either way.
    if (await withinUnverifiedLimit()) {
      logger.error(
        secret.reason === "missing"
          ? "[resend-webhook] RESEND_WEBHOOK_SECRET is not set: every Resend webhook is refused, so opt-outs and spam complaints made at Resend do not reach the newsletter table"
          : "[resend-webhook] RESEND_WEBHOOK_SECRET is not a Resend signing secret (whsec_ followed by base64): every Resend webhook is refused",
        { reason: secret.reason },
      );
    }
    return refuse(503, "Webhook not configured");
  }

  /** A delivery without a valid signature: counted against the caller, logged while under the limit (reason only). */
  const unsigned = async (status: 400 | 413, error: string, reason: string) => {
    if (!(await withinUnverifiedLimit())) return refuse(429, "Too many requests");
    logger.warn("[resend-webhook] delivery refused before its signature was accepted", { reason });
    return refuse(status, error);
  };

  if (Number(req.headers.get("content-length") ?? 0) > RESEND_WEBHOOK_MAX_BODY_BYTES) return unsigned(413, "Payload too large", "body_too_large");
  // The RAW body, capped while the route reads it (readRawBody says what Next reads before that): the signature covers the
  // bytes as sent, so nothing may parse or re-serialise it first.
  const raw = await readRawBody(req, RESEND_WEBHOOK_MAX_BODY_BYTES);
  if (!raw.ok) return raw.reason === "body_too_large" ? unsigned(413, "Payload too large", raw.reason) : unsigned(400, "Invalid signature", raw.reason);
  const body = raw.body;

  const svixId = req.headers.get("svix-id");
  const verdict = verifyResendWebhook({
    key: secret.key,
    headers: { id: svixId, timestamp: req.headers.get("svix-timestamp"), signature: req.headers.get("svix-signature") },
    body,
  });
  if (!verdict.ok) return unsigned(400, "Invalid signature", verdict.reason);

  const parsed = parseResendWebhookEvent(body);
  if (!parsed.ok) {
    // Signed by Resend but not the documented shape: refused, so it shows as a failed delivery in the Resend dashboard.
    logger.warn("[resend-webhook] signed delivery is not a readable event", { reason: parsed.reason, id: svixId });
    return refuse(400, "Invalid payload");
  }
  const event = parsed.event;
  const age = event.createdAt ? Math.round((Date.now() - event.createdAt.getTime()) / 1000) : null;

  if (event.kind === "ignored") {
    debug("[resend-webhook] event type not handled: acknowledged, nothing changed", { type: event.type, id: svixId });
    return acknowledged();
  }
  if (event.kind === "contact.updated" && !event.unsubscribed) {
    // Never a subscription: consent only comes from our double opt-in (src/lib/newsletter.ts). Our own confirmation
    // PATCHes the contact to unsubscribed:false, so this is the expected echo of every confirmation.
    logger.info("[resend-webhook] contact.updated with unsubscribed:false: our table is not changed (consent only through our double opt-in)", { id: svixId });
    return acknowledged();
  }

  if (!isDatabaseConfigured()) {
    logger.error("[resend-webhook] an opt-out arrived but no database is configured: refused so Resend delivers it again", { type: event.type, id: svixId });
    return refuse(503, "Not available");
  }

  const addresses = event.kind === "contact.updated" ? [event.email] : event.to;
  const kind: ResendReportedOptOut = event.kind === "contact.updated" ? "resend_unsubscribe" : "spam_complaint";
  const tally = { unsubscribed: 0, already: 0, unknown: 0 };
  for (const address of addresses) {
    const result = await recordResendOptOut(address, kind);
    if (!result.ok) {
      // recordOptOut logged the cause (without the address). Earlier addresses of this event are recorded; the retry
      // finds them "already" and continues with the rest.
      logger.error("[resend-webhook] opt-out could not be stored: answered 500 so Resend delivers the event again", { type: event.type, id: svixId });
      return refuse(500, "Not stored");
    }
    tally[result.status] += 1;
  }
  logger.info("[resend-webhook] opt-out reported by Resend processed", { type: event.type, id: svixId, ageSeconds: age, ...tally });
  return acknowledged();
}
