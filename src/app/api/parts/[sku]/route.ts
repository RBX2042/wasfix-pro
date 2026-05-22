import { NextRequest } from "next/server";
import { apiSuccess, apiError } from "@/lib/api-response";
import { staticPartFull } from "@/lib/static-db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ sku: string }> }) {
  try {
    const { sku } = await params;
    const part = staticPartFull(sku);
    if (!part) return apiError("Onderdeel niet gevonden", 404);
    return apiSuccess({ part });
  } catch {
    return apiError("Fout bij ophalen onderdeel", 500);
  }
}
