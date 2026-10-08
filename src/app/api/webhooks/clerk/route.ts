import { NextRequest, NextResponse } from "next/server";
import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { prisma } from "@/lib/prisma";
import { env, isDatabaseConfigured } from "@/lib/env";
import { logger } from "@/lib/logger";
import { identityFromClerkPayload, normalizeEmail, syncSignedInUser, type ClerkWebhookUser } from "@/lib/auth";
import { endStripeSubscription, getStripe, scrubStripeCustomer } from "@/lib/stripe";
import { notifyOwner } from "@/lib/notify";

export const runtime = "nodejs";

type ClerkUserPayload = ClerkWebhookUser;

/**
 * Clerk webhook receiver. Configure in Clerk dashboard → Webhooks → endpoint
 * https://wasfix.nl/api/webhooks/clerk with events user.created, user.updated,
 * user.deleted. Set CLERK_WEBHOOK_SECRET (Svix signing secret, whsec_…).
 *
 * The Svix signature is always verified: an unsigned payload is a stranger
 * telling us to delete a user, and user.deleted wipes diagnoses, saved machines
 * and API keys. Accepting one because NODE_ENV happened not to be "production"
 * handed that to anyone who could reach a preview or staging deploy.
 * CLERK_WEBHOOK_ALLOW_UNSIGNED=true opts a local machine out; it is refused on
 * a production build so setting it on a deployed environment changes nothing.
 */
export async function POST(req: NextRequest) {
  let type = "";
  let data: ClerkUserPayload = {};

  const secret = env.CLERK_WEBHOOK_SECRET;
  const allowUnsigned = process.env.CLERK_WEBHOOK_ALLOW_UNSIGNED === "true" && !env.IS_PRODUCTION;
  if (secret) {
    try {
      const evt = await verifyWebhook(req, { signingSecret: secret });
      type = evt.type;
      data = evt.data as ClerkUserPayload;
    } catch (err) {
      logger.warn("Clerk webhook signature invalid", err);
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }
  } else if (allowUnsigned) {
    logger.warn("Clerk webhook accepted UNSIGNED — CLERK_WEBHOOK_ALLOW_UNSIGNED is set");
    const body = await req.json().catch(() => null);
    type = body?.type ?? "";
    data = body?.data ?? {};
  } else {
    logger.error("Clerk webhook received but CLERK_WEBHOOK_SECRET is not set");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }

  const clerkId = data.id;
  if (!clerkId) {
    return NextResponse.json({ error: "Missing user id" }, { status: 400 });
  }

  if (!isDatabaseConfigured()) {
    // Nothing to sync into — acknowledge so Clerk doesn't retry forever.
    return NextResponse.json({ received: true, persisted: false });
  }

  const identity = identityFromClerkPayload(data);
  const email = identity?.email ?? undefined;
  const name = identity?.name ?? null;

  try {
    switch (type) {
      case "user.created":
      case "user.updated": {
        if (!email) break;
        // The same rules as a sign-in (src/lib/auth.ts syncSignedInUser): an address
        // Clerk has not verified neither claims an existing row nor is stored, and a
        // verified address listed in ADMIN_EMAILS is promoted. Duplicated rules here
        // are how a webhook ends up claiming what a sign-in refuses to.
        const before = await prisma.user.findUnique({ where: { clerkId }, select: { id: true } });
        // identityFromClerkPayload applies the sign-in's definition of verified (primary address only).
        const row = await syncSignedInUser(identity!);
        if (type === "user.created" && !before && identity!.emailVerified) {
          const { sendWelcomeEmail } = await import("@/lib/email");
          await sendWelcomeEmail(normalizeEmail(email), name ?? email).catch((e) => logger.warn("Welcome email failed", e));
        }
        logger.info("[clerk] user synced", { userId: row.id, event: type });
        break;
      }

      case "user.deleted": {
        // GDPR: anonymise instead of hard-delete so order history (7y fiscal
        // retention) stays intact.
        const existing = await prisma.user.findUnique({ where: { clerkId } });
        if (existing) {
          const anonymisedEmail = `deleted-${existing.id}@anon.wasfix.nl`;

          // Stripe FIRST, while the row still knows the ids: once they are nulled
          // nobody can cancel the subscription, and the card of a person who erased
          // their account would keep being charged.
          let stripeFailed = false;
          if (existing.stripeSubId || existing.stripeCustomerId) {
            const stripe = getStripe();
            if (!stripe) {
              stripeFailed = true;
              logger.error("[clerk] user.deleted: account has Stripe data but Stripe is not configured", { userId: existing.id });
            } else {
              if (existing.stripeSubId) {
                try {
                  await endStripeSubscription(stripe, existing.stripeSubId, `clerk-erase-${existing.id}-${existing.stripeSubId}`);
                } catch (err) {
                  stripeFailed = true;
                  logger.error("[clerk] user.deleted: Stripe subscription could not be cancelled", { userId: existing.id, err: err instanceof Error ? err.message : String(err) });
                }
              }
              if (existing.stripeCustomerId) {
                try {
                  await scrubStripeCustomer(stripe, existing.stripeCustomerId, anonymisedEmail);
                } catch (err) {
                  stripeFailed = true;
                  logger.error("[clerk] user.deleted: Stripe customer could not be anonymised", { userId: existing.id, err: err instanceof Error ? err.message : String(err) });
                }
              }
            }
            if (stripeFailed) {
              await notifyOwner({
                event: "clerk.erase_stripe_failed",
                level: "error",
                title: "Verwijderde klant: Stripe handmatig afronden",
                lines: [
                  `Gebruiker ${existing.id} is in Clerk verwijderd, maar het abonnement of de klantgegevens bij Stripe konden niet worden opgezegd of geanonimiseerd.`,
                  "Zeg het abonnement op en anonimiseer de klant in het Stripe-dashboard. De koppeling (abonnement- en klant-id) blijft op het account staan zodat je weet welke.",
                ],
              });
            }
          }

          await prisma.user.update({
            where: { id: existing.id },
            data: {
              clerkId: null,
              email: anonymisedEmail,
              name: "Verwijderd account",
              // The plan must not outlive the person. The Stripe ids stay only when
              // the Stripe step failed, as the handle for finishing it by hand.
              plan: "FREE",
              stripeSubStatus: null,
              stripeCurrentPeriodEnd: null,
              stripeCancelAtPeriodEnd: false,
              ...(stripeFailed ? {} : { stripeSubId: null, stripeCustomerId: null }),
            },
          });
          await prisma.diagnosis.deleteMany({ where: { userId: existing.id } }).catch(() => null);
          await prisma.savedMachine.deleteMany({ where: { userId: existing.id } }).catch(() => null);
          await prisma.apiKey.deleteMany({ where: { userId: existing.id } }).catch(() => null);
        }
        break;
      }

      default:
        break;
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    logger.error("Clerk webhook error", err);
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }
}
