import { DashboardLayout } from "@/components/dashboard-layout";
import { getCurrentUser, getPlanLimits } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ApiKeysClient } from "./client";

export const metadata = { title: "API keys · WasFix Pro" };
export const dynamic = "force-dynamic";

export default async function ApiKeysPage() {
  const user = await getCurrentUser().catch(() => null);
  if (!user) redirect("/inloggen?next=/dashboard/api-keys");

  const limits = getPlanLimits(user.plan);
  const hasApiAccess = ["MONTEUR_PRO", "BEDRIJF", "API"].includes(user.plan);

  if (!hasApiAccess) {
    return (
      <DashboardLayout role={user.role}>
        <div className="border rounded-lg p-12 text-center bg-gradient-to-br from-primary/5 to-accent/5">
          <h2 className="font-heading text-xl font-bold mb-3">API toegang vereist Monteur Pro</h2>
          <p className="text-muted-foreground mb-6 max-w-md mx-auto">
            B2B REST API is beschikbaar vanaf Monteur Pro (€29/mnd) — 1.000 calls/maand inbegrepen.
          </p>
          <Link href="/upgrade?plan=MONTEUR_PRO" className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium">
            Upgrade naar Monteur Pro
          </Link>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout role={user.role}>
      <div className="space-y-6">
        <div>
          <h1 className="font-heading text-2xl font-bold">API keys</h1>
          <p className="text-muted-foreground text-sm">
            Beheer je API keys. Documentatie: <Link href="/api-docs" className="text-primary hover:underline">/api-docs</Link>
          </p>
        </div>

        <ApiKeysClient userPlan={user.plan} apiCallLimit={1000} />

        {/* Usage stats */}
        <div className="border rounded-lg p-6">
          <h2 className="font-heading text-lg font-semibold mb-4">Usage deze maand</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Calls" value="0" sub="van 1.000" />
            <Stat label="/diagnose" value="0" sub="van 100" />
            <Stat label="/parts" value="0" sub="onbeperkt" />
            <Stat label="/errorcodes" value="0" sub="onbeperkt" />
          </div>
          <p className="text-xs text-muted-foreground mt-4">
            Stats updaten elke 5 minuten. Bij overschrijden 1.000/mnd: extra calls €0.001 elk, max €50 extra/mnd.
          </p>
        </div>

        <div className="border rounded-lg p-6 bg-muted/30 text-sm">
          <p className="font-medium mb-2">Plan-overzicht: {user.plan}</p>
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
            <li>API rate limit: {user.plan === "BEDRIJF" ? "10.000" : user.plan === "API" ? "Onbeperkt" : "1.000"} calls/maand</li>
            <li>Onderdelen-korting: {Math.round(limits.partsDiscount * 100)}%</li>
            <li>AI diagnoses: {limits.diagnosesPerMonth === -1 ? "Onbeperkt" : limits.diagnosesPerMonth}</li>
          </ul>
        </div>
      </div>
    </DashboardLayout>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="border rounded-md p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-heading text-2xl font-bold mt-1">{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{sub}</div>
    </div>
  );
}
