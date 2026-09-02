/**
 * Build-time flag (see next.config.ts) telling client + server code whether
 * real Clerk auth is active. Safe to import anywhere.
 */
export const CLERK_ENABLED = process.env.NEXT_PUBLIC_CLERK_ENABLED === "true";
