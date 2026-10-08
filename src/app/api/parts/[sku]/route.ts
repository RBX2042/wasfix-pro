import { NextRequest } from "next/server";
import { apiSuccess, apiError } from "@/lib/api-response";
import { dbPartFull } from "@/lib/static-db";

export const revalidate = 60;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ sku: string }> }) {
  try {
    const { sku } = await params;
    // Public projection: no costEur, no supplier. Guides embedded here carry only the
    // free preview of premium guides (see redactGuide in static-db).
    const part = await dbPartFull(sku);
    if (!part) return apiError("Onderdeel niet gevonden", 404);
    return apiSuccess({ part });
  } catch {
    return apiError("Fout bij ophalen onderdeel", 500);
  }
}
