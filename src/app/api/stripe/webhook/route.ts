import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { env } from "@/lib/env";
import type Stripe from "stripe";
import { recordConversion } from "@/lib/referrals";

export const runtime = "nodejs";

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

  // Idempotency check
  try {
    const existing = await prisma.stripeEvent.findUnique({
      where: { stripeEventId: event.id },
    });
    if (existing) {
      return NextResponse.json({ received: true, alreadyProcessed: true });
    }
  } catch (err) {
    logger.warn("StripeEvent lookup failed (continuing)", err);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.userId;
        const plan = session.metadata?.plan;
        const orderId = session.metadata?.orderId;

        if (orderId) {
          await prisma.$transaction(async (tx) => {
            const order = await tx.order.findUnique({
              where: { id: orderId },
              include: { items: true },
            });
            if (!order || order.status !== "PENDING") return;
            await tx.order.update({
              where: { id: orderId },
              data: { status: "PAID", stripePaymentId: session.id },
            });
            for (const item of order.items) {
              await tx.part.update({
                where: { id: item.partId },
                data: { stock: { decrement: item.quantity } },
              });
            }
          });
          // Idempotent: a replayed webhook returns the existing invoice
          // rather than burning a second sequential number.
          const { issueInvoiceForOrder } = await import("@/lib/invoicing");
          await issueInvoiceForOrder(orderId);
        }

        // Referral credit: the visitor id was stashed at checkout time.
        const refVisitorId = session.metadata?.refVisitorId;
        if (refVisitorId) await recordConversion(refVisitorId);

        if (userId && plan) {
          await prisma.user.update({
            where: { id: userId },
            data: {
              plan,
              stripeSubId: typeof session.subscription === "string" ? session.subscription : undefined,
            },
          });
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
          const plan = sub.metadata?.plan;
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

    await prisma.stripeEvent.create({
      data: { stripeEventId: event.id, type: event.type },
    });
  } catch (err) {
    logger.error("Webhook handler error", err);
    return new NextResponse("Handler error", { status: 500 });
  }

  return NextResponse.json({ received: true });
}
