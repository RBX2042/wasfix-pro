import { env, isClerkConfigured } from "./env";

/**
 * Demo mode = no real authentication. Active when DEMO_MODE=true or when
 * Clerk keys are missing (the app can never lock users out by accident).
 */
export function isDemoMode(): boolean {
  return env.DEMO_MODE || !isClerkConfigured();
}
