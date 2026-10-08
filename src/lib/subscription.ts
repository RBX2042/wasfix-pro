/**
 * What a customer's subscription is worth RIGHT NOW.
 *
 * User.plan says which plan the customer last paid for; it does not say whether
 * they still do. The Stripe webhook mirrors Stripe's own status and "paid
 * through" date next to it (User.stripeSubStatus, User.stripeCurrentPeriodEnd)
 * and every entitlement check should ask effectivePlan(user) instead of reading
 * User.plan directly. getCurrentUser() (src/lib/auth.ts) applies it, so every
 * entitlement check downstream already sees the effective plan and the grace
 * window below is in force. The scheduled maintenance that moves a lapsed
 * subscription back to FREE in the database runs from /api/cron/stripe-subscriptions,
 * which only runs when the hosting platform calls it with CRON_SECRET.
 *
 * The functions here are pure: no database, no Stripe client, no environment.
 * The module imports ./plans for the plan table and nothing else at runtime.
 * The server side (re-fetching a subscription from Stripe and writing these
 * columns) lives in src/app/api/stripe/_lib/.
 *
 * "PAID THROUGH" (User.stripeCurrentPeriodEnd)
 *   The end of the period the customer has actually paid for.
 *     active / trialing   Stripe's current_period_end.
 *     past_due, unpaid    Stripe's current_period_START. Stripe's documentation
 *                         has the period advance when the renewal invoice is
 *                         created, whether or not it is paid, so the start of
 *                         the current period is the end of the last paid one.
 *                         That is documented behaviour; it has not been run
 *                         against the live API from this repository, only
 *                         against scripts/lib/fake-stripe.ts. The grace window
 *                         below counts from this date.
 *     canceled            not stored (null). See below.
 *
 * "canceled" means the subscription HAS ENDED at Stripe. A customer who cancels
 * in the billing portal with "at the end of the billing period" (checkStripeReadiness
 * fails when the portal is set to cancel immediately, because the terms promise
 * access to the end of the paid period) stays "active" with cancel_at_period_end
 * until that moment, so the paid time is honoured by Stripe's own status and not
 * by a date rule here. A "canceled" subscription with time left on its period
 * comes from an immediate cancellation (Dashboard, API, account erasure) or from
 * Stripe's dunning settings ending a subscription whose card never paid; neither
 * is owed the rest of the period, and treating it as owed restored the paid plan
 * for up to a month after the dunning had failed. (How Stripe reports these
 * states is taken from its documentation; it has not been run against the live
 * API from this repository, only against scripts/lib/fake-stripe.ts.)
 *
 * effectivePlan
 *   no Stripe status (never touched by the webhook)   user.plan as stored
 *   active, trialing                                   user.plan
 *   past_due                                           user.plan until paidThrough + PAST_DUE_GRACE_DAYS, then FREE
 *   canceled, unpaid, incomplete, incomplete_expired,
 *   paused, anything unknown                           FREE
 */
import type Stripe from "stripe";
import { PLANS, type Plan, type PlanId } from "./plans";

/**
 * How long a customer whose renewal payment failed keeps their plan. Stripe
 * retries the card on its own schedule and the customer is told with a link to
 * the billing portal on every failed attempt; after this many days without a
 * payment the plan lapses to FREE even if Stripe is still retrying.
 */
export const PAST_DUE_GRACE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Statuses in which Stripe is (or will go on) charging this subscription. */
export const LIVE_SUBSCRIPTION_STATUSES: readonly string[] = ["active", "trialing", "past_due"];

/**
 * Statuses for which a new Checkout must not be created: the customer already
 * has a subscription object that the billing portal can repair or change.
 * "unpaid" is included because its open invoices are settled in the portal and
 * a second subscription would leave it dangling at Stripe. For that to work the
 * webhook keeps User.stripeSubId for an unpaid subscription (the plan is FREE,
 * the id stays); the subscribe route also looks the customer's subscriptions up
 * at Stripe, so it does not depend on the id alone.
 */
export const PORTAL_SUBSCRIPTION_STATUSES: readonly string[] = [...LIVE_SUBSCRIPTION_STATUSES, "unpaid"];

export function isLiveSubscriptionStatus(status: string | null | undefined): boolean {
  return !!status && LIVE_SUBSCRIPTION_STATUSES.includes(status);
}

