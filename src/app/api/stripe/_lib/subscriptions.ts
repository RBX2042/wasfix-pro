/**
 * Subscription state: Stripe is the source of truth, the webhook is only the
 * doorbell.
 *
 * An event payload is a snapshot from the moment it was created. Stripe does not
 * deliver events in order and retries reorder them further, so applying the
 * payload lets a stale "updated(active)" re-grant a plan that was cancelled, and
 * a "deleted" for an old subscription strip a customer who is paying for a new
 * one. So every subscription event only says WHICH subscription changed; the
 * state that is written comes from retrieving that subscription again, under a
 * per-user lock, which makes any order of delivery converge on the same result.
 *
 * One live subscription per user: a user's stored subscription (User.stripeSubId)
 * is only replaced when it is no longer live at Stripe. A second live one is
 * reported to the owner and left alone; an event about a subscription that is
 * not the user's current one never changes the plan.
 */
import type Stripe from "stripe";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { BILLABLE_PLANS, getPlan, stripePriceIdFor, type PlanId } from "@/lib/plans";
import { notifyError, notifyOwner } from "@/lib/notify";
import { esc, button, shell } from "@/lib/emails/layout";
import { endStripeSubscription } from "@/lib/stripe";
import { isLiveSubscriptionStatus, effectivePlan, pastDueGraceEndsAt, PAST_DUE_GRACE_DAYS } from "@/lib/subscription";

/** Rows erased by /api/account/delete carry this address. */
export const ANONYMISED_EMAIL_SUFFIX = "@anon.wasfix.nl";

type IdLike = string | { id: string } | null | undefined;
export function idOf(value: IdLike): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
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
export function planForPriceId(priceId: string | null | undefined): PlanId | null {
  if (!priceId) return null;
  return BILLABLE_PLANS.find((plan) => stripePriceIdFor(plan) === priceId) ?? null;
}

function planOf(sub: Stripe.Subscription): { plan: PlanId | null; priceId: string | null } {
  const ids = (sub.items?.data ?? []).map((item) => item.price?.id).filter((id): id is string => !!id);
  for (const id of ids) {
    const plan = planForPriceId(id);
    if (plan) return { plan, priceId: id };
  }
  return { plan: null, priceId: ids[0] ?? null };
}

type PeriodFields = { current_period_start?: number | null; current_period_end?: number | null };
function periodOf(sub: Stripe.Subscription, key: "current_period_start" | "current_period_end"): number | null {
  // Top-level on the API version this code is pinned to; newer versions moved
  // the period onto the subscription items.
  const top = (sub as unknown as PeriodFields)[key];
  if (typeof top === "number") return top;
  const item = (sub.items?.data?.[0] as unknown as PeriodFields | undefined)?.[key];
  return typeof item === "number" ? item : null;
}

/**
 * The end of the period the customer has paid for. See src/lib/subscription.ts
 * ("PAID THROUGH"). null for a canceled subscription: it has ended and owes no
 * access, whatever period Stripe still shows on it.
 */
export function paidThroughOf(sub: Stripe.Subscription): Date | null {
  if (sub.status === "canceled") return null;
  const unpaidPeriod = sub.status === "past_due" || sub.status === "unpaid";
  const seconds = unpaidPeriod ? periodOf(sub, "current_period_start") : periodOf(sub, "current_period_end");
  return seconds === null ? null : new Date(seconds * 1000);
}

/** The subscription as Stripe has it now, or null when Stripe no longer knows it. */
export async function fetchSubscription(stripe: Stripe, subId: string): Promise<Stripe.Subscription | null> {
  try {
    return await stripe.subscriptions.retrieve(subId);
  } catch (err) {
    const e = err as { code?: string; statusCode?: number };
    if (e?.code === "resource_missing" || e?.statusCode === 404) return null;
    throw err;
  }
}

export type SyncHint = { userId?: string | null; customerId?: string | null };

export type SyncResult =
  | {
      kind: "applied";
      userId: string;
      email: string;
      /** What the account is entitled to now (effectivePlan). */
      plan: string;
      /** The plan stored on the account: what the customer is (or was last) paying for. */
      storedPlan: string;
      status: string;
      activated: boolean;
      paidThrough: Date | null;
    }
  | { kind: "ignored"; reason: "no_user" | "not_current" | "duplicate_live" | "anonymised" | "customer_mismatch" };

