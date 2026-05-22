import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/api-response";

export const revalidate = 3600; // 1 hour — error codes rarely change

const MAX_LIMIT = 100;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const brand = searchParams.get("brand");
    const q = searchParams.get("q");
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(searchParams.get("limit") ?? "100", 10) || 100));

    const where: Record<string, unknown> = {};
    if (brand) where.machine = { brand };
    if (q) where.OR = [{ code: { contains: q.toUpperCase() } }, { title: { contains: q } }];

    const [errorCodes, total] = await Promise.all([
      prisma.errorCode.findMany({
        where,
        include: { machine: true },
        orderBy: { code: "asc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.errorCode.count({ where }),
    ]);
    return apiSuccess({ errorCodes, page, limit, total });
  } catch {
    return apiError("Fout bij ophalen foutcodes", 500);
  }
}
