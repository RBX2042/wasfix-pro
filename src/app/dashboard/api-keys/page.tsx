import { DashboardLayout } from "@/components/dashboard-layout";
import { getCurrentUser, getPlanLimits, planDisplayName } from "@/lib/auth";
import { apiAllowanceFor, apiQuotaKeyFor } from "@/lib/api-auth";
import { getPlan } from "@/lib/plans";
import { prisma } from "@/lib/prisma";
import { isDatabaseConfigured } from "@/lib/env";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ApiKeysClient } from "./client";

export const metadata = { title: "API keys · WasFix Pro" };
export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" });
const num = (n: number) => n.toLocaleString("nl-NL");

export default async function ApiKeysPage() {
  const user = await getCurrentUser().catch(() => null);
  if (!user) redirect("/inloggen?next=/dashboard/api-keys");

  const limits = getPlanLimits(user);
  // The same function the API itself applies on every request, with the plan the
  // account is entitled to now: what this page says is what a call will get.
  const allowance = apiAllowanceFor(user.plan);
  const planName = planDisplayName(user.plan);

  // Real usage only: the allowance counter the API spends from (see api-auth.ts apiQuotaKeyFor).
  let used: number | null = null;
  let resetsAt: Date | null = null;
  let activeKeys = 0;
  if (allowance && isDatabaseConfigured()) {
    try {
      const counter = await prisma.usageCounter.findUnique({ where: { scope_key: { scope: "api", key: apiQuotaKeyFor(user.id) } } });
      const live = !!counter && counter.windowEnd >= new Date();
      used = live ? counter!.count : 0;
      resetsAt = live ? counter!.windowEnd : null;
    } catch {
      used = null; // unreadable: say nothing rather than a made-up zero
    }
  }
  if (isDatabaseConfigured()) {
    activeKeys = await prisma.apiKey.count({ where: { userId: user.id, revokedAt: null } }).catch(() => 0);
  }

  if (!allowance && activeKeys === 0) {
    return (
      <DashboardLayout role={user.role}>
        <div className="border rounded-lg p-12 text-center bg-gradient-to-br from-primary/5 to-accent/5">
          <h2 className="font-heading text-xl font-bold mb-3">API toegang vereist Monteur Pro</h2>
          <p className="text-muted-foreground mb-6 max-w-md mx-auto">
            De B2B REST API is beschikbaar vanaf Monteur Pro (€29/mnd excl. btw) — {num(getPlan("MONTEUR_PRO").apiCallsPerMonth)} calls per maand inbegrepen.
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

        {!allowance && (
          <div role="alert" className="border border-amber-500/50 bg-amber-50 dark:bg-amber-950/30 rounded-lg p-4 text-sm">
            <p className="font-medium">Je keys zijn uitgeschakeld.</p>
            <p className="text-muted-foreground mt-1">
              Je huidige plan ({planName}) bevat geen API. Zolang dat zo is, antwoorden je keys met HTTP 402. Je kunt ze hieronder nog wel intrekken.{" "}
              <Link href="/upgrade?plan=MONTEUR_PRO" className="text-primary hover:underline">Monteur Pro afsluiten</Link> zet ze weer aan.
            </p>
          </div>
        )}

        <ApiKeysClient canCreate={!!allowance} />

        {allowance && (
          <div className="border rounded-lg p-6">
            <h2 className="font-heading text-lg font-semibold mb-4">Gebruik deze periode</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Stat label="Calls" value={used === null ? "—" : num(used)} sub={`van ${num(allowance.monthlyCalls)} per 30 dagen`} />
              <Stat label="Periode" value={resetsAt ? DATE.format(resetsAt) : "—"} sub={resetsAt ? "tot dan geldt je teller" : "start bij je eerste call"} />
              <Stat label="Per uur" value={num(allowance.hourlyBurst)} sub="calls, alle endpoints samen" />
            </div>
            <p className="text-xs text-muted-foreground mt-4">
              De teller geldt voor je hele account, niet per key. Is je limiet op, dan antwoordt de API met HTTP 429 tot de periode is verlopen; er worden geen extra calls in rekening gebracht.
            </p>
          </div>
        )}

        <div className="border rounded-lg p-6 bg-muted/30 text-sm">
          <p className="font-medium mb-2">Plan-overzicht: {planName}</p>
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
            <li>API: {allowance ? `${num(allowance.monthlyCalls)} calls per maand, maximaal ${num(allowance.hourlyBurst)} per uur` : "niet inbegrepen"}</li>
            <li>Onderdelen-korting: {Math.round(limits.partsDiscount * 100)}%{user.subscriptionStatus === "trialing" && limits.partsDiscountWhenPaying > 0 ? ` (${Math.round(limits.partsDiscountWhenPaying * 100)}% na je eerste betaling)` : ""}</li>
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
