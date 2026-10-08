/**
 * Give back the stock held by reservations that will never be paid.
 *
 * An OPENSTAAND order holds its units from the moment the invoice goes out. Once
 * the due date plus the grace period of the terms (voorwaarden art. 7) has
 * passed, the order is cancelled through cancelOrder(): in ONE transaction that
 * flips the status, puts the units back and issues the credit note for the
 * invoice (decision D4: an invoice is never edited or deleted).
 *
 * WHERE IT RUNS. cancelOrder() awaits a customer mail and an owner notice per
 * order, so a sweep costs roughly one webhook round trip per order. It therefore
 * never runs inline in a customer's request except in one narrow case: the
 * customer's cart is short of stock and an expired reservation is what holds the
 * missing units (then at most 3 are released, with a deadline, because the
 * alternative is refusing a paying customer). Otherwise /api/checkout starts it
 * after the response (MAX_SWEEP_PER_CHECKOUT per request). It is also exported
 * for a scheduled route; one is not part of this bundle.
 *
 * Each order is handled on its own: one poisoned row must not stop the others.
 */
import { prisma } from "./prisma";
import { logger } from "./logger";
import { cancelOrder } from "./invoicing";
import { canTransition } from "./order-status";
import { revalidateCatalog } from "./cache-tags";
import { ABANDONED_STRIPE_ORDER_HOURS, BANK_TRANSFER_GRACE_DAYS } from "./cart-limits";

export type ExpiryResult = { examined: number; cancelled: number; failed: number };

export async function releaseExpiredBankTransferOrders(
  opts: {
    limit?: number;
    now?: Date;
    /** Only reservations that hold one of these parts (the shortage case). */
    partIds?: string[];
    /** Stop waiting after this long and return what is done so far; the work in flight still completes. */
    deadlineMs?: number;
  } = {},
): Promise<ExpiryResult> {
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - BANK_TRANSFER_GRACE_DAYS * 24 * 60 * 60 * 1000);
  const expired = await prisma.order.findMany({
    where: {
      status: "OPENSTAAND",
      paymentMethod: "BANK_TRANSFER",
      dueAt: { lt: cutoff },
      ...(opts.partIds ? { items: { some: { partId: { in: opts.partIds } } } } : {}),
    },
    select: { id: true },
    // Oldest reservations first: a limit only frees a slice per call.
    orderBy: { dueAt: "asc" },
    take: opts.limit ?? 25,
  });
  const result: ExpiryResult = { examined: expired.length, cancelled: 0, failed: 0 };

  const work = (async () => {
    for (const { id } of expired) {
      const res = await cancelOrder(id, {
        reason: "Niet betaald binnen de termijn",
        customerReason: "We hebben je betaling niet ontvangen binnen de betaaltermijn.",
        actor: "system",
      });
      if (res.ok && !res.alreadyCancelled) result.cancelled++;
      else if (!res.ok) {
        result.failed++;
        logger.error("[cart-expiry] could not cancel an expired bank-transfer order", { orderId: id, code: res.code });
      }
    }
    if (result.cancelled > 0) revalidateCatalog();
  })();

  if (opts.deadlineMs === undefined) await work;
  else {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([work, new Promise<void>((resolve) => (timer = setTimeout(resolve, opts.deadlineMs)))]);
    clearTimeout(timer);
    // `work` keeps running after a timeout; it must never become an unhandled rejection.
    work.catch((err) => logger.error("[cart-expiry] sweep failed after its deadline", err));
  }
  return result;
}

/**
 * Close Stripe orders that were created and never paid.
 *
 * Every card/iDEAL attempt first writes a PENDING order (no stock, no invoice), and a customer who
 * closes the tab leaves it behind. After ABANDONED_STRIPE_ORDER_HOURS (the Stripe session has
 * expired by then) it becomes CANCELLED. Nobody paid, so there is nothing to refund: no customer
 * mail, no owner notice, and no credit note (a PENDING order has no invoice; the WHERE says so).
 * The update is conditional on the expected status (decision D3), so a payment that lands at the
 * same moment wins. An order the Stripe webhook already attached a payment intent to is left alone.
 */
export async function expireAbandonedStripeOrders(opts: { now?: Date; limit?: number } = {}): Promise<{ cancelled: number }> {
  if (!canTransition("PENDING", "CANCELLED")) return { cancelled: 0 };
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - ABANDONED_STRIPE_ORDER_HOURS * 60 * 60 * 1000);
  const stale = await prisma.order.findMany({
    where: { status: "PENDING", paymentMethod: "STRIPE", createdAt: { lt: cutoff }, invoice: { is: null }, stripePaymentIntentId: null },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: opts.limit ?? 50,
  });
  if (stale.length === 0) return { cancelled: 0 };
  const res = await prisma.order.updateMany({
    where: { id: { in: stale.map((o) => o.id) }, status: "PENDING" },
    data: { status: "CANCELLED", cancelledAt: now, cancelReason: "Betaling niet afgerond" },
  });
  return { cancelled: res.count };
}
