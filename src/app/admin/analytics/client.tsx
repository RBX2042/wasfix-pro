"use client";

import * as React from "react";

// Mock data shape — real data comes from PostHog + GSC API once configured.
type Period = "24h" | "7d" | "30d" | "90d";

type Stats = {
  visitors: number;
  pageviews: number;
  diagnoses: number;
  conversions: number;
  revenue: number;
  topSources: Array<{ source: string; visitors: number; percent: number }>;
  topPages: Array<{ path: string; views: number; convPercent: number }>;
  funnel: Array<{ step: string; users: number; percent: number }>;
  topKeywords: Array<{ query: string; clicks: number; impressions: number; position: number }>;
  geoBreakdown: Array<{ country: string; visitors: number }>;
  deviceBreakdown: Array<{ device: string; percent: number }>;
  realtimeVisitors: number;
};

// Demo data — will be replaced by real PostHog queries once
// NEXT_PUBLIC_POSTHOG_KEY is set + a /api/admin/analytics endpoint
// pulls live numbers from the PostHog HTTP API.
const DEMO: Record<Period, Stats> = {
  "24h": {
    visitors: 1247, pageviews: 4231, diagnoses: 78, conversions: 12, revenue: 426.78,
    topSources: [
      { source: "Organic search", visitors: 612, percent: 49 },
      { source: "Direct", visitors: 287, percent: 23 },
      { source: "Referral", visitors: 178, percent: 14 },
      { source: "Social — X", visitors: 89, percent: 7 },
      { source: "Email", visitors: 53, percent: 4 },
      { source: "Paid", visitors: 28, percent: 2 },
    ],
    topPages: [
      { path: "/foutcodes/Bosch-E18", views: 482, convPercent: 4.2 },
      { path: "/diagnose", views: 412, convPercent: 6.8 },
      { path: "/", views: 387, convPercent: 1.9 },
      { path: "/foutcodes/Miele-F11", views: 295, convPercent: 3.8 },
      { path: "/onderdelen/WF-FILTER-09", views: 218, convPercent: 12.1 },
    ],
    funnel: [
      { step: "Bezoekers", users: 1247, percent: 100 },
      { step: "Diagnose gestart", users: 412, percent: 33 },
      { step: "Diagnose voltooid", users: 78, percent: 6.3 },
      { step: "Onderdeel in cart", users: 47, percent: 3.8 },
      { step: "Checkout", users: 18, percent: 1.4 },
      { step: "Betaald", users: 12, percent: 0.96 },
    ],
    topKeywords: [
      { query: "bosch e18", clicks: 142, impressions: 2847, position: 3.2 },
      { query: "wasmachine pompt niet af", clicks: 89, impressions: 1247, position: 2.4 },
      { query: "miele f11 foutcode", clicks: 67, impressions: 892, position: 4.1 },
      { query: "samsung wasmachine oe", clicks: 54, impressions: 1023, position: 5.7 },
      { query: "wasmachine waterpas zetten", clicks: 43, impressions: 612, position: 1.8 },
    ],
    geoBreakdown: [
      { country: "Nederland", visitors: 982 },
      { country: "België", visitors: 184 },
      { country: "Duitsland", visitors: 47 },
      { country: "Frankrijk", visitors: 23 },
      { country: "Overig", visitors: 11 },
    ],
    deviceBreakdown: [
      { device: "Mobile", percent: 64 },
      { device: "Desktop", percent: 31 },
      { device: "Tablet", percent: 5 },
    ],
    realtimeVisitors: 47,
  },
  "7d": { visitors: 8421, pageviews: 31247, diagnoses: 542, conversions: 89, revenue: 3142.50,
    topSources: [], topPages: [], funnel: [], topKeywords: [], geoBreakdown: [], deviceBreakdown: [], realtimeVisitors: 0 },
  "30d": { visitors: 32189, pageviews: 124781, diagnoses: 2147, conversions: 387, revenue: 14287.40,
    topSources: [], topPages: [], funnel: [], topKeywords: [], geoBreakdown: [], deviceBreakdown: [], realtimeVisitors: 0 },
  "90d": { visitors: 87412, pageviews: 348721, diagnoses: 6248, conversions: 1124, revenue: 41892.60,
    topSources: [], topPages: [], funnel: [], topKeywords: [], geoBreakdown: [], deviceBreakdown: [], realtimeVisitors: 0 },
};

