import { NextRequest } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { apiError, apiSuccess } from "@/lib/api-response";
import { rateLimit, getClientKey } from "@/lib/ratelimit";

const Schema = z.object({
  companyName: z.string().min(2).max(120),
  kvkNumber: z.string().regex(/^\d{8}$/),
  vatNumber: z.string().regex(/^NL\d{9}B\d{2}$/i).optional(),
  email: z.string().email(),
  phone: z.string().regex(/^[+0][\d\s-]{8,16}$/).optional(),
  contactName: z.string().min(2).max(100),
  yearsExperience: z.number().int().min(0).max(60).optional(),
  coverageAreas: z.array(z.string().regex(/^[1-9][0-9]{3}$/)).optional(),
  specializations: z.array(z.string().max(50)).optional(),
  acceptTerms: z.literal(true),
});

export async function POST(req: NextRequest) {
  if (!rateLimit(`monteur-signup:${getClientKey(req)}`, 3, 60 * 60 * 1000)) {
    return apiError("Te veel aanmeldingen — probeer over een uur opnieuw.", 429);
  }

  const body = await req.json().catch(() => null);
  if (!body) return apiError("Ongeldige JSON", 400);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return apiError("Ongeldige aanmeldgegevens", 400, parsed.error.flatten());

  const data = parsed.data;

  // Generate application ID
  const applicationId = `MNT-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  logger.info("[monteur-signup] application received", { applicationId, kvkNumber: data.kvkNumber });

  // Notify admin via Resend
  try {
    const { sendMonteurApplicationNotification } = await import("@/lib/email");
    await sendMonteurApplicationNotification({ applicationId, ...data });
  } catch (err) {
    logger.warn("[monteur-signup] email failed", err);
  }

  return apiSuccess({
    applicationId,
    message: "Aanmelding ontvangen. We reviewen je gegevens binnen 1 werkdag en sturen je toegangsdetails per e-mail.",
  });
}
