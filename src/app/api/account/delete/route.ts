import { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isDatabaseConfigured } from "@/lib/env";
import { isDemoMode } from "@/lib/demo-mode";
import { apiError, apiSuccess } from "@/lib/api-response";
import { rateLimit, getClientKey } from "@/lib/ratelimit";
import { logger } from "@/lib/logger";

const Schema = z.object({
  confirmation: z.literal("VERWIJDER MIJN ACCOUNT"),
  reason: z.string().max(500).optional(),
});

// What replaces free text we cannot keep but whose row must survive.
const REDACTED = "Verwijderd op verzoek (AVG art. 17)";

// GDPR Art. 17 — Right to be Forgotten.
// Erase what has no basis to stay, anonymize the rows the bookkeeping needs,
// and retain only the invoice — art. 35a Wet OB, 7 jaar fiscale bewaarplicht.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser().catch(() => null);
  if (!user) return apiError("Inloggen vereist", 401);

  // Irreversible and it touches every table this account owns; a stolen
  // session should not be able to hammer it.
  if (!(await rateLimit(`account-delete:${getClientKey(req, user.id)}`, 3, 60 * 60 * 1000))) {
    return apiError("Te veel pogingen — probeer over een uur opnieuw.", 429);
  }

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

    // Read before deleting: DiagnosisFeedback has no user column and the
    // referral rows are also reachable by code, so both are unreachable once
    // the diagnoses and the account code are gone.
    const [diagnoses, account] = await Promise.all([
      prisma.diagnosis.findMany({ where: { userId: user.id }, select: { id: true, sessionId: true } }).catch(() => []),
      prisma.user.findUnique({ where: { id: user.id }, select: { referralCode: true } }).catch(() => null),
    ]);

    // Monteur CRM: names, addresses, phone numbers and IBANs of this monteur
    // and of their own customers. None of that has a basis to outlive the
    // account it was collected under, and WasFix is not the bookkeeper of the
    // monteur's own invoice series. Order matters — MonteurInvoice pins its
    // work order with onDelete: Restrict, so the invoices go first.
    await prisma.monteurInvoice.deleteMany({ where: { ownerId: user.id } }).catch((err) => logger.warn("[gdpr] monteur invoices not erased", err));
    await prisma.workOrder.deleteMany({ where: { ownerId: user.id } }).catch((err) => logger.warn("[gdpr] work orders not erased", err));
    await prisma.customer.deleteMany({ where: { ownerId: user.id } }).catch((err) => logger.warn("[gdpr] CRM customers not erased", err));

    // Hard-delete data without legal retention requirements.
    await Promise.all([
      prisma.diagnosisFeedback
        .deleteMany({
          where: {
            OR: [
              { diagnosisId: { in: diagnoses.map((d) => d.id) } },
              { sessionId: { in: diagnoses.map((d) => d.sessionId) } },
            ],
          },
        })
        .catch(() => null),
      prisma.diagnosis.deleteMany({ where: { userId: user.id } }).catch(() => null),
      prisma.savedMachine.deleteMany({ where: { userId: user.id } }).catch(() => null),
      prisma.apiKey.deleteMany({ where: { userId: user.id } }).catch(() => null),
      prisma.monteurProfile.deleteMany({ where: { userId: user.id } }).catch(() => null),
      prisma.monteurApplication.deleteMany({ where: { email: user.email } }).catch(() => null),
      prisma.newsletterSubscriber.deleteMany({ where: { email: user.email } }).catch(() => null),
      prisma.referral
        .deleteMany({ where: account?.referralCode ? { OR: [{ referrerId: user.id }, { code: account.referralCode }] } : { referrerId: user.id } })
        .catch(() => null),
      prisma.review.updateMany({ where: { email: user.email }, data: { email: anonymizedEmail, author: "Anoniem" } }).catch(() => null),
      // The RMA row stays attached to its order for the refund trail, but the
      // reporter's name and their free-text notes are not part of that trail.
      prisma.rmaRequest.updateMany({ where: { email: user.email }, data: { name: "Verwijderd account", email: anonymizedEmail, notes: REDACTED } }).catch(() => null),
      // The order row is the accounting record, so it survives — but the
      // contact details on it are a duplicate. Art. 35a Wet OB wants the
      // buyer's name and address on the *invoice*, and Invoice.buyerJson
      // snapshots exactly that, so the copy on the order can go. vatNumber
      // stays: the VAT return is reconciled against it.
      prisma.order.updateMany({ where: { userId: user.id }, data: { email: anonymizedEmail, shippingAddress: REDACTED } }).catch(() => null),
    ]);

    // Last, so the e-mail-keyed cleanups above still matched the real address.
    // stripeCustomerId goes too: it is a live handle to a Stripe record with
    // this person's name and address on it.
    await prisma.user.update({
      where: { id: user.id },
      data: { email: anonymizedEmail, name: "Verwijderd account", clerkId: null, stripeSubId: null, stripeCustomerId: null, referralCode: null },
    });

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
      message:
        "Account verwijderd. Alles is gewist of geanonimiseerd, op één ding na: " +
        "de facturen van je bestellingen bewaren we 7 jaar (fiscale bewaarplicht) " +
        "en daarop blijven je naam en adres staan, omdat art. 35a Wet OB die op een " +
        "factuur verplicht. De bestellingen zelf zijn losgekoppeld van je e-mailadres " +
        "en bezorgadres.",
    });
  } catch (err) {
    logger.error("[gdpr] account delete failed", err);
    return apiError("Verwijdering mislukt. Mail privacy@wasfix.nl voor handmatige afhandeling.", 500);
  }
}
