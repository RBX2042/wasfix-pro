import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { getCurrentUser } from "@/lib/auth";
import { env, isDatabaseConfigured } from "@/lib/env";
import { apiError, apiSuccess } from "@/lib/api-response";
import { logger } from "@/lib/logger";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return apiError("Niet ingelogd", 401);

  const stripe = getStripe();
  if (!stripe) {
    return apiSuccess({ demo: true, message: "Stripe niet geconfigureerd in demo modus" });
  }
  if (!isDatabaseConfigured()) {
    return apiError("Geen actief abonnement", 400);
  }

  try {
    const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
    if (!dbUser?.stripeCustomerId) {
      return apiError("Geen actief abonnement", 400);
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: dbUser.stripeCustomerId,
      return_url: `${env.APP_URL}/dashboard/profiel`,
    });

    return apiSuccess({ url: session.url });
  } catch (err) {
    logger.error("Stripe portal error", err);
    return apiError("Klantportaal kon niet worden geopend", 500);
  }
}
