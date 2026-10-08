/**
 * Stripe line items for a checkout session. Pure; lives outside the route file
 * because a Next route module may only export handlers and config, and the cent
 * arithmetic below has to be testable on its own (scripts/qa-checkout.ts).
 */

export type StripeLineItem = {
  price_data: {
    currency: string;
    product_data: { name: string; metadata: { sku: string } };
    unit_amount: number;
  };
  quantity: number;
};

/**
 * Stripe line items whose cents add up to `targetCents` exactly.
 *
 * One unit_amount per line cannot carry every discounted total: 5% off
 * 7 x € 28,50 leaves 3 cents that do not divide over the quantity, and the old
 * correction (add `round(residual / quantity)` to the last line) rounded those
 * 3 cents to 0 — Stripe charged € 189,49 while the order and the BTW invoice
 * recorded € 189,52. Over the catalog that missed on 510 of 1728 single-SKU
 * carts, sometimes charging the customer more than the price shown.
 *
 * So the remainder is spread cent by cent over individual units instead: the
 * units that carry one cent extra become their own line item at unit + 1.
 */
export function discountedLineItems(
  items: { name: string; sku: string; unitCents: number; quantity: number }[],
  targetCents: number
): StripeLineItem[] {
  const line = (item: { name: string; sku: string }, unitCents: number, quantity: number): StripeLineItem => ({
    price_data: {
      currency: "eur",
      product_data: { name: item.name, metadata: { sku: item.sku } },
      unit_amount: unitCents,
    },
    quantity,
  });

  if (items.length === 0) return [];

  // Largest-remainder allocation of the discounted total over the lines, so
  // every line keeps its own share of the discount and the cents that do not
  // divide land somewhere instead of being dropped.
  const grossCents = items.reduce((sum, i) => sum + i.unitCents * i.quantity, 0);
  const exact = items.map((i) => (grossCents > 0 ? (i.unitCents * i.quantity * targetCents) / grossCents : 0));
  const lineCents = exact.map((v) => Math.floor(v));
  const byRemainder = exact
    .map((v, idx) => ({ idx, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  let residual = targetCents - lineCents.reduce((a, b) => a + b, 0);
  for (let n = 0; residual > 0; n++) {
    lineCents[byRemainder[n % byRemainder.length].idx] += 1;
    residual -= 1;
  }

  const lineItems: StripeLineItem[] = [];
  items.forEach((item, idx) => {
    const base = Math.floor(lineCents[idx] / item.quantity);
    const extra = lineCents[idx] - base * item.quantity;
    if (item.quantity - extra > 0) lineItems.push(line(item, base, item.quantity - extra));
    if (extra > 0) lineItems.push(line(item, base + 1, extra));
  });
  return lineItems;
}
