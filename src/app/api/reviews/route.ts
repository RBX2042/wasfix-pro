import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { apiError, apiSuccess } from "@/lib/api-response";
import { rateLimit, getClientKey } from "@/lib/ratelimit";
import { getReviews, hasPurchased } from "@/lib/reviews";
import { prisma } from "@/lib/prisma";
import { isDatabaseConfigured } from "@/lib/env";

const PostSchema = z.object({
  targetType: z.enum(["part", "guide"]),
  targetSku: z.string().optional(),
  targetSlug: z.string().optional(),
  rating: z.number().int().min(1).max(5),
  title: z.string().min(3).max(80),
  body: z.string().min(10).max(2000),
  author: z.string().min(2).max(60),
  email: z.string().email(),
});

// GET — list reviews for a target
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const sku = sp.get("sku") ?? undefined;
  const slug = sp.get("slug") ?? undefined;
  if (!sku && !slug) return apiError("Vereist: sku of slug parameter", 400);
  // Single source of truth: seed reviews + moderator-approved rows.
  const reviews = await getReviews({ sku, slug });
  return NextResponse.json({ data: reviews, total: reviews.length });
}

// POST — submit a review (queued for moderation)
export async function POST(req: NextRequest) {
  if (!(await rateLimit(`review:${getClientKey(req)}`, 5, 60 * 60 * 1000))) {
    return apiError("Te veel reviews — probeer over een uur opnieuw.", 429);
  }

  const body = await req.json().catch(() => null);
  if (!body) return apiError("Ongeldige JSON", 400);
  const parsed = PostSchema.safeParse(body);
  if (!parsed.success) return apiError("Ongeldige review", 400, parsed.error.flatten());

  let reviewId = `rev-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  // The verified-purchase badge is earned, not claimed: it is only granted when
  // this e-mail actually has a paid order containing the reviewed part.
  const verifiedPurchase =
    parsed.data.targetType === "part" && parsed.data.targetSku
      ? await hasPurchased(parsed.data.email, parsed.data.targetSku)
      : false;

  if (isDatabaseConfigured()) {
    try {
      const created = await prisma.review.create({
        data: {
          targetType: parsed.data.targetType,
          targetSku: parsed.data.targetSku ?? null,
          targetSlug: parsed.data.targetSlug ?? null,
          rating: parsed.data.rating,
          title: parsed.data.title,
          body: parsed.data.body,
          author: parsed.data.author,
          email: parsed.data.email,
          status: "PENDING",
          verifiedPurchase,
        },
      });
      reviewId = created.id;
    } catch (err) {
      // With the moderation e-mail switched off this row is the only trace of
      // the review. A warn plus a "will be published after moderation" reply
      // means the review exists nowhere at all.
      logger.error("[reviews] persist failed", err);
      return apiError("Je review kon nu niet worden opgeslagen. Probeer het over een paar minuten opnieuw.", 503);
    }
  }
  logger.info("[reviews] new review submitted", { reviewId, target: parsed.data.targetSku ?? parsed.data.targetSlug, rating: parsed.data.rating });

  // Moderation notification is disabled: this block imported getResend and FROM
  // from @/lib/email, but both are module-private there. `typeof getResend ===
  // "function"` was therefore always false and no moderator was ever mailed —
  // silent dead code. Re-enable only once @/lib/email exports a
  // sendReviewModerationNotification() (escaping the user input on its side, as
  // sendRmaNotification already does). Until then the queue is visible in
  // /admin/aanvragen.

  return apiSuccess({
    reviewId,
    message: "Bedankt — je review wordt gepubliceerd na moderatie (max 24u op werkdagen).",
  });
}
