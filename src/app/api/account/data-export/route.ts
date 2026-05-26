import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api-response";
import { logger } from "@/lib/logger";

// GDPR Art. 20 — Right to Data Portability.
// User can download a ZIP/JSON of all their data.
export async function GET() {
  const user = await getCurrentUser().catch(() => null);
  if (!user) return apiError("Inloggen vereist", 401);

  try {
    const [profile, orders, diagnoses, machines] = await Promise.all([
      prisma.user.findUnique({ where: { id: user.id }, select: { id: true, email: true, name: true, role: true, plan: true, createdAt: true } }),
      prisma.order.findMany({ where: { userId: user.id }, include: { items: true } }).catch(() => []),
      prisma.diagnosis.findMany({ where: { userId: user.id } }).catch(() => []),
      prisma.savedMachine.findMany({ where: { userId: user.id } }).catch(() => []),
    ]);

    const data = {
      exportedAt: new Date().toISOString(),
      userId: user.id,
      profile,
      orders,
      diagnoses,
      savedMachines: machines,
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
