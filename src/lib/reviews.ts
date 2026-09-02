/**
 * Review data for public pages.
 *
 * Two sources, merged: the curated seed set in `src/data/reviews.json` and
 * moderator-approved rows in the `Review` table. Ratings shown to users and
 * emitted as schema.org AggregateRating are always computed from these real
 * reviews — never invented — so structured data matches what the page shows.
 */

import "server-only";
import reviewsRaw from "@/data/reviews.json";
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

const seedReviews = reviewsRaw as PublicReview[];

export type ReviewStats = { count: number; avgRating: number };

export function reviewStats(reviews: PublicReview[]): ReviewStats {
  if (reviews.length === 0) return { count: 0, avgRating: 0 };
  const sum = reviews.reduce((s, r) => s + r.rating, 0);
  return { count: reviews.length, avgRating: Math.round((sum / reviews.length) * 10) / 10 };
}

/** Approved reviews for one part (by sku) or guide (by slug), newest first. */
export async function getReviews({ sku, slug }: { sku?: string; slug?: string }): Promise<PublicReview[]> {
  const seeded = seedReviews.filter((r) =>
    sku ? r.type === "part" && r.targetSku === sku : r.type === "guide" && r.targetSlug === slug
  );

  if (!isDatabaseConfigured()) return seeded;

  try {
    const rows = await prisma.review.findMany({
      where: {
        status: "APPROVED",
        ...(sku ? { targetType: "part", targetSku: sku } : { targetType: "guide", targetSlug: slug }),
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const fromDb: PublicReview[] = rows.map((r) => ({
      id: r.id,
      type: r.targetType === "part" ? "part" : "guide",
      targetSku: r.targetSku,
      targetSlug: r.targetSlug,
      author: r.author,
      rating: r.rating,
      title: r.title,
      body: r.body,
      publishedAt: r.createdAt.toISOString().slice(0, 10),
      verified: true,
    }));
    return [...fromDb, ...seeded];
  } catch (err) {
    logger.warn("[reviews] DB lookup failed — serving seed reviews only", err);
    return seeded;
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
