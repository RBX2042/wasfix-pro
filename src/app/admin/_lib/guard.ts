import { getCurrentUser } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/env";

export type ActionState = { ok: boolean; message?: string; error?: string; at?: number };

/**
 * Every admin mutation starts here. A server action is a public POST endpoint
 * the moment it is exported, so hiding the button is not access control: the
 * role is checked again on every call. Returns a state object instead of
 * throwing so the form can show the reason.
 */
export async function adminGuard(): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") return { ok: false, error: "Geen toegang." };
  if (!isDatabaseConfigured()) return { ok: false, error: "Geen database geconfigureerd." };
  return { ok: true, email: user.email };
}

export const fail = (error: string): ActionState => ({ ok: false, error, at: Date.now() });
export const done = (message: string): ActionState => ({ ok: true, message, at: Date.now() });
