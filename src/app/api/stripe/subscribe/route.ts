import { NextRequest } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { BILLABLE_PLANS, getPlan, stripePriceIdFor, type PlanId } from "@/lib/plans";
import { getCurrentUser } from "@/lib/auth";
import { env, isDatabaseConfigured } from "@/lib/env";
import { apiError, apiSuccess } from "@/lib/api-response";
import { currentVisitorId, recordConversion, recordSignup } from "@/lib/referrals";

const SubscribeSchema = z.object({
  plan: z.enum(BILLABLE_PLANS as [PlanId, ...PlanId[]]),
});

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
      // parts order. Same fail-closed rule the checkout route already applies:
      // demo mode is an explicit opt-in, production is not.
      if (env.IS_PRODUCTION && !env.DEMO_MODE) {
        logger.error("Subscription upgrade blocked — Stripe is not configured in production", { plan });
        return apiError(
          "Betaalde abonnementen zijn tijdelijk niet beschikbaar. Neem contact op via support@wasfix.nl.",
          503
        );
      }
      // Demo mode — direct upgrade (persisted when a DB is available)
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

    let dbUser = await prisma.user.findUnique({ where: { id: user.id } });
    if (!dbUser) return apiError("Gebruiker niet gevonden", 404);

    // The advertised price lives in plans.ts, the charged price in a Stripe
    // dashboard nobody here can see. Nothing caught a mismatch: the runbook
    // still says to create Bedrijf at €99 while we sell it at €199, and a
    // yearly interval or a USD price would have been just as invisible.
    // Business plans quote ex BTW and consumer plans incl BTW (planPriceSuffix),
    // which is exactly Stripe's exclusive/inclusive tax_behavior — with
    // automatic_tax below, a wrong setting either adds 21% on top of a consumer
    // price we promised was inclusive, or is rejected outright by Stripe.
    const expectedTaxBehavior = planConfig.audience === "business" ? "exclusive" : "inclusive";
    const price = await stripe.prices.retrieve(priceId);
    if (
      price.unit_amount !== planConfig.priceCents ||
      price.currency !== "eur" ||
      price.recurring?.interval !== "month" ||
      price.recurring.interval_count !== 1 ||
      price.tax_behavior !== expectedTaxBehavior
    ) {
      logger.error("Stripe price does not match the advertised plan — checkout blocked", {
        plan,
        priceId,
        expected: {
          unitAmount: planConfig.priceCents,
          currency: "eur",
          interval: "month",
          intervalCount: 1,
          taxBehavior: expectedTaxBehavior,
        },
        actual: {
          unitAmount: price.unit_amount,
          currency: price.currency,
          interval: price.recurring?.interval ?? null,
          intervalCount: price.recurring?.interval_count ?? null,
          taxBehavior: price.tax_behavior,
        },
      });
      return apiError(
        "Dit abonnement is tijdelijk niet beschikbaar. Neem contact op via support@wasfix.nl.",
        500
      );
    }

    if (!dbUser.stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: { userId: user.id },
      });
      dbUser = await prisma.user.update({
        where: { id: user.id },
        data: { stripeCustomerId: customer.id },
      });
    }

    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        payment_method_types: ["card", "ideal", "bancontact"],
        customer: dbUser.stripeCustomerId!,
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
        success_url: `${env.APP_URL}/dashboard?upgraded=1`,
        cancel_url: `${env.APP_URL}/prijzen`,
        metadata: { userId: user.id, plan, ...(visitorId ? { refVisitorId: visitorId } : {}) },
        subscription_data: {
          metadata: { userId: user.id, plan },
          // The trial is advertised on the homepage, the pricing page and in
          // the terms; without this the customer is charged immediately.
          ...(planConfig.trialDays > 0 ? { trial_period_days: planConfig.trialDays } : {}),
        },
      },
      { idempotencyKey: `subscribe-${user.id}-${plan}-${Date.now()}` }
    );

    return apiSuccess({ checkoutUrl: session.url });
  } catch (err) {
    logger.error("Subscribe error", err);
    return apiError("Upgrade mislukt", 500);
  }
}
