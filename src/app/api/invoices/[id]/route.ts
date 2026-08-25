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

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: { items: true, customer: true, workOrder: true },
  });
  if (!invoice) return apiError("Factuur niet gevonden", 404);
  if (invoice.companyId !== company.id) return apiError("Geen toegang", 403);

  return apiSuccess({ invoice });
}
