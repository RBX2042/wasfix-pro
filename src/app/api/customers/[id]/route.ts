import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { hasMonteurAccess, getOrCreateCompanyForUser } from "@/lib/company";
import { apiError, apiSuccess } from "@/lib/api-response";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return apiError("Niet ingelogd", 401);
  if (!hasMonteurAccess(user)) return apiError("Monteur Pro vereist", 403);

  const company = await getOrCreateCompanyForUser(user);
  const { id } = await params;

  const customer = await prisma.customer.findUnique({
    where: { id },
    include: {
      machines: true,
      workOrders: {
        orderBy: { createdAt: "desc" },
        include: { items: true, machine: true },
      },
    },
  });

  if (!customer) return apiError("Klant niet gevonden", 404);
  // Tenant isolation: a customer only belongs to one company.
  if (customer.companyId !== company.id) return apiError("Geen toegang", 403);

  return apiSuccess({ customer });
}
