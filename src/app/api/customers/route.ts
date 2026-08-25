import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { hasMonteurAccess, getOrCreateCompanyForUser } from "@/lib/company";
import { apiError, apiSuccess } from "@/lib/api-response";
import { rateLimit, getClientKey } from "@/lib/ratelimit";

const CustomerSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().max(30).optional().or(z.literal("")),
  addressLine: z.string().max(150).optional().or(z.literal("")),
  postalCode: z.string().max(20).optional().or(z.literal("")),
  city: z.string().max(80).optional().or(z.literal("")),
  notes: z.string().max(2000).optional().or(z.literal("")),
});

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return apiError("Niet ingelogd", 401);
  if (!hasMonteurAccess(user)) return apiError("Monteur Pro vereist", 403);

  const company = await getOrCreateCompanyForUser(user);

  const { searchParams } = req.nextUrl;
  const q = searchParams.get("q")?.trim();
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
  const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit") ?? "20") || 20));

  const where = {
    companyId: company.id,
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { email: { contains: q, mode: "insensitive" as const } },
            { phone: { contains: q } },
          ],
        }
      : {}),
  };

  const [total, customers] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where,
      include: { machines: true, _count: { select: { workOrders: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return apiSuccess({ customers, page, limit, total });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return apiError("Niet ingelogd", 401);
  if (!hasMonteurAccess(user)) return apiError("Monteur Pro vereist", 403);

  if (!rateLimit(`customers:create:${getClientKey(req, user.id)}`, 30, 60_000)) {
    return apiError("Te veel verzoeken. Probeer het over een minuut opnieuw.", 429);
  }

  const body = await req.json().catch(() => null);
  if (!body) return apiError("Ongeldige JSON", 400);

  const parsed = CustomerSchema.safeParse(body);
  if (!parsed.success) return apiError("Ongeldige klantgegevens", 400, parsed.error.flatten());

  const company = await getOrCreateCompanyForUser(user);
  const { name, email, phone, addressLine, postalCode, city, notes } = parsed.data;

  const customer = await prisma.customer.create({
    data: {
      companyId: company.id,
      name,
      email: email || null,
      phone: phone || null,
      addressLine: addressLine || null,
      postalCode: postalCode || null,
      city: city || null,
      notes: notes || null,
    },
  });

  return apiSuccess({ customer }, 201);
}
