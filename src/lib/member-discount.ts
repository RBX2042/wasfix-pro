/**
 * The price a plan member pays for parts, computed exactly the way checkout
 * computes it.
 *
 * /api/checkout does `discount = money(subtotal * partsDiscount)` and
 * `total = money(subtotal - discount)`, where money() rounds to cents with
 * Math.round(x * 100) / 100. The first version of the product page rounded the
 * DISCOUNTED price instead (cents - round(cents * d)); in floating point
 * 28.5 * 0.15 is 4.2749999999999995, so checkout's discount is 4.27 and the
 * member pays 24.23, while the page promised 24.22. 14 of 96 parts disagreed
 * at the 15% tier. Same operations, same order, no shortcut.
 *
 * Client-safe on purpose (no imports): member-price.tsx runs in the browser.
 */

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

/** What `quantity` pieces cost a member, before shipping. Mirrors /api/checkout. */
export function memberLineTotal(priceEur: number, discount: number, quantity = 1): number {
  const subtotal = money(priceEur * quantity);
  const off = money(subtotal * discount);
  return money(subtotal - off);
}
