/**
 * Can this deployment take an order at all?
 *
 * Asked in two places: /checkout (before the customer fills in the form) and
 * /api/checkout (the one that is actually enforced). In production it fails
 * CLOSED:
 *   - no usable database  -> an order would be acknowledged and never stored
 *   - company identity not ready -> an invoice or a wire instruction would carry
 *     a placeholder KvK, btw-nummer or IBAN
 *   - NEXT_PUBLIC_APP_URL unusable (unset, local, no https://, or carrying a path) -> the
 *     "bekijk je bestelling" button of the e-mail, the Stripe return address and the owner's
 *     admin links would point at localhost or be rejected by Stripe. "Unusable" is defined in
 *     ONE place, src/lib/site-url.ts, shared with the build, the sitemap and `npm run preflight`
 * Outside production both checks are skipped so local development and the demo
 * keep working.
 *
 * `missing` holds field NAMES for the log, never values; the customer-facing
 * message deliberately lists nothing.
 */
import { env, isDatabaseConfigured } from "./env";
import { companyReadiness } from "./plans";
import { checkAppUrl } from "./site-url";

export type CheckoutBlock =
  | { code: "database"; missing: string[] }
  | { code: "company"; missing: string[] }
  | { code: "app_url"; missing: string[] };

/** True for the address the app falls back to when NEXT_PUBLIC_APP_URL is not set, and for any other local address. */
export function appUrlIsLocal(url: string = env.APP_URL): boolean {
  return /^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(url);
}

/** True when NEXT_PUBLIC_APP_URL cannot be used as the public address (the same test as the production build and preflight). */
export function appUrlIsUnusable(url: string = env.APP_URL): boolean {
  return checkAppUrl(url).url === null;
}

export function checkoutBlockedReason(): CheckoutBlock | null {
  if (!env.IS_PRODUCTION) return null;
  if (!isDatabaseConfigured()) return { code: "database", missing: ["DATABASE_URL"] };
  const readiness = companyReadiness();
  if (!readiness.ready) return { code: "company", missing: readiness.missing.map(String) };
  if (appUrlIsUnusable()) return { code: "app_url", missing: ["NEXT_PUBLIC_APP_URL"] };
  return null;
}

/** What the customer is told. Same text for both causes: nothing about the configuration leaks. */
export const CHECKOUT_UNAVAILABLE_MESSAGE =
  "Bestellen is op dit moment niet mogelijk. Er is niets besteld en er is niets afgeschreven. Probeer het later opnieuw of mail ons.";
