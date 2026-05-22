import { DashboardLayout } from "@/components/dashboard-layout";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { redirect } from "next/navigation";
import Link from "next/link";
import { formatEur, formatDate } from "@/lib/utils";
import { Users, Package, TrendingUp, MessageCircle, BookOpen, AlertCircle } from "lucide-react";
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

  const [usersCount, partsCount, ordersCount, diagnosesCount, guidesCount, errorCodesCount, revenue, recentOrders, recentUsers, allOrders, allDiagnoses, allErrorCodes] = await Promise.all([
    prisma.user.count(),
    prisma.part.count(),
    prisma.order.count(),
    prisma.diagnosis.count(),
    prisma.repairGuide.count(),
    prisma.errorCode.count(),
    prisma.order.aggregate({ where: { status: { in: ["PAID", "SHIPPED", "DELIVERED"] } }, _sum: { totalEur: true } }),
    prisma.order.findMany({ take: 5, orderBy: { createdAt: "desc" } }),
    prisma.user.findMany({ take: 5, orderBy: { createdAt: "desc" } }),
    prisma.order.findMany({ where: { status: { in: ["PAID", "SHIPPED", "DELIVERED"] } } }),
    prisma.diagnosis.findMany({ select: { result: true } }),
    prisma.errorCode.findMany({ select: { code: true, severity: true } }),
  ]);

  // Build revenue chart data — group orders by day, last 30 days
  const now = new Date();
  const days: Array<{ date: string; revenue: number; orders: number }> = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    const next = new Date(d); next.setDate(next.getDate() + 1);
    const dayOrders = allOrders.filter(o => o.createdAt >= d && o.createdAt < next);
    days.push({
      date: `${d.getDate()}/${d.getMonth() + 1}`,
      revenue: dayOrders.reduce((s, o) => s + Number(o.totalEur), 0),
      orders: dayOrders.length,
    });
  }

  // Build error-code frequency from diagnoses
  const codeCount: Record<string, { count: number; severity: string }> = {};
  for (const d of allDiagnoses) {
    if (!d.result) continue;
    try {
      const r = typeof d.result === "string" ? JSON.parse(d.result) : (d.result as { errorCode?: string });
      const code = r?.errorCode;
      if (code) {
        const ec = allErrorCodes.find(e => e.code === code);
        if (!codeCount[code]) codeCount[code] = { count: 0, severity: ec?.severity ?? "MEDIUM" };
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard icon={<Users className="h-4 w-4" />} label="Gebruikers" value={usersCount.toString()} />
        <StatCard icon={<Package className="h-4 w-4" />} label="Bestellingen" value={ordersCount.toString()} />
        <StatCard icon={<TrendingUp className="h-4 w-4" />} label="Omzet" value={formatEur(revenue._sum.totalEur ?? 0)} />
        <StatCard icon={<MessageCircle className="h-4 w-4" />} label="Diagnoses" value={diagnosesCount.toString()} />
      </div>

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
            <p className="text-xs text-muted-foreground mb-3">Meest gediagnosticeerde codes (gekleurd op severity)</p>
            {topCodes.length > 0 ? (
              <ErrorCodeFrequency data={topCodes} />
            ) : (
              <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">
                Nog geen diagnoses geregistreerd
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

function ManageCard({ icon, title, count, href }: { icon: React.ReactNode; title: string; count: number; href: string }) {
  return (
    <Link href={href}>
      <Card className="hover:border-primary transition-colors h-full">
        <CardContent className="p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center text-primary">{icon}</div>
            <div>
              <h3 className="font-heading font-semibold">{title}</h3>
              <p className="text-sm text-muted-foreground">{count} items beheren</p>
            </div>
          </div>
          <p className="text-xs text-primary mt-2">Beheren →</p>
        </CardContent>
      </Card>
    </Link>
  );
}
