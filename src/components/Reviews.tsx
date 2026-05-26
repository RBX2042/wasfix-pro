import reviewsData from "@/data/reviews.json";

type Review = {
  id: string;
  type: "part" | "guide";
  targetSku?: string;
  targetSlug?: string;
  author: string;
  rating: number;
  title: string;
  body: string;
  publishedAt: string;
  verified: boolean;
};

const reviews = reviewsData as Review[];

export function getReviewsFor({ sku, slug }: { sku?: string; slug?: string }): Review[] {
  if (sku) return reviews.filter((r) => r.type === "part" && r.targetSku === sku);
  if (slug) return reviews.filter((r) => r.type === "guide" && r.targetSlug === slug);
  return [];
}

export function getReviewStats(reviews: Review[]): { count: number; avgRating: number } {
  if (reviews.length === 0) return { count: 0, avgRating: 0 };
  const sum = reviews.reduce((s, r) => s + r.rating, 0);
  return { count: reviews.length, avgRating: sum / reviews.length };
}

// Read-only review display component. Submission flow goes to /api/reviews
// (scaffold — needs DB + moderation when activated).
export function Reviews({ sku, slug }: { sku?: string; slug?: string }) {
  const list = getReviewsFor({ sku, slug });
  const stats = getReviewStats(list);

  if (list.length === 0) {
    return (
      <div className="border rounded-lg p-6 text-center text-sm text-muted-foreground">
        Nog geen reviews voor dit {sku ? "onderdeel" : "gids"}. Wees de eerste.
      </div>
    );
  }

  return (
    <div className="border rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-heading text-lg font-semibold">Reviews ({stats.count})</h3>
        <div className="flex items-center gap-2 text-sm">
          <span style={{ color: "#f5b643" }}>{"★".repeat(Math.round(stats.avgRating))}{"☆".repeat(5 - Math.round(stats.avgRating))}</span>
          <span className="font-medium tabular-nums">{stats.avgRating.toFixed(1)}</span>
          <span className="text-muted-foreground">/ 5</span>
        </div>
      </div>

      <div className="space-y-4">
        {list.map((r) => (
          <article key={r.id} className="border-l-2 border-primary/30 pl-4">
            <div className="flex items-baseline justify-between gap-2 mb-1">
              <div className="flex items-center gap-2">
                <span style={{ color: "#f5b643" }} className="text-xs">{"★".repeat(r.rating)}</span>
                <span className="font-medium text-sm">{r.title}</span>
              </div>
              {r.verified && (
                <span className="text-xs text-emerald-600 flex items-center gap-1">
                  <span>✓</span> Geverifieerde aankoop
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
    </div>
  );
}
