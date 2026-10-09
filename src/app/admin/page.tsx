import { DashboardLayout } from "@/components/dashboard-layout";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { redirect } from "next/navigation";
import Link from "next/link";
import { formatEur, formatDate } from "@/lib/utils";
import { Users, Package, TrendingUp, MessageCircle, BookOpen, AlertCircle, Inbox, BarChart3, Landmark, Undo2, Calculator } from "lucide-react";
import { ORDER_STATUS_LABEL, isOrderStatus, orderRef } from "@/lib/order-status";
import { MARGIN_ESTIMATE_LABEL } from "@/lib/invoicing";
import { PLANS } from "@/lib/plans";
import { AdminShell } from "./_lib/page-shell";
import { AdminNav } from "./_lib/admin-nav";
import { accountStats, ordersPerDay, openCounts, paidRevenue, paidWithoutInvoice, revenuePerDay, shopMargin, subscriptionStats, vatByQuarter, type DayCount, type OpenCounts, type RevenueDay, type RevenueFigures, type SubscriptionStats } from "./_lib/economics";
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
      <AdminShell>
        <Card>
          <CardContent className="p-12 text-center">
            <p className="text-muted-foreground">Geen toegang. Alleen admins.</p>
          </CardContent>
        </Card>
      </AdminShell>
    </DashboardLayout>
    );
  }

  // Every query on this page is bounded or done by Postgres. Money figures come from
  // src/app/admin/_lib/economics.ts: margins count QUOTE costs only (decision D8) and
  // Order.costEur is not summed anywhere.
  const now = new Date();

  // Diagnosis.result is JSON inside a string column, so errorCode cannot be
  // grouped in SQL. Hence a window plus a hard cap instead of the whole table.
  const DIAGNOSIS_WINDOW_DAYS = 90;
  const DIAGNOSIS_SAMPLE = 2000;
  const diagnosisSince = new Date(now);
  diagnosisSince.setDate(diagnosisSince.getDate() - DIAGNOSIS_WINDOW_DAYS);

  let accountInfo = { accounts: 0, guests: 0 }, noInvoice = { count: 0, grossEur: 0 }, partsCount = 20, ordersCount = 0, diagnosesCount = 0, guidesCount = 6, errorCodesCount = 26;
  let revenue: RevenueFigures = { grossEur: 0, vatEur: 0, netEur: 0, paidOrders: 0 };
  let margin: Awaited<ReturnType<typeof shopMargin>> | null = null;
  let counts: OpenCounts = { toShip: 0, unpaidInvoices: 0, overdueInvoices: 0, openRma: 0, pendingApplications: 0, pendingReviews: 0 };
  let perDay: DayCount[] = [];
  let subs: SubscriptionStats | null = null;
  let quarterVat: { quarter: number; vatPayableEur: number } | null = null;
  let recentOrders: Array<{ id: string; createdAt: Date; totalEur: number; status: string; invoice: { number: string } | null }> = [];
  let recentUsers: Array<{ id: string; name: string | null; email: string; plan: string }> = [];
  let revenueDays: RevenueDay[] = [];
  let recentDiagnoses: Array<{ result: string | null }> = [];
  let allErrorCodes: Array<{ code: string; severity: string }> = [];
  let dbError = false;
  try {
    const year = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam", year: "numeric" }).format(now));
    const currentQuarter = Math.floor((Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam", month: "numeric" }).format(now)) - 1) / 3) + 1;
    let quarters: Awaited<ReturnType<typeof vatByQuarter>>;
    [accountInfo, noInvoice, partsCount, ordersCount, diagnosesCount, guidesCount, errorCodesCount, revenue, margin, counts, perDay, subs, quarters, recentOrders, recentUsers, revenueDays, recentDiagnoses, allErrorCodes] = await Promise.all([
      accountStats(),
      paidWithoutInvoice(),
      prisma.part.count(),
      prisma.order.count(),
      prisma.diagnosis.count(),
      prisma.repairGuide.count(),
      prisma.errorCode.count(),
      paidRevenue(),
      shopMargin(),
      openCounts(now),
      ordersPerDay(14, now),
      subscriptionStats(),
      vatByQuarter(year),
      prisma.order.findMany({ take: 5, orderBy: { createdAt: "desc" }, select: { id: true, createdAt: true, totalEur: true, status: true, invoice: { select: { number: true } } } }),
      prisma.user.findMany({ where: { clerkId: { not: null } }, take: 5, orderBy: { createdAt: "desc" }, select: { id: true, name: true, email: true, plan: true } }),
      revenuePerDay(30, now),
      prisma.diagnosis.findMany({
        where: { createdAt: { gte: diagnosisSince }, result: { not: null } },
        select: { result: true },
        orderBy: { createdAt: "desc" },
        take: DIAGNOSIS_SAMPLE,
      }),
      prisma.errorCode.findMany({ select: { code: true, severity: true } }),
    ]);
    quarterVat = quarters.find((q) => q.quarter === currentQuarter) ?? null;
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

  const usersCount = accountInfo.accounts;
  const guestsCount = accountInfo.guests;
  const grossTurnover = revenue.grossEur;
  const netRevenue = revenue.netEur;
  const peak = Math.max(1, ...perDay.map((d) => d.created));
  const createdLast14 = perDay.reduce((s, d) => s + d.created, 0);

  // Revenue chart: Invoice minus CreditNote per Amsterdam day (see revenuePerDay), the same books as the card above it.
  const days = revenueDays.map((d) => {
    const [, m, dd] = d.day.split("-");
    return { date: `${Number(dd)}/${Number(m)}`, revenue: d.revenueEur, orders: d.invoices };
  });

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
      <AdminShell>
      <AdminNav current="/admin" />
      <div className="mb-6">
        <Badge variant="danger" className="mb-2">ADMIN</Badge>
        <h1 className="font-heading text-2xl font-bold">Admin Dashboard</h1>
        <p className="text-muted-foreground text-sm">Wat moet er vandaag gebeuren, en verdienen we er iets aan?</p>
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8" data-testid="open-counts">
        <WorkCard href="/admin/bestellingen" label="Te verzenden" value={counts.toShip} urgent={counts.toShip > 0} />
        <WorkCard href="/admin/bestellingen?view=te-betalen" label="Wacht op betaling" value={counts.unpaidInvoices} urgent={counts.overdueInvoices > 0} sub={counts.overdueInvoices > 0 ? `${counts.overdueInvoices} te laat` : undefined} />
        <WorkCard href="/admin/retouren" label="Open retouren" value={counts.openRma} urgent={counts.openRma > 0} />
        <WorkCard href="/admin/aanvragen" label="Aanvragen en reviews" value={counts.pendingApplications + counts.pendingReviews} sub={`${counts.pendingApplications} monteurs, ${counts.pendingReviews} reviews`} urgent={counts.pendingApplications + counts.pendingReviews > 0} />
      </div>

      <Card className="mb-8">
        <CardContent className="p-6">
          <h2 className="font-heading text-lg font-semibold mb-1">Bestelt er iemand? Laatste 14 dagen</h2>
          <p className="text-xs text-muted-foreground mb-3">
            {createdLast14} bestelling{createdLast14 === 1 ? "" : "en"} geplaatst uit de database (ook onbetaalde). Bezoekcijfers staan hier niet: analytics zijn pas na toestemming van de bezoeker en dus onvolledig.
          </p>
          <div className="flex items-end gap-1 h-24" role="img" aria-label={`Bestellingen per dag, laatste 14 dagen: ${perDay.map((d) => `${d.date}: ${d.created}`).join(", ")}`}>
            {perDay.map((d) => (
              <div key={d.date} className="flex-1 min-w-0 flex flex-col justify-end h-full" title={`${d.date}: ${d.created} geplaatst, ${d.paid} betaald`}>
                <div className="w-full rounded-sm bg-primary/30" style={{ height: `${(d.created / peak) * 100}%`, minHeight: d.created > 0 ? 4 : 1 }}>
                  <div className="w-full rounded-sm bg-primary" style={{ height: d.created > 0 ? `${(d.paid / d.created) * 100}%` : 0 }} />
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground mt-1"><span>{perDay[0]?.date.slice(5)}</span><span>vandaag</span></div>
          <p className="text-[11px] text-muted-foreground mt-1">Donker = betaald, licht = geplaatst.</p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard icon={<Users className="h-4 w-4" />} label="Gebruikers (met account)" value={usersCount.toString()} hint={`${guestsCount} gast${guestsCount === 1 ? "" : "en"} bestelden zonder account`} />
        <StatCard icon={<Package className="h-4 w-4" />} label="Bestellingen" value={ordersCount.toString()} />
        <StatCard icon={<TrendingUp className="h-4 w-4" />} label="Omzet incl. btw (betaald)" value={formatEur(grossTurnover)} />
        <StatCard icon={<MessageCircle className="h-4 w-4" />} label="Diagnoses" value={diagnosesCount.toString()} />
      </div>

      <Card className="mb-8">
        <CardContent className="p-6">
          <h2 className="font-heading text-lg font-semibold mb-1">Wat verdienen we hieraan?</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Omzet is geen winst. De btw dragen we af. Een marge telt alleen inkoopprijzen waarvan je een offerte of factuur hebt; de rest is een {MARGIN_ESTIMATE_LABEL}.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MoneyStat label="Netto omzet" value={formatEur(netRevenue)} hint="excl. btw, min creditnota's" />
            <MoneyStat
              label="Btw lopend kwartaal"
              value={quarterVat ? formatEur(quarterVat.vatPayableEur) : "-"}
              hint={quarterVat ? `Q${quarterVat.quarter}, alleen webshopfacturen min creditnota's (abonnementen: zie Economie)` : "geen gegevens"}
            />
            <MoneyStat
              label="Marge (offerte-kosten)"
              value={margin && margin.confirmed.lines > 0 ? formatEur(margin.confirmed.marginEur) : "nog geen"}
              hint={margin && margin.confirmed.lines > 0 ? `${margin.confirmed.marginPct ?? 0}% van netto omzet, ${margin.confirmed.lines} orderregels` : "geen orderregels met een offerte-inkoopprijs"}
              accent
            />
            <MoneyStat
              label={`Marge (${MARGIN_ESTIMATE_LABEL})`}
              value={margin && margin.estimated.lines > 0 ? formatEur(margin.estimated.marginEur) : "-"}
              hint={margin && margin.estimated.lines > 0 ? `${margin.estimated.marginPct ?? 0}%: ${MARGIN_ESTIMATE_LABEL}, niet betrouwbaar` : "geen regels"}
            />
          </div>
          {margin && margin.estimated.lines + margin.unknownLines > 0 && (
            <p className="text-xs text-amber-600 mt-4">
              {margin.estimated.lines} orderregels hebben alleen een geschatte inkoopprijs en {margin.unknownLines} geen. Zet echte inkoopprijzen met herkomst &ldquo;offerte&rdquo; bij{" "}
              <Link href="/admin/onderdelen" className="underline">onderdelen</Link>. Per onderdeel zie je de winst op{" "}
              <Link href="/admin/economie" className="underline">Economie en btw</Link>.
            </p>
          )}
          {subs && (
            <p className="text-xs text-muted-foreground mt-3">
              Abonnementen: {subs.active} actief, {subs.trialing} in proefperiode, {subs.pastDue} betaling mislukt. MRR {formatEur(subs.mrrExVatEur)} excl. btw, berekend uit opgeslagen statussen en de prijzen van {Object.values(PLANS).filter((p) => p.priceCents > 0).map((p) => p.name).join(", ")}, niet uit Stripe.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-3 gap-4 mb-8">
        <ManageCard icon={<Package className="h-5 w-5" />} title="Onderdelen" count={partsCount} href="/admin/onderdelen" />
        <ManageCard icon={<BookOpen className="h-5 w-5" />} title="Reparatiegidsen" count={guidesCount} href="/admin/gidsen" />
        <ManageCard icon={<AlertCircle className="h-5 w-5" />} title="Foutcodes" count={errorCodesCount} href="/admin/foutcodes" />
        <ManageCard icon={<Inbox className="h-5 w-5" />} title="Aanvragen & reviews" href="/admin/aanvragen" />
        <ManageCard icon={<Landmark className="h-5 w-5" />} title="Bestellingen & facturen" href="/admin/bestellingen" />
        <ManageCard icon={<Undo2 className="h-5 w-5" />} title="Retouren" href="/admin/retouren" />
        <ManageCard icon={<Calculator className="h-5 w-5" />} title="Economie en btw" href="/admin/economie" />
        <ManageCard icon={<Users className="h-5 w-5" />} title="Gebruikers" count={usersCount} href="/admin/gebruikers" />
        <ManageCard icon={<BarChart3 className="h-5 w-5" />} title="Analytics" href="/admin/analytics" />
      </div>

      <div className="grid lg:grid-cols-2 gap-6 mb-8">
        <Card>
          <CardContent className="p-6">
            <h2 className="font-heading text-lg font-semibold mb-1">Omzet (30 dagen)</h2>
            <p className="text-xs text-muted-foreground mb-3">Omzet incl. btw per factuurdatum van betaalde bestellingen, min creditnota&apos;s (zelfde cijfers als het kaartje &ldquo;Omzet incl. btw&rdquo;). De lijn telt facturen.{noInvoice.count > 0 && (
                <> <Link href="/admin/bestellingen?view=zonder-factuur" className="text-amber-700 underline">{noInvoice.count} betaalde bestelling{noInvoice.count === 1 ? "" : "en"} ({formatEur(noInvoice.grossEur)}) heeft nog geen factuur</Link> en staat dus niet in deze grafiek.</>
              )}</p>
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

      {/* grid-cols-1 = minmax(0,1fr): without it the single mobile column grows to the widest unbreakable string (a long e-mail address) and the page scrolls sideways. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="min-w-0">
          <CardContent className="p-6">
            <h2 className="font-heading text-lg font-semibold mb-4">Recente bestellingen</h2>
            <div className="space-y-2">
              {recentOrders.map((o) => (
                <Link key={o.id} href={`/admin/bestellingen?q=${orderRef(o.id)}`}>
                  <div className="flex items-center justify-between gap-2 p-3 rounded-md border hover:border-primary transition-colors">
                    <div className="min-w-0">
                      <p className="font-mono text-sm">#{orderRef(o.id)}{o.invoice && <span className="text-muted-foreground"> · {o.invoice.number}</span>}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(o.createdAt)}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="font-bold">{formatEur(o.totalEur)}</span>
                      <Badge variant="outline" className="ml-2">{isOrderStatus(o.status) ? ORDER_STATUS_LABEL[o.status] : o.status}</Badge>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardContent className="p-6">
            <h2 className="font-heading text-lg font-semibold mb-1">Recente gebruikers</h2>
            <p className="text-xs text-muted-foreground mb-3">Alleen accounts; gasten staan niet in deze lijst.</p>
            <div className="space-y-2">
              {recentUsers.length === 0 && <p className="text-sm text-muted-foreground">Nog geen accounts.</p>}
              {recentUsers.map((u) => (
                <div key={u.id} className="flex items-center justify-between gap-2 p-3 rounded-md border">
                  <div className="min-w-0">
                    <p className="font-medium text-sm break-words">{u.name ?? u.email}</p>
                    <p className="text-xs text-muted-foreground break-all">{u.email}</p>
                  </div>
                  <Badge variant="outline" className="shrink-0">{u.plan}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </AdminShell>
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

function WorkCard({ href, label, value, sub, urgent }: { href: string; label: string; value: number; sub?: string; urgent?: boolean }) {
  return (
    <Link href={href}>
      <Card className={`hover:border-primary transition-colors h-full ${urgent ? "border-amber-500/60" : ""}`}>
        <CardContent className="p-4">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="font-heading text-3xl font-bold tabular-nums">{value}</p>
          {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
        </CardContent>
      </Card>
    </Link>
  );
}

function StatCard({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">{icon} {label}</div>
        <p className="font-heading text-2xl font-bold">{value}</p>
        {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
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
