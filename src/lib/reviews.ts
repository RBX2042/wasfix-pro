/**
 * Review data for public pages.
 *
 * There is exactly one source: moderator-approved rows in the `Review` table.
 * We ship no seed reviews — a review on this site was written by someone who
 * actually used the product. Ratings shown to users and emitted as schema.org
 * AggregateRating are computed from those rows only, so the structured data
 * always matches what a visitor can read on the page.
 *
 * The "geverifieerde aankoop" badge is `Review.verifiedPurchase`, which is set
 * at submission time by matching the reviewer's e-mail against a paid order
 * containing that part. It is never set for guide reviews, and never by hand.
 */

import "server-only";
import { prisma } from "./prisma";
import { isDatabaseConfigured } from "./env";
import { logger } from "./logger";

export type PublicReview = {
  id: string;
  type: "part" | "guide";
  targetSku?: string | null;
  targetSlug?: string | null;
  author: string;
  rating: number;
  title: string;
  body: string;
  publishedAt: string;
  verified: boolean;
};

export type ReviewStats = { count: number; avgRating: number };

export function reviewStats(reviews: PublicReview[]): ReviewStats {
  if (reviews.length === 0) return { count: 0, avgRating: 0 };
  const sum = reviews.reduce((s, r) => s + r.rating, 0);
  return { count: reviews.length, avgRating: Math.round((sum / reviews.length) * 10) / 10 };
}

/**
 * Does this e-mail have a paid order containing this part? Used to decide
 * whether a review may carry the verified-purchase badge.
 */
export async function hasPurchased(email: string, sku: string): Promise<boolean> {
  if (!isDatabaseConfigured()) return false;
  try {
    const count = await prisma.order.count({
      where: {
        email: { equals: email, mode: "insensitive" },
        status: { in: ["PAID", "SHIPPED", "DELIVERED"] },
        items: { some: { part: { sku } } },
      },
    });
    return count > 0;
  } catch (err) {
    logger.warn("[reviews] purchase check failed — badge withheld", err);
    return false;
  }
}

/** Approved reviews for one part (by sku) or guide (by slug), newest first. */
export async function getReviews({ sku, slug }: { sku?: string; slug?: string }): Promise<PublicReview[]> {
  if (!isDatabaseConfigured()) return [];

  try {
    const rows = await prisma.review.findMany({
      where: {
        status: "APPROVED",
        ...(sku ? { targetType: "part", targetSku: sku } : { targetType: "guide", targetSlug: slug }),
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return rows.map((r) => ({
      id: r.id,
      type: r.targetType === "part" ? "part" : "guide",
      targetSku: r.targetSku,
      targetSlug: r.targetSlug,
      author: r.author,
      rating: r.rating,
      title: r.title,
      body: r.body,
      publishedAt: r.createdAt.toISOString().slice(0, 10),
      verified: r.verifiedPurchase,
    }));
  } catch (err) {
    logger.warn("[reviews] DB lookup failed — showing no reviews", err);
    return [];
  }
}

/**
 * schema.org AggregateRating built from real reviews. Returns undefined when
 * there are none, so we never publish a rating we cannot show on the page.
 */
export function aggregateRatingLd(stats: ReviewStats) {
  if (stats.count === 0) return undefined;
  return {
    "@type": "AggregateRating",
    ratingValue: stats.avgRating.toFixed(1),
    reviewCount: String(stats.count),
    bestRating: "5",
    worstRating: "1",
  };
}

/** schema.org Review list built from real reviews (capped for payload size). */
export function reviewsLd(reviews: PublicReview[], max = 5) {
  if (reviews.length === 0) return undefined;
  return reviews.slice(0, max).map((r) => ({
    "@type": "Review",
    reviewRating: { "@type": "Rating", ratingValue: String(r.rating), bestRating: "5" },
    author: { "@type": "Person", name: r.author },
    datePublished: r.publishedAt,
    reviewBody: r.body,
  }));
}
