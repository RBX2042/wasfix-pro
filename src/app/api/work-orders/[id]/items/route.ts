import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { hasMonteurAccess, getOrCreateCompanyForUser } from "@/lib/company";
import { apiError, apiSuccess } from "@/lib/api-response";

const ItemSchema = z.object({
  partId: z.string().min(1).optional(),
  description: z.string().min(1).max(200),
  quantity: z.number().int().min(1).max(99).default(1),
  unitPrice: z.number().min(0).max(10000).default(0),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return apiError("Niet ingelogd", 401);
  if (!hasMonteurAccess(user)) return apiError("Monteur Pro vereist", 403);

  const company = await getOrCreateCompanyForUser(user);
  const { id: workOrderId } = await params;

  const workOrder = await prisma.workOrder.findUnique({ where: { id: workOrderId } });
  if (!workOrder) return apiError("Werkorder niet gevonden", 404);
  if (workOrder.companyId !== company.id) return apiError("Geen toegang", 403);

  const body = await req.json().catch(() => null);
  if (!body) return apiError("Ongeldige JSON", 400);
  const parsed = ItemSchema.safeParse(body);
  if (!parsed.success) return apiError("Ongeldige regel", 400, parsed.error.flatten());

  const { partId, description, quantity, unitPrice } = parsed.data;

  let resolvedPartId: string | null = null;
  let resolvedUnitPrice = unitPrice;
  let resolvedDescription = description;
  if (partId) {
    const part = await prisma.part.findUnique({ where: { id: partId } });
    if (!part) return apiError("Onderdeel niet gevonden", 404);
    resolvedPartId = part.id;
    // Trust the catalog price, not client-supplied unitPrice, when a real part is linked.
    resolvedUnitPrice = part.priceEur;
    resolvedDescription = description || part.name;
  }

  const item = await prisma.workOrderItem.create({
    data: {
      workOrderId,
      partId: resolvedPartId,
      description: resolvedDescription,
      quantity,
      unitPrice: resolvedUnitPrice,
    },
    include: { part: true },
  });

  return apiSuccess({ item }, 201);
}