async function findUser(subId: string, hint: SyncHint) {
  const bySub = await prisma.user.findFirst({ where: { stripeSubId: subId } });
  if (bySub) return bySub;
  if (hint.userId) {
    const byId = await prisma.user.findUnique({ where: { id: hint.userId } });
    if (byId) return byId;
  }
  if (hint.customerId) return prisma.user.findFirst({ where: { stripeCustomerId: hint.customerId } });
  return null;
}

/**
 * Apply the current state of subscription `subId` to its user. `hint` carries
 * identifiers from the event (user id from our own metadata, customer id) used
 * only to find the user; it never decides the plan or status.
 */
export async function syncSubscription(stripe: Stripe, subId: string, hint: SyncHint = {}): Promise<SyncResult> {
  const found = await findUser(subId, hint);
  if (!found) {
    logger.warn("Stripe subscription belongs to no user of ours", { subscription: subId });
    await notifyOwner({
      event: "subscription.unknown_user",
      level: "warn",
      title: "Stripe-abonnement zonder gebruiker",
      lines: [`Abonnement ${subId} hoort bij geen account in de database.`, "Controleer in Stripe of dit een test of een handmatig aangemaakt abonnement is."],
    });
    return { kind: "ignored", reason: "no_user" };
  }

  const outcome = await prisma.$transaction(
    async (tx): Promise<{ result: SyncResult; mail: { email: string; plan: PlanId; trial: boolean } | null; unknownPrice: string | null; duplicate: string | null; cancelDuplicate: boolean }> => {
      // Serialise every sync for this user: two events about the same account
      // must not each fetch, then write in the opposite order.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${found.id}))`;
      const user = await tx.user.findUniqueOrThrow({ where: { id: found.id } });
      const none = { mail: null, unknownPrice: null, duplicate: null, cancelDuplicate: false };

      const fresh = await fetchSubscription(stripe, subId);
      const live = !!fresh && isLiveSubscriptionStatus(fresh.status);
      const customerId = idOf(fresh?.customer);
      const isCurrent = user.stripeSubId === subId;

      if (user.email.endsWith(ANONYMISED_EMAIL_SUFFIX)) {
        // An erased account must never be handed a plan again. If Stripe still
        // bills a subscription for it, the caller cancels it.
        return { ...none, result: { kind: "ignored", reason: "anonymised" }, cancelDuplicate: live };
      }
      if (!isCurrent && user.stripeCustomerId && customerId && user.stripeCustomerId !== customerId) {
        // The user id in metadata was set by whoever created the subscription; an
        // id pointing at somebody else's Stripe customer never earns a plan.
        return { ...none, result: { kind: "ignored", reason: "customer_mismatch" } };
      }

      if (!isCurrent) {
        // A subscription that is not the user's current one may only REPLACE it
        // when it is live and the stored one no longer is.
        if (!live) return { ...none, result: { kind: "ignored", reason: "not_current" } };
        if (user.stripeSubId) {
          const stored = isLiveSubscriptionStatus(user.stripeSubStatus) || !user.stripeSubStatus ? await fetchSubscription(stripe, user.stripeSubId) : null;
          if (stored && isLiveSubscriptionStatus(stored.status)) {
            return { ...none, result: { kind: "ignored", reason: "duplicate_live" }, duplicate: user.stripeSubId };
          }
        }
      }

      const now = new Date();
      const paidThrough = fresh ? paidThroughOf(fresh) : null;
      const status = fresh ? fresh.status : "canceled";
      const { plan: pricedPlan, priceId } = fresh ? planOf(fresh) : { plan: null, priceId: null };
      // The plan ends with the subscription. "canceled" is an ended subscription
      // whatever period Stripe still shows on it: it comes from an immediate
      // cancellation or from Stripe giving up on a card that never paid, and
      // neither is owed the rest of the month (see src/lib/subscription.ts).
      // An "unpaid" subscription is not ended, its invoices can still be paid in
      // the billing portal, so the account keeps pointing at it (plan FREE).
      const lapsed = !fresh || status === "unpaid" || status === "incomplete_expired" || status === "canceled";
      const ended = !fresh || status === "canceled" || status === "incomplete_expired";
      const wasLive = isCurrent && isLiveSubscriptionStatus(user.stripeSubStatus);
      const trialStart = fresh?.trial_start ? new Date(fresh.trial_start * 1000) : null;
      const usedTrial = !!fresh && (status === "trialing" || !!fresh.trial_end);

      const nextPlan = lapsed ? "FREE" : pricedPlan ?? user.plan;
      const updated = await tx.user.update({
        where: { id: user.id },
        data: {
          plan: nextPlan,
          stripeSubId: ended ? null : subId,
          stripeSubStatus: status,
          stripeCurrentPeriodEnd: paidThrough,
          // Mirrors Stripe: a cancelled-at-period-end subscription is still active until then.
          stripeCancelAtPeriodEnd: !!fresh?.cancel_at_period_end && !ended,
          ...(!user.stripeCustomerId && customerId ? { stripeCustomerId: customerId } : {}),
          ...(usedTrial && !user.trialUsedAt ? { trialUsedAt: trialStart ?? now } : {}),
        },
      });

      const activated = live && !wasLive && !(isCurrent && !user.stripeSubStatus);
      return {
        result: { kind: "applied", userId: updated.id, email: updated.email, plan: effectivePlan(updated, now), storedPlan: updated.plan, status, activated, paidThrough },
        mail: activated && pricedPlan ? { email: updated.email, plan: pricedPlan, trial: status === "trialing" } : null,
        unknownPrice: live && !pricedPlan ? priceId ?? "(geen prijs)" : null,
        duplicate: null,
        cancelDuplicate: false,
      };
    },
    { maxWait: 10_000, timeout: 30_000 },
  );

  // Side effects only after the commit, so a slow mail or a dead Slack cannot
  // hold the user lock.
  if (outcome.unknownPrice) {
    logger.error("Unknown Stripe price id — plan NOT applied, add this price to STRIPE_PRICE_*", { subscription: subId, priceId: outcome.unknownPrice });
    await notifyError(new Error(`Stripe-prijs ${outcome.unknownPrice} is aan geen plan gekoppeld`), {
      where: "abonnementen",
      subscription: subId,
      fix: "Zet de prijs in STRIPE_PRICE_PARTICULIER, STRIPE_PRICE_MONTEUR of STRIPE_PRICE_BEDRIJF",
    });
  }
  if (outcome.duplicate) {
    logger.error("A second live Stripe subscription for one user — left alone", { subscription: subId, stored: outcome.duplicate });
    await notifyOwner({
      event: "subscription.duplicate",
      level: "error",
      title: "Een klant heeft twee lopende abonnementen",
      lines: [`Opgeslagen: ${outcome.duplicate}. Nieuw (genegeerd): ${subId}.`, "Zeg een van beide op in Stripe en betaal zo nodig terug. Het plan van de klant is niet gewijzigd."],
    });
  }
  if (outcome.cancelDuplicate) {
    await cancelOrphanSubscription(stripe, subId);
  }
  if (outcome.result.kind === "applied" && outcome.mail) {
    const planName = getPlan(outcome.mail.plan).name;
    const { sendSubscriptionConfirmation } = await import("@/lib/email");
    await sendSubscriptionConfirmation(outcome.mail.email, planName);
    await notifyOwner({
      event: "subscription.started",
      title: `Nieuw abonnement: ${planName}`,
      lines: [outcome.mail.trial ? "Met proefperiode" : "Direct betaald"],
      url: "/admin",
    });
  }
  return outcome.result;
}

