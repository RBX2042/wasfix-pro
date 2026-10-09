"use client";

import * as React from "react";
import { track, EVT } from "@/lib/analytics";

type Stats = { clicks: number; signups: number; conversions: number; earningsEur: number };

/**
 * The referral link with its counters. Replaces src/components/ReferralWidget.tsx,
 * which promised "€5 per vriend" and credit "verzilverbaar tegen onderdelen" that
 * nothing could pay out. The counters here are what the database holds; the page
 * around this panel says how credit is actually settled.
 */
export function ReferralPanel({ link, code, stats }: { link: string; code: string; stats: Stats }) {
  const [copied, setCopied] = React.useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      track(EVT.REFERRAL_LINK_SHARED, { method: "copy", code });
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked: the link is selectable in the box */ }
  };

  const share = (channel: "whatsapp" | "email") => {
    track(EVT.REFERRAL_LINK_SHARED, { method: channel, code });
    const msg = `Ik gebruik WasFix Pro voor wasmachine-diagnose en onderdelen. Hier is mijn link: ${link}`;
    const urls = {
      whatsapp: `https://wa.me/?text=${encodeURIComponent(msg)}`,
      email: `mailto:?subject=${encodeURIComponent("Aanrader: WasFix Pro")}&body=${encodeURIComponent(msg)}`,
    };
    window.open(urls[channel], "_blank", "noopener,noreferrer");
  };

  return (
    <div className="border rounded-lg p-6 bg-gradient-to-br from-primary/5 to-accent/5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <Stat label="Kliks" value={String(stats.clicks)} />
        <Stat label="Gestart" value={String(stats.signups)} />
        <Stat label="Eerste bestelling betaald" value={String(stats.conversions)} />
        <Stat label="Tegoed (nog niet verrekend)" value={`€${stats.earningsEur.toFixed(2).replace(".", ",")}`} />
      </div>

      <div className="flex gap-2 items-stretch mb-3">
        <div className="flex-1 flex items-center px-3 py-2 bg-background border rounded-md font-mono text-xs overflow-hidden">
          <span className="truncate">{link}</span>
        </div>
        <button onClick={copy} className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors min-h-11">
          {copied ? "✓ Gekopieerd" : "Kopieer"}
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => share("whatsapp")} className="px-3 py-1.5 text-xs border rounded-md hover:bg-muted transition-colors min-h-11">WhatsApp</button>
        <button onClick={() => share("email")} className="px-3 py-1.5 text-xs border rounded-md hover:bg-muted transition-colors min-h-11">E-mail</button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-heading text-xl font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
