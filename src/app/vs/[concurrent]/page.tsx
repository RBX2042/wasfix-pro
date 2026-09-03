import { WasFixShell, Icon } from "@/components/redesign/SharedLayout";
import { notFound } from "next/navigation";
import Link from "next/link";
import comparisonsData from "@/data/comparisons.json";
import { catalogStats, formatCount } from "@/lib/catalog-stats";

type Comparison = {
  slug: string;
  competitor: string;
  tagline: string;
  intro: string;
  winsTable: Array<{ topic: string; us: string; them: string; winner: "us" | "them" | "tie" }>;
  scenarios: Array<{ title: string; options: string[] }>;
  verdict: string;
};

const STATS = catalogStats();

/**
 * Our own side of a comparison table quotes catalogue sizes. Those are written
 * as {PARTS}/{GUIDES}/{CODES} placeholders in comparisons.json and resolved
 * here, so a comparison page can never advertise a number the catalogue does
 * not actually hold.
 */
const CATALOG_TOKENS: Record<string, string> = {
  "{PARTS}": formatCount(STATS.parts),
  "{GUIDES}": formatCount(STATS.guides),
  "{CODES}": formatCount(STATS.errorCodes),
  "{BRANDS}": formatCount(STATS.brands),
};

function resolveTokens(text: string): string {
  return text.replace(/\{(?:PARTS|GUIDES|CODES|BRANDS)\}/g, (m) => CATALOG_TOKENS[m] ?? m);
}

const comparisons = (comparisonsData as Comparison[]).map((c) => ({
  ...c,
  winsTable: c.winsTable.map((row) => ({ ...row, us: resolveTokens(row.us), them: resolveTokens(row.them) })),
}));

