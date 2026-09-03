import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isDatabaseConfigured } from "@/lib/env";
import { isDemoMode } from "@/lib/demo-mode";
import { apiError } from "@/lib/api-response";
import { rateLimit, getClientKey } from "@/lib/ratelimit";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

// GDPR Art. 15/20 — Right of Access and Data Portability.
// User can download a JSON of all their data.
export async function GET(req: NextRequest) {
  const user = await getCurrentUser().catch(() => null);
  if (!user) return apiError("Inloggen vereist", 401);

  // This endpoint hands out every personal detail we hold in one response —
  // AVG art. 32 asks us to protect exactly that against a stolen session being
  // milked. A handful per hour is more than a real export ever needs. Keyed on
  // the IP in demo mode: there every visitor resolves to the same shared
  // account, so the per-account bucket would be one site-wide budget and the
  // sixth visitor to press the button would get a 429.
  if (!(await rateLimit(`data-export:${getClientKey(req, isDemoMode() ? undefined : user.id)}`, 5, 60 * 60 * 1000))) {
    return apiError("Te veel exports — probeer over een uur opnieuw.", 429);
  }

  try {
    const hasDb = isDatabaseConfigured();

    // DiagnosisFeedback has no user column: a row points at a diagnosis or at
    // the session it was given in. Only the diagnosis id proves whose row it
    // is — Diagnosis.sessionId comes straight from the request body, so a
    // caller who plants a diagnosis with someone else's session id would have
    // this hand them that person's feedback. The widget always sends the id.
    const diagnoses = hasDb ? await prisma.diagnosis.findMany({ where: { userId: user.id } }).catch(() => []) : [];
    const diagnosisFeedback =
      diagnoses.length > 0
        ? await prisma.diagnosisFeedback
            .findMany({ where: { diagnosisId: { in: diagnoses.map((d) => d.id) } } })
            .catch(() => [])
        : [];

    // Read first: the referral rows are also reachable by the account's code,
    // and the erasure deletes them on exactly that predicate. Exporting less
    // than we erase means the person never saw data we held and acted on.
    const profile = hasDb
      ? await prisma.user
          .findUnique({ where: { id: user.id }, select: { id: true, email: true, name: true, role: true, plan: true, referralCode: true, createdAt: true } })
          .catch(() => null)
      : null;

    // Every model in schema.prisma that holds data about this person: through
    // their account id, or through the e-mail they used on the forms that need
    // no account. An export that misses one is not an art. 15/20 export.
    const [orders, invoices, machines, reviews, apiKeys, rmaRequests, monteurApplications, newsletterSubscriptions, monteurProfile, customers, workOrders, monteurInvoices, monteurInvoiceSequences, referrals] = hasDb
      ? await Promise.all([
          prisma.order.findMany({ where: { userId: user.id }, include: { items: true } }).catch(() => []),
          prisma.invoice.findMany({ where: { order: { userId: user.id } } }).catch(() => []),
          prisma.savedMachine.findMany({ where: { userId: user.id } }).catch(() => []),
          prisma.review.findMany({ where: { email: user.email } }).catch(() => []),
          prisma.apiKey.findMany({ where: { userId: user.id }, select: { id: true, name: true, prefix: true, createdAt: true, lastUsedAt: true, usageCount: true, revokedAt: true } }).catch(() => []),
          prisma.rmaRequest.findMany({ where: { email: user.email } }).catch(() => []),
          prisma.monteurApplication.findMany({ where: { email: user.email } }).catch(() => []),
          prisma.newsletterSubscriber.findMany({ where: { email: user.email } }).catch(() => []),
          prisma.monteurProfile.findUnique({ where: { userId: user.id } }).catch(() => null),
          prisma.customer.findMany({ where: { ownerId: user.id } }).catch(() => []),
          prisma.workOrder.findMany({ where: { ownerId: user.id } }).catch(() => []),
          prisma.monteurInvoice.findMany({ where: { ownerId: user.id } }).catch(() => []),
          prisma.monteurInvoiceSequence.findMany({ where: { ownerId: user.id } }).catch(() => []),
          prisma.referral
            .findMany({ where: profile?.referralCode ? { OR: [{ referrerId: user.id }, { code: profile.referralCode }] } : { referrerId: user.id } })
            .catch(() => []),
        ])
      : [[], [], [], [], [], [], [], [], null, [], [], [], [], []];

    const data = {
      exportedAt: new Date().toISOString(),
      userId: user.id,
      profile: profile ?? { id: user.id, email: user.email, name: user.name, role: user.role, plan: user.plan },
      orders,
      invoices,
      diagnoses,
      diagnosisFeedback,
      savedMachines: machines,
      reviews,
      apiKeys,
      rmaRequests,
      monteurApplications,
      newsletterSubscriptions,
      monteurProfile,
      customers,
      workOrders,
      monteurInvoices,
      monteurInvoiceSequences,
      referrals,
      _notice:
        "This export contains all personal data WasFix Pro holds about you under AVG Art. 15 (Right of Access) and Art. 20 (Right to Data Portability). API key secrets are omitted: they are stored hashed and cannot be recovered. For inquiries: privacy@wasfix.nl.",
    };

    logger.info("[gdpr] data export generated", { userId: user.id });

    return new NextResponse(JSON.stringify(data, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="wasfix-data-export-${user.id}-${Date.now()}.json"`,
      },
    });
  } catch (err) {
    logger.error("[gdpr] data export failed", err);
    return apiError("Export kon niet worden gegenereerd. Mail privacy@wasfix.nl.", 500);
  }
}
