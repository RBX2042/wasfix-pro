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
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { notifyOwner } from "@/lib/notify";
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
        const session = await stripe.checkout.sessions.retrieve(order.stripePaymentId!);
        if (session.metadata?.orderId !== order.id) {
          logger.warn("Reconcile: the session does not belong to this order — skipped", { order: order.id, session: session.id });
          continue;
        }
        if (session.payment_status === "paid") {
          const outcome = await fulfilOrder(order.id, session);
          if (outcome === "rejected") {
            // fulfilOrder has told the owner. Remember it: the order stays PENDING,
            // so without this every run (every 15 to 30 minutes) would page the
            // owner again about the same payment.
            result.rejected += 1;
            await putStripeMarker(rejectedMarker(order.id, order.stripePaymentId!), "reconcile-rejected");
          } else if (outcome === "fulfilled") {
            result.fulfilled += 1;
            logger.warn("Reconcile: a paid order was still PENDING (its webhook never arrived) and has been fulfilled", { order: order.id });
            await notifyOwner({
              event: "stripe.reconciled",
              level: "warn",
              title: "Betaalde bestelling zonder webhook alsnog verwerkt",
              lines: [`Bestelling #${order.id.slice(0, 8).toUpperCase()} stond op PENDING terwijl Stripe haar als betaald kent.`, "Controleer of het webhook-endpoint en STRIPE_WEBHOOK_SECRET kloppen."],
              url: "/admin/bestellingen",
            });
          }
        } else if (session.status === "expired") {
          const outcome = await cancelOrderForSession(stripe, order.id, session, { kind: "expired", reason: "Betaalsessie verlopen", customerReason: null, notifyCustomer: false });
          if (outcome === "cancelled") result.cancelled += 1;
        } else {
          result.unpaid += 1;
        }
      } catch (err) {
        result.errors += 1;
        logger.error("Reconcile: could not settle a PENDING order", { order: order.id, err });
      }
    }
  }
  return result;
}

const rejectedMarker = (orderId: string, sessionId: string) => `reconcile-rejected:${orderId}:${sessionId}`;
