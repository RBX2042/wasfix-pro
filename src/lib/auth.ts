import { isDemoMode } from "./utils";
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

export async function getCurrentUser(): Promise<DemoUser | null> {
  // In demo mode, return the superadmin user (fall back to demo user)
  if (isDemoMode()) {
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
    return STATIC_DEMO_USER;
  }

  // Real Clerk auth
  try {
    const { auth, currentUser } = await import("@clerk/nextjs/server");
    const { userId } = await auth();
    if (!userId) return null;
    const cu = await currentUser();
    if (!cu) return null;
    const email = cu.emailAddresses[0]?.emailAddress ?? "";
    const dbUser = await prisma.user.upsert({
      where: { clerkId: userId },
      update: { email, name: `${cu.firstName ?? ""} ${cu.lastName ?? ""}`.trim() || null },
      create: {
        clerkId: userId,
        email,
        name: `${cu.firstName ?? ""} ${cu.lastName ?? ""}`.trim() || null,
      },
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

export const PLAN_LIMITS = {
  FREE: { diagnosesPerMonth: 3, partsDiscount: 0, premiumGuides: false, technicianDashboard: false },
  PARTICULIER: { diagnosesPerMonth: -1, partsDiscount: 0.05, premiumGuides: true, technicianDashboard: false },
  MONTEUR_PRO: { diagnosesPerMonth: -1, partsDiscount: 0.10, premiumGuides: true, technicianDashboard: true },
  BEDRIJF: { diagnosesPerMonth: -1, partsDiscount: 0.15, premiumGuides: true, technicianDashboard: true },
  API: { diagnosesPerMonth: -1, partsDiscount: 0.10, premiumGuides: true, technicianDashboard: true },
} as const;

export function getPlanLimits(plan: string) {
  return PLAN_LIMITS[plan as keyof typeof PLAN_LIMITS] ?? PLAN_LIMITS.FREE;
}
