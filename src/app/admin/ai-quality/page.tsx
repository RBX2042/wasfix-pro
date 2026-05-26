import { DashboardLayout } from "@/components/dashboard-layout";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";

export const metadata = { title: "AI Quality · WasFix Admin", robots: "noindex" };
export const dynamic = "force-dynamic";

// AI Quality Loop dashboard — scaffold with metrics that get populated
// from diagnose_feedback events once data accumulates.
export default async function AiQualityPage() {
  const user = await getCurrentUser().catch(() => null);
  if (!user) redirect("/inloggen?next=/admin/ai-quality");
  if (user.role !== "ADMIN" && user.role !== "BUSINESS") redirect("/");

  // Demo metrics — to be replaced by Diagnosis.findMany + aggregate on real data
  const stats = {
    last30dDiagnoses: 2147,
    feedbackResponses: 612,
    feedbackRate: 28.5,
    accuracyRate: 87.4,
    topAccurate: [
      { brand: "Bosch", code: "E18", accuracy: 96, samples: 142 },
      { brand: "Miele", code: "F11", accuracy: 94, samples: 87 },
      { brand: "Samsung", code: "OE", accuracy: 92, samples: 76 },
    ],
    topMismatches: [
      { brand: "Whirlpool", code: "F14", accuracy: 62, samples: 23, hint: "Module-error too broadly diagnosed — needs photo-based refinement" },
      { brand: "AEG", code: "E68", accuracy: 65, samples: 17, hint: "Aardlek vaak verward met element-short" },
      { brand: "LG", code: "LE1", accuracy: 71, samples: 14, hint: "Direct Drive sensor — confidence drops on older models" },
    ],
  };

  return (
    <DashboardLayout role={user.role}>
      <div className="space-y-6">
        <div>
          <h1 className="font-heading text-2xl font-bold">AI Quality</h1>
          <p className="text-muted-foreground text-sm">Confidence calibration, mismatch detection, retraining queue</p>
        </div>

        <div className="grid md:grid-cols-4 gap-3">
          <KpiCard label="Diagnoses (30d)" value={stats.last30dDiagnoses.toLocaleString("nl-NL")} />
          <KpiCard label="Feedback responses" value={stats.feedbackResponses.toLocaleString("nl-NL")} />
          <KpiCard label="Response rate" value={`${stats.feedbackRate}%`} />
          <KpiCard label="Accuracy" value={`${stats.accuracyRate}%`} positive />
        </div>

        <div className="grid lg:grid-cols-2 gap-4">
          <div className="border rounded-lg p-5">
            <h3 className="font-semibold mb-3">Beste accuratesse (top 3)</h3>
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                <tr><th className="text-left pb-2">Code</th><th className="text-right pb-2">Accuracy</th><th className="text-right pb-2">Samples</th></tr>
              </thead>
              <tbody>
                {stats.topAccurate.map((row) => (
                  <tr key={`${row.brand}-${row.code}`} className="border-t">
                    <td className="py-2 font-mono text-xs">{row.brand} {row.code}</td>
                    <td className="py-2 text-right text-emerald-600 tabular-nums">{row.accuracy}%</td>
                    <td className="py-2 text-right tabular-nums">{row.samples}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="border rounded-lg p-5">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <span className="text-amber-500">⚠</span> Mismatches (top 3)
            </h3>
            <div className="space-y-3">
              {stats.topMismatches.map((row) => (
                <div key={`${row.brand}-${row.code}`} className="border-l-2 border-amber-500 pl-3">
                  <div className="flex justify-between items-baseline gap-2">
                    <span className="font-mono text-xs font-medium">{row.brand} {row.code}</span>
                    <span className="text-amber-600 text-sm tabular-nums">{row.accuracy}% ({row.samples} samples)</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{row.hint}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="border rounded-lg p-5">
          <h3 className="font-semibold mb-3">Retraining cycle</h3>
          <ol className="text-sm space-y-2 text-muted-foreground list-decimal pl-5">
            <li><strong className="text-foreground">Wekelijks</strong>: Export feedback events naar <code className="bg-muted px-1.5 py-0.5 rounded text-xs">data/feedback-export-YYYY-MM-DD.jsonl</code></li>
            <li><strong className="text-foreground">Analyseren</strong>: Mismatches groeperen op brand+code → top-10 priority list</li>
            <li><strong className="text-foreground">Prompt-aanpassing</strong>: Few-shot examples toevoegen voor mismatched codes in <code className="bg-muted px-1.5 py-0.5 rounded text-xs">src/lib/ai/prompts/</code></li>
            <li><strong className="text-foreground">A/B test</strong>: Nieuw prompt-template via PostHog feature flag → 10% van traffic</li>
            <li><strong className="text-foreground">Promote</strong>: Bij accuracy verbetering &gt;3%, nieuwe prompt vastpinnen</li>
          </ol>
        </div>

        <p className="text-xs text-muted-foreground border-t pt-4">
          Demo-data — werkelijke metrics populeren wanneer feedback-events accumuleren in DB. Run wekelijks <code className="bg-muted px-1.5 py-0.5 rounded">node scripts/export-ai-feedback.mjs</code> voor handmatige analyse.
        </p>
      </div>
    </DashboardLayout>
  );
}

function KpiCard({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="border rounded-lg p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`font-heading text-2xl font-bold mt-1 ${positive ? "text-emerald-600" : ""}`}>{value}</div>
    </div>
  );
}
