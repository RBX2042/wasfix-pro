import Stripe from "stripe";
import { env } from "./env";

let _stripe: Stripe | null = null;

export function getStripe(): Stripe | null {
  if (!env.STRIPE_SECRET_KEY) return null;
  if (!_stripe) {
    _stripe = new Stripe(env.STRIPE_SECRET_KEY, {
      apiVersion: "2024-12-18.acacia" as Stripe.LatestApiVersion,
      typescript: true,
      // stripe-node defaults to 80s per attempt and retries twice — far beyond
      // any serverless function limit. The customer then got a 504 with the order
      // already persisted as PENDING. 8s x at most 2 attempts keeps the total
      // under ~16s, so the route can handle its own failure instead of being
      // killed mid-flight.
      timeout: 8_000,
      maxNetworkRetries: 1,
    });
  }
  return _stripe;
}

/** @deprecated Use stripePriceIdFor() from src/lib/plans.ts. */
export const STRIPE_PRICES = {
  PARTICULIER: env.STRIPE_PRICE_PARTICULIER ?? "",
  MONTEUR_PRO: env.STRIPE_PRICE_MONTEUR ?? "",
  BEDRIJF: env.STRIPE_PRICE_BEDRIJF ?? "",
} as const;
