import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isDatabaseConfigured } from "@/lib/env";
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
  // milked. A handful per hour is more than a real export ever needs.
  if (!(await rateLimit(`data-export:${getClientKey(req, user.id)}`, 5, 60 * 60 * 1000))) {
    return apiError("Te veel exports — probeer over een uur opnieuw.", 429);
  }

  try {
    const hasDb = isDatabaseConfigured();

    // DiagnosisFeedback has no user column: a row points at a diagnosis or at
    // the session it was given in, so it is only reachable via the diagnoses.
    const diagnoses = hasDb ? await prisma.diagnosis.findMany({ where: { userId: user.id } }).catch(() => []) : [];
    const diagnosisFeedback =
      diagnoses.length > 0
        ? await prisma.diagnosisFeedback
            .findMany({
              where: {
                OR: [
                  { diagnosisId: { in: diagnoses.map((d) => d.id) } },
                  { sessionId: { in: diagnoses.map((d) => d.sessionId) } },
                ],
              },
            })
            .catch(() => [])
        : [];

    // Every model in schema.prisma that holds data about this person: through
    // their account id, or through the e-mail they used on the forms that need
    // no account. An export that misses one is not an art. 15/20 export.
    const [profile, orders, invoices, machines, reviews, apiKeys, rmaRequests, monteurApplications, newsletterSubscriptions, monteurProfile, customers, workOrders, monteurInvoices, referrals] = hasDb
      ? await Promise.all([
          prisma.user.findUnique({ where: { id: user.id }, select: { id: true, email: true, name: true, role: true, plan: true, referralCode: true, createdAt: true } }).catch(() => null),
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
          prisma.referral.findMany({ where: { referrerId: user.id } }).catch(() => []),
        ])
      : [null, [], [], [], [], [], [], [], [], null, [], [], [], []];

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
