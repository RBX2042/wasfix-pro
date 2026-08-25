import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { hasMonteurAccess, getOrCreateCompanyForUser, nextInvoiceNumber, NL_VAT_RATE } from "@/lib/company";
import { apiError, apiSuccess } from "@/lib/api-response";

// Generates an Invoice from a COMPLETED work order's items + callout fee,
// and advances the work order to INVOICED (matches the status flow in
// src/lib/work-order.ts: COMPLETED -> INVOICED).
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return apiError("Niet ingelogd", 401);
  if (!hasMonteurAccess(user)) return apiError("Monteur Pro vereist", 403);

  const company = await getOrCreateCompanyForUser(user);
  const { id } = await params;

  const workOrder = await prisma.workOrder.findUnique({
    where: { id },
    include: { items: true, invoice: true },
  });
  if (!workOrder) return apiError("Werkorder niet gevonden", 404);
  if (workOrder.companyId !== company.id) return apiError("Geen toegang", 403);
  if (workOrder.invoice) {
    return apiError(`Er bestaat al een factuur (${workOrder.invoice.number}) voor deze werkorder`, 400);
  }
  if (workOrder.status !== "COMPLETED") {
    return apiError("Werkorder moet eerst afgerond zijn (status COMPLETED) voordat je een factuur maakt", 400);
  }

  const lineItems = workOrder.items.map((item) => ({
    description: item.description,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    vatRate: NL_VAT_RATE,
  }));
  if (workOrder.calloutFeeEur > 0) {
    lineItems.push({ description: "Voorrijkosten", quantity: 1, unitPrice: workOrder.calloutFeeEur, vatRate: NL_VAT_RATE });
  }
  if (lineItems.length === 0) {
    return apiError("Werkorder heeft geen regels om te factureren", 400);
  }

  const subtotalEur = lineItems.reduce((sum, li) => sum + li.unitPrice * li.quantity, 0);
  const vatEur = lineItems.reduce((sum, li) => sum + li.unitPrice * li.quantity * li.vatRate, 0);
  const totalEur = subtotalEur + vatEur;

  const number = await nextInvoiceNumber(company.id);

  const invoice = await prisma.$transaction(async (tx) => {
    const created = await tx.invoice.create({
      data: {
        number,
        companyId: company.id,
        customerId: workOrder.customerId,
        workOrderId: workOrder.id,
        subtotalEur,
        vatEur,
        totalEur,
        items: { create: lineItems },
      },
      include: { items: true, customer: true },
    });
    await tx.workOrder.update({ where: { id: workOrder.id }, data: { status: "INVOICED" } });
    return created;
  });

  return apiSuccess({ invoice }, 201);
}
