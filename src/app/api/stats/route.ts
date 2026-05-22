import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";

export const revalidate = 60;

export async function GET() {
  try {
    const user = await getCurrentUser();

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [
      totalDiagnoses,
      thisMonthDiagnoses,
      totalOrders,
      revenue,
      totalParts,
      totalErrorCodes,
      totalGuides,
      totalMachines,
      brandCount,
      topPartsRaw,
    ] = await Promise.all([
      prisma.diagnosis.count(),
      prisma.diagnosis.count({ where: { createdAt: { gte: startOfMonth } } }),
      prisma.order.count(),
      prisma.order.aggregate({
        where: { status: { in: ["PAID", "SHIPPED", "DELIVERED"] } },
        _sum: { totalEur: true },
      }),
      prisma.part.count(),
      prisma.errorCode.count(),
      prisma.repairGuide.count(),
      prisma.washingMachine.count(),
      prisma.washingMachine.groupBy({ by: ["brand"] }),
      prisma.orderItem.groupBy({
        by: ["partId"],
        _sum: { quantity: true },
        orderBy: { _sum: { quantity: "desc" } },
        take: 5,
      }),
    ]);

    const topParts = await prisma.part.findMany({
      where: { id: { in: topPartsRaw.map((p) => p.partId) } },
      select: { id: true, sku: true, name: true, priceEur: true, imageUrl: true },
    });

    return apiSuccess({
      totals: {
        diagnoses: totalDiagnoses,
        orders: totalOrders,
        revenue: revenue._sum.totalEur ?? 0,
        parts: totalParts,
        errorCodes: totalErrorCodes,
        guides: totalGuides,
        machines: totalMachines,
        brands: brandCount.length,
      },
      thisMonth: {
        diagnoses: thisMonthDiagnoses,
      },
      topParts: topParts.map((p) => ({
        ...p,
        priceEur: Number(p.priceEur),
        sold: topPartsRaw.find((tp) => tp.partId === p.id)?._sum.quantity ?? 0,
      })),
      user: user ? { plan: user.plan, role: user.role } : null,
    });
  } catch {
    return apiError("Failed to load stats", 500);
  }
}
