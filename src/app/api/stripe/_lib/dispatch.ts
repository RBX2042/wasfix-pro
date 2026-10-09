/**
 * One handler per event type in src/lib/stripe-events.ts.
 *
 * The switch is exhaustive over HANDLED_STRIPE_EVENTS: adding a type to that
 * list without a case here is a compile error (the `never` at the end), and
 * the reverse cannot happen because `type` is narrowed by it first.
 */
import type Stripe from "stripe";
import { logger } from "@/lib/logger";
import { recordConversion } from "@/lib/referrals";
import type { HandledStripeEvent } from "@/lib/stripe-events";
import { cancelOrderForSession, fulfilOrder } from "./fulfil";
import { handleChargeRefunded, handleDisputeCreated } from "./refunds";
import { handleSubscriptionInvoice, idOf, syncSubscription } from "./subscriptions";

export async function processStripeEvent(stripe: Stripe, event: Stripe.Event & { type: HandledStripeEvent }): Promise<void> {
  const type: HandledStripeEvent = event.type;
  switch (type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object as Stripe.Checkout.Session;
      const refVisitorId = session.metadata?.refVisitorId;

      if (session.mode === "subscription") {
        const subId = idOf(session.subscription as string | { id: string } | null);
        if (!subId) {
          logger.warn("Subscription checkout completed without a subscription id", { session: session.id });
          return;
        }
        // The plan comes from the subscription as Stripe has it now, never from
        // this session's metadata.
        await syncSubscription(stripe, subId, { userId: session.metadata?.userId, customerId: idOf(session.customer as string | { id: string } | null) });
        // No referral credit here: a subscription (or trial) starting is not proof of a paid
        // order, and a reward is only booked against a PAID order (see recordConversion).
        return;
      }

      const orderId = session.metadata?.orderId;
      if (!orderId) {
        logger.info("Checkout session without an order id — nothing to fulfil", { session: session.id });
        return;
      }
      // "completed" only means the customer finished the form. With a delayed
      // method (SEPA incasso) the money is not there yet and payment_status
      // stays "unpaid" until async_payment_succeeded arrives. Booking the order
      // PAID, taking the stock and burning an invoice number on that would be
      // revenue for money that never came in.
      if (session.payment_status !== "paid") {
        logger.warn("Checkout session completed but not paid — waiting for the async payment", { orderId, paymentStatus: session.payment_status });
        return;
      }
      const outcome = await fulfilOrder(orderId, session);
      // Referral credit: the visitor id was stashed at checkout time. recordConversion needs the
      // order as proof and re-checks that it is PAID, so it cannot book a reward for a refused one.
      if (refVisitorId && outcome !== "rejected") await recordConversion(refVisitorId, undefined, { orderId });
      return;
    }

    case "checkout.session.expired": {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderId = session.metadata?.orderId;
      if (!orderId) return; // an expired subscription checkout owns no order
      await cancelOrderForSession(stripe, orderId, session, { kind: "expired", reason: "Betaalsessie verlopen", customerReason: null, notifyCustomer: false });
      return;
    }

    case "checkout.session.async_payment_failed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderId = session.metadata?.orderId;
      if (!orderId) return;
      await cancelOrderForSession(stripe, orderId, session, {
        kind: "async_failed",
        reason: "Betaling mislukt (Stripe)",
        customerReason: "Je betaling is niet gelukt, daarom is de bestelling geannuleerd.",
        notifyCustomer: true,
      });
      return;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      await syncSubscription(stripe, sub.id, { userId: sub.metadata?.userId, customerId: idOf(sub.customer as string | { id: string } | null) });
      return;
    }

    case "invoice.paid":
    case "invoice.payment_failed":
      await handleSubscriptionInvoice(stripe, event.data.object as Stripe.Invoice, type);
      return;

    case "charge.refunded":
      await handleChargeRefunded(stripe, event.data.object as Stripe.Charge);
      return;

    case "charge.dispute.created":
      await handleDisputeCreated(stripe, event.data.object as Stripe.Dispute);
      return;

    default: {
      const unhandled: never = type;
      throw new Error(`no handler for ${String(unhandled)}`);
    }
  }
}
