import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { apiError, apiSuccess } from "@/lib/api-response";
import { rateLimit, getClientKey } from "@/lib/ratelimit";
import { getReviews } from "@/lib/reviews";
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
        },
      });
      reviewId = created.id;
    } catch (err) {
      logger.warn("[reviews] persist failed", err);
    }
  }
  logger.info("[reviews] new review submitted", { reviewId, target: parsed.data.targetSku ?? parsed.data.targetSlug, rating: parsed.data.rating });

  // Notify moderation team
  try {
    const { getResend, FROM } = await import("@/lib/email") as { getResend?: () => unknown; FROM?: string } & Record<string, unknown>;
    const resend = (typeof getResend === "function" ? getResend() : null) as { emails: { send: (opts: Record<string, string>) => Promise<unknown> } } | null;
    if (resend && FROM) {
      await resend.emails.send({
        from: FROM,
        to: "reviews@wasfix.nl",
        replyTo: parsed.data.email,
        subject: `📝 Nieuwe review (${parsed.data.rating}★) — modereren · ${reviewId}`,
        html: `
          <div style="font-family: system-ui, sans-serif; max-width: 600px;">
            <h2>Nieuwe review</h2>
            <table style="width: 100%; font-size: 14px;">
              <tr><td><strong>ID:</strong></td><td>${reviewId}</td></tr>
              <tr><td><strong>Target:</strong></td><td>${parsed.data.targetType} ${parsed.data.targetSku ?? parsed.data.targetSlug}</td></tr>
              <tr><td><strong>Rating:</strong></td><td>${"★".repeat(parsed.data.rating)}</td></tr>
              <tr><td><strong>Auteur:</strong></td><td>${parsed.data.author} (${parsed.data.email})</td></tr>
            </table>
            <h3 style="margin-top: 16px;">${parsed.data.title}</h3>
            <div style="padding: 12px; background: #f7f7f9; border-left: 3px solid #1a6b6b; border-radius: 4px;">${parsed.data.body.replace(/\n/g, "<br>")}</div>
            <p style="margin-top: 20px; font-size: 12px; color: #888;">Modereer in /admin/reviews.</p>
          </div>
        `,
      });
    }
  } catch (err) {
    logger.warn("[reviews] notification email failed", err);
  }

  return apiSuccess({
    reviewId,
    message: "Bedankt — je review wordt gepubliceerd na moderatie (max 24u op werkdagen).",
  });
}
