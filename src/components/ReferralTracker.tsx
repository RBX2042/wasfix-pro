"use client";

import * as React from "react";

// Captures ?ref=USERCODE from URL and stores in cookie for 30 days.
// On signup or purchase, the cookie is read and the referrer credited.
// Server-side endpoint /api/referral/credit handles the attribution.

const COOKIE_NAME = "wasfix-ref";
const COOKIE_DAYS = 30;

export function ReferralTracker() {
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (!ref) return;
    if (!/^[A-Z0-9]{4,20}$/.test(ref)) return; // basic validation

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
      params.delete("ref");
      const clean = window.location.pathname + (params.toString() ? `?${params.toString()}` : "") + window.location.hash;
      window.history.replaceState({}, "", clean);
    }
  }, []);

  return null;
}
