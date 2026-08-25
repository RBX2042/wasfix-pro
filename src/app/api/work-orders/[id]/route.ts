import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { hasMonteurAccess, getOrCreateCompanyForUser } from "@/lib/company";
import { apiError, apiSuccess } from "@/lib/api-response";
import { isValidStatusTransition, isWorkOrderStatus } from "@/lib/work-order";

async function loadScopedWorkOrder(id: string, companyId: string) {
  const workOrder = await prisma.workOrder.findUnique({
    where: { id },
    include: { customer: true, machine: true, items: { include: { part: true } }, technician: { select: { id: true, name: true, email: true } } },
  });
  if (!workOrder) return { workOrder: null, error: apiError("Werkorder niet gevonden", 404) };
  if (workOrder.companyId !== companyId) return { workOrder: null, error: apiError("Geen toegang", 403) };
  return { workOrder, error: null };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return apiError("Niet ingelogd", 401);
  if (!hasMonteurAccess(user)) return apiError("Monteur Pro vereist", 403);

  const company = await getOrCreateCompanyForUser(user);
  const { id } = await params;
  const { workOrder, error } = await loadScopedWorkOrder(id, company.id);
  if (error) return error;

  return apiSuccess({ workOrder });
}

const PatchSchema = z.object({
  status: z.string().optional(),
  technicianNote: z.string().max(4000).optional(),
  aiDiagnosis: z.string().max(4000).optional(),
  laborHours: z.number().min(0).max(100).optional(),
  calloutFeeEur: z.number().min(0).max(1000).optional(),
  scheduledAt: z.string().datetime().optional(),
  // A signature-pad PNG data URL. Capped well above what a typical
  // signature trace produces, to stop someone stuffing arbitrary blobs
  // into a text column via this field.
  signatureUrl: z.string().startsWith("data:image/png;base64,").max(200_000).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return apiError("Niet ingelogd", 401);
  if (!hasMonteurAccess(user)) return apiError("Monteur Pro vereist", 403);

  const company = await getOrCreateCompanyForUser(user);
  const { id } = await params;
  const { workOrder, error } = await loadScopedWorkOrder(id, company.id);
  if (error || !workOrder) return error;

  const body = await req.json().catch(() => null);
  if (!body) return apiError("Ongeldige JSON", 400);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) return apiError("Ongeldige gegevens", 400, parsed.error.flatten());

  const { status, technicianNote, aiDiagnosis, laborHours, calloutFeeEur, scheduledAt, signatureUrl } = parsed.data;

  if (status !== undefined) {
    if (!isWorkOrderStatus(status)) return apiError("Ongeldige status", 400);
    if (!isValidStatusTransition(workOrder.status, status)) {
      return apiError(`Kan niet van ${workOrder.status} naar ${status}`, 400);
    }
  }

  const updated = await prisma.workOrder.update({
    where: { id },
    data: {
      ...(status !== undefined ? { status } : {}),
      ...(technicianNote !== undefined ? { technicianNote } : {}),
      ...(aiDiagnosis !== undefined ? { aiDiagnosis } : {}),
      ...(laborHours !== undefined ? { laborHours } : {}),
      ...(calloutFeeEur !== undefined ? { calloutFeeEur } : {}),
      ...(scheduledAt !== undefined ? { scheduledAt: new Date(scheduledAt) } : {}),
      ...(signatureUrl !== undefined ? { signatureUrl } : {}),
    },
    include: { customer: true, machine: true, items: { include: { part: true } } },
  });

  return apiSuccess({ workOrder: updated });
}
