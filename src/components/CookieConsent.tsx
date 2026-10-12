"use client";

import * as React from "react";
import Link from "next/link";

// 3-tier AVG-compliant consent:
//  - functional: always on (necessary cookies for cart, session)
//  - analytics: opt-in for Vercel Analytics / Speed Insights / optional PostHog + GA4
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

// Layout: a compact bar along the bottom edge. The first version was a 16px-inset
// card with 20px padding and a 15px headline: 259px tall (32% of a 375x812 phone,
// 66% expanded) and, appearing 600ms after load, the largest paint on the page - so
// for every first-time visitor the cookie text WAS the LCP element (3.4s against
// 0.9s once the consent cookie existed). Now: two short lines at 12.5px, buttons
// 44px tall (the tap-target minimum), and the detailed choices open as a scrollable
// sheet only when asked for.
const BTN: React.CSSProperties = {
  flex: "1 1 0",
  minWidth: 0,
  minHeight: 44,
  borderRadius: 8,
  padding: "6px 10px",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 13.5,
  fontWeight: 500,
  // Wrap, do not clip: "Mijn keuze opslaan" is wider than a third of a 375 px screen.
  whiteSpace: "normal",
  lineHeight: 1.25,
};

export function CookieConsent() {
  const [visible, setVisible] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  // Not pre-ticked: consent has to be an active act (CJEU Planet49, Autoriteit
  // Persoonsgegevens). The panel used to open with Analytics already ticked, so
  // "Mijn keuze opslaan" without touching anything recorded analytics: true.
  const [analytics, setAnalytics] = React.useState(false);
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
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        maxHeight: "70vh",
        overflowY: "auto",
        // Theme tokens, not literals: the banner is on every first visit, in both themes.
        background: "hsl(var(--popover))",
        borderTop: "1px solid hsl(var(--input))",
        padding: "10px 14px calc(10px + env(safe-area-inset-bottom))",
        color: "hsl(var(--popover-foreground))",
        boxShadow: "0 -8px 30px -12px hsl(0 0% 0% / 0.35)",
        fontFamily: "var(--font-geist), system-ui, -apple-system, sans-serif",
        fontSize: 12.5,
        lineHeight: 1.45,
      }}
    >
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <p id="consent-desc" style={{ margin: "0 0 8px", color: "hsl(var(--muted-foreground))", fontSize: 12.5 }}>
          <span id="consent-title" style={{ fontWeight: 600, color: "hsl(var(--foreground))" }}>Cookies. </span>
          Functionele cookies zijn nodig; analytics alleen met jouw toestemming.{" "}
          <Link href="/cookies" style={{ color: "hsl(var(--primary))", textDecoration: "underline" }}>Meer info</Link>
        </p>

        {expanded && (
          <div style={{ background: "hsl(var(--muted))", border: "1px solid hsl(var(--border))", borderRadius: 10, padding: "6px 12px", marginBottom: 10 }}>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0", opacity: 0.7 }}>
              <input type="checkbox" checked disabled style={{ marginTop: 2, width: 18, height: 18 }} />
              <span>
                <b>Functioneel</b> (altijd aan) — inloggen, winkelmand, voorkeuren.
              </span>
            </label>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={analytics}
                onChange={(e) => setAnalytics(e.target.checked)}
                style={{ marginTop: 2, width: 18, height: 18 }}
              />
              <span>
                <b>Analytics</b> — meet welke pagina&apos;s en stappen bezoekers gebruiken (zonder e-mail of naam), zodat we fouten en knelpunten zien.
              </span>
            </label>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={marketing}
                onChange={(e) => setMarketing(e.target.checked)}
                style={{ marginTop: 2, width: 18, height: 18 }}
              />
              <span>
                <b>Marketing</b> — verwijzingscookies voor ons doorverwijsprogramma. Standaard uit.
              </span>
            </label>
          </div>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={acceptAll}
            style={{ ...BTN, background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))", border: "1px solid hsl(var(--primary))" }}
          >
            Alles accepteren
          </button>
          <button
            onClick={rejectAll}
            style={{ ...BTN, background: "hsl(var(--secondary))", color: "hsl(var(--secondary-foreground))", border: "1px solid hsl(var(--input))" }}
          >
            Alleen functioneel
          </button>
          {expanded ? (
            <button
              onClick={saveChoices}
              style={{ ...BTN, background: "transparent", color: "hsl(var(--primary))", border: "1px solid hsl(var(--primary))" }}
            >
              Mijn keuze opslaan
            </button>
          ) : (
            <button
              onClick={() => setExpanded(true)}
              style={{ ...BTN, flex: "0 0 auto", background: "transparent", color: "hsl(var(--foreground))", border: "1px solid transparent", textDecoration: "underline" }}
            >
              Aanpassen
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Helper that other modules can use to read current consent state.
export function getConsent(): Consent | null {
  return readConsent();
}
