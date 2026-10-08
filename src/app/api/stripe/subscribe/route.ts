import { NextRequest } from "next/server";
import type Stripe from "stripe";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { BILLABLE_PLANS, getPlan, stripePriceIdFor, type PlanId } from "@/lib/plans";
import { getCurrentUser } from "@/lib/auth";
import { env, isDatabaseConfigured } from "@/lib/env";
import { siteUrl } from "@/lib/site-url";
import { isDemoMode } from "@/lib/demo-mode";
import { apiError, apiSuccess } from "@/lib/api-response";
import { notifyError } from "@/lib/notify";
import { currentVisitorId, recordConversion, recordSignup } from "@/lib/referrals";
import { PORTAL_SUBSCRIPTION_STATUSES, expectedTaxBehavior, priceMismatches } from "@/lib/subscription";
import { fetchSubscription, idOf } from "../_lib/subscriptions";
import { WITHDRAWAL_WAIVER_TEXT, requiresWithdrawalWaiver } from "@/app/upgrade/consent";
import { supportEmail, supportHint } from "@/lib/support-contact";

export const maxDuration = 30;

const SubscribeSchema = z.object({
  plan: z.enum(BILLABLE_PLANS as [PlanId, ...PlanId[]]),
  // The consumer's explicit request for immediate start and acknowledgement of the
  // loss of the withdrawal right (src/app/upgrade/consent.ts). Required for the
  // consumer plan, before any Stripe session is created.
  withdrawalWaiver: z.boolean().optional(),
});

/**
 * Two clicks on "Upgrade nu" within this window must land on ONE Checkout
 * session. A key that changes on every request (it used to carry Date.now())
 * dedupes nothing; a key that never changes would hand out a finished or
 * expired session for a day, so it rolls over every 10 minutes.
 */
