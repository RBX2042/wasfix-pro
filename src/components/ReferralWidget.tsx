"use client";

import * as React from "react";
import { track, EVT } from "@/lib/analytics";

// Widget shown in /dashboard — user's referral link + stats.
// Reward: €5 credit per converted paying customer (24-month attribution window).

type Stats = {
  link: string;
  clicks: number;
  signups: number;
  conversions: number;
  earningsEur: number;
};

export function ReferralWidget({ userCode }: { userCode: string }) {
  const link = `https://wasfix.nl/?ref=${userCode}`;
  const [stats, setStats] = React.useState<Stats | null>(null);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    fetch(`/api/referral/stats?code=${userCode}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => setStats(d?.data ?? { link, clicks: 0, signups: 0, conversions: 0, earningsEur: 0 }))
      .catch(() => setStats({ link, clicks: 0, signups: 0, conversions: 0, earningsEur: 0 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userCode]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      track(EVT.REFERRAL_LINK_SHARED, { method: "copy", code: userCode });
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  const share = (channel: "whatsapp" | "email" | "linkedin") => {
    track(EVT.REFERRAL_LINK_SHARED, { method: channel, code: userCode });
    const msg = `Ik gebruik WasFix Pro voor wasmachine-diagnose + onderdelen. Hier is mijn link: ${link}`;
    const urls = {
      whatsapp: `https://wa.me/?text=${encodeURIComponent(msg)}`,
      email: `mailto:?subject=${encodeURIComponent("Aanrader: WasFix Pro")}&body=${encodeURIComponent(msg)}`,
      linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(link)}`,
    };
    window.open(urls[channel], "_blank", "noopener,noreferrer");
  };

  return (
    <div className="border rounded-lg p-6 bg-gradient-to-br from-primary/5 to-accent/5">
      <div className="flex items-start gap-3 mb-4">
        <div className="text-2xl">🎁</div>
        <div className="flex-1">
          <h3 className="font-heading text-lg font-semibold mb-1">Verdien €5 per vriend</h3>
          <p className="text-sm text-muted-foreground">
            Deel je link. Elke nieuwe betalende klant = €5 credit op je account (24 mnd attributie-window).
          </p>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-4 gap-2 mb-4">
          <Stat label="Clicks" value={stats.clicks} />
          <Stat label="Signups" value={stats.signups} />
          <Stat label="Betaald" value={stats.conversions} highlight={stats.conversions > 0} />
          <Stat label="Verdiend" value={`€${stats.earningsEur.toFixed(2)}`} highlight={stats.earningsEur > 0} />
        </div>
      )}

      {/* Link + copy */}
      <div className="flex gap-2 items-stretch mb-3">
        <div className="flex-1 flex items-center px-3 py-2 bg-background border rounded-md font-mono text-xs overflow-hidden">
          <span className="truncate">{link}</span>
        </div>
        <button
          onClick={copy}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          {copied ? "✓ Gekopieerd" : "Kopieer"}
        </button>
      </div>

      {/* Share buttons */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => share("whatsapp")}
          className="px-3 py-1.5 text-xs border rounded-md hover:bg-muted transition-colors flex items-center gap-1.5"
        >
          <span>💬</span> WhatsApp
        </button>
        <button
          onClick={() => share("email")}
          className="px-3 py-1.5 text-xs border rounded-md hover:bg-muted transition-colors flex items-center gap-1.5"
        >
          <span>✉</span> Email
        </button>
        <button
          onClick={() => share("linkedin")}
          className="px-3 py-1.5 text-xs border rounded-md hover:bg-muted transition-colors flex items-center gap-1.5"
        >
          <span>💼</span> LinkedIn
        </button>
      </div>

      <p className="text-xs text-muted-foreground mt-4 leading-relaxed">
        <strong className="text-foreground">Voorwaarden:</strong> Credit wordt geactiveerd wanneer de uitgenodigde persoon zijn eerste betaalde maand voltooit (geen restitutie). Credit is verzilverbaar tegen onderdelen of abonnementsmaanden. Geen contante uitbetaling. Max €500/jaar.
      </p>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <div className="text-center">
      <div className={`font-heading text-xl font-bold ${highlight ? "text-emerald-600" : ""}`}>{value}</div>
      <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
    </div>
  );
}
