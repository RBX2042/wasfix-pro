import { getReviews, reviewStats, type PublicReview } from "@/lib/reviews";
import { ReviewForm } from "./ReviewForm";

export { reviewStats } from "@/lib/reviews";
export type { PublicReview } from "@/lib/reviews";

function Stars({ rating, className }: { rating: number; className?: string }) {
  const full = Math.round(rating);
  return (
    <span style={{ color: "#f5b643" }} className={className} aria-label={`${rating} van 5 sterren`}>
      {"★".repeat(full)}
      {"☆".repeat(Math.max(0, 5 - full))}
    </span>
  );
}

export function ReviewList({ reviews }: { reviews: PublicReview[] }) {
  const stats = reviewStats(reviews);

  return (
    <div className="space-y-4">
      {reviews.length > 0 && (
        <div className="flex items-center gap-2 text-sm">
          <Stars rating={stats.avgRating} />
          <span className="font-medium tabular-nums">{stats.avgRating.toFixed(1)}</span>
          <span className="text-muted-foreground">/ 5 · {stats.count} {stats.count === 1 ? "review" : "reviews"}</span>
        </div>
      )}
      {reviews.map((r) => (
        <article key={r.id} className="border-l-2 border-primary/30 pl-4">
          <div className="flex items-baseline justify-between gap-2 mb-1 flex-wrap">
            <div className="flex items-center gap-2">
              <Stars rating={r.rating} className="text-xs" />
              <span className="font-medium text-sm">{r.title}</span>
            </div>
            {r.verified && (
              <span className="text-xs text-emerald-600 flex items-center gap-1">
                <span aria-hidden>✓</span> Geverifieerde aankoop
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mb-2 leading-relaxed">{r.body}</p>
          <div className="text-xs text-muted-foreground">
            {r.author} · {new Date(r.publishedAt).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" })}
          </div>
        </article>
      ))}
    </div>
  );
}

/**
 * Review block for a part or guide detail page: approved reviews plus a
 * submission form. Reviews are moderated in /admin/aanvragen before they
 * appear here, so nothing user-submitted goes live unchecked.
 */
export async function Reviews({ sku, slug }: { sku?: string; slug?: string }) {
  const reviews = await getReviews({ sku, slug });

  return (
    <section className="border rounded-lg p-6" id="reviews">
      <h2 className="font-heading text-lg font-semibold mb-4">
        Reviews {reviews.length > 0 && <span className="text-muted-foreground font-normal">({reviews.length})</span>}
      </h2>

      {reviews.length === 0 ? (
        <p className="text-sm text-muted-foreground mb-6">
          Nog geen reviews voor {sku ? "dit onderdeel" : "deze gids"}. Wees de eerste die er een schrijft.
        </p>
      ) : (
        <div className="mb-6">
          <ReviewList reviews={reviews} />
        </div>
      )}

      <ReviewForm targetType={sku ? "part" : "guide"} targetSku={sku} targetSlug={slug} />
    </section>
  );
}