/** A live subscription for an erased account is cancelled where it bills: here, at Stripe. */
async function cancelOrphanSubscription(stripe: Stripe, subId: string): Promise<void> {
  try {
    await stripe.subscriptions.cancel(subId, undefined, { idempotencyKey: `orphan-cancel-${subId}` });
    logger.warn("Cancelled a Stripe subscription that belonged to an erased account", { subscription: subId });
    await notifyOwner({ event: "subscription.orphan_cancelled", level: "warn", title: "Abonnement van een verwijderd account opgezegd", lines: [`Abonnement ${subId} is bij Stripe opgezegd.`] });
  } catch (err) {
    logger.error("Could not cancel a subscription of an erased account", err);
    await notifyOwner({ event: "subscription.orphan", level: "error", title: "Abonnement van een verwijderd account loopt nog", lines: [`Zeg ${subId} handmatig op in Stripe.`] });
  }
}

// ─── Invoices of a subscription ────────────────────────────────────────

export async function sendPaymentFailedEmail(
  email: string,
  data: { plan: string; attempt: number | null; amountEur: number | null; graceEndsAt: Date | null; lapsed: boolean },
): Promise<void> {
  const { sendMail } = await import("@/lib/email");
  const date = data.graceEndsAt ? new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" }).format(data.graceEndsAt) : null;
  const amount = data.amountEur != null ? new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(data.amountEur) : null;
  const url = `${env.APP_URL.replace(/\/+$/, "")}/dashboard/profiel`;
  await sendMail({
    template: "subscription-payment-failed",
    to: email,
    subject: "Je betaling voor WasFix is niet gelukt",
    html: shell(`
        <h1 style="color: #1a6b6b;">We konden je abonnement niet incasseren</h1>
        <p style="font-size: 16px; line-height: 1.6;">
          De betaling voor je abonnement ${esc(data.plan)}${amount ? ` (${esc(amount)})` : ""} is niet gelukt${data.attempt ? ` (poging ${data.attempt})` : ""}.
          Stripe probeert het opnieuw, maar je kunt het sneller oplossen door je betaalmethode bij te werken.
        </p>
        <p style="font-size: 16px; line-height: 1.6;">
          ${
            data.lapsed
              ? `Je voordelen zijn gestopt omdat de betaling te lang openstond. Zodra de betaling slaagt, staan ze weer aan.`
              : date
                ? `Je behoudt je voordelen tot ${esc(date)}. Daarna vallen we terug op het gratis plan tot de betaling is gelukt.`
                : `Je behoudt je voordelen nog even; daarna vallen we terug op het gratis plan tot de betaling is gelukt.`
          }
        </p>
        ${button(url, "Betaalmethode bijwerken")}
        <p style="margin-top: 24px; font-size: 13px; color: #666;">Open op die pagina "Beheer abonnement (Stripe portal)".</p>`),
  });
}

