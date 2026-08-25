import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { hasMonteurAccess, getOrCreateCompanyForUser, nextWorkOrderNumber } from "@/lib/company";
import { apiError, apiSuccess } from "@/lib/api-response";
import { rateLimit, getClientKey } from "@/lib/ratelimit";
import { isWorkOrderStatus } from "@/lib/work-order";

const WorkOrderSchema = z.object({
  customerId: z.string().min(1),
  machineId: z.string().min(1).optional(),
  complaint: z.string().min(3).max(2000),
  scheduledAt: z.string().datetime().optional(),
});

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return apiError("Niet ingelogd", 401);
  if (!hasMonteurAccess(user)) return apiError("Monteur Pro vereist", 403);

  const company = await getOrCreateCompanyForUser(user);

  const { searchParams } = req.nextUrl;
  const statusParam = searchParams.get("status");
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
  const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit") ?? "20") || 20));

  const where = {
    companyId: company.id,
    ...(statusParam && isWorkOrderStatus(statusParam) ? { status: statusParam } : {}),
  };

  const [total, workOrders] = await Promise.all([
    prisma.workOrder.count({ where }),
    prisma.workOrder.findMany({
      where,
      include: { customer: true, machine: true, items: true, technician: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return apiSuccess({ workOrders, page, limit, total });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return apiError("Niet ingelogd", 401);
  if (!hasMonteurAccess(user)) return apiError("Monteur Pro vereist", 403);

  if (!rateLimit(`workorders:create:${getClientKey(req, user.id)}`, 30, 60_000)) {
    return apiError("Te veel verzoeken. Probeer het over een minuut opnieuw.", 429);
  }

  const body = await req.json().catch(() => null);
  if (!body) return apiError("Ongeldige JSON", 400);
  const parsed = WorkOrderSchema.safeParse(body);
  if (!parsed.success) return apiError("Ongeldige werkordergegevens", 400, parsed.error.flatten());

  const company = await getOrCreateCompanyForUser(user);
  const { customerId, machineId, complaint, scheduledAt } = parsed.data;

  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer || customer.companyId !== company.id) {
    return apiError("Klant niet gevonden", 404);
  }

  if (machineId) {
    const machine = await prisma.customerMachine.findUnique({ where: { id: machineId } });
    if (!machine || machine.customerId !== customerId) {
      return apiError("Apparaat hoort niet bij deze klant", 400);
    }
  }

  const number = await nextWorkOrderNumber(company.id);

  const workOrder = await prisma.workOrder.create({
    data: {
      number,
      companyId: company.id,
      customerId,
      machineId: machineId ?? null,
      technicianId: user.id,
      complaint,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      status: scheduledAt ? "SCHEDULED" : "NEW",
    },
    include: { customer: true, machine: true, items: true },
  });

  return apiSuccess({ workOrder }, 201);
}
