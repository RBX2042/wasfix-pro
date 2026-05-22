import Stripe from "stripe";
import { env } from "./env";

let _stripe: Stripe | null = null;

export function getStripe(): Stripe | null {
  if (!env.STRIPE_SECRET_KEY) return null;
  if (!_stripe) {
    _stripe = new Stripe(env.STRIPE_SECRET_KEY, {
      apiVersion: "2024-12-18.acacia" as Stripe.LatestApiVersion,
      typescript: true,
    });
  }
  return _stripe;
}

export const STRIPE_PRICES = {
  PARTICULIER: env.STRIPE_PRICE_PARTICULIER ?? "",
  MONTEUR_PRO: env.STRIPE_PRICE_MONTEUR ?? "",
  BEDRIJF: env.STRIPE_PRICE_BEDRIJF ?? "",
} as const;
