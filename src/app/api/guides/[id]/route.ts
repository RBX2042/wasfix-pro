import { NextRequest } from "next/server";
import { apiSuccess, apiError } from "@/lib/api-response";
import { staticGuide, guides as allGuides } from "@/lib/static-db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    // Try slug first (most common), then id
    const guide = staticGuide(id) ?? staticGuide(allGuides.find((g) => g.id === id)?.slug ?? "");
    if (!guide) return apiError("Gids niet gevonden", 404);
    return apiSuccess({ guide });
  } catch {
    return apiError("Fout bij ophalen gids", 500);
  }
}
