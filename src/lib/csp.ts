/**
 * Content-Security-Policy for the whole site, built from the environment.
 *
 * Self-contained (no "@/" imports): next.config.ts loads it at build time and
 * scripts/qa-csp.ts / scripts/preflight.ts load it outside Next.
 *
 * WHY it is a function and not a constant: a production Clerk instance does
 * not live on a fixed host. Its frontend API sits on the owner's own domain
 * (clerk.<domain>) and clerk-js, its XHRs and its bot-challenge iframe all load
 * from there. With a static policy that listed only *.clerk.accounts.dev,
 * sign-in and sign-up were blocked by our own header the day pk_live_ keys were
 * set, and nobody could reach the account area or pay as a member. The host is
 * encoded in the publishable key (base64 of "<host>$"), so it is read from there.
 *
 * Headers are baked into the build (routes-manifest), so a change to any of the
 * variables read here needs a rebuild, exactly like every other NEXT_PUBLIC_ value.
 */
import type { EnvLike } from "./site-url";




export type CspInput = {
  /** true = enforcing header; false = Report-Only and 'unsafe-eval' for HMR. */
  production: boolean;
  /** NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY. */
  clerkPublishableKey?: string | null;
  /** NEXT_PUBLIC_POSTHOG_KEY: PostHog hosts are only allowed when it is configured. */
  posthogKey?: string | null;
  /** NEXT_PUBLIC_GA_ID: Google Analytics hosts are only allowed when it is configured. */
  gaId?: string | null;
};

/** A hostname, nothing else: the value ends up inside a header, so ";" or spaces must never get through. */
const HOSTNAME = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

export type ClerkKeyInfo = { host: string; mode: "live" | "test" };

/**
 * The Clerk frontend API host encoded in a publishable key, or null for anything
 * that is not a well-formed key. pk_live_Y2xlcmsud2FzZml4Lm5sJA -> clerk.wasfix.nl
 */
export function clerkKeyInfo(publishableKey: string | null | undefined): ClerkKeyInfo | null {
  const match = /^pk_(live|test)_([A-Za-z0-9+/_-]+={0,2})$/.exec((publishableKey ?? "").trim());
  if (!match) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(match[2], "base64").toString("utf8");
  } catch {
    return null;
  }
  const host = decoded.replace(/\$$/, "").trim().toLowerCase();
  if (!HOSTNAME.test(host)) return null;
  return { host, mode: match[1] as "live" | "test" };
}

export function buildCsp(input: CspInput): string {
  const clerk = clerkKeyInfo(input.clerkPublishableKey);
  const clerkHost = clerk ? `https://${clerk.host}` : "";
  // Test keys (development instances and Vercel previews) serve clerk-js and the
  // account pages from *.clerk.accounts.dev. A live key does not need the wildcard,
  // and a wildcard on a domain anybody can register under is not worth having.
  const clerkTest = clerk?.mode === "test" ? "https://*.clerk.accounts.dev" : "";
  const posthog = input.posthogKey ? "https://*.posthog.com" : "";
  const ga = input.gaId ? "https://www.googletagmanager.com" : "";
  const gaConnect = input.gaId ? "https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com" : "";
  const gaImg = input.gaId ? "https://*.google-analytics.com https://www.googletagmanager.com" : "";

  const join = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

  return [
    "default-src 'self'",
    join(
      "script-src 'self' 'unsafe-inline'",
      !input.production && "'unsafe-eval'",
      "https://va.vercel-scripts.com https://*.vercel-analytics.com https://js.stripe.com",
      // Clerk bot protection (Cloudflare Turnstile) runs as a script and in an iframe.
      clerk && join(clerkHost, "https://challenges.cloudflare.com", clerkTest),
      posthog,
      ga,
    ),
    // Tailwind / inline styles for SSR-streamed content
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    join(
      "img-src 'self' data: blob: https://*.supabase.co https://images.unsplash.com https://cdn.jsdelivr.net https://img.clerk.com https://placehold.co https://*.gravatar.com",
      gaImg,
    ),
    "font-src 'self' data: https://fonts.gstatic.com",
    join(
      "connect-src 'self' https://*.supabase.co https://img.clerk.com https://api.stripe.com https://va.vercel-scripts.com https://*.vercel-analytics.com https://generativelanguage.googleapis.com",
      clerk && join(clerkHost, "https://clerk-telemetry.com", clerkTest),
      posthog,
      gaConnect,
    ),
    join("frame-src 'self' https://js.stripe.com https://*.youtube-nocookie.com https://www.youtube.com", clerk && "https://challenges.cloudflare.com"),
    // clerk-js starts a web worker from a blob: URL.
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
}

export function cspHeaderName(production: boolean): string {
  // Report-Only in development so HMR and React Refresh are never blocked.
  return production ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only";
}

/** The policy for the current process environment. */
export function cspFromEnv(env: EnvLike = process.env): string {
  return buildCsp({
    production: env.NODE_ENV === "production",
    clerkPublishableKey: env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    posthogKey: env.NEXT_PUBLIC_POSTHOG_KEY,
    gaId: env.NEXT_PUBLIC_GA_ID,
  });
}
