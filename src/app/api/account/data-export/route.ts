import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isDatabaseConfigured } from "@/lib/env";
import { apiError } from "@/lib/api-response";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

// GDPR Art. 20 — Right to Data Portability.
// User can download a JSON of all their data.
export async function GET() {
  const user = await getCurrentUser().catch(() => null);
  if (!user) return apiError("Inloggen vereist", 401);

  try {
    const hasDb = isDatabaseConfigured();
    const [profile, orders, diagnoses, machines, reviews, apiKeys] = hasDb
      ? await Promise.all([
          prisma.user.findUnique({ where: { id: user.id }, select: { id: true, email: true, name: true, role: true, plan: true, createdAt: true } }).catch(() => null),
          prisma.order.findMany({ where: { userId: user.id }, include: { items: true } }).catch(() => []),
          prisma.diagnosis.findMany({ where: { userId: user.id } }).catch(() => []),
          prisma.savedMachine.findMany({ where: { userId: user.id } }).catch(() => []),
          prisma.review.findMany({ where: { email: user.email } }).catch(() => []),
          prisma.apiKey.findMany({ where: { userId: user.id }, select: { id: true, name: true, prefix: true, createdAt: true, lastUsedAt: true, usageCount: true, revokedAt: true } }).catch(() => []),
        ])
      : [null, [], [], [], [], []];

    const data = {
      exportedAt: new Date().toISOString(),
      userId: user.id,
      profile: profile ?? { id: user.id, email: user.email, name: user.name, role: user.role, plan: user.plan },
      orders,
      diagnoses,
      savedMachines: machines,
      reviews,
      apiKeys,
      _notice: "This export contains all personal data WasFix Pro holds about you under AVG Art. 20 (Right to Data Portability). For inquiries: privacy@wasfix.nl.",
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
