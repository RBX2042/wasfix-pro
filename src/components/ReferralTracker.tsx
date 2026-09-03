"use client";

import * as React from "react";

// Captures ?ref=USERCODE from URL and stores in cookie for 30 days.
// On signup or purchase, the cookie is read and the referrer credited.
// Server-side endpoint /api/referral/credit handles the attribution.
//
// Attributie is een marketing-doeleinde, geen noodzakelijke cookie: wasfix-ref
// (30 dagen) en de wasfix-vid die /api/referral/track erbij zet, mogen pas na
// opt-in worden geplaatst (art. 11.7a Telecommunicatiewet). Daarom hetzelfde
// patroon als PostHogProvider/LiveChat: consent-cookie lezen en luisteren naar
// het wasfix-consent-update event. De ?ref-parameter blijft tot die tijd in de
// URL staan, zodat een bezoeker die de banner pas later accepteert alsnog aan
// de juiste verwijzer wordt toegerekend.

const COOKIE_NAME = "wasfix-ref";
const COOKIE_DAYS = 30;

export function ReferralTracker() {
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (!ref) return;
    if (!/^[A-Z0-9]{4,20}$/.test(ref)) return; // basic validation

    let stored = false;

    const storeIfAllowed = (marketingConsent: boolean) => {
      if (stored || !marketingConsent) return;
      stored = true;

      // Set cookie immediately so attribution survives even if the API call fails
      const maxAge = COOKIE_DAYS * 24 * 60 * 60;
      document.cookie = `${COOKIE_NAME}=${encodeURIComponent(ref)}; Max-Age=${maxAge}; Path=/; SameSite=Lax`;

      // Record the click server-side (also issues the anonymous visitor cookie)
      fetch("/api/referral/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: ref, landingPath: window.location.pathname }),
      }).catch(() => { /* attribution is best-effort */ });

      // Fire-and-forget analytics ping
      try {
        // Dynamic import to avoid bundling on every page
        import("@/lib/analytics").then(({ track, EVT }) => {
          track(EVT.REFERRAL_LINK_SHARED, { code: ref, landing: window.location.pathname });
        }).catch(() => {});
      } catch { /* ignore */ }

      // Strip ?ref from URL without reload for cleaner UX
      if (window.history.replaceState) {
        const clean = new URLSearchParams(window.location.search);
        clean.delete("ref");
        const url = window.location.pathname + (clean.toString() ? `?${clean.toString()}` : "") + window.location.hash;
        window.history.replaceState({}, "", url);
      }
    };

    // Read existing consent
    try {
      const match = document.cookie.split("; ").find((c) => c.startsWith("wasfix-consent="));
      if (match) {
        const consent = JSON.parse(decodeURIComponent(match.split("=")[1]));
        if (consent.marketing) storeIfAllowed(true);
      }
    } catch { /* ignore */ }

    // Listen for consent updates
    const onConsent = (e: Event) => {
      const detail = (e as CustomEvent).detail as { marketing?: boolean };
      if (detail?.marketing) storeIfAllowed(true);
    };
    window.addEventListener("wasfix-consent-update", onConsent);
    return () => window.removeEventListener("wasfix-consent-update", onConsent);
  }, []);

  return null;
}
