import { after, NextRequest, NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { clientErrorGate, firstLine, normaliseForSignature, pathOnly, sharedGate } from "@/lib/monitoring";
import { notifyError } from "@/lib/notify";
import { logger } from "@/lib/logger";
import { alertableName, alertablePath, sameOrigin } from "@/lib/client-error";

export const dynamic = "force-dynamic";

/**
 * Receives errors thrown in the visitor's browser (see src/lib/report-client-error.ts).
 *
 * It is public by nature, and what arrives is text an anonymous visitor wrote.
 * So it is built on one rule: NOTHING the browser says is forwarded to the
 * owner's channel as text. The owner is told only
 *   - an error NAME from a fixed list (anything else becomes "Error"), and
 *   - a route path that matches a strict pattern (letters, digits and / _ - . [ ]),
 *     so a link or a sentence cannot be put into it.
 * The message the browser sent goes to the platform log (logger.warn), where the
 * owner can read it but nobody is being steered by it.
 *
 * Limits, all per server process (a serverless deployment has several):
 *   - body over 1 KB: refused; 5 requests a minute per client address
 *   - same-origin only (see sameOrigin): stops OTHER sites making visitors' browsers
 *     post here; a scripted client can still send the right headers, which is why
 *     the rest of this list exists
 *   - identical alerts once per 15 minutes; at most 3 alerts an hour from this route
 *     (clientErrorGate), and those still pass the one shared gate for all owner
 *     error alerts (sharedGate), so browsers can neither flood the channel nor
 *     use up the cap meant for server errors
 * It stores nothing and echoes nothing.
 */
const MAX_BODY = 1024;

export async function POST(req: NextRequest) {
  const ok = NextResponse.json({ ok: true }, { status: 202, headers: { "Cache-Control": "no-store" } });
  try {
    if (!sameOrigin(req.headers)) return NextResponse.json({ ok: false }, { status: 403 });
    const raw = await req.text();
    if (raw.length > MAX_BODY) return NextResponse.json({ ok: false }, { status: 413 });
    if (!(await rateLimit(`client-error:${clientIp(req) || "anon"}`, 5, 60_000))) return NextResponse.json({ ok: false }, { status: 429 });

    const body = JSON.parse(raw) as { name?: unknown; message?: unknown; path?: unknown };
    const claimedName = typeof body.name === "string" ? body.name : "";
    const name = alertableName(claimedName);
    const message = typeof body.message === "string" ? firstLine(body.message) : "";
    const rawPath = typeof body.path === "string" ? pathOnly(body.path) : "";
    const path = alertablePath(rawPath);

    logger.warn("[client-error]", { name: claimedName.slice(0, 60), path: rawPath.slice(0, 200), message });

    // Dedupe on name + path only: the browser's text must not be able to mint new signatures.
    const signature = `client|${normaliseForSignature(path)}|${name}`;
    const own = clientErrorGate().admit(signature);
    if (own.send) {
      const shared = sharedGate().admit(signature);
      if (shared.send) {
        const sent = notifyError(new Error(`${name} in de browser (de melding zelf staat in het serverlog)`), {
          where: `browser ${path}`,
          herhaald: own.suppressed > 0 ? `${own.suppressed} gelijke meldingen onderdrukt` : undefined,
        });
        try {
          after(() => sent);
        } catch {
          // Outside a request scope (a test): the call is already running.
        }
      }
    }
  } catch {
    // Malformed input is dropped silently: nothing here is worth an error of its own.
  }
  return ok;
}
