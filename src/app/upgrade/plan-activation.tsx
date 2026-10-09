"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { supportHint } from "@/lib/support-hint";

/** What the server knew when the page was rendered; the same fields /api/user/plan returns. */
export type PlanSnapshot = {
  plan: string;
  planName: string;
  subscriptionStatus: string | null;
  /** ISO date. For a trial this is the day of the first payment. */
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  partsDiscountWhenPaying: number;
};

const POLL_EVERY_MS = 2000;
const POLL_FOR_MS = 40_000;

// Fixed time zone: the server renders this text too, and two zones would make hydration disagree.
const DATE = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" });
const formatDate = (iso: string | null) => (iso ? DATE.format(new Date(iso)) : null);

const BUSINESS = new Set(["MONTEUR_PRO", "BEDRIJF", "API"]);

/**
 * The confirmation after paying, shared by /upgrade?success and /dashboard?upgraded=1.
 *
 * The customer comes back from Stripe before our webhook has necessarily
 * written the plan, so for a short while the account still reads FREE. Instead
 * of showing "Gratis" with an upgrade prompt to someone who has just paid, this
 * polls /api/user/plan for up to 40 seconds, then refreshes the server-rendered
 * page behind it. If the plan has not appeared by then it says so honestly.
 */
export function PlanActivation({ initial, expectedPlan, supportEmail = null }: { initial: PlanSnapshot; expectedPlan?: string; supportEmail?: string | null }) {
  const router = useRouter();
  const [snap, setSnap] = React.useState(initial);
  const arrived = (s: PlanSnapshot) => s.plan !== "FREE" && (!expectedPlan || s.plan === expectedPlan);
  const [timedOut, setTimedOut] = React.useState(false);
  const isIn = arrived(snap);

  React.useEffect(() => {
    if (arrived(initial)) return;
    let stopped = false;
    const started = Date.now();
    const tick = async () => {
      if (stopped) return;
      try {
        const res = await fetch("/api/user/plan", { cache: "no-store", credentials: "same-origin" });
        if (res.status === 401) return; // signed out: nothing to wait for
        if (res.ok) {
          const j = await res.json();
          const next: PlanSnapshot = {
            plan: j.plan,
            planName: j.planName,
            subscriptionStatus: j.subscriptionStatus ?? null,
            currentPeriodEnd: j.currentPeriodEnd ?? null,
            cancelAtPeriodEnd: !!j.cancelAtPeriodEnd,
            partsDiscountWhenPaying: Number(j.partsDiscountWhenPaying ?? 0),
          };
          if (arrived(next)) {
            setSnap(next);
            try { sessionStorage.removeItem("wasfix-member-discount"); } catch { /* storage blocked */ }
            router.refresh(); // the server-rendered plan, nav and banners behind this card
            return;
          }
        }
      } catch {
        /* network blip: try again */
      }
      if (Date.now() - started >= POLL_FOR_MS) {
        setTimedOut(true);
        return;
      }
      setTimeout(tick, POLL_EVERY_MS);
    };
    const first = setTimeout(tick, POLL_EVERY_MS);
    return () => {
      stopped = true;
      clearTimeout(first);
    };
    // The snapshot we start from is the only input; polling must not restart when it updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isIn) {
    return (
      <div role="status" aria-live="polite" className="rounded-lg border bg-muted/30 p-5 text-sm">
        {timedOut ? (
          <>
            <p className="font-medium">Je abonnement is nog niet zichtbaar.</p>
            <p className="text-muted-foreground mt-1">
              Heb je zojuist afgerekend, dan kan het verwerken tot enkele minuten duren; je ontvangt een bevestiging per e-mail zodra het actief is.
              Ververs deze pagina over een paar minuten. Staat het er daarna nog niet, {supportHint(supportEmail)} en noem het e-mailadres van je account.
            </p>
          </>
        ) : (
          <p className="flex items-center gap-2 font-medium">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> We verwerken je betaling… dit duurt meestal een paar seconden.
          </p>
        )}
      </div>
    );
  }

  const trialing = snap.subscriptionStatus === "trialing";
  const date = formatDate(snap.currentPeriodEnd);
  const discount = Math.round(snap.partsDiscountWhenPaying * 100);
  const business = BUSINESS.has(snap.plan);

  return (
    <div role="status" className="rounded-lg border border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/30 p-5 space-y-3">
      <p className="flex items-start gap-2 font-semibold">
        <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" aria-hidden />
        <span>
          {trialing ? `Je ${snap.planName}-proefperiode is gestart.` : `Je ${snap.planName}-abonnement is actief.`}
        </span>
      </p>
      <ul className="text-sm space-y-1 text-muted-foreground pl-7 list-disc">
        {trialing && date && <li>Je eerste betaling is op <strong className="text-foreground">{date}</strong>. Tot die dag betaal je niets en opzeggen kan zonder kosten.</li>}
        {!trialing && date && !snap.cancelAtPeriodEnd && <li>Volgende verlenging: <strong className="text-foreground">{date}</strong>.</li>}
        {snap.cancelAtPeriodEnd && date && <li>Je abonnement loopt af op <strong className="text-foreground">{date}</strong> en wordt niet verlengd.</li>}
        {discount > 0 && <li>De {discount}% korting op onderdelen gaat in zodra je eerste betaling is voldaan, niet tijdens de proefperiode.</li>}
        <li>Opzeggen of je betaalmethode wijzigen kan altijd via <Link href="/dashboard/profiel" className="underline">Profiel &amp; abonnement</Link>.</li>
      </ul>
      <div className="flex flex-wrap gap-2 pl-7">
        {business ? (
          <>
            <Link href="/monteur/dashboard" className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">Naar je monteur-dashboard</Link>
            <Link href="/dashboard/api-keys" className="inline-flex h-10 items-center rounded-md border px-4 text-sm font-medium">API-key aanmaken</Link>
            <Link href="/monteur/onderdelen" className="inline-flex h-10 items-center rounded-md border px-4 text-sm font-medium">Onderdelen</Link>
          </>
        ) : (
          <>
            <Link href="/diagnose" className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">Start een diagnose</Link>
            <Link href="/dashboard" className="inline-flex h-10 items-center rounded-md border px-4 text-sm font-medium">Naar je dashboard</Link>
          </>
        )}
      </div>
    </div>
  );
}
