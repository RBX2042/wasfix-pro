import { NextRequest } from "next/server";
import { apiSuccess, apiError } from "@/lib/api-response";
import { dbErrorCodes } from "@/lib/static-db";

export const revalidate = 3600; // 1 hour — error codes rarely change

const MAX_LIMIT = 100;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const brand = searchParams.get("brand") ?? undefined;
    const q = searchParams.get("q") ?? undefined;
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(searchParams.get("limit") ?? "100", 10) || 100));

    const all = await dbErrorCodes({ where: { brand, q } });
    const total = all.length;
    const errorCodes = all.slice((page - 1) * limit, (page - 1) * limit + limit);

    return apiSuccess({ errorCodes, page, limit, total });
  } catch {
    return apiError("Fout bij ophalen foutcodes", 500);
  }
}
