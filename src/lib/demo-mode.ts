import { env, isClerkConfigured } from "./env";

/**
 * Demo mode = no real authentication; every visitor resolves to the demo
 * superadmin. That is a development convenience and must never be reachable in
 * production, where it would hand admin rights to anyone. In production the
 * answer is always false: if Clerk is not configured there, nobody is signed
 * in and getCurrentUser() returns null, which locks the private pages rather
 * than opening them.
 */
export function isDemoMode(): boolean {
  if (env.IS_PRODUCTION) return false;
  return env.DEMO_MODE || !isClerkConfigured();
}
