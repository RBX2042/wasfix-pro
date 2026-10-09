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
      // Public fields of the part only: `part: true` also returned costEur and supplier to the customer.
      include: { items: { include: { part: { select: { id: true, sku: true, name: true, brand: true, imageUrl: true } } } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    // Order.costEur is what the goods cost the shop: never part of a customer's view of their order.
    return apiSuccess({ orders: orders.map(({ costEur: _cost, ...order }) => order) });
  } catch (err) {
    logger.error("Orders lookup failed", err);
    return apiError("Bestellingen konden niet worden geladen", 503);
  }
}
