import { NextRequest } from "next/server";
import { apiSuccess, apiError } from "@/lib/api-response";
import { dbGuide, dbGuideById } from "@/lib/static-db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    // Try slug first (most common), then id
    const guide = (await dbGuide(id)) ?? (await dbGuideById(id));
    if (!guide) return apiError("Gids niet gevonden", 404);
    return apiSuccess({ guide });
  } catch {
    return apiError("Fout bij ophalen gids", 500);
  }
}
