import { COMPANY, SHIPPING } from "@/lib/plans";
import { env, isStripeConfigured } from "@/lib/env";
import { formatEur } from "@/lib/utils";

/**
 * Statements about the shop that are shown to buyers, computed from the same
 * settings checkout uses, so a page can only say what is true right now.
 */

/**
 * "iDEAL en creditcard of op rekening (bankoverschrijving)" - only the payment
 * methods that are really switched on: Stripe (iDEAL + card) needs its keys, and
 * "op rekening" is refused in production while the company identity is still a
 * placeholder. Returns null when nothing is on, so the page says nothing rather
 * than something false.
 */
export function paymentMethodsLine(): string | null {
  const stripeOn = isStripeConfigured();
  const bankTransferOn = !(env.IS_PRODUCTION && COMPANY.isPlaceholder);
  const parts = [stripeOn ? "iDEAL en creditcard" : null, bankTransferOn ? "op rekening (bankoverschrijving)" : null].filter(Boolean);
  return parts.length ? parts.join(" of ") : null;
}

/** "Verzending binnen Nederland € 5,95, gratis vanaf € 50." */
export function shippingLine(): string {
  return `Verzending binnen Nederland ${formatEur(SHIPPING.rateEur)}, gratis vanaf ${formatEur(SHIPPING.freeFromEur)}.`;
}
