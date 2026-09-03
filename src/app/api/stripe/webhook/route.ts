import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { env } from "@/lib/env";
import type Stripe from "stripe";
import { recordConversion } from "@/lib/referrals";
import { BILLABLE_PLANS, stripePriceIdFor, type PlanId } from "@/lib/plans";

export const runtime = "nodejs";

/**
 * A plan name out of Stripe metadata is only worth as much as the request that
 * put it there. Anything we do not actually sell is refused instead of being
 * written into User.plan, where it would decide discounts and API limits.
 */
function billablePlan(value: string | null | undefined): PlanId | null {
  return BILLABLE_PLANS.includes(value as PlanId) ? (value as PlanId) : null;
}

/**
 * The plan a Stripe price id belongs to.
 *
 * Stripe does NOT rewrite subscription metadata when a customer switches price
 * in the billing portal, so metadata keeps naming the plan they left: a Bedrijf
 * customer downgrading to Particulier paid € 4,99 and kept 15% parts discount,
 * 10.000 API calls and the Pro dashboard. The price the subscription is on is
 * the only fact. A price id we cannot map means STRIPE_PRICE_* in this
 * deployment is behind the Stripe dashboard — falling back to metadata there
 * would re-open exactly that downgrade, so this returns null and the caller
 * leaves the plan alone.
 */
function planForPriceId(priceId: string | null | undefined): PlanId | null {
  if (!priceId) return null;
  return BILLABLE_PLANS.find((plan) => stripePriceIdFor(plan) === priceId) ?? null;
}

/**
 * Book a paid checkout session: order to PAID, stock out, invoice issued.
 * Safe to run twice — the second run finds nothing left to claim.
 */
async function fulfilOrder(orderId: string, session: Stripe.Checkout.Session): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // The status transition IS the lock. findUnique + `status !== "PENDING"` +
    // update is not: under READ COMMITTED two simultaneous deliveries of one
    // event both read PENDING and both decremented the stock.
    const claimed = await tx.order.updateMany({
      where: { id: orderId, status: "PENDING" },
      // paidAt is the only record of *when* the money came in: createdAt is
      // when the order was placed and updatedAt is overwritten by the next
      // status change, so without this every Stripe order is blank in a
      // payment-date or btw-periode reconciliation.
      data: { status: "PAID", stripePaymentId: session.id, paidAt: new Date() },
    });
    if (claimed.count === 0) return;
    const items = await tx.orderItem.findMany({
      where: { orderId },
      select: { partId: true, quantity: true },
    });
    for (const item of items) {
      // A Stripe order reserves nothing when it is created, so two PENDING
      // orders for the last unit can both get paid. Refusing money that has
      // already been taken is not an option — the decrement stands — but a sale
      // we cannot cover has to be visible to fulfilment instead of quietly
      // driving stock negative.
      const claimedStock = await tx.part.updateMany({
        where: { id: item.partId, stock: { gte: item.quantity } },
        data: { stock: { decrement: item.quantity } },
      });
      if (claimedStock.count === 0) {
        await tx.part.update({
          where: { id: item.partId },
          data: { stock: { decrement: item.quantity } },
        });
        logger.error("Paid order oversold — stock went negative", {
          orderId,
          partId: item.partId,
          quantity: item.quantity,
        });
      }
    }
  });
  // Idempotent: a replayed webhook returns the existing invoice
  // rather than burning a second sequential number. A failure here
  // must propagate so Stripe retries — silently continuing left a paid
  // order with no invoice and nothing to notice it.
  const { issueInvoiceForOrder } = await import("@/lib/invoicing");
  const issued = await issueInvoiceForOrder(orderId);
  if (!issued) throw new Error(`invoice_not_issued:${orderId}`);
}

