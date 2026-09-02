import { getCurrentUser, getPlanLimits } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isDatabaseConfigured } from "@/lib/env";
import { apiError, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return apiError("Niet ingelogd", 401);

  let diagnosesUsed = 0;
  if (isDatabaseConfigured()) {
    try {
      const dbUser = await prisma.user.findUnique({ where: { id: user.id }, select: { diagnosesUsed: true } });
      diagnosesUsed = dbUser?.diagnosesUsed ?? 0;
    } catch { /* DB unreachable — report 0 used */ }
  }
  const limits = getPlanLimits(user.plan);

  return apiSuccess({
    plan: user.plan,
    role: user.role,
    diagnosesUsed,
    diagnosesLimit: limits.diagnosesPerMonth,
    diagnosesRemaining:
      limits.diagnosesPerMonth === -1 ? -1 : Math.max(0, limits.diagnosesPerMonth - diagnosesUsed),
    partsDiscount: limits.partsDiscount,
    premiumGuides: limits.premiumGuides,
  });
}
