"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supportHint } from "@/lib/support-hint";

/** Serialisable form of SubscriptionNotice (src/lib/subscription.ts): dates as ISO strings, plan as its display name. */
export type BannerNotice =
  | { kind: "past_due"; planName: string; graceEndsAt: string | null; lapsed: boolean }
  | { kind: "payment_required"; planName: string }
  | { kind: "ending"; planName: string; endsAt: string };

// Fixed zone: the server renders this too.
const DATE = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" });
const fmt = (iso: string) => DATE.format(new Date(iso));

/**
 * What the customer must know about their subscription: a failed payment (with
 * the way to fix it: the billing portal), an unpaid one, or a cancellation that
 * is already scheduled. A failed renewal is the one that earns money back, so
 * it comes with a button, not just a sentence.
 */
export function SubscriptionBanner({ notice, supportEmail = null }: { notice: BannerNotice; supportEmail?: string | null }) {
  const [busy, setBusy] = useState(false);

  async function openPortal() {
    setBusy(true);
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      toast.error(data.error ?? `Het klantportaal kon niet worden geopend. Probeer het zo opnieuw of ${supportHint(supportEmail)}.`);
    } catch {
      toast.error("Geen verbinding met de server. Probeer het opnieuw.");
    } finally {
      setBusy(false);
    }
  }

  let tone = "border-amber-500/50 bg-amber-50 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100";
  let text: string;
  let action: string | null = "Betaalmethode bijwerken";

  switch (notice.kind) {
    case "past_due":
      if (notice.lapsed) {
        tone = "border-rose-500/50 bg-rose-50 text-rose-950 dark:bg-rose-950/30 dark:text-rose-100";
        text = `De betaling voor je ${notice.planName}-abonnement is niet gelukt en de uitstelperiode is voorbij. Je valt daarom terug op Gratis. Werk je betaalmethode bij om ${notice.planName} te herstellen.`;
      } else {
        text = `De laatste betaling voor je ${notice.planName}-abonnement is niet gelukt. Werk je betaalmethode bij${notice.graceEndsAt ? ` vóór ${fmt(notice.graceEndsAt)}` : ""}, anders valt je abonnement terug op Gratis.`;
      }
      break;
    case "payment_required":
      tone = "border-rose-500/50 bg-rose-50 text-rose-950 dark:bg-rose-950/30 dark:text-rose-100";
      text = `Je ${notice.planName}-abonnement staat open voor betaling en is niet actief. Werk je betaalmethode bij en reken de openstaande factuur af om het te herstellen.`;
      break;
    case "ending":
      tone = "border-sky-500/50 bg-sky-50 text-sky-950 dark:bg-sky-950/30 dark:text-sky-100";
      text = `Je ${notice.planName}-abonnement is opgezegd en loopt af op ${fmt(notice.endsAt)}. Tot die dag houd je alle voordelen; daarna val je terug op Gratis.`;
      action = "Beheer abonnement";
      break;
  }

  return (
    <div role="alert" data-testid={`subscription-banner-${notice.kind}`} className={`flex flex-col gap-3 rounded-lg border p-4 text-sm sm:flex-row sm:items-center sm:justify-between ${tone}`}>
      <p>{text}</p>
      {action && (
        <Button type="button" size="sm" variant="outline" onClick={openPortal} disabled={busy} className="shrink-0 bg-background">
          {busy ? "Bezig…" : action}
        </Button>
      )}
    </div>
  );
}
