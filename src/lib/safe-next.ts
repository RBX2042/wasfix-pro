import { env } from "./env";

/** A query parameter can arrive once, repeated (an array) or not at all; only the first value is used. */
export function firstParam(value: unknown): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === "string" ? v : undefined;
}

const MAX_LENGTH = 2000;

/**
 * The place to go after signing in or registering, taken from the address bar
 * and therefore not to be trusted. Accepts a path on this site ("/upgrade?plan=X")
 * or an absolute URL on this site's own origin (Clerk's middleware puts the full
 * URL of the page you were sent away from in redirect_url); anything else becomes
 * the fallback.
 *
 * WHY it parses instead of pattern-matching: a browser strips tabs and newlines
 * from a URL before reading it, so "/<TAB>/evil.com" is the protocol-relative
 * "//evil.com" to the browser while a startsWith("//") test sees "/\t". The same
 * parser the browser uses (WHATWG URL) decides here, and only a result that is
 * still on our own origin is accepted. Non-strings (a repeated query parameter
 * arrives as an array) are treated as absent rather than throwing.
 */
export function safeNext(raw: unknown, fallback = "/dashboard"): string {
  const value = firstParam(raw);
  if (!value || value.length > MAX_LENGTH) return fallback;
  if (!value.startsWith("/") && !/^https?:\/\//i.test(value)) return fallback;
  try {
    const own = new URL(env.APP_URL);
    const url = new URL(value, own.origin);
    if (url.origin !== own.origin) return fallback;
    const target = `${url.pathname}${url.search}${url.hash}`;
    // "//host" can never come out of an origin-checked parse, but a result is only ever used as a local path.
    if (!target.startsWith("/") || target.startsWith("//")) return fallback;
    return target;
  } catch {
    return fallback;
  }
}

// A Map, not an object: ?plan=__proto__ or ?plan=constructor must not find anything.
const PLAN_REDIRECT = new Map<string, string>([
  ["particulier", "/upgrade?plan=PARTICULIER"],
  ["monteur_pro", "/upgrade?plan=MONTEUR_PRO"],
  ["bedrijf", "/upgrade?plan=BEDRIJF"],
]);

/** Where /inloggen sends the person afterwards: ?next=, or Clerk's own ?redirect_url=, else the dashboard. */
export function signInTarget(sp: { next?: unknown; redirect_url?: unknown }): string {
  return safeNext(firstParam(sp.next) ?? firstParam(sp.redirect_url));
}

/** Where /registreren sends the person afterwards: ?next=, else the payment page of ?plan=, else the dashboard. */
export function signUpTarget(sp: { next?: unknown; plan?: unknown }): string {
  return safeNext(firstParam(sp.next) ?? PLAN_REDIRECT.get((firstParam(sp.plan) ?? "").toLowerCase()));
}
