import { NextRequest } from "next/server";
import { apiSuccess, apiError } from "@/lib/api-response";
import { staticGuides } from "@/lib/static-db";

export const revalidate = 3600; // 1 hour

const MAX_LIMIT = 50;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const difficulty = searchParams.get("difficulty") ?? undefined;
    const q = searchParams.get("q") ?? undefined;
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(searchParams.get("limit") ?? "50", 10) || 50));

    const all = staticGuides({ where: { difficulty, q }, orderBy: "views-desc" });
    const total = all.length;
    const guides = all.slice((page - 1) * limit, (page - 1) * limit + limit);

    return apiSuccess({ guides, page, limit, total });
  } catch {
    return apiError("Fout bij ophalen gidsen", 500);
  }
}
