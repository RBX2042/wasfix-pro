import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api-response";
import { rateLimit, getClientKey } from "@/lib/ratelimit";
import { trackServer } from "@/lib/analytics";
import { logger } from "@/lib/logger";

const Schema = z.object({
  diagnoseId: z.string().optional(),
  rating: z.enum(["up", "down"]),
  comment: z.string().max(500).optional(),
});

export async function POST(req: NextRequest) {
  if (!rateLimit(`feedback:${getClientKey(req)}`, 50, 60 * 60 * 1000)) {
    return apiError("Te veel feedbacks — even rust.", 429);
  }

  const body = await req.json().catch(() => null);
  if (!body) return apiError("Ongeldige JSON", 400);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return apiError("Ongeldige feedback", 400);

  const { diagnoseId, rating, comment } = parsed.data;
  logger.info("[diagnose:feedback]", { diagnoseId, rating, hasComment: !!comment });

  // Server-side analytics — bypasses ad-blockers
  await trackServer("diagnose_feedback", {
    diagnose_id: diagnoseId ?? "anon",
    rating,
    has_comment: !!comment,
  });

  // Try to persist in DB if available (Diagnosis model would need a feedback field)
  // Skipped here — see TODO in PROGRESS.md for "AI Quality Loop DB schema"

  return apiSuccess({ thanks: true });
}
