import { env } from "./env";
import { logger } from "./logger";

let warnedOnce = false;

/**
 * Whether the app should treat every visitor as an authenticated demo user
 * (see auth.ts) instead of requiring real Clerk sign-in.
 *
 * SECURITY: in production this must be an explicit, conscious choice
 * (DEMO_MODE=true) — never an implicit side effect of a missing secret.
 * A missing CLERK_SECRET_KEY in production means auth is misconfigured;
 * the correct behavior is to fail closed (nobody gets in) via the real
 * Clerk code path, not to fail open (everybody gets admin).
 *
 * Outside production, falling back to demo mode when CLERK_SECRET_KEY is
 * absent is fine — it's what lets `next dev` run without any keys.
 */
export function isDemoMode(): boolean {
  if (env.DEMO_MODE) {
    if (env.IS_PRODUCTION && !warnedOnce) {
      warnedOnce = true;
      logger.error(
        "DEMO_MODE=true in production — every visitor is auto-authenticated as the demo superadmin. " +
          "This must be turned off before real customer data exists in the database."
      );
    }
    return true;
  }
  if (env.IS_PRODUCTION) return false;
  return !env.CLERK_SECRET_KEY;
}
