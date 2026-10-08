/**
 * Money going back: refunds and disputes.
 *
 * A charge carries neither our order id nor the checkout session, only its
 * payment intent. Orders store that intent at fulfilment (Order.stripePaymentIntentId),
 * which is how an event is matched to the order it belongs to. An order paid
 * before that column was filled is found through the checkout session that owns
 * the payment intent.
 */
import type Stripe from "stripe";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { notifyOwner } from "@/lib/notify";
import { orderRef } from "@/lib/order-status";
import { revalidateCatalog } from "@/lib/cache-tags";
import { recordRefund } from "@/lib/invoicing";
import { idOf } from "./subscriptions";

type MatchedOrder = { id: string; status: string; totalEur: number };

/**
 * The order a payment intent belongs to, and whether that payment is the one
 * that PAID the order.
 *
 * `duplicate` is true for a payment found only through the checkout session's
 * metadata whose session / payment intent is not the one the order was paid
 * with. That is the second payment of a double charge (fulfil.ts flags it and
 * tells the owner to refund it). Booking its refund against the order would
 * cancel and credit an order whose real payment is untouched, so such a refund
 * must not reach recordRefund.
 */
async function orderForPaymentIntent(stripe: Stripe, paymentIntentId: string | null): Promise<{ order: MatchedOrder; duplicate: boolean } | null> {
  if (!paymentIntentId) return null;
  const direct = await prisma.order.findFirst({ where: { stripePaymentIntentId: paymentIntentId }, select: { id: true, status: true, totalEur: true } });
  if (direct) return { order: direct, duplicate: false };
  const sessions = await stripe.checkout.sessions.list({ payment_intent: paymentIntentId, limit: 1 });
  const session = sessions.data[0];
  const orderId = session?.metadata?.orderId;
  if (!session || !orderId) return null;
  const byMetadata = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true, status: true, totalEur: true, stripePaymentId: true, stripePaymentIntentId: true } });
  if (!byMetadata) return null;
  const { stripePaymentId, stripePaymentIntentId, ...order } = byMetadata;
  const paidWithOther = (stripePaymentIntentId != null && stripePaymentIntentId !== paymentIntentId) || (stripePaymentIntentId == null && stripePaymentId != null && stripePaymentId !== session.id);
  if (paidWithOther) return { order, duplicate: true };
  // Remember it, so the next event is a plain lookup.
  await prisma.order.updateMany({ where: { id: orderId, stripePaymentIntentId: null }, data: { stripePaymentIntentId: paymentIntentId } });
  return { order, duplicate: false };
}

const eurText = (cents: number) => `€ ${(cents / 100).toFixed(2)}`;

