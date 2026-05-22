import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return apiError("Niet ingelogd", 401);

  const orders = await prisma.order.findMany({
    where: { userId: user.id },
    include: { items: { include: { part: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return apiSuccess({ orders });
}
