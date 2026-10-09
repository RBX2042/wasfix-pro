/**
 * What may be taken from a browser error report (src/app/api/client-error/route.ts).
 *
 * Kept out of the route file because a Next route module may only export HTTP
 * handlers and route config, and these need unit tests.
 *
 * The rule: nothing a browser sends is forwarded to the owner as TEXT. Only an
 * error name from a fixed list and a path matching a strict pattern survive.
 */

const ALERTABLE_NAMES = new Set([
  "Error", "TypeError", "ReferenceError", "RangeError", "SyntaxError", "EvalError", "URIError",
  "ChunkLoadError", "SecurityError", "NetworkError", "AbortError", "NotAllowedError", "QuotaExceededError", "DOMException",
]);

// Letters, digits and / _ - . [ ]: no ':' (so no URL), no space (so no sentence).
const SAFE_PATH = /^\/[A-Za-z0-9/_\-.[\]]{0,100}$/;

export function alertableName(claimed: unknown): string {
  return typeof claimed === "string" && ALERTABLE_NAMES.has(claimed) ? claimed : "Error";
}

export function alertablePath(claimed: unknown): string {
  const raw = typeof claimed === "string" ? (claimed.split(/[?#]/)[0] ?? "") : "";
  return SAFE_PATH.test(raw) ? raw : "?";
}

/**
 * True when the request comes from a page of this same site. Sec-Fetch-Site is set
 * by the browser and cannot be changed by page script; Origin is the fallback for
 * browsers/contexts that do not send it. This stops OTHER sites from making their
 * visitors' browsers post here. It does not stop a scripted client (curl) that
 * sends matching headers by hand, which is why the route also limits volume.
 */
export function sameOrigin(headers: Pick<Headers, "get">): boolean {
  const site = headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === (headers.get("host") ?? "");
  } catch {
    return false;
  }
}