export type SubscriptionFields = {
  plan: string;
  stripeSubStatus?: string | null;
  stripeCurrentPeriodEnd?: Date | string | null;
  /**
   * Stripe's cancel_at_period_end. There is no column for it yet (it needs a
   * migration by the schema owner, see the Stripe bundle's report), so rows read
   * from the database leave it undefined and subscriptionNotice never says "ending".
   */
  stripeCancelAtPeriodEnd?: boolean | null;
};

function asTime(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const t = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

/** The moment a past_due customer loses the plan, or null when there is no paid-through date. */
export function pastDueGraceEndsAt(paidThrough: Date | string | null | undefined): Date | null {
  const t = asTime(paidThrough);
  return t === null ? null : new Date(t + PAST_DUE_GRACE_DAYS * DAY_MS);
}

/** The plan this account is entitled to at `now`. See the module comment for the rules. */
export function effectivePlan(user: SubscriptionFields, now: Date = new Date()): string {
  if (!user.plan || user.plan === "FREE") return "FREE";
  const status = user.stripeSubStatus;
  // Not managed by the Stripe webhook (an admin-granted plan, a row older than
  // the status column): nothing to contradict the stored plan.
  if (!status) return user.plan;
  const paidThrough = asTime(user.stripeCurrentPeriodEnd);
  switch (status) {
    case "active":
    case "trialing":
      return user.plan;
    case "past_due": {
      if (paidThrough === null) return "FREE";
      return now.getTime() <= paidThrough + PAST_DUE_GRACE_DAYS * DAY_MS ? user.plan : "FREE";
    }
    default:
      return "FREE";
  }
}

export type SubscriptionNotice =
  | { kind: "past_due"; plan: string; graceEndsAt: Date | null; lapsed: boolean }
  | { kind: "ending"; plan: string; endsAt: Date }
  | { kind: "payment_required"; plan: string };

/**
 * What the dashboard should tell the customer about their payment, or null when
 * all is well. "past_due" is the one that earns money: it is shown with a link
 * to the billing portal (POST /api/stripe/portal).
 */
export function subscriptionNotice(user: SubscriptionFields, now: Date = new Date()): SubscriptionNotice | null {
  if (!user.plan || user.plan === "FREE" || !user.stripeSubStatus) return null;
  const end = asTime(user.stripeCurrentPeriodEnd);
  if (user.stripeSubStatus === "past_due") {
    const grace = pastDueGraceEndsAt(user.stripeCurrentPeriodEnd);
    return { kind: "past_due", plan: user.plan, graceEndsAt: grace, lapsed: !grace || now.getTime() > grace.getTime() };
  }
  if ((user.stripeSubStatus === "active" || user.stripeSubStatus === "trialing") && user.stripeCancelAtPeriodEnd === true && end !== null && now.getTime() < end) {
    return { kind: "ending", plan: user.plan, endsAt: new Date(end) };
  }
  if (user.stripeSubStatus === "unpaid") return { kind: "payment_required", plan: user.plan };
  return null;
}

/** "exclusive" for the business tiers (quoted ex btw), "inclusive" for consumers. Stripe cannot change it on an existing price. */
export function expectedTaxBehavior(plan: Plan): "exclusive" | "inclusive" {
  return plan.audience === "business" ? "exclusive" : "inclusive";
}

/**
 * The fields on which a Stripe price differs from the plan we advertise. Empty
 * means the price may be sold. One function for the subscribe route and the
 * readiness check, so they can never accept different prices.
 */
export function priceMismatches(price: Pick<Stripe.Price, "unit_amount" | "currency" | "recurring" | "tax_behavior" | "active">, plan: Plan): string[] {
  return [
    price.active === false && "active",
    price.unit_amount !== plan.priceCents && "unit_amount",
    price.currency !== "eur" && "currency",
    price.recurring?.interval !== "month" && "recurring.interval",
    price.recurring?.interval_count !== 1 && "recurring.interval_count",
    price.tax_behavior !== expectedTaxBehavior(plan) && "tax_behavior",
  ].filter((m): m is string => typeof m === "string");
}

/** Plan config for a plan id (kept here so route code needs one import for both). */
export function planConfig(plan: PlanId): Plan {
  return PLANS[plan];
}
