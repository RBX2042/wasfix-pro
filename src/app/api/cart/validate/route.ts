import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { getCurrentUser, getPlanLimits } from "@/lib/auth";
import { getClientKey, rateLimit } from "@/lib/ratelimit";
import { CatalogUnavailableError, evaluateCart, loadLiveParts, publicLine, type CartRef } from "@/lib/cart-pricing";
import { cartTotals } from "@/lib/cart-totals";
import { MAX_LINES_PER_ORDER } from "@/lib/cart-limits";

export const dynamic = "force-dynamic";

/**
 * Live price and stock for a cart.
 *
 * The cart lives in the customer's browser (localStorage) and can be days old: a
 * price raised, a part sold out, a part deleted. /checkout calls this when it
 * opens and the drawer calls it when it is opened, so the customer sees the
 * current truth BEFORE pressing the order button. /api/checkout re-checks
 * anyway and refuses (409) to charge anything the customer was not shown.
 *
 *   POST {items:[{sku?, partId?, quantity}]}  -> lines, changed, totals (with the signed-in plan discount)
 *   GET  ?sku=A&sku=B                         -> the same lines for quantity 1, no totals
 *
 * Public fields only (name, brand, picture, price, stock): never the cost price.
 */

// Quantity is capped by the evaluation, not refused: an old cart holding 40 of something
// must be shortened, not turned away.
const BodySchema = z.object({
  items: z
    .array(
      z
        .object({ sku: z.string().min(1).max(64).optional(), partId: z.string().min(1).max(64).optional(), quantity: z.number().int().min(1).max(1000) })
        .refine((d) => d.sku || d.partId, { message: "sku of partId is verplicht" }),
    )
    .min(1)
    .max(MAX_LINES_PER_ORDER * 2),
});

async function answer(refs: CartRef[], withTotals: boolean) {
  const parts = await loadLiveParts(refs);
  const evaluation = evaluateCart(refs, parts);
  const lines = evaluation.lines.map(publicLine);
  if (!withTotals) return apiSuccess({ lines, changed: evaluation.changed });

  let partsDiscount = 0;
  try {
    const user = await getCurrentUser();
    if (user) partsDiscount = getPlanLimits(user.plan).partsDiscount;
  } catch {
    // Anonymous: no discount.
  }
  const subtotal = evaluation.orderable.reduce((sum, l) => sum + (l.part?.priceEur ?? 0) * l.quantity, 0);
  return apiSuccess({ lines, changed: evaluation.changed, partsDiscount, totals: cartTotals(subtotal, partsDiscount) });
}

function failure(err: unknown) {
  if (err instanceof CatalogUnavailableError) {
    logger.error("[cart/validate] no database in production");
    return apiError("De winkelmand kan nu niet worden gecontroleerd. Probeer het zo opnieuw.", 503);
  }
  logger.error("[cart/validate] lookup failed", err);
  return apiError("De winkelmand kan nu niet worden gecontroleerd. Probeer het zo opnieuw.", 503);
}

export async function POST(req: NextRequest) {
  if (!(await rateLimit(`cart-validate:${getClientKey(req)}`, 120, 10 * 60 * 1000))) {
    return apiError("Te veel verzoeken. Probeer het over een paar minuten opnieuw.", 429);
  }
  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return apiError("Ongeldige winkelmand", 400);
  try {
    return await answer(parsed.data.items, true);
  } catch (err) {
    return failure(err);
  }
}

export async function GET(req: NextRequest) {
  if (!(await rateLimit(`cart-validate:${getClientKey(req)}`, 120, 10 * 60 * 1000))) {
    return apiError("Te veel verzoeken. Probeer het over een paar minuten opnieuw.", 429);
  }
  const url = new URL(req.url);
  const skus = [...url.searchParams.getAll("sku"), ...(url.searchParams.get("skus")?.split(",") ?? [])]
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 64);
  const unique = [...new Set(skus)].slice(0, MAX_LINES_PER_ORDER * 2);
  if (unique.length === 0) return apiError("Geef minstens één sku op", 400);
  try {
    return await answer(unique.map((sku) => ({ sku, quantity: 1 })), false);
  } catch (err) {
    return failure(err);
  }
}
