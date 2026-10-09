import { DashboardLayout } from "@/components/dashboard-layout";
import { getCurrentUser } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { AdminShell } from "../_lib/page-shell";
import { AdminNav } from "../_lib/admin-nav";
import { AnalyticsDashboard, type Period, type PeriodCounts, type TopCode } from "./client";

export const metadata = { title: "Analytics dashboard · WasFix Admin", robots: "noindex" };
export const dynamic = "force-dynamic";

const PERIOD_DAYS: Record<Period, number> = { "24h": 1, "7d": 7, "30d": 30, "90d": 90 };
const PAID = ["PAID", "SHIPPED", "DELIVERED"];

export default async function AdminAnalyticsPage() {
  // Auth guard. This page reads orders and users, so BUSINESS-plan users do not get in (they used to).
  const user = await getCurrentUser().catch(() => null);
  if (!user) redirect("/inloggen?next=/admin/analytics");
  if (user.role !== "ADMIN") redirect("/");

  const hasDb = isDatabaseConfigured();
  const empty: PeriodCounts = { diagnoses: 0, ordersPlaced: 0, ordersPaid: 0, newUsers: 0 };
  const counts: Record<Period, PeriodCounts> = { "24h": empty, "7d": empty, "30d": empty, "90d": empty };
  let topCodes: TopCode[] = [];
  let ok = hasDb;
  if (hasDb) {
    try {
      const now = Date.now();
      for (const p of Object.keys(PERIOD_DAYS) as Period[]) {
        const since = new Date(now - PERIOD_DAYS[p] * 86_400_000);
        const [diagnoses, ordersPlaced, ordersPaid, newUsers] = await Promise.all([
          prisma.diagnosis.count({ where: { createdAt: { gte: since } } }),
          prisma.order.count({ where: { createdAt: { gte: since } } }),
          prisma.order.count({ where: { createdAt: { gte: since }, status: { in: PAID } } }),
          prisma.user.count({ where: { createdAt: { gte: since } } }),
        ]);
        counts[p] = { diagnoses, ordersPlaced, ordersPaid, newUsers };
      }
      const recent = await prisma.diagnosis.findMany({
        where: { createdAt: { gte: new Date(now - 90 * 86_400_000) }, result: { not: null } },
        select: { result: true },
        orderBy: { createdAt: "desc" },
        take: 2000,
      });
      const tally = new Map<string, number>();
      for (const d of recent) {
        try {
          const code = (JSON.parse(d.result as string) as { errorCode?: string })?.errorCode;
          if (code) tally.set(code, (tally.get(code) ?? 0) + 1);
        } catch {
          /* a row that is not JSON is skipped */
        }
      }
      topCodes = [...tally.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count).slice(0, 10);
    } catch {
      ok = false;
    }
  }

  return (
    <DashboardLayout role={user.role}>
      <AdminShell>
      <AdminNav current="/admin/analytics" />
      <AnalyticsDashboard counts={counts} topCodes={topCodes} hasDb={ok} />
    </AdminShell>
    </DashboardLayout>
  );
}
