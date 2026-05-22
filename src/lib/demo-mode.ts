import { env } from "./env";

export function isDemoMode(): boolean {
  return env.DEMO_MODE || !env.CLERK_SECRET_KEY;
}
