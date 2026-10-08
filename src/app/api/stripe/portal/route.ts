import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { getCurrentUser } from "@/lib/auth";
import { env, isDatabaseConfigured } from "@/lib/env";
import { isDemoMode } from "@/lib/demo-mode";
import { apiError, apiSuccess } from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { notifyError } from "@/lib/notify";

export const maxDuration = 30;

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return apiError("Niet ingelogd", 401);

  const stripe = getStripe();
  if (!stripe) {
    // "Stripe is not configured" is a demo answer. In production it is a
    // misconfiguration, and a paying customer must not be told it is a demo.
    if (isDemoMode()) return apiSuccess({ demo: true, message: "Stripe niet geconfigureerd in demo modus" });
    return apiError("Het klantportaal is tijdelijk niet beschikbaar. Neem contact op via support@wasfix.nl.", 503);
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
    // The usual cause is a portal configuration that was never saved in the
    // Stripe dashboard; checkStripeReadiness() reports that one by name.
    await notifyError(err, { where: "klantportaal" });
    return apiError("Klantportaal kon niet worden geopend", 500);
  }
}
