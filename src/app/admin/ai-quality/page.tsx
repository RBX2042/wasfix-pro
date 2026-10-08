import { DashboardLayout } from "@/components/dashboard-layout";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { isDatabaseConfigured } from "@/lib/env";
import { AdminShell } from "../_lib/page-shell";
import { AdminNav } from "../_lib/admin-nav";

export const metadata = { title: "AI-kwaliteit · WasFix Admin", robots: "noindex" };
export const dynamic = "force-dynamic";

/**
 * What users say about the diagnoses, from the database and nothing else.
 *
 * This page used to show invented numbers (2.147 diagnoses, 87,4% "accuracy", per-code
 * accuracy tables) with a small "demo data" line at the bottom. Nothing here is measured
 * accuracy: DiagnosisFeedback only holds the thumbs up or down a user gave, so the page
 * says exactly that and shows counts.
 */
export default async function AiQualityPage() {
  const user = await getCurrentUser().catch(() => null);
  if (!user) redirect("/inloggen?next=/admin/ai-quality");
  if (user.role !== "ADMIN" && user.role !== "BUSINESS") redirect("/");

  const since = new Date(Date.now() - 30 * 86_400_000);
  let data: {
    diagnoses: number;
    up: number;
    down: number;
    byBrand: Array<{ brand: string; down: number; diagnoses: number }>;
  } | null = null;

  if (isDatabaseConfigured()) {
    try {
      const [diagnoses, up, down, downRows, brandCounts] = await Promise.all([
        prisma.diagnosis.count({ where: { createdAt: { gte: since } } }),
        prisma.diagnosisFeedback.count({ where: { createdAt: { gte: since }, rating: "up" } }),
        prisma.diagnosisFeedback.count({ where: { createdAt: { gte: since }, rating: "down" } }),
        prisma.diagnosisFeedback.findMany({ where: { createdAt: { gte: since }, rating: "down", diagnosisId: { not: null } }, select: { diagnosisId: true }, take: 1000 }),
        prisma.diagnosis.groupBy({ by: ["brand"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
      ]);
      const ids = downRows.map((r) => r.diagnosisId).filter((v): v is string => !!v);
      const downDiagnoses = ids.length ? await prisma.diagnosis.findMany({ where: { id: { in: ids } }, select: { brand: true } }) : [];
      const downByBrand = new Map<string, number>();
      for (const d of downDiagnoses) downByBrand.set(d.brand, (downByBrand.get(d.brand) ?? 0) + 1);
      const totals = new Map(brandCounts.map((b) => [b.brand, b._count._all]));
      const byBrand = [...downByBrand.entries()]
        .map(([brand, n]) => ({ brand, down: n, diagnoses: totals.get(brand) ?? 0 }))
        .sort((a, b) => b.down - a.down)
        .slice(0, 8);
      data = { diagnoses, up, down, byBrand };
    } catch {
      data = null;
    }
  }

  const responses = data ? data.up + data.down : 0;
  const nl = (n: number) => n.toLocaleString("nl-NL");

  return (
    <DashboardLayout role={user.role}>
      <AdminShell>
        <AdminNav current="/admin/ai-quality" />
        <div className="space-y-6">
          <div>
            <h1 className="font-heading text-2xl font-bold">AI-kwaliteit</h1>
            <p className="text-muted-foreground text-sm">Wat gebruikers de afgelopen 30 dagen over de diagnoses hebben aangegeven.</p>
          </div>

          {!data ? (
            <p className="rounded-lg border p-5 text-sm text-muted-foreground">Geen databaseverbinding: er zijn geen cijfers om te tonen.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <KpiCard label="Diagnoses (30 dagen)" value={nl(data.diagnoses)} />
                <KpiCard label="Duim omhoog" value={nl(data.up)} />
                <KpiCard label="Duim omlaag" value={nl(data.down)} />
                <KpiCard label="Reageert met feedback" value={data.diagnoses > 0 ? `${((responses / data.diagnoses) * 100).toFixed(1).replace(".", ",")}%` : "–"} />
              </div>
              <p className="rounded-lg border bg-muted/30 p-4 text-sm">
                Dit zijn aantallen uit de database, geen gemeten nauwkeurigheid: alleen gebruikers die op een duim klikken tellen mee, en we weten niet of de diagnose klopte.
                {responses === 0 && " Er is de afgelopen 30 dagen nog geen feedback binnengekomen."}
              </p>

              <div className="rounded-lg border p-5">
                <h2 className="mb-3 font-semibold">Merken met de meeste duimen omlaag</h2>
                {data.byBrand.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nog geen negatieve feedback die aan een diagnose is gekoppeld.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                        <tr><th className="pb-2 text-left">Merk</th><th className="pb-2 text-right">Duim omlaag</th><th className="pb-2 text-right">Diagnoses</th></tr>
                      </thead>
                      <tbody>
                        {data.byBrand.map((r) => (
                          <tr key={r.brand} className="border-t">
                            <td className="py-2">{r.brand}</td>
                            <td className="py-2 text-right tabular-nums">{nl(r.down)}</td>
                            <td className="py-2 text-right tabular-nums">{nl(r.diagnoses)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </AdminShell>
    </DashboardLayout>
  );
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 font-heading text-2xl font-bold">{value}</div>
    </div>
  );
}
