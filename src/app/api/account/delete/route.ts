import { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isDatabaseConfigured } from "@/lib/env";
import { isDemoMode } from "@/lib/demo-mode";
import { apiError, apiSuccess } from "@/lib/api-response";
import { logger } from "@/lib/logger";

const Schema = z.object({
  confirmation: z.literal("VERWIJDER MIJN ACCOUNT"),
  reason: z.string().max(500).optional(),
});

// GDPR Art. 17 — Right to be Forgotten.
// Soft-delete: anonymize PII, keep orders for legal retention (7 years).
export async function POST(req: NextRequest) {
  const user = await getCurrentUser().catch(() => null);
  if (!user) return apiError("Inloggen vereist", 401);

  const body = await req.json().catch(() => null);
  if (!body) return apiError("Ongeldige JSON", 400);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return apiError("Bevestiging-zin klopt niet", 400);

  if (isDemoMode()) {
    // The shared demo account can't be erased — that would break the demo for everyone.
    return apiSuccess({ demo: true, message: "In demo-modus wordt het gedeelde demo-account niet verwijderd." });
  }
  if (!isDatabaseConfigured()) {
    return apiSuccess({ message: "Er zijn geen opgeslagen gegevens om te verwijderen." });
  }

  try {
    const anonymizedEmail = `deleted-${user.id.slice(0, 8)}@anon.wasfix.nl`;
    await prisma.user.update({
      where: { id: user.id },
      data: { email: anonymizedEmail, name: "Verwijderd account", clerkId: null, stripeSubId: null },
    });

    // Hard-delete data without legal retention requirements.
    await Promise.all([
      prisma.diagnosis.deleteMany({ where: { userId: user.id } }).catch(() => null),
      prisma.savedMachine.deleteMany({ where: { userId: user.id } }).catch(() => null),
      prisma.apiKey.deleteMany({ where: { userId: user.id } }).catch(() => null),
      prisma.review.updateMany({ where: { email: user.email }, data: { email: anonymizedEmail, author: "Anoniem" } }).catch(() => null),
    ]);

    // Remove the Clerk identity too so the login stops working.
    try {
      const { clerkClient, auth } = await import("@clerk/nextjs/server");
      const { userId: clerkId } = await auth();
      if (clerkId) await (await clerkClient()).users.deleteUser(clerkId);
    } catch (err) {
      logger.warn("[gdpr] Clerk user delete failed (continuing)", err);
    }

    logger.info("[gdpr] account erased", { userId: user.id, reason: parsed.data.reason });

    return apiSuccess({
      message: "Account verwijderd. Bestelhistorie blijft 7 jaar (fiscaal verplicht), maar persoonsgegevens zijn geanonimiseerd.",
    });
  } catch (err) {
    logger.error("[gdpr] account delete failed", err);
    return apiError("Verwijdering mislukt. Mail privacy@wasfix.nl voor handmatige afhandeling.", 500);
  }
}
