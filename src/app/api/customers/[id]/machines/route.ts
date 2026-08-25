import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { hasMonteurAccess, getOrCreateCompanyForUser } from "@/lib/company";
import { apiError, apiSuccess } from "@/lib/api-response";

const MachineSchema = z.object({
  brand: z.string().min(1).max(50),
  model: z.string().min(1).max(80),
  serialNumber: z.string().max(60).optional().or(z.literal("")),
  purchaseDate: z.string().datetime().optional().or(z.literal("")),
  warrantyUntil: z.string().datetime().optional().or(z.literal("")),
  notes: z.string().max(2000).optional().or(z.literal("")),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return apiError("Niet ingelogd", 401);
  if (!hasMonteurAccess(user)) return apiError("Monteur Pro vereist", 403);

  const company = await getOrCreateCompanyForUser(user);
  const { id: customerId } = await params;

  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) return apiError("Klant niet gevonden", 404);
  if (customer.companyId !== company.id) return apiError("Geen toegang", 403);

  const body = await req.json().catch(() => null);
  if (!body) return apiError("Ongeldige JSON", 400);
  const parsed = MachineSchema.safeParse(body);
  if (!parsed.success) return apiError("Ongeldige apparaatgegevens", 400, parsed.error.flatten());

  const { brand, model, serialNumber, purchaseDate, warrantyUntil, notes } = parsed.data;

  const machine = await prisma.customerMachine.create({
    data: {
      customerId,
      brand,
      model,
      serialNumber: serialNumber || null,
      purchaseDate: purchaseDate ? new Date(purchaseDate) : null,
      warrantyUntil: warrantyUntil ? new Date(warrantyUntil) : null,
      notes: notes || null,
    },
  });

  return apiSuccess({ machine }, 201);
}
