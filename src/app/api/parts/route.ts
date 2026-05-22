import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/api-response";

export const revalidate = 300; // 5 minutes

const MAX_LIMIT = 100;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const brand = searchParams.get("brand");
    const category = searchParams.get("category");
    const q = searchParams.get("q");
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(searchParams.get("limit") ?? "60", 10) || 60));

    const where: Record<string, unknown> = {};
    if (brand) where.brand = brand;
    if (category) where.category = category;
    if (q) where.OR = [{ name: { contains: q } }, { sku: { contains: q } }];

    const [parts, total] = await Promise.all([
      prisma.part.findMany({
        where,
        orderBy: [{ stock: "desc" }, { priceEur: "asc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.part.count({ where }),
    ]);
    return apiSuccess({ parts, page, limit, total });
  } catch {
    return apiError("Fout bij ophalen onderdelen", 500);
  }
}
