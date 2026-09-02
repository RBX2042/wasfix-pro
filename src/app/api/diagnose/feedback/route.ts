import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api-response";
import { rateLimit, getClientKey } from "@/lib/ratelimit";
import { trackServer } from "@/lib/analytics";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { isDatabaseConfigured } from "@/lib/env";

const Schema = z.object({
  diagnoseId: z.string().optional(),
  sessionId: z.string().max(100).optional(),
  rating: z.enum(["up", "down"]),
  comment: z.string().max(500).optional(),
});

export async function POST(req: NextRequest) {
  if (!(await rateLimit(`feedback:${getClientKey(req)}`, 50, 60 * 60 * 1000))) {
    return apiError("Te veel feedbacks — even rust.", 429);
  }

  const body = await req.json().catch(() => null);
  if (!body) return apiError("Ongeldige JSON", 400);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return apiError("Ongeldige feedback", 400);

  const { diagnoseId, sessionId, rating, comment } = parsed.data;
  logger.info("[diagnose:feedback]", { diagnoseId, rating, hasComment: !!comment });

  // Server-side analytics — bypasses ad-blockers
  await trackServer("diagnose_feedback", {
    diagnose_id: diagnoseId ?? "anon",
    rating,
    has_comment: !!comment,
  });

  if (isDatabaseConfigured()) {
    await prisma.diagnosisFeedback
      .create({ data: { diagnosisId: diagnoseId ?? null, sessionId: sessionId ?? null, rating, comment: comment ?? null } })
      .catch((err) => logger.warn("[diagnose:feedback] persist failed", err));
  }

  return apiSuccess({ thanks: true });
}
