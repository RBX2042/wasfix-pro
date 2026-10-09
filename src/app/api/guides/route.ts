import { NextRequest } from "next/server";
import { apiSuccess, apiError } from "@/lib/api-response";
import { dbGuides, redactGuide } from "@/lib/static-db";
import { viewerCanReadPremiumGuides } from "@/lib/guide-access";

// Per viewer: what a premium guide contains depends on the caller's plan, so this
// must never be served from a shared cache. (It used to be `revalidate = 3600`
// with every step of every premium guide in the body.)
export const dynamic = "force-dynamic";

const MAX_LIMIT = 50;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const difficulty = searchParams.get("difficulty") ?? undefined;
    const q = searchParams.get("q") ?? undefined;
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(searchParams.get("limit") ?? "50", 10) || 50));

    const canReadPremium = await viewerCanReadPremiumGuides();
    const all = await dbGuides({ where: { difficulty, q }, orderBy: "views-desc", full: true });
    const total = all.length;
    // Every guide passes through redactGuide: premium guides are cut to the free
    // preview (2 steps) with lockedStepCount for anyone whose plan lacks them.
    const guides = all
      .slice((page - 1) * limit, (page - 1) * limit + limit)
      .map((g) => redactGuide(g, canReadPremium));

    return apiSuccess({ guides, page, limit, total });
  } catch {
    return apiError("Fout bij ophalen gidsen", 500);
  }
}
