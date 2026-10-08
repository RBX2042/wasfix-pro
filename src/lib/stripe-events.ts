/**
 * The ONE list of Stripe event types the webhook handles.
 *
 * Three things derive from it so they cannot drift apart:
 *   - the dispatch in src/app/api/stripe/webhook/route.ts (an event type that is
 *     not in this list is acknowledged with 200 and logged, never processed),
 *   - checkStripeReadiness() in ./stripe-readiness, which fails when the
 *     webhook endpoint in the Stripe dashboard does not subscribe to all of
 *     them (Stripe only delivers the events enabled on the endpoint, so a
 *     missing one means a handler that never runs),
 *   - the runbook: copy HANDLED_STRIPE_EVENTS into the endpoint's "Select
 *     events" box, or run `listWebhookEventsForDocs()` for a ready-made list.
 *
 * Add a type here AND a case in the webhook dispatcher together; the QA script
 * (scripts/qa-stripe.ts) fails when one exists without the other.
 */

export const HANDLED_STRIPE_EVENTS = [
  // One-off orders
  "checkout.session.completed",
  "checkout.session.expired",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  // Subscriptions
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
  // Money going back
  "charge.refunded",
  "charge.dispute.created",
] as const;

export type HandledStripeEvent = (typeof HANDLED_STRIPE_EVENTS)[number];

const HANDLED = new Set<string>(HANDLED_STRIPE_EVENTS);

export function isHandledStripeEvent(type: string): type is HandledStripeEvent {
  return HANDLED.has(type);
}

/** What each event does here, for the runbook and for the readiness report. */
export const STRIPE_EVENT_PURPOSE: Record<HandledStripeEvent, string> = {
  "checkout.session.completed": "Een order is betaald (kaart/iDEAL) of een abonnement is gestart; zonder deze blijft elke order op PENDING staan.",
  "checkout.session.expired": "Een niet afgeronde betaalsessie annuleert de order en geeft een eventuele reservering vrij.",
  "checkout.session.async_payment_succeeded": "Een vertraagde betaling is binnen; de order wordt alsnog betaald.",
  "checkout.session.async_payment_failed": "Een vertraagde betaling is mislukt; de order wordt geannuleerd.",
  "customer.subscription.created": "Een abonnement is aangemaakt; het plan volgt uit de prijs bij Stripe.",
  "customer.subscription.updated": "Plan, status of looptijd van een abonnement is gewijzigd (ook via het klantportaal).",
  "customer.subscription.deleted": "Een abonnement is beeindigd.",
  "invoice.paid": "Een abonnementsfactuur is betaald; haalt een achterstand (past_due) weg.",
  "invoice.payment_failed": "Een incasso is mislukt; de klant krijgt een herinnering met de link naar het klantportaal.",
  "charge.refunded": "Een terugbetaling levert een creditnota op en, bij een volledige terugbetaling, de annulering van de order.",
  "charge.dispute.created": "Een klant betwist een betaling; de eigenaar krijgt direct bericht met de uiterste reactiedatum.",
};

/** The webhook endpoint's `enabled_events`, one per line, ready to paste. */
export function listWebhookEventsForDocs(): string {
  return HANDLED_STRIPE_EVENTS.join("\n");
}

/** Events in `HANDLED_STRIPE_EVENTS` that an endpoint's `enabled_events` does not cover. "*" covers everything. */
export function missingWebhookEvents(enabledEvents: readonly string[]): HandledStripeEvent[] {
  if (enabledEvents.includes("*")) return [];
  const have = new Set(enabledEvents);
  return HANDLED_STRIPE_EVENTS.filter((type) => !have.has(type));
}
