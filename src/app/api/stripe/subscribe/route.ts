import { NextRequest } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getStripe, STRIPE_PRICES } from "@/lib/stripe";
import { getCurrentUser } from "@/lib/auth";
import { env, isDatabaseConfigured } from "@/lib/env";
import { apiError, apiSuccess } from "@/lib/api-response";

const SubscribeSchema = z.object({
  plan: z.enum(["PARTICULIER", "MONTEUR_PRO", "BEDRIJF"]),
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
    const priceId = STRIPE_PRICES[plan];
    const stripe = getStripe();

    if (!stripe || !priceId) {
      // Demo mode — direct upgrade (persisted when a DB is available)
      if (isDatabaseConfigured()) {
        await prisma.user.update({ where: { id: user.id }, data: { plan } }).catch((err) =>
          logger.warn("Demo upgrade could not be persisted", err)
        );
      }
      return apiSuccess({ demo: true, plan });
    }

    if (!isDatabaseConfigured()) {
      return apiError("Abonnementen vereisen een database (DATABASE_URL). Zie BLOCKED.md.", 503);
    }

    let dbUser = await prisma.user.findUnique({ where: { id: user.id } });
    if (!dbUser) return apiError("Gebruiker niet gevonden", 404);

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
        success_url: `${env.APP_URL}/dashboard?upgraded=1`,
        cancel_url: `${env.APP_URL}/prijzen`,
        metadata: { userId: user.id, plan },
        subscription_data: { metadata: { userId: user.id, plan } },
      },
      { idempotencyKey: `subscribe-${user.id}-${plan}-${Date.now()}` }
    );

    return apiSuccess({ checkoutUrl: session.url });
  } catch (err) {
    logger.error("Subscribe error", err);
    return apiError("Upgrade mislukt", 500);
  }
}
