import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { logger } from "@/lib/logger";
import { getStripe } from "@/lib/stripe";
import { env } from "@/lib/env";
import { notifyError } from "@/lib/notify";
import { isHandledStripeEvent, type HandledStripeEvent } from "@/lib/stripe-events";
import { claimStripeEvent, completeStripeEvent, releaseStripeEvent } from "../_lib/lease";
import { processStripeEvent } from "../_lib/dispatch";

export const runtime = "nodejs";
// A paid order is fulfilled inside this request (stock, invoice, mail, owner
// notice). The Stripe client allows ~16 s per call, so give the platform room
// to let a slow handler finish instead of killing it halfway, which is what the
// event lease in ../_lib/lease.ts exists to recover from.
export const maxDuration = 30;

/** After this many failed attempts at one event the owner is told, once a minute at most. */
const ALERT_AFTER_ATTEMPTS = 3;

export async function POST(req: NextRequest) {
  const stripe = getStripe();
  if (!stripe) {
    // Demo mode — accept silently so Stripe test webhooks don't error
    return NextResponse.json({ received: true, demo: true });
  }

  const sig = req.headers.get("stripe-signature");
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    // Not the sender's fault: without the secret no event can be verified, every
    // paid order stays PENDING, and nobody would know. Say so loudly.
    logger.error("STRIPE_WEBHOOK_SECRET is not set — every Stripe webhook is being refused");
    await notifyError(new Error("STRIPE_WEBHOOK_SECRET ontbreekt: betalingen worden niet verwerkt"), { where: "stripe webhook" });
    return new NextResponse("Webhook secret not configured", { status: 503 });
  }
  if (!sig) {
    logger.warn("Stripe webhook without a signature header");
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

  const type = event.type;
  if (!isHandledStripeEvent(type)) {
    // Acknowledged so Stripe stops retrying, logged so a type that should be
    // handled does not disappear unnoticed. The type list is in src/lib/stripe-events.ts.
    logger.info("Stripe event type is not handled — acknowledged", { type: event.type, id: event.id });
    return NextResponse.json({ received: true, ignored: true });
  }
  // `type` is narrowed by the guard above; carry that over to the event.
  const handled = event as Stripe.Event & { type: HandledStripeEvent };

  let claim;
  try {
    claim = await claimStripeEvent(event.id, event.type);
  } catch (err) {
    logger.error("Could not claim Stripe event — refusing to process without replay protection", err);
    return new NextResponse("Handler error", { status: 500 });
  }
  if (claim.state === "duplicate") return NextResponse.json({ received: true, alreadyProcessed: true });
  if (claim.state === "busy") {
    // Another delivery is working on it. Not a success: if that worker dies,
    // Stripe's next retry takes the event over once its lease has run out.
    return NextResponse.json({ received: false, inProgress: true }, { status: 409 });
  }

  try {
    await processStripeEvent(stripe, handled);
  } catch (err) {
    logger.error("Webhook handler error", { type: event.type, id: event.id, attempt: claim.attempts, err });
    // Give the lease back (not delete the row): Stripe's retry takes the event
    // over immediately, and the attempt count and last error stay on record.
    await releaseStripeEvent(event.id, claim.claimedAt, err).catch((relErr) =>
      logger.error("Could not release the Stripe event lease — the retry waits for it to expire", relErr),
    );
    if (claim.attempts >= ALERT_AFTER_ATTEMPTS) {
      await notifyError(err, { where: "stripe webhook", event: event.type, attempts: claim.attempts });
    }
    return new NextResponse("Handler error", { status: 500 });
  }

  try {
    await completeStripeEvent(event.id);
  } catch (err) {
    // Every handler is idempotent, so a lease that expires and is taken over
    // re-runs harmlessly. Not worth failing the delivery for.
    logger.error("Could not mark the Stripe event completed — it may be processed again after the lease", err);
  }
  return NextResponse.json({ received: true });
}
