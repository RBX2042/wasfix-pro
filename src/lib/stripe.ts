import Stripe from "stripe";
import { env } from "./env";

/** The API version this code is written against. Webhook events follow the ENDPOINT's version, not this one. */
export const STRIPE_API_VERSION = "2024-12-18.acacia";

let _stripe: Stripe | null = null;
let _override: Stripe | null = null;

export function getStripe(): Stripe | null {
  // Test seam: scripts/qa-stripe.ts hands in a client that talks to the local
  // fake Stripe (scripts/lib/fake-stripe.ts). Production code never calls
  // _setStripeForTests, so this branch cannot be reached there.
  if (_override) return _override;
  if (!env.STRIPE_SECRET_KEY) return null;
  if (!_stripe) {
    _stripe = new Stripe(env.STRIPE_SECRET_KEY, {
      apiVersion: STRIPE_API_VERSION as Stripe.LatestApiVersion,
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

/** For tests only: use `client` instead of the one built from STRIPE_SECRET_KEY. Pass null to go back. */
export function _setStripeForTests(client: Stripe | null): void {
  _override = client;
}

/** @deprecated Use stripePriceIdFor() from src/lib/plans.ts. */
export const STRIPE_PRICES = {
  PARTICULIER: env.STRIPE_PRICE_PARTICULIER ?? "",
  MONTEUR_PRO: env.STRIPE_PRICE_MONTEUR ?? "",
  BEDRIJF: env.STRIPE_PRICE_BEDRIJF ?? "",
} as const;

export type StripeRefundResult = { ok: true; refundId: string; amountEur: number } | { ok: false; error: string };

/**
 * Pay (part of) a Stripe order back. Create the refund FIRST, then record it:
 * pass `refundId` to cancelOrder / recordRefund (src/lib/invoicing.ts) as
 * `stripeRefundId` and honour the `refundDueEur` they return. If this fails the
 * order has not been touched and can simply be retried.
 *
 * `idempotencyKey` must be stable for one intended refund (for example
 * `cancel-<orderId>`): a double click then reaches Stripe as the same refund.
 * The charge.refunded webhook later finds the credit note by this refund id and
 * books nothing a second time. Never throws.
 */
export async function refundStripePayment(opts: { orderId: string; paymentIntentId: string; amountEur: number; idempotencyKey: string }): Promise<StripeRefundResult> {
  const stripe = getStripe();
  if (!stripe) return { ok: false, error: "Stripe is niet geconfigureerd." };
  const amount = Math.round(opts.amountEur * 100);
  if (!opts.paymentIntentId || !Number.isInteger(amount) || amount <= 0) return { ok: false, error: "Ongeldige terugbetaling." };
  try {
    const refund = await stripe.refunds.create(
      { payment_intent: opts.paymentIntentId, amount, metadata: { orderId: opts.orderId } },
      { idempotencyKey: opts.idempotencyKey },
    );
    return { ok: true, refundId: refund.id, amountEur: refund.amount / 100 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Stripe kon de terugbetaling niet uitvoeren: ${message.slice(0, 200)}` };
  }
}

function isMissing(err: unknown): boolean {
  const e = err as { code?: string; statusCode?: number } | null;
  return e?.code === "resource_missing" || e?.statusCode === 404;
}

/**
 * End a subscription where it bills. "already_ended" when Stripe no longer knows
 * it or has it as canceled. Throws on any other Stripe error, so a caller that
 * must not carry on with a subscription still billing (account erasure) can stop.
 */
export async function endStripeSubscription(stripe: Stripe, subscriptionId: string, idempotencyKey: string): Promise<"cancelled" | "already_ended"> {
  let current: Stripe.Subscription;
  try {
    current = await stripe.subscriptions.retrieve(subscriptionId);
  } catch (err) {
    if (isMissing(err)) return "already_ended";
    throw err;
  }
  if (current.status === "canceled" || current.status === "incomplete_expired") return "already_ended";
  try {
    await stripe.subscriptions.cancel(subscriptionId, undefined, { idempotencyKey });
  } catch (err) {
    if (isMissing(err)) return "already_ended";
    throw err;
  }
  return "cancelled";
}

/**
 * Stop a Stripe customer record from identifying a person who asked to be
 * erased: name, e-mail, phone, address and shipping are replaced and the saved
 * payment methods (which carry billing name, e-mail and address of their own)
 * are detached. The customer object itself, and the charges and invoices Stripe
 * has already issued for it, stay at Stripe: this does not rewrite those.
 * Throws when Stripe refuses, so the caller can tell the owner to finish by hand.
 */
export async function scrubStripeCustomer(stripe: Stripe, customerId: string, anonymisedEmail: string): Promise<{ detachedPaymentMethods: number }> {
  await stripe.customers.update(customerId, { name: "Verwijderd account", email: anonymisedEmail, phone: "", address: "", shipping: "" });
  let detached = 0;
  const methods = await stripe.paymentMethods.list({ customer: customerId, limit: 100 });
  for (const method of methods.data) {
    await stripe.paymentMethods.detach(method.id);
    detached += 1;
  }
  return { detachedPaymentMethods: detached };
}