export function generateStaticParams() {
  return comparisons.map((c) => ({ concurrent: c.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ concurrent: string }> }) {
  const { concurrent } = await params;
  const c = comparisons.find((x) => x.slug === concurrent);
  if (!c) return { title: "Vergelijking niet gevonden" };
  return {
    title: `WasFix Pro vs ${c.competitor} — eerlijke vergelijking · WasFix Pro`,
    description: `${c.tagline} ${c.intro.slice(0, 110)}`,
    alternates: { canonical: `/vs/${c.slug}` },
    openGraph: {
      title: `WasFix Pro vs ${c.competitor}`,
      description: c.tagline,
      type: "article",
    },
  };
}

export default async function VsPage({ params }: { params: Promise<{ concurrent: string }> }) {
  const { concurrent } = await params;
  const c = comparisons.find((x) => x.slug === concurrent);
  if (!c) notFound();

  const usWins = c.winsTable.filter((w) => w.winner === "us").length;
  const themWins = c.winsTable.filter((w) => w.winner === "them").length;
  const ties = c.winsTable.filter((w) => w.winner === "tie").length;

  return (
    <WasFixShell>
      <section className="section" style={{ paddingTop: 56 }}>
        <div className="container" style={{ maxWidth: 880 }}>
          <div className="eyebrow">Eerlijke vergelijking</div>
          <h1 className="h-display" style={{ fontSize: "clamp(30px, 4.5vw, 48px)", marginBottom: 12 }}>
            WasFix Pro <em>vs</em> {c.competitor}
          </h1>
          <p className="lead" style={{ marginBottom: 16 }}>{c.tagline}</p>
          <p style={{ color: "var(--text-2)", lineHeight: 1.7, marginBottom: 32, maxWidth: 720 }}>
            {c.intro}
          </p>

          {/* Score-bord */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 36 }}>
            <ScoreCard label="WasFix Pro wint" value={usWins} highlight />
            <ScoreCard label={`${c.competitor} wint`} value={themWins} />
            <ScoreCard label="Gelijkspel" value={ties} />
          </div>

          {/* Comparison table */}
          <section style={{ marginBottom: 40 }}>
            <h2 className="h-section" style={{ fontSize: 24, marginBottom: 16 }}>
              Punt voor <em>punt</em>
            </h2>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 600 }}>
                <thead>
                  <tr style={{ background: "var(--surf-2)" }}>
                    <th style={{ padding: "10px 12px", textAlign: "left", borderBottom: "1px solid var(--border)", fontWeight: 500 }}>Onderwerp</th>
                    <th style={{ padding: "10px 12px", textAlign: "left", borderBottom: "1px solid var(--border)", fontWeight: 500, color: "var(--acc-2)" }}>WasFix Pro</th>
                    <th style={{ padding: "10px 12px", textAlign: "left", borderBottom: "1px solid var(--border)", fontWeight: 500 }}>{c.competitor}</th>
                  </tr>
                </thead>
                <tbody>
                  {c.winsTable.map((row, i) => (
                    <tr key={i}>
                      <td style={{ padding: "12px", borderBottom: "1px solid var(--border)", color: "var(--text)", fontWeight: 500 }}>
                        {row.topic}
                      </td>
                      <td style={{ padding: "12px", borderBottom: "1px solid var(--border)", color: "var(--text-2)", background: row.winner === "us" ? "rgba(60,200,140,0.06)" : "transparent" }}>
                        {row.winner === "us" && <span style={{ color: "var(--ok)", marginRight: 6 }}>✓</span>}
                        {row.us}
                      </td>
                      <td style={{ padding: "12px", borderBottom: "1px solid var(--border)", color: "var(--text-2)", background: row.winner === "them" ? "rgba(60,200,140,0.06)" : "transparent" }}>
                        {row.winner === "them" && <span style={{ color: "var(--ok)", marginRight: 6 }}>✓</span>}
                        {row.them}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Scenarios */}
          <section style={{ marginBottom: 40 }}>
            <h2 className="h-section" style={{ fontSize: 24, marginBottom: 16 }}>
              Wanneer kies je <em>wat</em>?
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
              {c.scenarios.map((sc, i) => (
                <div key={i} className="step-card" style={{ padding: "20px 22px" }}>
                  <div style={{ fontWeight: 500, marginBottom: 12, fontSize: 15 }}>{sc.title}</div>
                  <ul style={{ paddingLeft: 18, color: "var(--text-2)", lineHeight: 1.7, fontSize: 13.5 }}>
                    {sc.options.map((opt, j) => (
                      <li key={j} style={{ marginBottom: 6 }}>{opt}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>

          {/* Verdict */}
          <div style={{ padding: 24, background: "linear-gradient(135deg, rgba(79,140,255,0.08), rgba(0,212,255,0.04))", border: "1px solid var(--border-ac)", borderRadius: 12, marginBottom: 24 }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Ons oordeel</div>
            <p style={{ color: "var(--text)", lineHeight: 1.7, fontSize: 15, margin: 0 }}>{c.verdict}</p>
          </div>

          {/* CTA */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center" }}>
            <Link className="btn btn-primary" href="/diagnose">
              Start gratis diagnose <Icon name="arrow" size={14} />
            </Link>
            <Link className="btn" href="/tools/repareren-of-vervangen">
              Repareren of vervangen? <Icon name="arrow" size={13} />
            </Link>
          </div>
        </div>
      </section>
    </WasFixShell>
  );
}

function ScoreCard({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div
      style={{
        padding: "20px 16px",
        background: highlight ? "linear-gradient(135deg, rgba(79,140,255,0.12), rgba(0,212,255,0.08))" : "var(--surf-2)",
        border: highlight ? "1px solid var(--acc-2)" : "1px solid var(--border)",
        borderRadius: 12,
        textAlign: "center",
      }}
    >
      <div className="mono" style={{ fontSize: 11, color: "var(--muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 36, fontWeight: 300, color: highlight ? "var(--acc-2)" : "var(--text)", letterSpacing: "-0.03em" }}>{value}</div>
    </div>
  );
}
