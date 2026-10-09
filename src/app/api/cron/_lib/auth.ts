import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Guard for every scheduled route.
 *
 *   - CRON_SECRET unset: EVERYTHING is refused (503). A scheduled route that
 *     runs for anyone who can guess its URL would let strangers trigger
 *     cancellations, mails and Stripe calls.
 *   - Authorization must be exactly "Bearer <CRON_SECRET>" (Vercel Cron sends
 *     that header when CRON_SECRET is set in the project). The comparison is
 *     constant time: SHA-256 digests of equal length through timingSafeEqual.
 *   - The presented value is never logged.
 *
 * Returns the response to send when the caller is refused, or null when allowed.
 */
export function refuseUnlessCron(req: Request, secret: string | null | undefined = env.CRON_SECRET): NextResponse | null {
  if (!secret) {
    logger.error("[cron] refused: CRON_SECRET is not set");
    return NextResponse.json({ ok: false, error: "cron_not_configured" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const header = req.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(secret).digest();
  if (!presented || !timingSafeEqual(a, b)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  return null;
}

/** Run a job behind the guard; a crash is logged, reported to the owner and answered with a 500 and no detail. */
export async function runCron(req: Request, name: string, job: () => Promise<Record<string, unknown>>): Promise<NextResponse> {
  const refused = refuseUnlessCron(req);
  if (refused) return refused;
  const started = Date.now();
  try {
    const result = await job();
    return NextResponse.json({ ok: true, job: name, ms: Date.now() - started, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    logger.error(`[cron] ${name} failed`, err);
    const { notifyError } = await import("@/lib/notify");
    await notifyError(err, { where: `cron ${name}` });
    return NextResponse.json({ ok: false, job: name, error: "job_failed" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
