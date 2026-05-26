"use client";

import * as React from "react";

// Crisp.chat live chat — env-gated.
// To activate: set NEXT_PUBLIC_CRISP_WEBSITE_ID in Vercel env.
// Without it, this component renders nothing (no script loaded).
//
// We respect cookie consent: chat only loads after analytics-or-marketing consent
// (since Crisp drops a session cookie).

const CRISP_ID = process.env.NEXT_PUBLIC_CRISP_WEBSITE_ID;

export function LiveChat() {
  React.useEffect(() => {
    if (typeof window === "undefined" || !CRISP_ID) return;

    const loadCrisp = () => {
      // Already loaded?
      if ((window as unknown as { $crisp?: unknown[] }).$crisp) return;
      const w = window as unknown as { $crisp: unknown[]; CRISP_WEBSITE_ID: string };
      w.$crisp = [];
      w.CRISP_WEBSITE_ID = CRISP_ID;
      const s = document.createElement("script");
      s.src = "https://client.crisp.chat/l.js";
      s.async = true;
      document.head.appendChild(s);
    };

    // Check consent
    try {
      const match = document.cookie.split("; ").find((c) => c.startsWith("wasfix-consent="));
      if (match) {
        const consent = JSON.parse(decodeURIComponent(match.split("=")[1]));
        if (consent.analytics || consent.marketing) loadCrisp();
      }
    } catch { /* ignore */ }

    // Listen for consent updates
    const onConsent = (e: Event) => {
      const detail = (e as CustomEvent).detail as { analytics?: boolean; marketing?: boolean };
      if (detail?.analytics || detail?.marketing) loadCrisp();
    };
    window.addEventListener("wasfix-consent-update", onConsent);
    return () => window.removeEventListener("wasfix-consent-update", onConsent);
  }, []);

  return null;
}