/**
 * The subscription an invoice belongs to. The API version this client is pinned
 * to puts it in `invoice.subscription`; newer versions (a webhook endpoint
 * created in the Dashboard defaults to the account's CURRENT version, and
 * events follow the endpoint, not the client) moved it to
 * `invoice.parent.subscription_details.subscription`. Read both, and when the
 * event carries neither ask Stripe for the invoice through the pinned client,
 * which always answers in the pinned shape.
 */
async function subscriptionOfInvoice(stripe: Stripe, invoice: Stripe.Invoice): Promise<string | null> {
  const shape = invoice as unknown as { subscription?: IdLike; parent?: { subscription_details?: { subscription?: IdLike } | null } | null };
  const direct = idOf(shape.subscription) ?? idOf(shape.parent?.subscription_details?.subscription);
  if (direct || !invoice.id) return direct;
  try {
    const fresh = (await stripe.invoices.retrieve(invoice.id)) as unknown as typeof shape;
    return idOf(fresh.subscription) ?? idOf(fresh.parent?.subscription_details?.subscription);
  } catch (err) {
    const e = err as { code?: string; statusCode?: number };
    if (e?.code === "resource_missing" || e?.statusCode === 404) return null;
    throw err;
  }
}

export async function handleSubscriptionInvoice(stripe: Stripe, invoice: Stripe.Invoice, type: "invoice.paid" | "invoice.payment_failed"): Promise<void> {
  const subId = await subscriptionOfInvoice(stripe, invoice);
  if (!subId) {
    logger.info("Invoice event without a subscription — nothing to sync", { invoice: invoice.id, type });
    return;
  }
  const result = await syncSubscription(stripe, subId, { customerId: idOf(invoice.customer) });
  if (type !== "invoice.payment_failed" || result.kind !== "applied") return;
  // Mail only while Stripe still says the payment is outstanding: a retry that
  // succeeded between the event and our fetch must not produce a scolding mail.
  if (result.status !== "past_due" && result.status !== "unpaid") return;
  const grace = pastDueGraceEndsAt(result.paidThrough);
  const lapsed = result.status === "unpaid" || !grace || grace.getTime() < Date.now();
  logger.warn("Stripe subscription payment failed", { subscription: subId, attempt: invoice.attempt_count, status: result.status });
  await sendPaymentFailedEmail(result.email, {
    plan: getPlan(result.storedPlan).name,
    attempt: invoice.attempt_count ?? null,
    amountEur: typeof invoice.amount_due === "number" ? invoice.amount_due / 100 : null,
    graceEndsAt: grace,
    lapsed,
  });
  if ((invoice.attempt_count ?? 1) <= 1) {
    await notifyOwner({
      event: "subscription.payment_failed",
      level: "warn",
      title: "Abonnementsbetaling mislukt",
      lines: [`Plan ${getPlan(result.storedPlan).name}, de klant heeft een herinnering gekregen.`, `Zonder betaling valt het plan ${PAST_DUE_GRACE_DAYS} dagen na het einde van de betaalde periode terug naar gratis: de toegang vervalt dan direct (effectivePlan), de database volgt bij de eerstvolgende run van /api/cron/stripe-subscriptions.`],
    });
  }
}