export async function handleChargeRefunded(stripe: Stripe, charge: Stripe.Charge): Promise<void> {
  const paymentIntentId = idOf(charge.payment_intent as string | { id: string } | null);
  const match = await orderForPaymentIntent(stripe, paymentIntentId);
  if (!match) {
    // A refund of a subscription payment or of a charge made outside the shop:
    // not in the webshop books. Said in the log so it is not mistaken for a loss.
    logger.info("Refund on a charge that belongs to no order — no credit note", { charge: charge.id, invoice: idOf((charge as unknown as { invoice?: string | { id: string } | null }).invoice) });
    return;
  }
  const { order } = match;
  if (match.duplicate) {
    logger.info("Refund of a duplicate payment — the order and its credit notes are left alone", { charge: charge.id, order: order.id });
    await notifyOwner({
      event: "stripe.duplicate_refunded",
      level: "info",
      title: `Dubbele betaling terugbetaald bij bestelling #${orderRef(order.id)}`,
      lines: ["Deze terugbetaling hoort bij de tweede betaling voor dezelfde bestelling. De bestelling zelf is niet gewijzigd: er is geen creditnota gemaakt en de voorraad is niet aangepast."],
      url: "/admin/bestellingen",
    });
    return;
  }

  // The charge object in the event may not list its refunds (and is a snapshot
  // anyway): ask Stripe for the refunds of this charge and book each one by its
  // own id, which makes a replay or a second charge.refunded for the same
  // charge book nothing twice.
  const refunds = await stripe.refunds.list({ charge: charge.id, limit: 100 });
  for (const refund of [...refunds.data].sort((a, b) => a.created - b.created)) {
    // A refund that failed or was cancelled returned no money.
    if (refund.status !== "succeeded" && refund.status !== "pending") continue;
    if ((refund.currency ?? "").toLowerCase() !== "eur") {
      await notifyOwner({
        event: "stripe.refund_currency",
        level: "error",
        title: `Terugbetaling in vreemde valuta bij bestelling #${orderRef(order.id)}`,
        lines: [`Refund ${refund.id}: ${eurText(refund.amount)} ${refund.currency.toUpperCase()}`, "Niet geboekt; boek de creditnota handmatig."],
        url: "/admin/bestellingen",
      });
      continue;
    }
    const result = await recordRefund(order.id, {
      amountEur: refund.amount / 100,
      stripeRefundId: refund.id,
      reason: "Terugbetaling via Stripe",
    });
    if (result.ok) {
      // A refund that completes an unshipped order cancels it and puts the units back.
      if (result.cancelled && !result.replayed) revalidateCatalog();
      continue;
    }
    if (result.code === "db_error" || result.code === "db_unavailable") {
      throw new Error(`record_refund_failed:${result.code}`);
    }
    if (result.code === "illegal_transition" && order.status === "CANCELLED") {
      // Refunding an order that was cancelled without an invoice: there is no
      // sale on the books to credit.
      logger.info("Refund for a cancelled order without an invoice — nothing to credit", { order: order.id, refund: refund.id });
      continue;
    }
    logger.error("Refund could not be booked", { order: order.id, refund: refund.id, code: result.code });
    await notifyOwner({
      event: "stripe.refund_unbooked",
      level: "error",
      title: `Terugbetaling niet verwerkt bij bestelling #${orderRef(order.id)}`,
      lines: [`Refund ${refund.id}: ${eurText(refund.amount)}`, `Reden: ${result.error}`, "Maak de creditnota handmatig aan in /admin/bestellingen."],
      url: "/admin/bestellingen",
    });
  }
}

export async function handleDisputeCreated(stripe: Stripe, dispute: Stripe.Dispute): Promise<void> {
  const match = await orderForPaymentIntent(stripe, idOf(dispute.payment_intent as string | { id: string } | null));
  const order = match?.order ?? null;
  const due = dispute.evidence_details?.due_by ? new Date(dispute.evidence_details.due_by * 1000) : null;
  const dueText = due ? new Intl.DateTimeFormat("nl-NL", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" }).format(due) : "onbekend (zie Stripe)";
  const lines = [
    `Bedrag ${eurText(dispute.amount)} ${dispute.currency.toUpperCase()}, reden: ${dispute.reason}`,
    `Uiterste reactiedatum: ${dueText}`,
    order ? `Bestelling #${orderRef(order.id)} (status ${order.status})${match?.duplicate ? ", maar dit is NIET de betaling waarmee de bestelling is voldaan (dubbele betaling)" : ""}` : "Geen webshopbestelling gevonden (abonnement of losse betaling)",
    `Geschil ${dispute.id}: reageer in Stripe, onder Betalingen, Geschillen.`,
  ];
  logger.error("Stripe dispute opened", { dispute: dispute.id, amountCents: dispute.amount, dueBy: due?.toISOString() ?? null, order: order?.id ?? null });
  const sent = await notifyOwner({
    event: "stripe.dispute",
    level: "error",
    title: "Betwisting (dispute) ontvangen",
    lines,
    url: order ? "/admin/bestellingen" : undefined,
  });
  // A dispute nobody hears about is lost by default. When a channel exists but
  // every attempt failed, fail the event so Stripe delivers it again.
  if (sent.configured && sent.delivered.length === 0) throw new Error("dispute_notification_failed");
}
