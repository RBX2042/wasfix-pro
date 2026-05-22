import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/api-response";

export const revalidate = 3600; // 1 hour

const MAX_LIMIT = 50;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const difficulty = searchParams.get("difficulty");
    const q = searchParams.get("q");
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(searchParams.get("limit") ?? "50", 10) || 50));

    const where: Record<string, unknown> = {};
    if (difficulty) where.difficulty = difficulty;
    if (q) where.OR = [{ title: { contains: q } }, { summary: { contains: q } }];

    const [guides, total] = await Promise.all([
      prisma.repairGuide.findMany({
        where,
        orderBy: { views: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.repairGuide.count({ where }),
    ]);
    return apiSuccess({ guides, page, limit, total });
  } catch {
    return apiError("Fout bij ophalen gidsen", 500);
  }
}