export async function POST(req: NextRequest) {
  const stripe = getStripe();
  if (!stripe) {
    // Demo mode — accept silently so Stripe test webhooks don't error
    return NextResponse.json({ received: true, demo: true });
  }

  const sig = req.headers.get("stripe-signature");
  const secret = env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !secret) {
    logger.warn("Missing stripe-signature or webhook secret");
    return new NextResponse("Missing signature", { status: 400 });
  }

  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, secret);
  } catch (err) {
    logger.error("Webhook signature verification failed", err);
    return new NextResponse("Invalid signature", { status: 400 });
  }

  // Idempotency. Claiming the event id BEFORE any side effect is what makes
  // this work: the unique index rejects the second of two simultaneous
  // deliveries here, where nothing has happened yet. Reading first and
  // inserting at the end failed open twice over — both deliveries passed the
  // read, and a failing read was caught and continued.
  try {
    await prisma.stripeEvent.create({
      data: { stripeEventId: event.id, type: event.type },
    });
  } catch (err) {
    if ((err as { code?: string })?.code === "P2002") {
      return NextResponse.json({ received: true, alreadyProcessed: true });
    }
    logger.error("Could not claim Stripe event — refusing to process without replay protection", err);
    return new NextResponse("Handler error", { status: 500 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.userId;
        const orderId = session.metadata?.orderId;

        // "completed" only means the customer finished the form. With a
        // delayed method (SEPA incasso, Klarna) the money is not there yet and
        // payment_status stays "unpaid" until async_payment_succeeded arrives.
        // Booking the order PAID, shipping the stock and burning an invoice
        // number on that would be revenue for money that never came in.
        const paid = session.payment_status === "paid";
        if (orderId && paid) {
          await fulfilOrder(orderId, session);
        } else if (orderId) {
          logger.warn("Checkout session completed but not paid — waiting for the async payment", {
            orderId,
            paymentStatus: session.payment_status,
          });
        }

        // Referral credit: the visitor id was stashed at checkout time. Not
        // for an order still waiting on its money — that one is credited when
        // async_payment_succeeded lands.
        const refVisitorId = session.metadata?.refVisitorId;
        if (refVisitorId && (paid || !orderId)) await recordConversion(refVisitorId);

        // A subscription session is not necessarily "paid" — a plan with a
        // trial reports no_payment_required — so the plan is applied on its
        // own terms, not behind the order guard above.
        const plan = billablePlan(session.metadata?.plan);
        if (userId && session.metadata?.plan && !plan) {
          logger.error("Refusing an unknown plan from Stripe session metadata", {
            userId,
            plan: session.metadata.plan,
          });
        }
        if (userId && plan) {
          const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
          const target = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, stripeCustomerId: true },
          });
          if (!target) {
            logger.error("Stripe session names a user that does not exist — plan not applied", { userId });
          } else if (target.stripeCustomerId && customerId && target.stripeCustomerId !== customerId) {
            // metadata is set by whoever created the session; an id pointing at
            // someone else's account must never hand that account a plan.
            logger.error("Stripe session userId belongs to a different Stripe customer — plan not applied", {
              userId,
              customerId,
            });
          } else {
            await prisma.user.update({
              where: { id: userId },
              data: {
                plan,
                stripeSubId: typeof session.subscription === "string" ? session.subscription : undefined,
              },
            });
          }
        }
        break;
      }

      case "checkout.session.async_payment_failed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const orderId = session.metadata?.orderId;
        if (orderId) {
          // Nothing was reserved for this order (completed skipped it because
          // payment_status was not "paid"), so cancelling the row is the whole
          // job — leaving it PENDING would keep it waiting for a payment that
          // Stripe has already given up on.
          const cancelled = await prisma.order.updateMany({
            where: { id: orderId, status: "PENDING" },
            data: { status: "CANCELLED" },
          });
          logger.warn("Async payment failed — order cancelled", { orderId, cancelled: cancelled.count });
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
        const user =
          (await prisma.user.findFirst({ where: { stripeSubId: sub.id } })) ??
          (sub.metadata?.userId ? await prisma.user.findUnique({ where: { id: sub.metadata.userId } }) : null) ??
          (customerId ? await prisma.user.findFirst({ where: { stripeCustomerId: customerId } }) : null);
        if (!user) break;

        const ended = event.type === "customer.subscription.deleted" || ["canceled", "unpaid", "incomplete_expired"].includes(sub.status);
        if (ended) {
          await prisma.user.update({ where: { id: user.id }, data: { plan: "FREE", stripeSubId: null } });
        } else if (["active", "trialing", "past_due"].includes(sub.status)) {
          const priceId = sub.items?.data?.[0]?.price?.id;
          // Only the price decides the plan. An unmappable price id is a
          // deployment that does not know one of its own prices — a new price
          // created in the dashboard while STRIPE_PRICE_* stayed behind — not a
          // licence to believe metadata Stripe never rewrites: doing that hands
          // a portal downgrade the entitlements of the plan it left. So the
          // subscription id is recorded, the plan is left as it is, and the
          // missing mapping is shouted about instead of guessed around.
          const plan = planForPriceId(priceId);
          if (!plan) {
            logger.error("Unknown Stripe price id — plan NOT applied, add this price to STRIPE_PRICE_*", {
              subscription: sub.id,
              priceId,
              metadataPlan: sub.metadata?.plan,
              currentPlan: user.plan,
            });
          }
          await prisma.user.update({
            where: { id: user.id },
            data: { stripeSubId: sub.id, ...(plan ? { plan } : {}) },
          });
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        logger.warn("Stripe invoice payment failed", { customer: invoice.customer, invoice: invoice.id });
        break;
      }

      case "payment_intent.succeeded":
        // Handled via checkout.session.completed
        break;
    }
  } catch (err) {
    logger.error("Webhook handler error", err);
    // Hand the claim back, otherwise Stripe's retry is answered with
    // "alreadyProcessed" and the half that failed is never finished.
    await prisma.stripeEvent
      .deleteMany({ where: { stripeEventId: event.id } })
      .catch((delErr) => logger.error("Could not release the Stripe event claim — retries will be skipped", delErr));
    return new NextResponse("Handler error", { status: 500 });
  }

  return NextResponse.json({ received: true });
}