const SESSION_DEDUPE_WINDOW_MS = 10 * 60 * 1000;

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Niet ingelogd", 401);

    const body = await req.json().catch(() => null);
    if (!body) return apiError("Ongeldige JSON", 400);

    const parsed = SubscribeSchema.safeParse(body);
    if (!parsed.success) return apiError("Ongeldig plan", 400, parsed.error.flatten());

    const { plan } = parsed.data;
    const planConfig = getPlan(plan);
    // The consumer's consent is needed where a NEW subscription is about to be started (the
    // Checkout session, or the demo upgrade below), and nowhere else: a customer who already
    // has a subscription is sent to the billing portal, which starts nothing, and the upgrade
    // page tells them so without showing the checkbox. Checking first used to answer such a
    // customer with a 400 about the withdrawal right instead of the portal.
    const waiverMissing = requiresWithdrawalWaiver(plan) && parsed.data.withdrawalWaiver !== true;
    const waiverRefusal = () => apiError("Bevestig eerst dat je wilt dat de dienst direct begint en dat je daarmee je herroepingsrecht verliest zodra de dienst is uitgevoerd.", 400);
    const priceId = stripePriceIdFor(plan);
    const stripe = getStripe();
    const visitorId = await currentVisitorId();
    if (visitorId) await recordSignup(visitorId);

    if (!stripe || !priceId) {
      // SECURITY: without this guard a missing Stripe key means "everyone gets
      // the plan for free". Stripe keys are not configured yet (see
      // BLOCKED.md), so in production any signed-in user could POST
      // {"plan":"BEDRIJF"} and permanently grant themselves unlimited
      // diagnoses, premium guides, the monteur dashboard and 15% off every
      // parts order. A free upgrade is a demo feature: it needs isDemoMode(),
      // which is false in production whatever DEMO_MODE says. The raw DEMO_MODE
      // flag is NOT the test: wasfix.nl runs with it set to "true" (see
      // src/lib/api-auth.ts), and with Clerk keys present but Stripe keys
      // missing that flag alone handed any signed-in user any plan.
      if (env.IS_PRODUCTION || !isDemoMode()) {
        logger.error("Subscription upgrade blocked — Stripe is not configured", { plan, stripeKey: !!stripe, priceId: !!priceId });
        if (env.IS_PRODUCTION) {
          await notifyError(new Error(!stripe ? "STRIPE_SECRET_KEY ontbreekt" : `Stripe-prijs voor ${plan} ontbreekt`), { where: "abonnement afsluiten", plan });
        }
        return apiError(
          `Betaalde abonnementen zijn tijdelijk niet beschikbaar. Probeer het later opnieuw of ${supportHint(supportEmail())}.`,
          503
        );
      }
      // Demo mode — direct upgrade (persisted when a DB is available)
      if (waiverMissing) return waiverRefusal();
      if (isDatabaseConfigured()) {
        await prisma.user.update({ where: { id: user.id }, data: { plan } }).catch((err) =>
          logger.warn("Demo upgrade could not be persisted", err)
        );
      }
      if (visitorId) await recordConversion(visitorId);
      return apiSuccess({ demo: true, plan });
    }

    if (!isDatabaseConfigured()) {
      return apiError("Abonnementen vereisen een database (DATABASE_URL). Zie BLOCKED.md.", 503);
    }

    // Stripe sends the customer back to addresses built from NEXT_PUBLIC_APP_URL. In production an unusable
    // value (missing, http, the localhost fallback) would send a customer who just paid to a dead page, so
    // refuse before any Stripe session exists. Checkout does the same through cart-gate.
    const baseUrl = siteUrl();
    if (!baseUrl) {
      logger.error("Subscription blocked: NEXT_PUBLIC_APP_URL is not a usable public address", { plan });
      await notifyError(new Error("NEXT_PUBLIC_APP_URL is niet bruikbaar: abonnementen zijn geblokkeerd"), { where: "abonnement afsluiten", plan });
      return apiError(`Betaalde abonnementen zijn tijdelijk niet beschikbaar. Probeer het later opnieuw of ${supportHint(supportEmail())}.`, 503);
    }

    let dbUser = await prisma.user.findUnique({ where: { id: user.id } });
    if (!dbUser) return apiError("Gebruiker niet gevonden", 404);

    // One subscription per customer, as far as this route can tell. A second Checkout would leave the old one
    // billing, untracked, next to the new one; changing plan, fixing a card or
    // cancelling all happen on the existing subscription in the billing portal.
    // The stored id is not enough to know: when the webhook is late or failed,
    // a customer who just paid still has no stripeSubId, so Stripe is asked for
    // the customer's subscriptions as well. Two Checkout sessions opened in two
    // tabs for DIFFERENT plans can still both be paid; the webhook then keeps the
    // first subscription and reports the second to the owner (syncSubscription).
    let customerSubscriptions: Stripe.Subscription[] = [];
    if (dbUser.stripeCustomerId) {
      customerSubscriptions = (await stripe.subscriptions.list({ customer: dbUser.stripeCustomerId, status: "all", limit: 20 })).data;
    }
    const stored = dbUser.stripeSubId ? await fetchSubscription(stripe, dbUser.stripeSubId) : null;
    const existing = [stored, ...customerSubscriptions].find((s) => !!s && PORTAL_SUBSCRIPTION_STATUSES.includes(s.status)) ?? null;
    if (existing) {
      const customerId = dbUser.stripeCustomerId ?? idOf(existing.customer);
      if (!customerId) return apiError("Klantportaal kon niet worden geopend", 500);
      const portal = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${baseUrl}/dashboard/profiel`,
      });
      return apiSuccess({
        checkoutUrl: portal.url,
        portal: true,
        alreadySubscribed: true,
        plan: dbUser.plan,
        message: "Je hebt al een abonnement. Je kunt het hier wijzigen of opzeggen.",
      });
    }

    // Nothing above started a subscription (a live one would have returned the portal), so the consent is due now,
    // before any price lookup, customer or Checkout session is created at Stripe.
    if (waiverMissing) return waiverRefusal();

    // The advertised price lives in plans.ts, the charged price in a Stripe
    // dashboard nobody here can see. Nothing caught a mismatch: the runbook
    // told the operator to create Bedrijf at €99 while we sell it at €199
    // (since corrected), and a yearly interval or a USD price would have been
    // just as invisible.
    // Business plans quote ex BTW and consumer plans incl BTW (planPriceSuffix),
    // which is exactly Stripe's exclusive/inclusive tax_behavior — with
    // automatic_tax below, a wrong setting either adds 21% on top of a consumer
    // price we promised was inclusive, or is rejected outright by Stripe.
    // A price created without an explicit tax behaviour comes back
    // "unspecified" and is refused here; Stripe cannot change it afterwards,
    // so such a price has to be recreated (see BLOCKED.md).
    const price = await stripe.prices.retrieve(priceId);
    const mismatch = priceMismatches(price, planConfig);
    if (mismatch.length > 0) {
      logger.error("Stripe price does not match the advertised plan — checkout blocked", {
        plan,
        priceId,
        // Named outright so the operator sees which field to recreate the
        // price with, instead of diffing expected against actual by eye.
        mismatch,
        expected: {
          unitAmount: planConfig.priceCents,
          currency: "eur",
          interval: "month",
          intervalCount: 1,
          taxBehavior: expectedTaxBehavior(planConfig),
        },
        actual: {
          unitAmount: price.unit_amount,
          currency: price.currency,
          interval: price.recurring?.interval ?? null,
          intervalCount: price.recurring?.interval_count ?? null,
          taxBehavior: price.tax_behavior,
          active: price.active,
        },
      });
      await notifyError(new Error(`Stripe-prijs ${priceId} voor ${plan} wijkt af: ${mismatch.join(", ")}`), { where: "abonnement afsluiten", plan });
      return apiError(
        `Dit abonnement is tijdelijk niet beschikbaar. Probeer het later opnieuw of ${supportHint(supportEmail())}.`,
        500
      );
    }

    if (!dbUser.stripeCustomerId) {
      const customer = await stripe.customers.create(
        { email: user.email, name: user.name, metadata: { userId: user.id } },
        // A double click, or two tabs, must not create two customers.
        { idempotencyKey: `customer-${user.id}` }
      );
      await prisma.user.updateMany({ where: { id: user.id, stripeCustomerId: null }, data: { stripeCustomerId: customer.id } });
      dbUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    }
    const customerId = dbUser.stripeCustomerId!;

    // The trial is advertised on the homepage, the pricing page and in the
    // terms. It is granted once per ACCOUNT / Stripe customer, which closes the
    // loop "start a trial, cancel on day 13, repeat" (Particulier for free
    // forever, with the plan's parts discount). It does NOT stop a person who
    // erases the account and registers again, or who registers a second account
    // with another e-mail address: each is a new customer and gets a trial of
    // its own. User.trialUsedAt is set by the webhook the first time a
    // subscription is seen trialing; Stripe is asked as well for accounts that
    // had a subscription before that column existed.
    let trialDays = planConfig.trialDays;
    if (trialDays > 0 && dbUser.trialUsedAt) trialDays = 0;
    if (trialDays > 0 && customerSubscriptions.some((s) => s.status !== "incomplete" && s.status !== "incomplete_expired")) trialDays = 0;

    const bucket = Math.floor(Date.now() / SESSION_DEDUPE_WINDOW_MS);
    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        // Card and iDEAL only (decision D6: Netherlands, no Bancontact).
        payment_method_types: ["card", "ideal"],
        locale: "nl",
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        allow_promotion_codes: true,
        // Business plans are advertised "excl. btw" — without automatic_tax
        // Stripe charged the bare €29/€199 and the 21% came out of our margin
        // instead of being added on top. tax_id_collection lets a business
        // enter its btw-nummer (EU reverse charge); customer_update is required
        // by Stripe to let automatic_tax fill in the customer's address.
        automatic_tax: { enabled: true },
        tax_id_collection: { enabled: true },
        customer_update: { address: "auto", name: "auto" },
        // The dashboard shows the confirmation (plan, first payment / renewal date) and waits
        // for the webhook to write the plan before it says anything about it.
        success_url: `${baseUrl}/dashboard?upgraded=1`,
        cancel_url: `${baseUrl}/prijzen`,
        // The consent given on our page is repeated on Stripe's payment page and recorded on
        // the session and the subscription, so it can be shown when a customer disputes the charge.
        ...(requiresWithdrawalWaiver(plan) ? { custom_text: { submit: { message: WITHDRAWAL_WAIVER_TEXT } } } : {}),
        metadata: { userId: user.id, plan, ...(requiresWithdrawalWaiver(plan) ? { withdrawalWaiver: "accepted" } : {}), ...(visitorId ? { refVisitorId: visitorId } : {}) },
        subscription_data: {
          metadata: { userId: user.id, plan, ...(requiresWithdrawalWaiver(plan) ? { withdrawalWaiver: "accepted" } : {}) },
          ...(trialDays > 0 ? { trial_period_days: trialDays } : {}),
        },
      },
      { idempotencyKey: `subscribe-${user.id}-${plan}-${customerId}-${trialDays > 0 ? "trial" : "paid"}-${visitorId ?? "none"}-${bucket}` }
    );

    return apiSuccess({ checkoutUrl: session.url });
  } catch (err) {
    logger.error("Subscribe error", err);
    await notifyError(err, { where: "abonnement afsluiten" });
    return apiError("Upgrade mislukt", 500);
  }
}
