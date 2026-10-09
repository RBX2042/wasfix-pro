/**
 * Next.js instrumentation hook: runs once per server process (register) and for
 * every exception that escapes a request (onRequestError).
 *
 * Until this existed, a crash in a route was a line in the platform log that
 * nobody read: a checkout failing for every customer looked exactly like quiet.
 * Now the owner is told through src/lib/notify.ts (Slack, Discord, e-mail; see
 * .env.example) with a cool-down per error signature and a cap on the total
 * (src/lib/monitoring.ts), so one failing dependency cannot flood the channel.
 *
 * Node.js runtime only. The edge runtime (middleware) cannot load the owner
 * notification module (it uses Node APIs), so there errors stay in the log.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { initMonitoring } = await import("./lib/monitoring");
  await initMonitoring();
}

export async function onRequestError(
  err: unknown,
  request: { path: string; method: string },
  context: { routerKind?: string; routePath?: string; routeType?: string; renderSource?: string },
) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { logger } = await import("./lib/logger");
    const { getReporter, pathOnly } = await import("./lib/monitoring");
    const { notifyError } = await import("./lib/notify");
    // The log line is the full record (the stack included); the owner message is the short one.
    logger.error(`[request] ${request.method} ${context.routePath || pathOnly(request.path)} failed (${context.routeType ?? "route"})`, err, { report: false });
    // Awaited, because a serverless function may be frozen the moment the response
    // is sent and a message still in flight would be lost; but capped, so a dead
    // Slack can hold a failing request back by 2 s at most, and only the first
    // time that error appears in a 15-minute period (src/lib/monitoring.ts).
    await Promise.race([getReporter(notifyError).requestError(err, request, context), new Promise((resolve) => setTimeout(resolve, 2000))]);
  } catch {
    // Monitoring must never turn an error into a second one.
  }
}
