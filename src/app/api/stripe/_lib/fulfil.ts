/**
 * Orders paid (or given up) at Stripe.
 *
 * Permanent problems (an order that does not exist, an amount that does not
 * match, a payment for an order that was cancelled) are NOT retried: Stripe
 * would hammer the same dead end for three days and the owner would learn
 * nothing. They are acknowledged and reported with notifyOwner, which is the
 * only thing that gets a human to refund or fix them. Transient problems
 * (database down, Stripe unreachable) are thrown, so the route answers 500 and
 * Stripe retries.
 */
import type Stripe from "stripe";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { notifyOwner } from "@/lib/notify";
import { revalidateCatalog } from "@/lib/cache-tags";
import { holdsStock, orderRef } from "@/lib/order-status";
import { CompanyNotReadyError, cancelOrder, issueInvoiceForOrder, notifyOrderPaid } from "@/lib/invoicing";
import { claimStripeEvent, completeStripeEvent, releaseStripeEvent } from "./lease";

/** An order paid longer ago than this is never mailed again by a late event: its confirmation went out long ago. */
const CONFIRMATION_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

const cents = (eur: number) => Math.round(eur * 100);
const eurText = (c: number) => `€ ${(c / 100).toFixed(2)}`;

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

/** Tell the owner about a payment that needs a human. Never carries customer data. */
async function needsAttention(orderId: string, title: string, lines: string[]): Promise<void> {
  await notifyOwner({
    event: "stripe.attention",
    level: "error",
    title,
    lines: [`Bestelling #${orderRef(orderId)}`, ...lines],
    url: "/admin/bestellingen",
  });
}

export type FulfilOutcome =
  /** This call moved the order PENDING -> PAID. */
  | "fulfilled"
  /** The order was already paid (replay, or another event got there first). */
  | "already_paid"
  /** Not booked: reported to the owner, acknowledged. */
  | "rejected";

/**
 * Book a paid Checkout session: order PAID, stock out, invoice, confirmation.
 * Safe to run any number of times for the same session.
 */
