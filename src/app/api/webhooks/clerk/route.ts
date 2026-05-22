import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

/**
 * Clerk webhook receiver. Configure in Clerk dashboard → Webhooks
 * Events: user.created, user.updated, user.deleted
 *
 * Note: production should verify the Svix signature header. For demo we accept all.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const type: string = body?.type ?? "";
    const data = body?.data ?? {};

    const clerkId: string | undefined = data.id;
    const email: string | undefined = data.email_addresses?.[0]?.email_address;
    const firstName = data.first_name ?? "";
    const lastName = data.last_name ?? "";
    const name = `${firstName} ${lastName}`.trim() || null;

    if (!clerkId) {
      return NextResponse.json({ error: "Missing user id" }, { status: 400 });
    }

    switch (type) {
      case "user.created":
      case "user.updated":
        if (!email) break;
        await prisma.user.upsert({
          where: { clerkId },
          update: { email, name },
          create: { clerkId, email, name, role: "CONSUMER", plan: "FREE" },
        });
        break;

      case "user.deleted":
        await prisma.user
          .delete({ where: { clerkId } })
          .catch(() => null);
        break;

      default:
        break;
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    logger.error("Clerk webhook error", err);
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }
}
