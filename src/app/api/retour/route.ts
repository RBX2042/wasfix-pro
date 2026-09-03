import { NextRequest } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { apiError, apiSuccess } from "@/lib/api-response";
import { rateLimit, getClientKey } from "@/lib/ratelimit";
import { prisma } from "@/lib/prisma";
import { isDatabaseConfigured } from "@/lib/env";

const Schema = z.object({
  orderId: z.string().min(2).max(60),
  name: z.string().min(2).max(100),
  email: z.string().email(),
  reason: z.enum(["DEFECT", "WRONG_PART", "WRONG_ORDER", "WITHDRAWAL", "OTHER"]),
  notes: z.string().min(8).max(2000),
});

const REASON_LABEL: Record<string, string> = {
  DEFECT: "Defect of beschadigd",
  WRONG_PART: "Verkeerd onderdeel",
  WRONG_ORDER: "Verkeerd besteld",
  WITHDRAWAL: "Bedenktijd (herroeping)",
  OTHER: "Anders",
};

export async function POST(req: NextRequest) {
  try {
    // Rate limit: 5 per hour per IP (anti-spam)
    if (!(await rateLimit(`retour:${getClientKey(req)}`, 5, 60 * 60 * 1000))) {
      return apiError("Te veel aanvragen — probeer over een uur opnieuw.", 429);
    }

    const body = await req.json().catch(() => null);
    if (!body) return apiError("Ongeldige JSON", 400);

    const parsed = Schema.safeParse(body);
    if (!parsed.success) {
      return apiError("Ongeldige gegevens", 400, parsed.error.flatten());
    }
    const { orderId, name, email, reason, notes } = parsed.data;

    // Generate a deterministic RMA number
    const rmaNumber = `RMA-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    logger.info("RMA request received", { rmaNumber, orderId, reason });

    if (isDatabaseConfigured()) {
      // Never answer "received" for an RMA that exists nowhere: the customer
      // stops chasing it while their statutory 14-day withdrawal window runs out
      // against a request that was never recorded. A failed write gets a 503 so
      // they can try again.
      try {
        await prisma.rmaRequest.create({ data: { rmaNumber, orderId, name, email, reason, notes } });
      } catch (err) {
        logger.error("RMA persist failed", err);
        return apiError(
          "Je retour-aanvraag kon nu niet worden opgeslagen. Probeer het over een paar minuten opnieuw of mail retour@wasfix.nl.",
          503,
        );
      }
    }

    // Send notification email via Resend (graceful fallback)
    try {
      const { sendRmaNotification } = await import("@/lib/email");
      await sendRmaNotification({
        rmaNumber,
        orderId,
        name,
        email,
        reason: REASON_LABEL[reason],
        notes,
      });
    } catch (mailErr) {
      logger.warn("RMA notification email failed (Resend not configured?)", mailErr);
    }

    return apiSuccess({
      rmaNumber,
      message: "Je retour-aanvraag is ontvangen. We sturen je instructies per e-mail.",
    });
  } catch (err) {
    logger.error("RMA endpoint error", err);
    return apiError("Aanvraag kon niet worden verwerkt", 500);
  }
}