/**
 * Lapse plans that effectivePlan() already treats as FREE, so code that still
 * reads User.plan directly agrees. Meant for a daily cron. Only the plan is
 * reset while the subscription can still come back (past_due, unpaid, paused,
 * incomplete: the id and status stay, so a late payment restores the plan
 * through the next sync); for an ended subscription the id goes as well.
 */
export async function sweepLapsedSubscriptions(now: Date = new Date()): Promise<{ lapsed: number }> {
  const candidates = await prisma.user.findMany({
    where: { plan: { not: "FREE" }, stripeSubStatus: { not: null } },
    select: { id: true, plan: true, stripeSubStatus: true, stripeCurrentPeriodEnd: true },
  });
  let lapsed = 0;
  for (const user of candidates) {
    if (effectivePlan(user, now) !== "FREE") continue;
    const ended = user.stripeSubStatus === "canceled" || user.stripeSubStatus === "incomplete_expired";
    const res = await prisma.user.updateMany({
      // The WHERE repeats what was just read, so a webhook that fixed the
      // account in between wins.
      where: { id: user.id, plan: user.plan, stripeSubStatus: user.stripeSubStatus },
      data: { plan: "FREE", ...(ended ? { stripeSubId: null } : {}) },
    });
    lapsed += res.count;
  }
  if (lapsed > 0) logger.info("Lapsed subscriptions reset to FREE", { lapsed });
  return { lapsed };
}

/**
 * Cancel the Stripe subscription of every erased account that still points at
 * one. /api/account/delete cancels before it erases, so it leaves none behind;
 * the Clerk user.deleted webhook anonymises the row without touching Stripe, and
 * until that route is changed this is what stops the card being charged for an
 * account that no longer exists (otherwise the next renewal invoice is the first
 * event that cancels it, i.e. after one more charge). Meant for the same cron
 * as the sweep. Never throws; a failure is reported to the owner and retried on
 * the next run.
 */
export async function cancelSubscriptionsOfErasedUsers(stripe: Stripe | null): Promise<{ cancelled: number; failed: number }> {
  const result = { cancelled: 0, failed: 0 };
  if (!stripe) return result;
  const users = await prisma.user.findMany({
    where: { email: { endsWith: ANONYMISED_EMAIL_SUFFIX }, stripeSubId: { not: null } },
    select: { id: true, stripeSubId: true },
    take: 100,
  });
  for (const user of users) {
    try {
      const outcome = await endStripeSubscription(stripe, user.stripeSubId!, `erased-user-${user.id}-${user.stripeSubId}`);
      await prisma.user.updateMany({
        where: { id: user.id, stripeSubId: user.stripeSubId },
        data: { stripeSubId: null, plan: "FREE", stripeSubStatus: null, stripeCurrentPeriodEnd: null },
      });
      if (outcome === "cancelled") {
        result.cancelled += 1;
        logger.warn("Cancelled the Stripe subscription of an erased account", { userId: user.id, subscription: user.stripeSubId });
        await notifyOwner({ event: "subscription.orphan_cancelled", level: "warn", title: "Abonnement van een verwijderd account opgezegd", lines: [`Abonnement ${user.stripeSubId} is bij Stripe opgezegd.`] });
      }
    } catch (err) {
      result.failed += 1;
      logger.error("Could not cancel the subscription of an erased account", err);
      await notifyOwner({ event: "subscription.orphan", level: "error", title: "Abonnement van een verwijderd account loopt nog", lines: [`Zeg ${user.stripeSubId} handmatig op in Stripe.`] });
    }
  }
  return result;
}

/** The daily subscription housekeeping, one entry point for the scheduled route. */
export async function runSubscriptionMaintenance(stripe: Stripe | null, now: Date = new Date()) {
  const lapsed = await sweepLapsedSubscriptions(now);
  const erased = await cancelSubscriptionsOfErasedUsers(stripe);
  return { lapsed: lapsed.lapsed, orphansCancelled: erased.cancelled, orphansFailed: erased.failed };
}