export async function fulfilOrder(orderId: string, session: Stripe.Checkout.Session): Promise<FulfilOutcome> {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) {
    await needsAttention(orderId, "Betaling voor een onbekende bestelling", [
      `Stripe-sessie ${session.id} is betaald (${session.amount_total != null ? eurText(session.amount_total) : "bedrag onbekend"}), maar die bestelling bestaat niet.`,
      "Controleer in Stripe en betaal terug als het geen echte bestelling is.",
    ]);
    return "rejected";
  }

  // The paid amount must be the order's total to the cent, in euro. Anything
  // else is a payment this order did not ask for; marking it PAID would ship
  // goods against the wrong money and put the wrong figure on the invoice.
  const expected = cents(order.totalEur);
  if (session.amount_total !== expected || (session.currency ?? "").toLowerCase() !== "eur") {
    await needsAttention(orderId, "Betaald bedrag komt niet overeen met de bestelling", [
      `Verwacht ${eurText(expected)} EUR, Stripe ontving ${session.amount_total != null ? eurText(session.amount_total) : "?"} ${(session.currency ?? "?").toUpperCase()} (sessie ${session.id}).`,
      "De bestelling is NIET op betaald gezet en er is geen factuur gemaakt.",
    ]);
    return "rejected";
  }

  const paymentIntentId = idOf(session.payment_intent);
  const paidStatuses = ["PAID", "SHIPPED", "DELIVERED"];
  if (paidStatuses.includes(order.status)) {
    // A second, different payment for an order that is already paid is a double
    // charge, not a replay of the first one.
    const otherSession = order.stripePaymentId != null && order.stripePaymentId !== session.id;
    const otherIntent = order.stripePaymentIntentId != null && paymentIntentId != null && order.stripePaymentIntentId !== paymentIntentId;
    if (otherSession || otherIntent) {
      await needsAttention(orderId, "Dubbele betaling voor een al betaalde bestelling", [
        `Sessie ${session.id} is betaald terwijl de bestelling al via een andere betaling is voldaan.`,
        "Betaal de tweede betaling terug in Stripe.",
      ]);
      return "rejected";
    }
  } else if (order.status !== "PENDING") {
    // CANCELLED (or OPENSTAAND): money arrived for an order that must not be
    // fulfilled. No invoice, no status change.
    await needsAttention(orderId, order.status === "CANCELLED" ? "Betaling ontvangen voor een geannuleerde bestelling" : "Stripe-betaling voor een bestelling op rekening", [
      `Status ${order.status}; sessie ${session.id} is betaald (${eurText(expected)}).`,
      "Betaal terug in Stripe of zet de bestelling handmatig weer open.",
    ]);
    return "rejected";
  }

  let won = false;
  if (order.status === "PENDING") {
    const result = await prisma.$transaction(
      async (tx) => {
        // The status transition IS the lock. findUnique + `status !== "PENDING"` +
        // update is not: under READ COMMITTED two simultaneous deliveries of one
        // event both read PENDING and both decremented the stock.
        const claimed = await tx.order.updateMany({
          where: { id: orderId, status: "PENDING" },
          // paidAt is the only record of *when* the money came in. The payment
          // intent is what charge.refunded / charge.dispute.created identify an
          // order by: they carry no checkout session and no metadata of ours.
          data: {
            status: "PAID",
            stripePaymentId: session.id,
            ...(paymentIntentId ? { stripePaymentIntentId: paymentIntentId } : {}),
            paidAt: new Date(),
          },
        });
        if (claimed.count === 0) return { won: false, oversold: [] as Array<{ sku: string; quantity: number; stockAfter: number }> };
        // If checkout ever reserves stock for a Stripe order up front, the
        // reservation is already off the shelf and must not be taken twice.
        // holdsStock is the single place that says which states hold stock.
        const items = holdsStock("PENDING") ? [] : await tx.orderItem.findMany({ where: { orderId }, select: { partId: true, quantity: true } });
        const oversold: Array<{ sku: string; quantity: number; stockAfter: number }> = [];
        for (const item of items) {
          // A Stripe order reserves nothing when it is created, so two PENDING
          // orders for the last unit can both get paid. The money is already
          // taken, so the decrement stands; what must not happen is that it
          // happens unseen: the owner is told below.
          const taken = await tx.part.updateMany({
            where: { id: item.partId, stock: { gte: item.quantity } },
            data: { stock: { decrement: item.quantity } },
          });
          if (taken.count === 0) {
            const part = await tx.part.update({ where: { id: item.partId }, data: { stock: { decrement: item.quantity } }, select: { sku: true, stock: true } });
            oversold.push({ sku: part.sku, quantity: item.quantity, stockAfter: part.stock });
          }
        }
        return { won: true, oversold };
      },
      { maxWait: 10_000, timeout: 20_000 },
    );
    won = result.won;
    if (won) {
      revalidateCatalog();
      if (result.oversold.length > 0) {
        logger.error("Paid order oversold — stock went negative", { orderId, parts: result.oversold.map((o) => o.sku) });
        await needsAttention(orderId, "Verkocht zonder voorraad", [
          ...result.oversold.map((o) => `${o.sku}: ${o.quantity} stuk(s) besteld, voorraad nu ${o.stockAfter}.`),
          "De klant heeft al betaald. Lever na, of annuleer de bestelling in /admin/bestellingen (de terugbetaling volgt dan via Stripe).",
        ]);
      }
    } else {
      // Lost the race to another delivery between the read and the claim.
      const now = await prisma.order.findUnique({ where: { id: orderId }, select: { status: true } });
      if (!now || !paidStatuses.includes(now.status)) {
        await needsAttention(orderId, "Betaling ontvangen, maar de bestelling is intussen gewijzigd", [`Status nu ${now?.status ?? "onbekend"}; sessie ${session.id} is betaald.`]);
        return "rejected";
      }
    }
  }

  // Idempotent: a replay returns the existing invoice instead of burning a
  // second number. A transient failure propagates so Stripe retries; a company
  // identity that may not invoice yet is configuration, not a transient error,
  // and retrying cannot fix it, so the order stays PAID, the customer is still
  // told, and the owner is told what to set. The invoice page
  // (/bestelling/<id>/factuur) issues a missing invoice for a PAID order when
  // it is opened, so nothing is lost once the company details are set.
  try {
    const issued = await issueInvoiceForOrder(orderId);
    if (!issued) throw new Error(`invoice_not_issued:${orderId}`);
  } catch (err) {
    if (!(err instanceof CompanyNotReadyError)) throw err;
    await needsAttention(orderId, "Betaald, maar geen factuur: bedrijfsgegevens onvolledig", [
      `Ontbreekt: ${err.missing.join(", ")}.`,
      "Stel de COMPANY_* variabelen in; de factuur wordt daarna aangemaakt zodra de factuurpagina van de bestelling wordt geopend.",
    ]);
  }

  // The confirmation (customer mail with the invoice link, plus the owner ping)
  // goes out ONCE per order, whichever call gets to it first. Who "won" the
  // PENDING -> PAID claim is not enough to decide that: the winner can die
  // before it gets here (then a retry must send it), and a different event for
  // the same payment (completed + async_payment_succeeded, or a reconcile run
  // next to a late webhook) can arrive while the winner is still busy and would
  // send a second one. A unique marker row decides it (see ./lease.ts):
  //   claimed    this call sends it.
  //   duplicate  already sent: nothing to do.
  //   busy       another call is sending it right now. This call fails (Stripe
  //              retries the event later and then finds "duplicate") instead of
  //              returning success, because if that other call is a function
  //              that dies mid-send nobody would be left to send it.
  // A claim whose holder died is taken over by the next call once its lease has
  // run out. Orders paid more than 3 days ago are not mailed from here.
  const paidRecently = !order.paidAt || Date.now() - order.paidAt.getTime() < CONFIRMATION_WINDOW_MS;
  if (paidRecently) {
    const markerId = `mail:order-paid:${orderId}`;
    const mailClaim = await claimStripeEvent(markerId, "order-paid-mail");
    if (mailClaim.state === "busy") throw new Error(`order_confirmation_in_progress:${orderId}`);
    if (mailClaim.state === "claimed") {
      try {
        await notifyOrderPaid(orderId, "stripe");
        await completeStripeEvent(markerId);
      } catch (err) {
        // notifyOrderPaid does not throw; this is the database. Hand the claim back so a retry sends it.
        await releaseStripeEvent(markerId, mailClaim.claimedAt, err).catch(() => undefined);
        throw err;
      }
    }
  }
  return won ? "fulfilled" : "already_paid";
}

