/**
 * Give back the stock held by reservations that will never be paid, and close
 * the Stripe orders nobody finished.
 *
 * BANK TRANSFER. An OPENSTAAND order holds its units from the moment the invoice
 * goes out. Once the due date plus the grace period of the terms (voorwaarden
 * art. 7) has passed, the order is cancelled through cancelOrder(): in ONE
 * transaction that flips the status, puts the units back and issues the credit
 * note for the invoice (decision D4: an invoice is never edited or deleted).
 * The sweep decides from a LIST it read earlier, so it cancels with
 * `onlyFrom: ["OPENSTAAND"]`: an order the owner marked paid in the meantime is
 * reported as a conflict and left alone. (Without the guard the sweep cancelled
 * an order that had been marked paid a moment before, credited it, and owed the
 * customer a refund for goods that were about to ship.)
 *
 * STRIPE. Every card/iDEAL attempt first writes a PENDING order, and a customer
 * who closes the tab leaves it behind. After ABANDONED_STRIPE_ORDER_HOURS such an
 * order is NOT cancelled on the clock alone: a customer may have paid while the
 * webhook never arrived (wrong secret, endpoint missing), and cancelling that
 * order loses the sale and the money. An order that has a Checkout session is
 * resolved through Stripe (settleStripeOrder): paid -> the same fulfilment the
 * webhook runs; expired -> cancelled; still open -> the session is expired at
 * Stripe first and only then cancelled; unknown to Stripe or any error -> left as
 * it is and the owner is told (once per order). Without a Stripe client the
 * Stripe orders are left alone and the owner is told once. "Told" means a channel took the
 * message: when every configured channel fails, nothing is remembered and the next sweep
 * tries again. A paid session that cannot be booked (wrong amount, ...) is reported by
 * fulfilOrder and remembered in the same "reconcile-rejected" marker the reconcile run
 * uses, so the sweep (which runs after every checkout) neither asks Stripe about it again nor
 * repeats the alert. Only an order that
 * never reached Stripe (no session, no payment intent) is cancelled directly:
 * nobody can have paid it.
 *
 * WHERE IT RUNS. cancelOrder() awaits a customer mail and an owner notice per
 * order, so a sweep costs roughly one webhook round trip per order. It therefore
 * never runs inline in a customer's request except in one narrow case: the
 * customer's cart is short of stock and an expired reservation is what holds the
 * missing units (then at most 3 are released, with a deadline, because the
 * alternative is refusing a paying customer). Otherwise /api/checkout starts it
 * after the response (MAX_SWEEP_PER_CHECKOUT per request), and /api/cron/orders
 * runs it daily.
 *
 * Each order is handled on its own: one poisoned row must not stop the others.
 */
import { prisma } from "./prisma";
import { logger } from "./logger";
import { cancelOrder } from "./invoicing";
import { canTransition, orderRef } from "./order-status";
import { revalidateCatalog } from "./cache-tags";
import { notifyOwner } from "./notify";
import { getStripe } from "./stripe";
import { ABANDONED_STRIPE_ORDER_HOURS, BANK_TRANSFER_GRACE_DAYS } from "./cart-limits";
import { findStripeMarkers, putStripeMarker } from "@/app/api/stripe/_lib/lease";
import { ownerWasTold } from "@/app/api/stripe/_lib/fulfil";
import { rejectedMarker, settleStripeOrder } from "@/app/api/stripe/_lib/reconcile";

