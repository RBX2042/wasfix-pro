import { isDemoMode } from "./demo-mode";
import { isDatabaseConfigured } from "./env";
import { getPlan } from "./plans";
import { prisma } from "./prisma";

export type DemoUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  plan: string;
};

// Superadmin email — auto-logged-in in demo mode, full ADMIN/BEDRIJF privileges.
export const SUPERADMIN_EMAIL = "jdahoe@hotmail.nl";

// Static demo user — used when DB is unreachable so the app still works.
const STATIC_DEMO_USER: DemoUser = {
  id: "jdahoe-superadmin",
  email: SUPERADMIN_EMAIL,
  name: "Jimmy Dahoe",
  role: "ADMIN",
  plan: "BEDRIJF",
};

/**
 * Resolve the current user.
 *  - Demo mode: the superadmin (from DB when available, otherwise static).
 *  - Clerk mode: the signed-in Clerk user, upserted into our User table.
 * Never throws — returns null when nobody is signed in.
 */
export async function getCurrentUser(): Promise<DemoUser | null> {
  if (isDemoMode()) {
    if (isDatabaseConfigured()) {
      try {
        const superadmin = await prisma.user.findUnique({ where: { email: SUPERADMIN_EMAIL } });
        const fallback = !superadmin ? await prisma.user.findUnique({ where: { email: "demo@wasfixpro.nl" } }) : null;
        const user = superadmin ?? fallback;
        if (user) {
          return {
            id: user.id,
            email: user.email,
            name: user.name ?? "Demo User",
            role: user.role,
            plan: user.plan,
          };
        }
      } catch { /* DB unreachable — fall through to static user */ }
    }
    return STATIC_DEMO_USER;
  }

  // Real Clerk auth
  try {
    const { auth, currentUser } = await import("@clerk/nextjs/server");
    const { userId } = await auth();
    if (!userId) return null;
    const cu = await currentUser();
    if (!cu) return null;
    const email = cu.primaryEmailAddress?.emailAddress ?? cu.emailAddresses[0]?.emailAddress ?? "";
    const name = `${cu.firstName ?? ""} ${cu.lastName ?? ""}`.trim() || null;

    if (!isDatabaseConfigured()) {
      // Signed in, but no database yet: still let the user in with a FREE plan.
      return { id: userId, email, name: name ?? email, role: "CONSUMER", plan: "FREE" };
    }

    // Link by clerkId first; fall back to email so pre-existing rows
    // (orders placed as guest, seeded admins) get claimed on first login.
    const dbUser = await prisma.$transaction(async (tx) => {
      const byClerk = await tx.user.findUnique({ where: { clerkId: userId } });
      if (byClerk) return tx.user.update({ where: { id: byClerk.id }, data: { email, name: name ?? byClerk.name } });
      const byEmail = email ? await tx.user.findUnique({ where: { email } }) : null;
      if (byEmail) return tx.user.update({ where: { id: byEmail.id }, data: { clerkId: userId, name: name ?? byEmail.name } });
      return tx.user.create({ data: { clerkId: userId, email, name } });
    });
    return {
      id: dbUser.id,
      email: dbUser.email,
      name: dbUser.name ?? email,
      role: dbUser.role,
      plan: dbUser.plan,
    };
  } catch {
    return null;
  }
}

/**
 * Plan limits come from src/lib/plans.ts so pricing pages, Stripe and
 * entitlement checks can never drift apart. API is a legacy internal plan
 * that behaves like MONTEUR_PRO.
 */
export function getPlanLimits(plan: string) {
  const resolved = plan === "API" ? "MONTEUR_PRO" : plan;
  const p = getPlan(resolved);
  return {
    diagnosesPerMonth: p.diagnosesPerMonth,
    partsDiscount: p.partsDiscount,
    premiumGuides: p.premiumGuides,
    technicianDashboard: p.technicianDashboard,
  };
}

/** Plans/roles that unlock the Monteur Pro dashboard + B2B API. */
export function hasProAccess(user: Pick<DemoUser, "plan" | "role">): boolean {
  return ["MONTEUR_PRO", "BEDRIJF", "API"].includes(user.plan) || ["TECHNICIAN", "BUSINESS", "ADMIN"].includes(user.role);
}
