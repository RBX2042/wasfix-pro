import { DashboardLayout } from "@/components/dashboard-layout";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { redirect } from "next/navigation";
import Link from "next/link";
import { formatEur, formatDate } from "@/lib/utils";
import { Users, Package, TrendingUp, MessageCircle, BookOpen, AlertCircle, Inbox, BarChart3, Landmark } from "lucide-react";
import RevenueChart from "@/components/charts/RevenueChart";
import ErrorCodeFrequency from "@/components/charts/ErrorCodeFrequency";

export const dynamic = "force-dynamic";


export const metadata = { title: "Admin dashboard" };

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/inloggen");
  if (user.role !== "ADMIN") {
    return (
      <DashboardLayout role={user.role}>
        <Card>
          <CardContent className="p-12 text-center">
            <p className="text-muted-foreground">Geen toegang. Alleen admins.</p>
          </CardContent>
        </Card>
      </DashboardLayout>
    );
  }

  const PAID_STATUSES = ["PAID", "SHIPPED", "DELIVERED"];

  // Every query on this page is bounded. The previous version pulled every paid
  // order and every diagnosis ever written just to add them up in JS — at 100k
  // diagnoses a full scan with a JSON.parse per row, on every load of a
  // force-dynamic page. Postgres does the summing now; only what genuinely needs
  // a row-by-row pass (the charts) is fetched, and only within a window.
  const now = new Date();
  const chartStart = new Date(now);
  chartStart.setDate(chartStart.getDate() - 29);
  chartStart.setHours(0, 0, 0, 0);

  // Diagnosis.result is JSON inside a string column, so errorCode cannot be
  // grouped in SQL. Hence a window plus a hard cap instead of the whole table.
  const DIAGNOSIS_WINDOW_DAYS = 90;
  const DIAGNOSIS_SAMPLE = 2000;
  const diagnosisSince = new Date(now);
  diagnosisSince.setDate(diagnosisSince.getDate() - DIAGNOSIS_WINDOW_DAYS);

  let usersCount = 0, partsCount = 20, ordersCount = 0, diagnosesCount = 0, guidesCount = 6, errorCodesCount = 26;
  let revenue: { _sum: { totalEur: number | null; vatEur: number | null; costEur: number | null } } = { _sum: { totalEur: 0, vatEur: 0, costEur: 0 } };
  let costedRevenue: { _sum: { totalEur: number | null; vatEur: number | null }; _count: number } = { _sum: { totalEur: 0, vatEur: 0 }, _count: 0 };
  let paidOrdersCount = 0;
  let recentOrders: Awaited<ReturnType<typeof prisma.order.findMany>> = [];
  let recentUsers: Awaited<ReturnType<typeof prisma.user.findMany>> = [];
  let chartOrders: Array<{ createdAt: Date; totalEur: number }> = [];
  let recentDiagnoses: Array<{ result: string | null }> = [];
  let allErrorCodes: Array<{ code: string; severity: string }> = [];
  let dbError = false;
  try {
    [usersCount, partsCount, ordersCount, diagnosesCount, guidesCount, errorCodesCount, revenue, costedRevenue, paidOrdersCount, recentOrders, recentUsers, chartOrders, recentDiagnoses, allErrorCodes] = await Promise.all([
      prisma.user.count(),
      prisma.part.count(),
      prisma.order.count(),
      prisma.diagnosis.count(),
      prisma.repairGuide.count(),
      prisma.errorCode.count(),
      prisma.order.aggregate({ where: { status: { in: PAID_STATUSES } }, _sum: { totalEur: true, vatEur: true, costEur: true } }),
      // Only orders with a cost price count towards the margin; Postgres sums
      // that subset instead of a filter() over the whole table.
      prisma.order.aggregate({ where: { status: { in: PAID_STATUSES }, costEur: { not: null } }, _sum: { totalEur: true, vatEur: true }, _count: true }),
      prisma.order.count({ where: { status: { in: PAID_STATUSES } } }),
      prisma.order.findMany({ take: 5, orderBy: { createdAt: "desc" } }),
      prisma.user.findMany({ take: 5, orderBy: { createdAt: "desc" } }),
      prisma.order.findMany({
        where: { status: { in: PAID_STATUSES }, createdAt: { gte: chartStart } },
        select: { createdAt: true, totalEur: true },
      }),
      prisma.diagnosis.findMany({
        where: { createdAt: { gte: diagnosisSince }, result: { not: null } },
        select: { result: true },
        orderBy: { createdAt: "desc" },
        take: DIAGNOSIS_SAMPLE,
      }),
      prisma.errorCode.findMany({ select: { code: true, severity: true } }),
    ]);
  } catch {
    // DB unreachable. Catalog counts come from the static source, but revenue,
    // orders and users stay 0 — without a warning that reads as "nothing sold"
    // rather than "we don't know". Hence the banner.
    dbError = true;
    const { staticStats } = await import("@/lib/static-db");
    const s = staticStats();
    partsCount = s.partsCount;
    guidesCount = s.guidesCount;
    errorCodesCount = s.errorCodesCount;
  }

  // Turnover is not profit. Net revenue strips the btw we merely collect for
  // the tax office, and gross margin subtracts what the parts cost us. An
  // order whose parts have no cost price is excluded from the margin figure
  // rather than silently counted as pure profit.
  const grossTurnover = revenue._sum.totalEur ?? 0;
  const vatCollected = revenue._sum.vatEur ?? 0;
  const netRevenue = grossTurnover - vatCollected;
  const costOfGoods = revenue._sum.costEur ?? 0;
  const ordersWithCostCount = costedRevenue._count;
  const netRevenueWithCost = (costedRevenue._sum.totalEur ?? 0) - (costedRevenue._sum.vatEur ?? 0);
  const grossMargin = netRevenueWithCost - costOfGoods;
  const marginPct = netRevenueWithCost > 0 ? (grossMargin / netRevenueWithCost) * 100 : 0;
  const marginCoverage = paidOrdersCount > 0 ? (ordersWithCostCount / paidOrdersCount) * 100 : 100;

  // Build revenue chart data — group orders by day, last 30 days
  const days: Array<{ date: string; revenue: number; orders: number }> = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    const next = new Date(d); next.setDate(next.getDate() + 1);
    const dayOrders = chartOrders.filter(o => o.createdAt >= d && o.createdAt < next);
    days.push({
      date: `${d.getDate()}/${d.getMonth() + 1}`,
      revenue: dayOrders.reduce((s, o) => s + Number(o.totalEur), 0),
      orders: dayOrders.length,
    });
  }

  // Build error-code frequency from diagnoses
  const severityByCode = new Map(allErrorCodes.map((e) => [e.code, e.severity]));
  const codeCount: Record<string, { count: number; severity: string }> = {};
  for (const d of recentDiagnoses) {
    if (!d.result) continue;
    try {
      const r = typeof d.result === "string" ? JSON.parse(d.result) : (d.result as { errorCode?: string });
      const code = r?.errorCode;
      if (code) {
        if (!codeCount[code]) codeCount[code] = { count: 0, severity: severityByCode.get(code) ?? "MEDIUM" };
        codeCount[code].count++;
      }
    } catch {}
  }
  const topCodes = Object.entries(codeCount)
    .map(([code, v]) => ({ code, count: v.count, severity: v.severity }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return (
    <DashboardLayout role={user.role}>
      <div className="mb-6">
        <Badge variant="danger" className="mb-2">ADMIN</Badge>
        <h1 className="font-heading text-2xl font-bold">Admin Dashboard</h1>
        <p className="text-muted-foreground text-sm">Volledige controle over content en gebruikers</p>
      </div>

      {dbError && (
        <Card className="mb-6 border-destructive/40 bg-destructive/5">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold">Database onbereikbaar — cijfers hieronder zijn niet actueel</p>
              <p className="text-muted-foreground">
                Omzet, bestellingen, gebruikers en diagnoses staan op 0 omdat ze niet opgehaald konden
                worden, niet omdat ze 0 zijn. Alleen de catalogusaantallen komen uit de statische bron.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard icon={<Users className="h-4 w-4" />} label="Gebruikers" value={usersCount.toString()} />
        <StatCard icon={<Package className="h-4 w-4" />} label="Bestellingen" value={ordersCount.toString()} />
        <StatCard icon={<TrendingUp className="h-4 w-4" />} label="Omzet incl. btw" value={formatEur(grossTurnover)} />
        <StatCard icon={<MessageCircle className="h-4 w-4" />} label="Diagnoses" value={diagnosesCount.toString()} />
      </div>

      <Card className="mb-8">
        <CardContent className="p-6">
          <h2 className="font-heading text-lg font-semibold mb-1">Wat verdienen we hieraan?</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Omzet is geen winst. De btw dragen we af, de inkoop is al betaald.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MoneyStat label="Netto omzet" value={formatEur(netRevenue)} hint="excl. btw" />
            <MoneyStat label="Af te dragen btw" value={formatEur(vatCollected)} hint="niet van ons" />
            <MoneyStat label="Inkoopwaarde" value={formatEur(costOfGoods)} hint="kostprijs verkochte onderdelen" />
            <MoneyStat
              label="Brutomarge"
              value={formatEur(grossMargin)}
              hint={netRevenueWithCost > 0 ? `${marginPct.toFixed(1)}% van netto omzet` : "nog geen betaalde orders"}
              accent
            />
          </div>
          {marginCoverage < 100 && (
            <p className="text-xs text-amber-600 mt-4">
              Let op: {(100 - marginCoverage).toFixed(0)}% van de bestellingen bevat onderdelen zonder kostprijs.
              Die orders tellen niet mee in de marge. Vul de inkoopprijs aan bij{" "}
              <Link href="/admin/onderdelen" className="underline">onderdelen</Link>.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-3 gap-4 mb-8">
        <ManageCard
          icon={<Package className="h-5 w-5" />}
          title="Onderdelen"
          count={partsCount}
          href="/admin/onderdelen"
        />
        <ManageCard
          icon={<BookOpen className="h-5 w-5" />}
          title="Reparatiegidsen"
          count={guidesCount}
          href="/admin/gidsen"
        />
        <ManageCard
          icon={<AlertCircle className="h-5 w-5" />}
          title="Foutcodes"
          count={errorCodesCount}
          href="/admin/foutcodes"
        />
        <ManageCard
          icon={<Inbox className="h-5 w-5" />}
          title="Aanvragen & reviews"
                    href="/admin/aanvragen"
        />
        <ManageCard
          icon={<Landmark className="h-5 w-5" />}
          title="Bestellingen & facturen"
          href="/admin/bestellingen"
        />
        <ManageCard
          icon={<Users className="h-5 w-5" />}
          title="Gebruikers"
          count={usersCount}
          href="/admin/gebruikers"
        />
        <ManageCard
          icon={<BarChart3 className="h-5 w-5" />}
          title="Analytics"
          href="/admin/analytics"
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-6 mb-8">
        <Card>
          <CardContent className="p-6">
            <h2 className="font-heading text-lg font-semibold mb-1">Omzet (30 dagen)</h2>
            <p className="text-xs text-muted-foreground mb-3">Dagelijkse omzet en aantal bestellingen</p>
            <RevenueChart data={days} />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <h2 className="font-heading text-lg font-semibold mb-1">Top foutcodes</h2>
            <p className="text-xs text-muted-foreground mb-3">
              Meest gediagnosticeerde codes, laatste {DIAGNOSIS_WINDOW_DAYS} dagen
              (max {DIAGNOSIS_SAMPLE} diagnoses, gekleurd op severity)
            </p>
            {topCodes.length > 0 ? (
              <ErrorCodeFrequency data={topCodes} />
            ) : (
              <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">
                Geen diagnoses in de laatste {DIAGNOSIS_WINDOW_DAYS} dagen
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardContent className="p-6">
            <h2 className="font-heading text-lg font-semibold mb-4">Recente bestellingen</h2>
            <div className="space-y-2">
              {recentOrders.map((o) => (
                <Link key={o.id} href={`/bestelling/${o.id}`}>
                  <div className="flex items-center justify-between p-3 rounded-md border hover:border-primary transition-colors">
                    <div>
                      <p className="font-mono text-sm">#{o.id.slice(0, 8).toUpperCase()}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(o.createdAt)}</p>
                    </div>
                    <div className="text-right">
                      <span className="font-bold">{formatEur(o.totalEur)}</span>
                      <Badge variant="outline" className="ml-2">{o.status}</Badge>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <h2 className="font-heading text-lg font-semibold mb-4">Recente gebruikers</h2>
            <div className="space-y-2">
              {recentUsers.map((u) => (
                <div key={u.id} className="flex items-center justify-between p-3 rounded-md border">
                  <div>
                    <p className="font-medium text-sm">{u.name ?? u.email}</p>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                  </div>
                  <Badge variant="outline">{u.plan}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

function MoneyStat({ label, value, hint, accent }: { label: string; value: string; hint: string; accent?: boolean }) {
  return (
    <div className={`rounded-md border p-4 ${accent ? "border-primary/40 bg-primary/5" : ""}`}>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-heading text-xl font-bold mt-1 tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">{icon} {label}</div>
        <p className="font-heading text-2xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}

function ManageCard({ icon, title, count, href }: { icon: React.ReactNode; title: string; count?: number; href: string }) {
  return (
    <Link href={href}>
      <Card className="hover:border-primary transition-colors h-full">
        <CardContent className="p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center text-primary">{icon}</div>
            <div>
              <h3 className="font-heading font-semibold">{title}</h3>
              <p className="text-sm text-muted-foreground">{count !== undefined ? `${count} items beheren` : "Openen"}</p>
            </div>
          </div>
          <p className="text-xs text-primary mt-2">Beheren →</p>
        </CardContent>
      </Card>
    </Link>
  );
}