export type ExpiryResult = {
  examined: number;
  cancelled: number;
  failed: number;
  /** Orders that changed status between the list and the cancellation (typically paid by the owner): left as they are. */
  conflicts: number;
};

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
  const result: ExpiryResult = { examined: expired.length, cancelled: 0, failed: 0, conflicts: 0 };

  const work = (async () => {
    for (const { id } of expired) {
      const res = await cancelOrder(id, {
        reason: "Niet betaald binnen de termijn",
        customerReason: "We hebben je betaling niet ontvangen binnen de betaaltermijn.",
        actor: "system",
        onlyFrom: ["OPENSTAAND"],
      });
      if (res.ok && !res.alreadyCancelled) result.cancelled++;
      else if (!res.ok && res.code === "conflict") {
        // Paid (or otherwise changed) since the list was read. Not an error: the guard did its job.
        result.conflicts++;
        logger.warn("[cart-expiry] an expired bank-transfer order changed while the sweep ran — left alone", { orderId: id });
      } else if (!res.ok) {
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

export type AbandonedStripeResult = {
  /** Cancelled: never reached Stripe, or Stripe said the session expired unpaid. */
  cancelled: number;
  /** Paid at Stripe while the webhook never arrived: fulfilled now. */
  fulfilled: number;
  /** Left untouched (Stripe unknown, unreachable, not configured, odd session): the owner was told. */
  left: number;
};

const unresolvedMarker = (orderId: string) => `abandoned-stripe-unresolved:${orderId}`;

/**
 * Tell the owner, once per order, about Stripe orders this sweep could not close.
 * No customer data: order numbers and a reason. The "told" marker is written only when a
 * channel took the message (or none is configured, in which case the log is all there is):
 * a marker written after a failed delivery would silence the order for good.
 */
async function tellOwnerAboutUnresolved(orders: Array<{ id: string }>, why: string): Promise<void> {
  if (orders.length === 0) return;
  const known = await findStripeMarkers(orders.map((o) => unresolvedMarker(o.id)));
  // Only orders that are STILL pending: a second sweep (or a late webhook) may have settled one while this
  // sweep was waiting on Stripe, and "no result" about an order that was just cancelled is a false alarm.
  const stillPending = new Set((await prisma.order.findMany({ where: { id: { in: orders.map((o) => o.id) }, status: "PENDING" }, select: { id: true } })).map((o) => o.id));
  const fresh = orders.filter((o) => stillPending.has(o.id) && !known.has(unresolvedMarker(o.id)));
  if (fresh.length === 0) return;
  const sent = await notifyOwner({
    event: "orders.stripe_unresolved",
    level: "warn",
    title: `${fresh.length} Stripe-bestelling${fresh.length === 1 ? "" : "en"} zonder uitslag, niet geannuleerd`,
    lines: [
      `Bestelling${fresh.length === 1 ? "" : "en"}: ${fresh.slice(0, 8).map((o) => `#${orderRef(o.id)}`).join(", ")}${fresh.length > 8 ? ` en ${fresh.length - 8} meer` : ""}.`,
      why,
      "Ze zijn bewust niet geannuleerd: de klant kan betaald hebben. Controleer ze in het Stripe-dashboard.",
    ],
    url: "/admin/bestellingen?view=stripe",
  });
  if (!ownerWasTold(sent)) {
    logger.warn("[cart-expiry] no owner channel took the notice about unresolved Stripe orders — will try again on the next sweep", { orders: fresh.length });
    return;
  }
  for (const o of fresh) await putStripeMarker(unresolvedMarker(o.id), "abandoned-stripe-unresolved").catch(() => undefined);
}

/**
 * Close Stripe orders that were created and never paid, without cancelling one
 * that Stripe says was paid (see STRIPE in the header). Safe to call from every
 * checkout request and from the daily cron; the status claim decides races with a
 * late webhook.
 */
export async function expireAbandonedStripeOrders(opts: { now?: Date; limit?: number; deadlineMs?: number } = {}): Promise<AbandonedStripeResult> {
  const result: AbandonedStripeResult = { cancelled: 0, fulfilled: 0, left: 0 };
  if (!canTransition("PENDING", "CANCELLED")) return result;
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - ABANDONED_STRIPE_ORDER_HOURS * 60 * 60 * 1000);
  const limit = opts.limit ?? 50;

  // 1. Never reached Stripe: no session and no payment intent, so nobody can have paid. Conditional on the status.
  const neverSent = await prisma.order.findMany({
    where: { status: "PENDING", paymentMethod: "STRIPE", createdAt: { lt: cutoff }, invoice: { is: null }, stripePaymentId: null, stripePaymentIntentId: null },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  if (neverSent.length > 0) {
    const res = await prisma.order.updateMany({
      where: { id: { in: neverSent.map((o) => o.id) }, status: "PENDING", stripePaymentId: null, stripePaymentIntentId: null },
      data: { status: "CANCELLED", cancelledAt: now, cancelReason: "Betaling niet afgerond" },
    });
    result.cancelled += res.count;
  }

  // 2. A session exists (or a payment intent was recorded): Stripe decides.
  // An order this sweep already reported (unresolved) or that fulfilOrder already refused and reported
  // (rejected: a paid session that cannot be booked) is not asked about again: this function runs after
  // EVERY checkout request, and each look would cost a Stripe call and, for a refused payment, a repeated
  // alert. The reconcile cron is the retry path for the unresolved ones. The markers live in another table,
  // so the candidates are read page by page until `limit` of them are left: a pile of reported orders at the
  // front of the queue must not hide a newer paid one behind it.
  const withSession: Array<{ id: string; stripePaymentId: string | null }> = [];
  let after: { createdAt: Date; id: string } | null = null;
  for (let page = 0; page < 10 && withSession.length < limit; page++) {
    const rows: Array<{ id: string; stripePaymentId: string | null; createdAt: Date }> = await prisma.order.findMany({
      where: {
        status: "PENDING",
        paymentMethod: "STRIPE",
        createdAt: { lt: cutoff },
        invoice: { is: null },
        OR: [{ stripePaymentId: { not: null } }, { stripePaymentIntentId: { not: null } }],
        ...(after ? { AND: [{ OR: [{ createdAt: { gt: after.createdAt } }, { createdAt: after.createdAt, id: { gt: after.id } }] }] } : {}),
      },
      select: { id: true, stripePaymentId: true, createdAt: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 200,
    });
    if (rows.length === 0) break;
    after = { createdAt: rows[rows.length - 1].createdAt, id: rows[rows.length - 1].id };
    const known = await findStripeMarkers(rows.flatMap((o) => [unresolvedMarker(o.id), ...(o.stripePaymentId ? [rejectedMarker(o.id, o.stripePaymentId)] : [])]));
    for (const o of rows) {
      if (known.has(unresolvedMarker(o.id)) || (o.stripePaymentId && known.has(rejectedMarker(o.id, o.stripePaymentId)))) continue;
      if (withSession.length < limit) withSession.push(o);
    }
    if (rows.length < 200) break;
  }
  if (withSession.length === 0) return result;

  const stripe = getStripe();
  if (!stripe) {
    result.left = withSession.length;
    await tellOwnerAboutUnresolved(withSession, "Stripe is niet geconfigureerd op deze server, dus de uitslag van deze betaalsessies kan niet worden opgevraagd.");
    return result;
  }

  const deadline = Date.now() + (opts.deadlineMs ?? 15_000);
  const unresolved: Array<{ id: string }> = [];
  for (const order of withSession) {
    if (Date.now() > deadline) break;
    if (!order.stripePaymentId) {
      // A payment intent but no session id: nothing to ask about.
      unresolved.push(order);
      continue;
    }
    try {
      let outcome = await settleStripeOrder(stripe, { id: order.id, stripePaymentId: order.stripePaymentId });
      if (outcome === "open") {
        // A session that is still open after the abandonment period: expire it at Stripe
        // FIRST, so the customer can no longer pay it, and only then cancel. If Stripe
        // refuses (it was paid a moment ago) the next look finds it paid.
        await stripe.checkout.sessions.expire(order.stripePaymentId);
        outcome = await settleStripeOrder(stripe, { id: order.id, stripePaymentId: order.stripePaymentId });
      }
      if (outcome === "cancelled") result.cancelled++;
      else if (outcome === "fulfilled") result.fulfilled++;
      else if (outcome === "already_paid" || outcome === "ignored") continue; // someone else settled it between the list and now
      else {
        // rejected (fulfilOrder told the owner and settleStripeOrder remembered it), mismatch, unknown, open: not ours to close.
        result.left++;
        if (outcome !== "rejected") unresolved.push(order);
      }
    } catch (err) {
      result.left++;
      unresolved.push(order);
      logger.error("[cart-expiry] could not resolve an abandoned Stripe order through Stripe — left alone", { orderId: order.id, err });
    }
  }
  await tellOwnerAboutUnresolved(unresolved, "Stripe gaf geen duidelijke uitslag (onbekende of niet te bereiken sessie).");
  if (result.cancelled > 0 || result.fulfilled > 0) revalidateCatalog();
  return result;
}
