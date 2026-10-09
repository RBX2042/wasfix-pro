"use client";

import * as React from "react";

export type Period = "24h" | "7d" | "30d" | "90d";
export type PeriodCounts = { diagnoses: number; ordersPlaced: number; ordersPaid: number; newUsers: number };
export type TopCode = { code: string; count: number };

const LABEL: Record<Period, string> = { "24h": "24 uur", "7d": "7 dagen", "30d": "30 dagen", "90d": "90 dagen" };

/**
 * Only numbers that exist in the database are shown. This page used to render a
 * hard-coded set of visitors, revenue, funnel and keywords with invented
 * "+12%" deltas, and dropped its "voorbeeldcijfers" warning as soon as
 * NEXT_PUBLIC_POSTHOG_KEY was set, although nothing ever queried PostHog. Now
 * there is nothing invented to label: traffic metrics are simply not here, and
 * the notice does not depend on any environment variable.
 */
export function AnalyticsDashboard({ counts, topCodes, hasDb }: { counts: Record<Period, PeriodCounts>; topCodes: TopCode[]; hasDb: boolean }) {
  const [period, setPeriod] = React.useState<Period>("7d");
  const data = counts[period];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold">Analytics</h1>
          <p className="text-muted-foreground text-sm">Wat er in de database staat: diagnoses, bestellingen en nieuwe gebruikers</p>
        </div>
        <div className="flex gap-1 border rounded-md p-1 text-sm" role="tablist" aria-label="Periode">
          {(Object.keys(LABEL) as Period[]).map((p) => (
            <button key={p} role="tab" aria-selected={period === p} onClick={() => setPeriod(p)} className={`px-3 py-1 rounded ${period === p ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
              {LABEL[p]}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 p-4" data-testid="analytics-notice">
        <p className="font-semibold text-sm text-amber-900 dark:text-amber-100">Bezoekers, paginaweergaven, herkomst en zoekwoorden staan hier niet.</p>
        <p className="text-sm text-amber-800 dark:text-amber-200 mt-1">
          Er is geen koppeling met PostHog of Search Console gebouwd, dus deze pagina kan ze niet tonen, ook niet als een sleutel is ingesteld.
          Verkeer in de browser wordt bovendien alleen gemeten na toestemming van de bezoeker en is dus onvolledig. Wat hieronder staat komt uit de database.
        </p>
      </div>

      {!hasDb ? (
        <div className="border border-dashed rounded-lg p-8 text-center text-sm text-muted-foreground">Geen database geconfigureerd, dus geen cijfers.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi label="Diagnoses" value={data.diagnoses} />
            <Kpi label="Bestellingen geplaatst" value={data.ordersPlaced} />
            <Kpi label="Waarvan betaald" value={data.ordersPaid} />
            <Kpi label="Nieuwe gebruikers" value={data.newUsers} />
          </div>
          <p className="text-xs text-muted-foreground">Periode: laatste {LABEL[period]}. &ldquo;Betaald&rdquo; is de huidige status (betaald, verzonden of afgeleverd) van bestellingen die in die periode zijn geplaatst.</p>

          <div className="border rounded-lg p-5">
            <h3 className="font-semibold mb-1">Meest gediagnosticeerde foutcodes</h3>
            <p className="text-xs text-muted-foreground mb-3">Laatste 90 dagen, maximaal 2000 diagnoses</p>
            {topCodes.length === 0 ? (
              <div className="text-sm text-muted-foreground py-6 text-center border border-dashed rounded-md">Geen diagnoses met een foutcode in deze periode.</div>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {topCodes.map((c) => (
                    <tr key={c.code} className="border-t first:border-0"><td className="py-2 font-mono text-xs">{c.code}</td><td className="py-2 text-right tabular-nums">{c.count}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="border rounded-lg p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-heading text-2xl font-bold mt-1 tabular-nums">{value.toLocaleString("nl-NL")}</div>
    </div>
  );
}
