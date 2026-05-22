import { NextRequest } from "next/server";
import { apiSuccess, apiError } from "@/lib/api-response";
import { staticErrorCodeByCode } from "@/lib/static-db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const decoded = decodeURIComponent(code).toUpperCase();
    const errorCode = staticErrorCodeByCode(decoded);
    if (!errorCode) return apiError("Foutcode niet gevonden", 404);
    return apiSuccess({ errorCode });
  } catch {
    return apiError("Fout bij ophalen foutcode", 500);
  }
}
