/**
 * Cache tags and the one helper that invalidates the public catalogue.
 *
 * The home, product and error-code pages used to be `force-dynamic`: every ad
 * click or crawler hit became a function invocation plus several database
 * queries (p50 650-1300 ms against ~100 ms for the pages that were already
 * cached). They now render from the Next.js data cache, which holds the
 * catalogue reads for CATALOG_REVALIDATE_SECONDS and can be dropped at once by
 * tag.
 *
 * WHO CALLS revalidateCatalog(): today only POST /api/parts/revalidate (secret
 * protected), for edits made straight in the database. The admin price/stock
 * editor, the stock decrement in checkout and the Stripe webhook live in other
 * bundles' files and do NOT call it yet (listed as a cross-file need); until
 * they do, an edit shows up after at most CATALOG_REVALIDATE_SECONDS. Checkout
 * itself never reads this cache (it reads the live row), so a stale page can
 * show an old price or stock but can never charge one.
 */

import { revalidateTag, unstable_cache } from "next/cache";
import { logger } from "@/lib/logger";

export const CATALOG_TAG = "catalog";

/** Upper bound on how stale a catalogue page can be if nobody revalidates. */
export const CATALOG_REVALIDATE_SECONDS = 60;

/**
 * Run a catalogue read through the Next.js data cache, tagged CATALOG_TAG.
 *
 * `key` must contain every input that changes the result - the cached function
 * is identified by it alone, not by its closure.
 *
 * Outside the Next.js server (tsx scripts, the qa-* suites) there is no
 * incremental cache and unstable_cache throws, so the read runs directly.
 * NEXT_RUNTIME is set by Next for every server render and route handler.
 */
export async function cachedCatalogRead<T>(key: string[], read: () => Promise<T>): Promise<T> {
  if (!process.env.NEXT_RUNTIME) return read();
  return unstable_cache(read, ["catalog", ...key], {
    revalidate: CATALOG_REVALIDATE_SECONDS,
    tags: [CATALOG_TAG],
  })();
}

/**
 * Drop every cached catalogue read (and, with them, the pages rendered from
 * them) so the next visitor sees the new price/stock.
 *
 * Only works inside a Next.js request (route handler or server action). When it
 * cannot run - a script, or an unexpected Next error - it logs and returns
 * false instead of throwing: the caller has already committed its database
 * change, and a failed cache hint must not turn that into an error for the
 * customer. The time-based revalidate above is the backstop.
 *
 * @returns whether the revalidation was issued.
 */
export function revalidateCatalog(): boolean {
  try {
    revalidateTag(CATALOG_TAG);
    return true;
  } catch (err) {
    logger.warn("[cache] revalidateCatalog could not run; pages fall back to the time-based refresh", err);
    return false;
  }
}

