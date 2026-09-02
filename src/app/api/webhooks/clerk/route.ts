import { NextRequest, NextResponse } from "next/server";
import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { prisma } from "@/lib/prisma";
import { env, isDatabaseConfigured } from "@/lib/env";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

type ClerkUserPayload = {
  id?: string;
  email_addresses?: Array<{ id: string; email_address: string }>;
  primary_email_address_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
};

/**
 * Clerk webhook receiver. Configure in Clerk dashboard → Webhooks → endpoint
 * https://wasfix.nl/api/webhooks/clerk with events user.created, user.updated,
 * user.deleted. Set CLERK_WEBHOOK_SECRET (Svix signing secret, whsec_…).
 *
 * The Svix signature is verified whenever a secret is configured; without it
 * (local demo) the payload is accepted only in non-production.
 */
export async function POST(req: NextRequest) {
  let type = "";
  let data: ClerkUserPayload = {};

  const secret = env.CLERK_WEBHOOK_SECRET;
  if (secret) {
    try {
      const evt = await verifyWebhook(req, { signingSecret: secret });
      type = evt.type;
      data = evt.data as ClerkUserPayload;
    } catch (err) {
      logger.warn("Clerk webhook signature invalid", err);
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }
  } else if (env.IS_PRODUCTION) {
    logger.error("Clerk webhook received but CLERK_WEBHOOK_SECRET is not set");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  } else {
    const body = await req.json().catch(() => null);
    type = body?.type ?? "";
    data = body?.data ?? {};
  }

  const clerkId = data.id;
  if (!clerkId) {
    return NextResponse.json({ error: "Missing user id" }, { status: 400 });
  }

  if (!isDatabaseConfigured()) {
    // Nothing to sync into — acknowledge so Clerk doesn't retry forever.
    return NextResponse.json({ received: true, persisted: false });
  }

  const primary = data.email_addresses?.find((e) => e.id === data.primary_email_address_id) ?? data.email_addresses?.[0];
  const email = primary?.email_address;
  const name = `${data.first_name ?? ""} ${data.last_name ?? ""}`.trim() || null;

  try {
    switch (type) {
      case "user.created":
      case "user.updated": {
        if (!email) break;
        const byClerk = await prisma.user.findUnique({ where: { clerkId } });
        if (byClerk) {
          await prisma.user.update({ where: { id: byClerk.id }, data: { email, name } });
        } else {
          const byEmail = await prisma.user.findUnique({ where: { email } });
          if (byEmail) {
            await prisma.user.update({ where: { id: byEmail.id }, data: { clerkId, name: name ?? byEmail.name } });
          } else {
            await prisma.user.create({ data: { clerkId, email, name, role: "CONSUMER", plan: "FREE" } });
            if (type === "user.created") {
              const { sendWelcomeEmail } = await import("@/lib/email");
              await sendWelcomeEmail(email, name ?? email).catch((e) => logger.warn("Welcome email failed", e));
            }
          }
        }
        break;
      }

      case "user.deleted": {
        // GDPR: anonymise instead of hard-delete so order history (7y fiscal
        // retention) stays intact.
        const existing = await prisma.user.findUnique({ where: { clerkId } });
        if (existing) {
          await prisma.user.update({
            where: { id: existing.id },
            data: { clerkId: null, email: `deleted-${existing.id.slice(0, 8)}@anon.wasfix.nl`, name: "Verwijderd account" },
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
