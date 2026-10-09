/**
 * Safety net for Stripe orders that never got their webhook.
 *
 * The event lease (./lease.ts) recovers a function that died mid-event, but it
 * cannot help when the event never arrives: a webhook endpoint that was never
 * created, a wrong signing secret, or an outage longer than Stripe retries for.
 * The customer has paid, the order stays PENDING, and nobody is told. This asks
 * Stripe about the PENDING Stripe orders that are old enough to have been paid
 * or abandoned, and runs the same fulfilment / cancellation the webhook would.
 *
 * Meant to be called from a scheduled route (see CRON_SECRET in src/lib/env.ts);
 * it is safe to run at any time and as often as wanted: fulfilOrder and
 * cancelOrderForSession are idempotent and the status claim decides a race with
 * a late webhook.
 */
import type Stripe from "stripe";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { notifyOwner } from "@/lib/notify";
import { orderRef } from "@/lib/order-status";
import { cancelOrderForSession, fulfilOrder } from "./fulfil";
import { findStripeMarkers, putStripeMarker } from "./lease";

export const RECONCILE_MIN_AGE_MS = 15 * 60 * 1000;
const PAGE = 50;
const DEFAULT_MAX_ORDERS = 500;
const DEFAULT_BUDGET_MS = 20_000;

export type ReconcileResult = {
  checked: number;
  fulfilled: number;
  cancelled: number;
  unpaid: number;
  /** Paid at Stripe but not bookable (wrong amount, ...): the owner was told on the FIRST run, later runs skip them. */
  rejected: number;
  /** Orders skipped because an earlier run already reported them. */
  skipped: number;
  errors: number;
  /** The order cap or the time budget stopped the scan before every PENDING order was looked at. */
  truncated: boolean;
};

export type SettleOutcome =
  /** Paid at Stripe, the order was PENDING: fulfilled now (the owner is told: the webhook never came). */
  | "fulfilled"
  /** Paid at Stripe but not bookable (wrong amount, ...): fulfilOrder told the owner; the order stays PENDING. */
  | "rejected"
  /** Paid at Stripe and the order was already paid (a late webhook got there first). */
  | "already_paid"
  /** The session expired unpaid and this call cancelled the order. */
  | "cancelled"
  /** The session expired unpaid, but the order is no longer PENDING (or belongs to another session): nothing to cancel. */
  | "ignored"
  /** The session is still open: the customer could still pay. Nothing was changed. */
  | "open"
  /** The session names another order: nothing was changed. */
  | "mismatch"
  /** Stripe does not know the session. Nothing was changed. */
  | "unknown";

/**
 * Settle ONE PENDING Stripe order by asking Stripe what happened to its session:
 * paid -> the same fulfilment the webhook runs; expired -> cancel; open or
 * anything odd -> change nothing. Shared by the reconcile run and by the
 * abandoned-order sweep, so a Stripe order is never cancelled on a guess.
 * Throws on a Stripe or database error: the caller decides what that means.
 */
export async function settleStripeOrder(stripe: Stripe, order: { id: string; stripePaymentId: string }): Promise<SettleOutcome> {
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(order.stripePaymentId);
  } catch (err) {
    if ((err as { code?: string })?.code === "resource_missing" || (err as { statusCode?: number })?.statusCode === 404) return "unknown";
    throw err;
  }
  if (session.metadata?.orderId !== order.id) {
    logger.warn("Settle: the session does not belong to this order — skipped", { order: order.id, session: session.id });
    return "mismatch";
  }
  if (session.payment_status === "paid") {
    // requireOwnerNotified: the "reported" marker below is only written once the alert reached a channel.
    const outcome = await fulfilOrder(order.id, session, { requireOwnerNotified: true });
    if (outcome === "rejected") {
      // fulfilOrder has told the owner. Remember it: the order stays PENDING,
      // so without this every run (every 15 to 30 minutes) would page the
      // owner again about the same payment.
      await putStripeMarker(rejectedMarker(order.id, order.stripePaymentId), "reconcile-rejected");
      return "rejected";
    }
    if (outcome === "fulfilled") {
      logger.warn("Settle: a paid order was still PENDING (its webhook never arrived) and has been fulfilled", { order: order.id });
      await notifyOwner({
        event: "stripe.reconciled",
        level: "warn",
        title: "Betaalde bestelling zonder webhook alsnog verwerkt",
        lines: [`Bestelling #${orderRef(order.id)} stond op PENDING terwijl Stripe haar als betaald kent.`, "Controleer of het webhook-endpoint en STRIPE_WEBHOOK_SECRET kloppen."],
        url: "/admin/bestellingen",
      });
      return "fulfilled";
    }
    return "already_paid";
  }
  if (session.status === "expired") {
    return cancelOrderForSession(stripe, order.id, session, { kind: "expired", reason: "Betaalsessie verlopen", customerReason: null, notifyCustomer: false });
  }
  return "open";
}

