"use client";

import * as React from "react";
import Link from "next/link";

// 3-tier AVG-compliant consent:
//  - functional: always on (necessary cookies for cart, session)
//  - analytics: opt-in for Vercel Analytics / Plausible (cookieless but track event-level)
//  - marketing: opt-in for retargeting / future ads
//
// Storage: a single cookie `wasfix-consent` (JSON, 365 day, SameSite=Lax).
// We also fire a CustomEvent("wasfix-consent-update", detail) so other modules
// (e.g. analytics loader) can react without polling.

type Consent = {
  functional: true; // always on
  analytics: boolean;
  marketing: boolean;
  ts: number;
};

const COOKIE_NAME = "wasfix-consent";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

function readConsent(): Consent | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.split("; ").find((c) => c.startsWith(`${COOKIE_NAME}=`));
  if (!match) return null;
  try {
    return JSON.parse(decodeURIComponent(match.split("=")[1])) as Consent;
  } catch {
    return null;
  }
}

function writeConsent(c: Consent) {
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(JSON.stringify(c))}; Max-Age=${COOKIE_MAX_AGE}; Path=/; SameSite=Lax`;
  window.dispatchEvent(new CustomEvent("wasfix-consent-update", { detail: c }));
}

export function CookieConsent() {
  const [visible, setVisible] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  const [analytics, setAnalytics] = React.useState(true);
  const [marketing, setMarketing] = React.useState(false);

  React.useEffect(() => {
    const existing = readConsent();
    if (!existing) {
      // Show banner after small delay so SSR text settles
      const t = setTimeout(() => setVisible(true), 600);
      return () => clearTimeout(t);
    }
  }, []);

  const acceptAll = () => {
    writeConsent({ functional: true, analytics: true, marketing: true, ts: Date.now() });
    setVisible(false);
  };
  const rejectAll = () => {
    writeConsent({ functional: true, analytics: false, marketing: false, ts: Date.now() });
    setVisible(false);
  };
  const saveChoices = () => {
    writeConsent({ functional: true, analytics, marketing, ts: Date.now() });
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-labelledby="consent-title"
      aria-describedby="consent-desc"
      style={{
        position: "fixed",
        bottom: 16,
        left: 16,
        right: 16,
        zIndex: 9999,
        maxWidth: 720,
        margin: "0 auto",
        background: "rgba(11, 14, 28, 0.96)",
        backdropFilter: "saturate(140%) blur(14px)",
        WebkitBackdropFilter: "saturate(140%) blur(14px)",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 14,
        padding: "20px 22px",
        color: "#e8eefb",
        boxShadow: "0 24px 60px -20px rgba(0,0,0,0.7)",
        fontFamily: "var(--font-geist), system-ui, -apple-system, sans-serif",
        fontSize: 14,
        lineHeight: 1.55,
      }}
    >
      <div id="consent-title" style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>
        🍪 Cookies & privacy
      </div>
      <div id="consent-desc" style={{ color: "rgba(232,238,251,0.75)", marginBottom: 14 }}>
        We gebruiken essentiële cookies om de site te laten werken. Analytics helpt ons de site te verbeteren. Je kunt op elk moment je keuze wijzigen via{" "}
        <Link href="/cookies" style={{ color: "#7eb3ff", textDecoration: "underline" }}>cookie-instellingen</Link>.
      </div>

      {expanded && (
        <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "12px 14px", marginBottom: 14 }}>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "6px 0", opacity: 0.7 }}>
            <input type="checkbox" checked disabled style={{ marginTop: 3 }} />
            <span>
              <b>Functioneel</b> (altijd aan) — Inloggen, winkelmand, voorkeuren.
            </span>
          </label>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "6px 0", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={analytics}
              onChange={(e) => setAnalytics(e.target.checked)}
              style={{ marginTop: 3 }}
            />
            <span>
              <b>Analytics</b> — Geanonimiseerd page-view-data. Helpt ons fouten en knelpunten zien.
            </span>
          </label>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "6px 0", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={marketing}
              onChange={(e) => setMarketing(e.target.checked)}
              style={{ marginTop: 3 }}
            />
            <span>
              <b>Marketing</b> — Cookies voor retargeting. Standaard uit, alleen aan als je ze nodig hebt voor advertentievoorkeuren.
            </span>
          </label>
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <button
          onClick={acceptAll}
          style={{
            background: "linear-gradient(180deg, #5d97ff, #3b7aff)",
            color: "#fff",
            border: 0,
            borderRadius: 8,
            padding: "9px 16px",
            fontWeight: 500,
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: 13.5,
            boxShadow: "0 0 0 1px rgba(79,140,255,0.4), 0 6px 16px -6px rgba(79,140,255,0.6)",
          }}
        >
          Alles accepteren
        </button>
        <button
          onClick={rejectAll}
          style={{
            background: "rgba(255,255,255,0.06)",
            color: "#e8eefb",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 8,
            padding: "9px 14px",
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: 13.5,
          }}
        >
          Alleen functioneel
        </button>
        {expanded ? (
          <button
            onClick={saveChoices}
            style={{
              background: "transparent",
              color: "#7eb3ff",
              border: "1px solid rgba(126,179,255,0.3)",
              borderRadius: 8,
              padding: "9px 14px",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 13.5,
            }}
          >
            Mijn keuze opslaan
          </button>
        ) : (
          <button
            onClick={() => setExpanded(true)}
            style={{
              background: "transparent",
              color: "rgba(232,238,251,0.75)",
              border: 0,
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 13,
              textDecoration: "underline",
              padding: "9px 0",
              marginLeft: "auto",
            }}
          >
            Aanpassen
          </button>
        )}
      </div>
    </div>
  );
}

// Helper that other modules can use to read current consent state.
export function getConsent(): Consent | null {
  return readConsent();
}
