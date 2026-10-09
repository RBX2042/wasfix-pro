import { NextRequest } from "next/server";
import { apiSuccess, apiError } from "@/lib/api-response";
import { dbGuide, dbGuideById, redactGuide } from "@/lib/static-db";
import { viewerCanReadPremiumGuides } from "@/lib/guide-access";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    // Try slug first (most common), then id
    const found = (await dbGuide(id)) ?? (await dbGuideById(id));
    if (!found) return apiError("Gids niet gevonden", 404);
    const canReadPremium = await viewerCanReadPremiumGuides();
    const { parts, ...rest } = found;
    // Same rule as the /gidsen page: premium guides show their first steps to
    // everybody and the rest only to plans that include them.
    return apiSuccess({ guide: { ...redactGuide(rest, canReadPremium), parts } });
  } catch {
    return apiError("Fout bij ophalen gids", 500);
  }
}
