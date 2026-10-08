/**
 * The public address of this deployment (NEXT_PUBLIC_APP_URL) and whether it is usable.
 *
 * Self-contained on purpose (no "@/" imports, no env.ts): next.config.ts loads it
 * at build time, and scripts/preflight.ts loads it outside Next.
 *
 * WHY this exists: src/lib/env.ts falls back to http://localhost:3000 when the
 * variable is missing. In production that address ends up in Stripe return URLs,
 * every e-mail button, the sitemap and robots.txt, and nothing complained.
 * Checkout already refuses to sell in that state (src/lib/cart-gate.ts); this
 * module is the shared definition of "usable" for everything else.
 */

/** The shape of an environment: process.env, or a plain object in tests. */
export type EnvLike = Record<string, string | undefined>;


export type AppUrlCheck = {
  /** Normalised origin without a trailing slash, or null when it cannot be used as a public address. */
  url: string | null;
  /** Reasons it must not be used in production. Empty = fine. */
  errors: string[];
  /** Usable, but probably not what the owner wants long-term. */
  warnings: string[];
};

const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\]|::1)$/i;

export function checkAppUrl(raw: string | undefined | null): AppUrlCheck {
  const value = (raw ?? "").trim();
  if (!value) return { url: null, errors: ["NEXT_PUBLIC_APP_URL is niet ingesteld"], warnings: [] };

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { url: null, errors: [`NEXT_PUBLIC_APP_URL is geen geldige URL (verwacht bijvoorbeeld https://wasfix.nl)`], warnings: [] };
  }

  const errors: string[] = [];
  const warnings: string[] = [];
  if (LOCAL_HOST.test(parsed.hostname)) errors.push("NEXT_PUBLIC_APP_URL wijst naar een lokaal adres (localhost)");
  if (parsed.protocol !== "https:" && !LOCAL_HOST.test(parsed.hostname)) errors.push("NEXT_PUBLIC_APP_URL moet met https:// beginnen (Stripe accepteert voor live geen http-terugkeeradressen)");
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) errors.push("NEXT_PUBLIC_APP_URL moet alleen een domein zijn, zonder pad, zoekopdracht of #");
  if (/\.vercel\.app$/i.test(parsed.hostname)) warnings.push("NEXT_PUBLIC_APP_URL is een *.vercel.app-adres: prima om te testen, maar zoekmachines en klanten horen het eigen domein te zien");

  const origin = parsed.origin;
  return { url: errors.length === 0 ? origin : null, errors, warnings };
}

/**
 * The address to put in sitemap, robots.txt and metadata.
 *
 * Outside production the local fallback is fine (development, tests). In
 * production an unusable value returns null, and the caller must emit nothing
 * rather than an address that is wrong.
 */
export function siteUrl(env: EnvLike = process.env): string | null {
  const raw = env.NEXT_PUBLIC_APP_URL;
  if (env.NODE_ENV !== "production") {
    // Dev and tests: any parseable origin is accepted, including http://localhost:3000.
    try {
      return raw && raw.trim() ? new URL(raw.trim()).origin : "http://localhost:3000";
    } catch {
      return "http://localhost:3000";
    }
  }
  return checkAppUrl(raw).url;
}

/**
 * Host counterpart for the canonical-host redirect: the www variant of an apex
 * domain and vice versa. null for hosts where the question does not arise
 * (localhost, *.vercel.app, IP addresses).
 */
export function alternateHost(url: string | null): string | null {
  if (!url) return null;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (LOCAL_HOST.test(host) || /\.vercel\.app$/.test(host) || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
  return host.startsWith("www.") ? host.slice(4) : `www.${host}`;
}