export async function reconcilePendingStripeOrders(opts: { olderThanMs?: number; limit?: number; budgetMs?: number; now?: Date } = {}): Promise<ReconcileResult> {
  const result: ReconcileResult = { checked: 0, fulfilled: 0, cancelled: 0, unpaid: 0, rejected: 0, skipped: 0, errors: 0, truncated: false };
  const stripe = getStripe();
  if (!stripe) return result;
  const cutoff = new Date((opts.now ?? new Date()).getTime() - (opts.olderThanMs ?? RECONCILE_MIN_AGE_MS));
  const maxOrders = opts.limit ?? DEFAULT_MAX_ORDERS;
  const deadline = Date.now() + (opts.budgetMs ?? DEFAULT_BUDGET_MS);
  let seen = 0;
  // Keyset paging over ALL old PENDING orders, oldest first. A fixed "oldest 50"
  // never reached a paid order that sat behind 50 older, still open sessions.
  let after: { createdAt: Date; id: string } | null = null;
  for (;;) {
    const orders: Array<{ id: string; stripePaymentId: string | null; createdAt: Date }> = await prisma.order.findMany({
      where: {
        status: "PENDING",
        paymentMethod: "STRIPE",
        stripePaymentId: { not: null },
        createdAt: { lt: cutoff },
        ...(after ? { OR: [{ createdAt: { gt: after.createdAt } }, { createdAt: after.createdAt, id: { gt: after.id } }] } : {}),
      },
      select: { id: true, stripePaymentId: true, createdAt: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: PAGE,
    });
    if (orders.length === 0) break;
    after = { createdAt: orders[orders.length - 1].createdAt, id: orders[orders.length - 1].id };
    const reported = await findStripeMarkers(orders.map((o) => rejectedMarker(o.id, o.stripePaymentId!)));
    for (const order of orders) {
      if (seen >= maxOrders || Date.now() > deadline) {
        result.truncated = true;
        return result;
      }
      seen += 1;
      if (reported.has(rejectedMarker(order.id, order.stripePaymentId!))) {
        result.skipped += 1;
        continue;
      }
      result.checked += 1;
      try {
        const outcome = await settleStripeOrder(stripe, { id: order.id, stripePaymentId: order.stripePaymentId! });
        if (outcome === "fulfilled") result.fulfilled += 1;
        else if (outcome === "rejected") result.rejected += 1;
        else if (outcome === "cancelled") result.cancelled += 1;
        else if (outcome === "open") result.unpaid += 1;
        else if (outcome === "unknown") {
          // Stripe does not know the session: the same as the error it used to raise.
          result.errors += 1;
          logger.error("Reconcile: Stripe does not know the session of a PENDING order", { order: order.id });
        }
      } catch (err) {
        result.errors += 1;
        logger.error("Reconcile: could not settle a PENDING order", { order: order.id, err });
      }
    }
  }
  return result;
}

export const rejectedMarker = (orderId: string, sessionId: string) => `reconcile-rejected:${orderId}:${sessionId}`;
