import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/env";
import { apiError, apiSuccess } from "@/lib/api-response";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return apiError("Niet ingelogd", 401);

  if (!isDatabaseConfigured()) return apiSuccess({ orders: [], demo: true });

  try {
    const orders = await prisma.order.findMany({
      where: { userId: user.id },
      include: { items: { include: { part: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return apiSuccess({ orders });
  } catch (err) {
    logger.error("Orders lookup failed", err);
    return apiError("Bestellingen konden niet worden geladen", 503);
  }
}
