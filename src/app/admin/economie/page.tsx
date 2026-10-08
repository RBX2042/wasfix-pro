import Link from "next/link";
import { redirect } from "next/navigation";
import { DashboardLayout } from "@/components/dashboard-layout";
import { getCurrentUser } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/env";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MARGIN_ESTIMATE_LABEL } from "@/lib/invoicing";
import { PLANS, SHIPPING } from "@/lib/plans";
import { AdminShell } from "../_lib/page-shell";
import { AdminNav } from "../_lib/admin-nav";
import { eur } from "../_lib/format";
import { ECONOMICS_ASSUMPTIONS, paidRevenue, shopMargin, skuContributionTable, subscriptionStats, vatByQuarter } from "../_lib/economics";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin: economie en btw" };

const BASIS_LABEL = { QUOTE: "offerte", ESTIMATE: MARGIN_ESTIMATE_LABEL, UNKNOWN: "onbekend" } as const;

export default async function EconomyPage({ searchParams }: { searchParams: Promise<{ jaar?: string; filter?: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") redirect("/dashboard");
  if (!isDatabaseConfigured()) {
    return (
      <DashboardLayout role={user.role}>
      <AdminShell>
        <AdminNav current="/admin/economie" />
        <Card><CardContent className="p-12 text-center text-muted-foreground">Stel DATABASE_URL in om cijfers te zien.</CardContent></Card>
      </AdminShell>
    </DashboardLayout>
    );
  }
  const sp = await searchParams;
  const thisYear = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam", year: "numeric" }).format(new Date()));
  const year = Number.parseInt(sp.jaar ?? "", 10) || thisYear;
  const onlyProblems = sp.filter === "problemen";

  const [revenue, margin, quarters, subs, table] = await Promise.all([paidRevenue(), shopMargin(), vatByQuarter(year), subscriptionStats(), skuContributionTable()]);
  const rows = table
    .filter((r) => !onlyProblems || r.base.negative || r.atMaxDiscount.negative || r.base.contributionEur === null)
    .sort((a, b) => (a.base.contributionEur ?? -1e9) - (b.base.contributionEur ?? -1e9));
  const negatives = table.filter((r) => r.base.negative).length;
  const negativesMax = table.filter((r) => r.atMaxDiscount.negative).length;
  const unknown = table.filter((r) => r.base.contributionEur === null).length;
  const estimated = table.filter((r) => r.base.basis === "ESTIMATE").length;
  const total = quarters.reduce((s, q) => ({ vat: s.vat + q.vatPayableEur, gross: s.gross + q.grossEur, net: s.net + q.netEur }), { vat: 0, gross: 0, net: 0 });
  const maxDiscountPct = Math.round(Math.max(...Object.values(PLANS).map((p) => p.partsDiscount)) * 100);

  return (
    <DashboardLayout role={user.role}>
      <AdminShell>
      <AdminNav current="/admin/economie" />
      <h1 className="font-heading text-2xl font-bold mb-1">Economie en btw</h1>
      <p className="text-sm text-muted-foreground mb-6">Alles hieronder komt uit de database. Een marge telt alleen kostprijzen met een offerte of factuur als bron; de rest heet &ldquo;{MARGIN_ESTIMATE_LABEL}&rdquo;.</p>

      <section className="mb-8">
        <h2 className="font-heading text-lg font-semibold mb-3">Omzet en marge (betaalde bestellingen)</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Omzet incl. btw" value={eur(revenue.grossEur)} hint={`${revenue.paidOrders} bestellingen, min creditnota's`} />
          <Stat label="Netto omzet" value={eur(revenue.netEur)} hint={`btw ${eur(revenue.vatEur)}`} />
          <Stat
            label="Marge (offerte-kosten)"
            value={margin.confirmed.lines > 0 ? eur(margin.confirmed.marginEur) : "nog geen"}
            hint={margin.confirmed.lines > 0 ? `${margin.confirmed.marginPct ?? 0}% van ${eur(margin.confirmed.revenueExVatEur)}, ${margin.confirmed.lines} orderregels` : "geen orderregels met een offerte-inkoopprijs"}
            accent
          />
          <Stat
            label={`Marge (${MARGIN_ESTIMATE_LABEL})`}
            value={margin.estimated.lines > 0 ? eur(margin.estimated.marginEur) : "-"}
            hint={margin.estimated.lines > 0 ? `${margin.estimated.marginPct ?? 0}% van ${eur(margin.estimated.revenueExVatEur)}, ${margin.estimated.lines} regels. Niet betrouwbaar.` : "geen regels"}
          />
        </div>
        {margin.unknownLines > 0 && <p className="mt-2 text-xs text-muted-foreground">{margin.unknownLines} orderregels hebben helemaal geen inkoopprijs en tellen nergens mee.</p>}
        <p className="mt-2 text-xs text-muted-foreground">Kostprijs = de huidige inkoopprijs van het onderdeel (de bestelling bewaart er geen kopie van). Terugbetalingen zijn niet uit de marge gehaald.</p>
      </section>

      <section className="mb-8">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
          <h2 className="font-heading text-lg font-semibold">Btw per kwartaal {year}</h2>
          <div className="flex flex-wrap gap-2 text-sm">
            <Link className="underline" href={`/admin/economie?jaar=${year - 1}`}>← {year - 1}</Link>
            {year < thisYear && <Link className="underline" href={`/admin/economie?jaar=${year + 1}`}>{year + 1} →</Link>}
          </div>
        </div>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm tabular-nums">
            <thead className="bg-muted text-left">
              <tr><th className="p-2">Kwartaal</th><th className="p-2 text-right">Facturen</th><th className="p-2 text-right">Netto</th><th className="p-2 text-right">Btw</th><th className="p-2 text-right">Creditnota&apos;s</th><th className="p-2 text-right">Btw terug</th><th className="p-2 text-right font-semibold">Af te dragen btw</th><th className="p-2 text-right">Totaal incl.</th><th className="p-2"></th></tr>
            </thead>
            <tbody>
              {quarters.map((q) => (
                <tr key={q.quarter} className="border-t">
                  <td className="p-2">Q{q.quarter}</td>
                  <td className="p-2 text-right">{q.invoices}</td>
                  <td className="p-2 text-right">{eur(q.invoicedNetEur)}</td>
                  <td className="p-2 text-right">{eur(q.invoicedVatEur)}</td>
                  <td className="p-2 text-right">{q.creditNotes}</td>
                  <td className="p-2 text-right">{eur(-q.creditedVatEur)}</td>
                  <td className="p-2 text-right font-semibold">{eur(q.vatPayableEur)}</td>
                  <td className="p-2 text-right">{eur(q.grossEur)}</td>
                  <td className="p-2 text-right"><a className="underline" href={`/api/admin/export/invoices?year=${year}&quarter=${q.quarter}`}>CSV</a></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 font-semibold"><td className="p-2">Jaar</td><td colSpan={5}></td><td className="p-2 text-right">{eur(total.vat)}</td><td className="p-2 text-right">{eur(total.gross)}</td><td className="p-2 text-right"><a className="underline" href={`/api/admin/export/invoices?year=${year}`}>CSV</a></td></tr>
            </tfoot>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Bron: alleen de tabellen Factuur en Creditnota (btw = som facturen min som creditnota&apos;s), per kwartaal van de factuurdatum in tijdzone Europe/Amsterdam. Een factuur voor een nog onbetaalde bestelling telt mee, want de btw staat al op de factuur; een geannuleerde factuur valt weg door haar creditnota.
          Abonnementen (Stripe) staan hier niet in: die facturen en hun btw komen uit Stripe Tax / het Stripe-dashboard. Of dit klopt met je aangifte (factuur- of kasstelsel, KOR) bevestigt je boekhouder.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="font-heading text-lg font-semibold mb-3">Abonnementen</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Actief" value={String(subs.active)} hint="betalende abonnees" />
          <Stat label="Proefperiode" value={String(subs.trialing)} hint="nog geen omzet" />
          <Stat label="Betaling mislukt" value={String(subs.pastDue)} hint="past_due: risico" />
          <Stat label="MRR excl. btw" value={eur(subs.mrrExVatEur)} hint="alleen actieve abonnees" accent />
        </div>
        {subs.byPlan.length > 0 && (
          <ul className="mt-2 text-sm text-muted-foreground">
            {subs.byPlan.map((p) => <li key={p.plan}>{PLANS[p.plan].name}: {p.active} actief, {p.trialing} proef, {p.pastDue} past_due</li>)}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Berekend uit de opgeslagen statussen (gebruiker.stripeSubStatus) en de prijzen in plans.ts, niet uit Stripe. Kortingen, coupons en kosten van Stripe zijn niet verrekend.
          De facturen en btw van abonnementen staan alleen in Stripe: haal ze voor je aangifte op in het{" "}
          <a className="underline" href="https://dashboard.stripe.com/invoices" target="_blank" rel="noreferrer noopener">Stripe-dashboard</a> (Facturen, of de btw-rapporten van Stripe Tax).
        </p>
      </section>

      <section className="mb-8">
        <h2 className="font-heading text-lg font-semibold mb-1">Winst per onderdeel (1 stuk, 1 pakket)</h2>
        <p className="text-sm text-muted-foreground mb-3">
          {negatives} van {table.length} onderdelen verdienen niets of verliezen geld zonder korting, {negativesMax} met {maxDiscountPct}% plankorting (Bedrijf-plan); bij {unknown} is de inkoopprijs onbekend. {estimated} onderdelen rusten op een {MARGIN_ESTIMATE_LABEL} van de inkoopprijs.
        </p>
        <div className="mb-3 rounded-md border bg-amber-50 dark:bg-amber-950/20 p-3 text-xs">
          <p className="font-semibold mb-1">Aannames, geen feiten</p>
          <p>Betaalkosten {eur(ECONOMICS_ASSUMPTIONS.paymentFeeFixedEur)} per betaling + {ECONOMICS_ASSUMPTIONS.paymentFeePercent}%; vervoerder rekent ons {eur(ECONOMICS_ASSUMPTIONS.carrierCostEur)} per pakket; klant betaalt {eur(SHIPPING.rateEur)} verzending onder {eur(SHIPPING.freeFromEur)}. Pas deze waarden aan in src/app/admin/_lib/economics.ts zodra je je Stripe-tarief en het tarief van de vervoerder kent. Retouren, verpakking en eigen werk zitten er niet in.</p>
        </div>
        <div className="mb-2 flex gap-2 text-sm">
          <Link className={`underline ${!onlyProblems ? "font-semibold" : ""}`} href={`/admin/economie?jaar=${year}`}>Alle</Link>
          <Link className={`underline ${onlyProblems ? "font-semibold" : ""}`} href={`/admin/economie?jaar=${year}&filter=problemen`}>Alleen verlies of onbekend</Link>
          <Button asChild variant="outline" size="sm" className="ml-auto"><a href="/api/admin/parts/export">CSV onderdelen</a></Button>
        </div>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm tabular-nums">
            <thead className="bg-muted text-left">
              <tr><th className="p-2">SKU</th><th className="p-2 text-right">Prijs excl. btw</th><th className="p-2 text-right">Inkoop</th><th className="p-2 text-right">Betaalkosten</th><th className="p-2 text-right">Verzending netto</th><th className="p-2 text-right font-semibold">Winst</th><th className="p-2 text-right">Winst bij {maxDiscountPct}% korting</th></tr>
            </thead>
            <tbody>
              {rows.slice(0, 300).map(({ base, atMaxDiscount }) => (
                <tr key={base.sku} className="border-t">
                  <td className="p-2"><span className="font-mono">{base.sku}</span><span className="block text-xs text-muted-foreground max-w-[22ch] truncate">{base.name}</span></td>
                  <td className="p-2 text-right">{eur(base.priceExVatEur)}</td>
                  <td className="p-2 text-right">{base.costEur === null ? <Badge variant="warning">onbekend</Badge> : <>{eur(base.costEur)} <span className={`text-[10px] uppercase ${base.basis === "QUOTE" ? "text-emerald-600" : "text-amber-600"}`}>{BASIS_LABEL[base.basis]}</span></>}</td>
                  <td className="p-2 text-right">{eur(base.paymentFeeEur)}</td>
                  <td className="p-2 text-right">{eur(base.shippingNetEur)}</td>
                  <td className={`p-2 text-right font-semibold ${base.negative ? "text-red-600" : base.basis === "QUOTE" ? "" : "text-muted-foreground"}`}>
                    {base.contributionEur === null ? "-" : eur(base.contributionEur)}{base.negative && " ▼"}{base.basis === "ESTIMATE" && <span className="ml-1 text-[10px] uppercase font-normal">{MARGIN_ESTIMATE_LABEL}</span>}
                  </td>
                  <td className={`p-2 text-right ${atMaxDiscount.negative ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>{atMaxDiscount.contributionEur === null ? "-" : eur(atMaxDiscount.contributionEur)}{atMaxDiscount.negative && " ▼"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length > 300 && <p className="mt-2 text-xs text-muted-foreground">De eerste 300 van {rows.length} rijen.</p>}
      </section>
    </AdminShell>
    </DashboardLayout>
  );
}

function Stat({ label, value, hint, accent }: { label: string; value: string; hint: string; accent?: boolean }) {
  return (
    <div className={`rounded-md border p-4 min-w-0 ${accent ? "border-primary/40 bg-primary/5" : ""}`}>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-heading text-xl font-bold mt-1 tabular-nums break-words">{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>
    </div>
  );
}
