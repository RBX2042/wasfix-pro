import { env, isClerkConfigured } from "./env";
import { logger } from "./logger";

let warnedOnce = false;

/**
 * Demo mode = no real authentication (every visitor is auto-signed-in as
 * the seeded admin — see getCurrentUser() in auth.ts). Active when
 * DEMO_MODE=true, or — outside production only — when Clerk keys are
 * missing, so local dev needs no keys.
 *
 * SECURITY: in production, missing Clerk keys must NOT fall through to
 * demo mode. That would mean a half-configured production deploy (keys
 * not yet added to Vercel) silently grants every visitor admin access
 * instead of failing closed. Production demo mode must be an explicit,
 * conscious DEMO_MODE=true.
 */
export function isDemoMode(): boolean {
  if (env.DEMO_MODE) {
    if (env.IS_PRODUCTION && !warnedOnce) {
      warnedOnce = true;
      logger.error(
        "DEMO_MODE=true in production — every visitor is auto-authenticated as the demo admin. " +
          "This must be turned off before real user/order data exists in the database."
      );
    }
    return true;
  }
  if (env.IS_PRODUCTION) return false;
  return !isClerkConfigured();
}
