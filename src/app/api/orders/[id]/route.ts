import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return apiError("Niet ingelogd", 401);

  const { id } = await params;
  const order = await prisma.order.findUnique({
    where: { id },
    include: { items: { include: { part: true } } },
  });

  if (!order) return apiError("Bestelling niet gevonden", 404);

  if (order.userId !== user.id && user.role !== "ADMIN") {
    return apiError("Geen toegang", 403);
  }

  return apiSuccess({ order });
}