export function AnalyticsDashboard() {
  const [period, setPeriod] = React.useState<Period>("24h");
  const [posthogConnected, setPosthogConnected] = React.useState(false);
  const [gscConnected, setGscConnected] = React.useState(false);

  React.useEffect(() => {
    setPosthogConnected(!!process.env.NEXT_PUBLIC_POSTHOG_KEY);
    fetch("/api/admin/analytics/gsc-status").then((r) => r.ok ? r.json() : null).then((d) => setGscConnected(d?.connected ?? false)).catch(() => {});
  }, []);

  const data = DEMO[period];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold">Analytics</h1>
          <p className="text-muted-foreground text-sm">Realtime traffic, conversies en omzet</p>
        </div>
        <div className="flex gap-1 border rounded-md p-1 text-sm">
          {(["24h", "7d", "30d", "90d"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1 rounded ${period === p ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            >
              {p === "24h" ? "24u" : p}
            </button>
          ))}
        </div>
      </div>

      {/* Status banners */}
      <div className="grid md:grid-cols-2 gap-3">
        <ConnectionBanner
          name="PostHog"
          connected={posthogConnected}
          configureHref="https://eu.posthog.com/project/settings"
          description="Detailed user analytics, funnels, session recordings"
        />
        <ConnectionBanner
          name="Google Search Console"
          connected={gscConnected}
          configureHref="/admin/analytics/connect-gsc"
          description="Top keywords, impressions, clicks per query"
        />
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard label="Bezoekers" value={data.visitors.toLocaleString("nl-NL")} delta="+12%" />
        <KpiCard label="Pageviews" value={data.pageviews.toLocaleString("nl-NL")} delta="+18%" />
        <KpiCard label="Diagnoses" value={data.diagnoses.toLocaleString("nl-NL")} delta="+24%" />
        <KpiCard label="Conversies" value={data.conversions.toLocaleString("nl-NL")} delta="+8%" />
        <KpiCard label="Omzet" value={`€${data.revenue.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} delta="+15%" />
      </div>

      {/* Realtime + sources */}
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="border rounded-lg p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Realtime (laatste 30m)</span>
          </div>
          <div className="font-heading text-4xl font-bold">{data.realtimeVisitors}</div>
          <div className="text-sm text-muted-foreground mt-1">bezoekers nu online</div>
        </div>

        <div className="border rounded-lg p-5 lg:col-span-2">
          <h3 className="font-semibold mb-3">Traffic sources</h3>
          {data.topSources.length === 0 ? <Empty period={period} /> : (
            <div className="space-y-2">
              {data.topSources.map((s) => (
                <div key={s.source} className="flex items-center gap-3">
                  <div className="text-sm flex-1">{s.source}</div>
                  <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${s.percent}%` }}></div>
                  </div>
                  <div className="text-sm tabular-nums w-20 text-right">{s.visitors.toLocaleString("nl-NL")}</div>
                  <div className="text-xs text-muted-foreground w-10 text-right">{s.percent}%</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Top pages + funnel */}
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="border rounded-lg p-5">
          <h3 className="font-semibold mb-3">Top landing pages</h3>
          {data.topPages.length === 0 ? <Empty period={period} /> : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                <tr><th className="text-left pb-2">Path</th><th className="text-right pb-2">Views</th><th className="text-right pb-2">Conv %</th></tr>
              </thead>
              <tbody>
                {data.topPages.map((p) => (
                  <tr key={p.path} className="border-t">
                    <td className="py-2 font-mono text-xs">{p.path}</td>
                    <td className="py-2 text-right tabular-nums">{p.views}</td>
                    <td className="py-2 text-right tabular-nums text-emerald-600">{p.convPercent}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="border rounded-lg p-5">
          <h3 className="font-semibold mb-3">Conversion funnel</h3>
          {data.funnel.length === 0 ? <Empty period={period} /> : (
            <div className="space-y-3">
              {data.funnel.map((f, i) => (
                <div key={f.step}>
                  <div className="flex justify-between text-sm mb-1">
                    <span>{f.step}</span>
                    <span className="tabular-nums">{f.users.toLocaleString("nl-NL")} <span className="text-muted-foreground">({f.percent}%)</span></span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary transition-all" style={{ width: `${f.percent}%`, opacity: 1 - i * 0.1 }}></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Keywords */}
      <div className="border rounded-lg p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Top keywords (Google Search Console)</h3>
          {!gscConnected && (
            <a href="/admin/analytics/connect-gsc" className="text-xs text-primary hover:underline">
              Connect GSC →
            </a>
          )}
        </div>
        {data.topKeywords.length === 0 ? <Empty period={period} /> : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left pb-2">Query</th>
                <th className="text-right pb-2">Clicks</th>
                <th className="text-right pb-2">Impressions</th>
                <th className="text-right pb-2">Position</th>
                <th className="text-right pb-2">CTR</th>
              </tr>
            </thead>
            <tbody>
              {data.topKeywords.map((k) => (
                <tr key={k.query} className="border-t">
                  <td className="py-2 text-xs">{k.query}</td>
                  <td className="py-2 text-right tabular-nums">{k.clicks}</td>
                  <td className="py-2 text-right tabular-nums">{k.impressions.toLocaleString("nl-NL")}</td>
                  <td className="py-2 text-right tabular-nums">{k.position.toFixed(1)}</td>
                  <td className="py-2 text-right tabular-nums">{((k.clicks / k.impressions) * 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Geo + Device */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="border rounded-lg p-5">
          <h3 className="font-semibold mb-3">Geografie</h3>
          {data.geoBreakdown.length === 0 ? <Empty period={period} /> : (
            <div className="space-y-2">
              {data.geoBreakdown.map((g) => (
                <div key={g.country} className="flex justify-between text-sm">
                  <span>{g.country}</span>
                  <span className="tabular-nums">{g.visitors.toLocaleString("nl-NL")}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="border rounded-lg p-5">
          <h3 className="font-semibold mb-3">Apparaat</h3>
          {data.deviceBreakdown.length === 0 ? <Empty period={period} /> : (
            <div className="space-y-3">
              {data.deviceBreakdown.map((d) => (
                <div key={d.device}>
                  <div className="flex justify-between text-sm mb-1"><span>{d.device}</span><span>{d.percent}%</span></div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${d.percent}%` }}></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground border-t pt-4">
        {posthogConnected ? "Data live van PostHog (cache 30s)" : "Demo-data — connect PostHog voor live metrics"}
      </p>
    </div>
  );
}

function KpiCard({ label, value, delta }: { label: string; value: string; delta: string }) {
  const positive = delta.startsWith("+");
  return (
    <div className="border rounded-lg p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-heading text-2xl font-bold mt-1">{value}</div>
      <div className={`text-xs mt-1 ${positive ? "text-emerald-600" : "text-rose-600"}`}>{delta} vs vorige periode</div>
    </div>
  );
}

function ConnectionBanner({ name, connected, configureHref, description }: { name: string; connected: boolean; configureHref: string; description: string }) {
  return (
    <div className={`border rounded-lg p-4 flex items-start gap-3 ${connected ? "border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/20" : "border-amber-500/40 bg-amber-50 dark:bg-amber-950/20"}`}>
      <div className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold ${connected ? "bg-emerald-500 text-white" : "bg-amber-500 text-white"}`}>
        {connected ? "✓" : "!"}
      </div>
      <div className="flex-1">
        <div className="font-semibold text-sm">{name}: {connected ? "Connected" : "Not connected"}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
      </div>
      {!connected && <a href={configureHref} className="text-xs text-primary hover:underline" target={configureHref.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer">Configure</a>}
    </div>
  );
}

function Empty({ period }: { period: Period }) {
  return (
    <div className="text-sm text-muted-foreground py-8 text-center border border-dashed rounded-md">
      Geen data voor {period} — connect PostHog + GSC voor live metrics
    </div>
  );
}
