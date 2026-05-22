import { getCurrentUser, getPlanLimits } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiError, apiSuccess } from "@/lib/api-response";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return apiError("Niet ingelogd", 401);

  const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
  const limits = getPlanLimits(user.plan);

  return apiSuccess({
    plan: user.plan,
    role: user.role,
    diagnosesUsed: dbUser?.diagnosesUsed ?? 0,
    diagnosesLimit: limits.diagnosesPerMonth,
    diagnosesRemaining:
      limits.diagnosesPerMonth === -1
        ? -1
        : Math.max(0, limits.diagnosesPerMonth - (dbUser?.diagnosesUsed ?? 0)),
    partsDiscount: limits.partsDiscount,
    premiumGuides: limits.premiumGuides,
  });
}