/**
 * Cancel the order behind a Checkout session that expired or whose delayed
 * payment failed. Stripe is asked again first: an event is a notice, not a
 * fact, and cancelling an order that was paid in the meantime would refund-owe
 * the customer for goods they are about to receive.
 */
export async function cancelOrderForSession(
  stripe: Stripe,
  orderId: string,
  session: Stripe.Checkout.Session,
  why: { kind: "expired" | "async_failed"; reason: string; customerReason: string | null; notifyCustomer: boolean },
): Promise<"cancelled" | "ignored"> {
  let fresh: Stripe.Checkout.Session;
  try {
    fresh = await stripe.checkout.sessions.retrieve(session.id);
  } catch (err) {
    if ((err as { code?: string })?.code === "resource_missing") {
      logger.warn("Checkout session named by an event does not exist at Stripe — order left alone", { orderId, session: session.id });
      return "ignored";
    }
    throw err;
  }
  const stillUnpaid = fresh.payment_status !== "paid" && (why.kind === "expired" ? fresh.status === "expired" : true);
  if (!stillUnpaid) {
    logger.warn("Session event says unpaid, Stripe says otherwise — order left alone", { orderId, session: session.id, status: fresh.status, paymentStatus: fresh.payment_status });
    return "ignored";
  }

  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { status: true, stripePaymentId: true } });
  if (!order) {
    logger.warn("Session event names an order that does not exist", { orderId, session: session.id });
    return "ignored";
  }
  if (order.status !== "PENDING") {
    logger.info("Session event for an order that is no longer PENDING — nothing to cancel", { orderId, status: order.status });
    return "ignored";
  }
  if (order.stripePaymentId && order.stripePaymentId !== session.id) {
    logger.info("Session event for an older session of this order — nothing to cancel", { orderId, session: session.id });
    return "ignored";
  }

  const result = await cancelOrder(orderId, { reason: why.reason, actor: "stripe", notifyCustomer: why.notifyCustomer, customerReason: why.customerReason });
  if (!result.ok) {
    if (result.code === "not_found" || result.code === "not_cancellable" || result.code === "illegal_transition") return "ignored";
    // conflict, db_error, db_unavailable: let Stripe retry.
    throw new Error(`cancel_failed:${result.code}`);
  }
  if (result.restocked) revalidateCatalog();
  return result.alreadyCancelled ? "ignored" : "cancelled";
}
