import { NextRequest } from "next/server";
import { apiSuccess, apiError } from "@/lib/api-response";
import { dbParts } from "@/lib/static-db";

// Identical for every caller (the response is the PublicPart projection), so it can
// be cached; POST /api/parts/revalidate clears it with the pages.
export const revalidate = 60;

const MAX_LIMIT = 100;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const brand = searchParams.get("brand") ?? undefined;
    const category = searchParams.get("category") ?? undefined;
    const q = searchParams.get("q") ?? undefined;
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(searchParams.get("limit") ?? "60", 10) || 60));

    // dbParts returns the public projection: id, sku, name, description, brand,
    // category, priceEur, stock, imageUrl, isOriginal. costEur and supplier are
    // not in it - this endpoint used to return the purchase price of every part.
    const all = await dbParts({ where: { brand, category, q }, orderBy: q ? undefined : "stock-then-price" });
    const total = all.length;
    const parts = all.slice((page - 1) * limit, (page - 1) * limit + limit);

    return apiSuccess({ parts, page, limit, total });
  } catch {
    return apiError("Fout bij ophalen onderdelen", 500);
  }
}
