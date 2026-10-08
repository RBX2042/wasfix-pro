/**
 * Browser side of error reporting, used by the error boundaries
 * (src/app/error.tsx, src/app/global-error.tsx).
 *
 * An exception thrown while rendering a SERVER component is already reported
 * by src/instrumentation.ts, and the browser receives it with a `digest` and a
 * message React has deliberately blanked. One thrown in the BROWSER (an event
 * handler, a client component) never reaches the server, so it is posted to
 * /api/client-error. Only what helps find it is sent: the name, the first line of
 * the message and the path WITHOUT its query string (an order link carries its
 * access token there).
 */

export function reportClientError(error: Error & { digest?: string }): void {
  // Server errors are reported where they happened; do not tell the owner twice.
  if (error.digest) return;
  try {
    const body = JSON.stringify({
      name: String(error.name || "Error").slice(0, 60),
      message: String(error.message || "").split(/\r?\n/)[0].slice(0, 160),
      path: window.location.pathname.slice(0, 200),
    });
    const blob = new Blob([body], { type: "application/json" });
    if (!navigator.sendBeacon?.("/api/client-error", blob)) {
      void fetch("/api/client-error", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => undefined);
    }
  } catch {
    // Reporting is best effort.
  }
}
