import { NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";
import { apiError, apiSuccess } from "@/lib/api-response";
import { env } from "@/lib/env";
import { revalidateCatalog } from "@/lib/cache-tags";

export const dynamic = "force-dynamic";

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * POST /api/parts/revalidate - make the storefront pick up a catalogue change now.
 *
 * For edits made straight in the database (a price update in SQL, a stock import):
 * a SQL statement cannot call revalidateCatalog() itself. The admin editor, checkout
 * and the Stripe webhook are in other bundles' files and do not call it yet; until
 * they do, the pages catch up on their own within a minute.
 *
 * Authorisation: `Authorization: Bearer <CRON_SECRET>`. With no CRON_SECRET
 * configured the endpoint is closed (503) rather than open.
 */
export async function POST(req: NextRequest) {
  const secret = env.CRON_SECRET;
  if (!secret) return apiError("Niet beschikbaar: CRON_SECRET is niet ingesteld", 503);
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!given || !sameSecret(given, secret)) return apiError("Niet geautoriseerd", 401);
  const issued = revalidateCatalog();
  return apiSuccess({ revalidated: issued });
}
