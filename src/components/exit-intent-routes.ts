/**
 * Where the exit-intent popup must never appear. A plain module (no React, no Next)
 * so the rule can be unit-checked from scripts/qa-storefront.ts.
 *
 * A modal over a half-filled payment form, an order confirmation or the upgrade flow
 * costs sales; on /checkout a top-edge mouseleave used to open it over the form, and
 * on a phone a fast downward swipe did the same. Account and admin screens are not
 * marketing surfaces either, and /diagnose is the product itself.
 */
export const EXIT_INTENT_BLOCKED_PREFIXES = [
  "/checkout", "/bestelling", "/upgrade", "/inloggen", "/registreren",
  "/dashboard", "/admin", "/monteur", "/retour", "/diagnose",
];

export function exitIntentAllowed(pathname: string): boolean {
  return !EXIT_INTENT_BLOCKED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
