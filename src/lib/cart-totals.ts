/**
 * The order total, computed one way for everybody: the cart drawer, the
 * checkout summary, /api/cart/validate and (line for line) /api/checkout.
 * Client-safe.
 *
 * The arithmetic is the one /api/checkout has always used: discount on the whole
 * subtotal, shipping decided AFTER the discount, VAT contained in the total.
 * scripts/qa-checkout.ts compares this function with real orders so the two
 * copies cannot drift apart unnoticed.
 */
import { SHIPPING, VAT_RATE, shippingFor } from "./plans";

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

export type CartTotals = {
  subtotalEur: number;
  discountEur: number;
  shippingEur: number;
  totalEur: number;
  /** VAT contained in totalEur (catalogue prices include btw). */
  vatEur: number;
  /** What is still missing for free shipping, 0 when already free. */
  toFreeShippingEur: number;
};

export function cartTotals(rawSubtotalEur: number, partsDiscount = 0): CartTotals {
  const subtotalEur = money(rawSubtotalEur);
  const discountEur = money(subtotalEur * partsDiscount);
  const shippingEur = shippingFor(subtotalEur, discountEur);
  const totalEur = money(subtotalEur - discountEur + shippingEur);
  const vatEur = money(totalEur * (VAT_RATE / (1 + VAT_RATE)));
  const toFreeShippingEur = Math.max(0, money(SHIPPING.freeFromEur - (subtotalEur - discountEur)));
  return { subtotalEur, discountEur, shippingEur, totalEur, vatEur, toFreeShippingEur };
}

/** Whole cents, for comparing two euro amounts without float noise. */
export const cents = (eur: number): number => Math.round(eur * 100);
