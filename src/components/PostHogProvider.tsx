"use client";

import * as React from "react";

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com";

// Lightweight PostHog loader — initialized once on client after consent.
// Listens to wasfix-consent-update events from CookieConsent component.
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  React.useEffect(() => {
    if (!POSTHOG_KEY) return; // not configured → no-op

    let initialized = false;

    const initIfAllowed = (analyticsConsent: boolean) => {
      if (initialized || !analyticsConsent) return;
      initialized = true;
      // Dynamically import posthog-js — package optional, only loaded if installed.
      // Webpack ignore-comment keeps build green when the package is absent.
      // @ts-expect-error -- optional dependency, may not be installed
      import(/* webpackIgnore: true */ "posthog-js")
        .then((mod) => {
          const posthog = mod.default ?? mod;
          posthog.init(POSTHOG_KEY, {
            api_host: POSTHOG_HOST,
            person_profiles: "identified_only",
            capture_pageview: true,
            capture_pageleave: true,
            disable_session_recording: true,
          });
          (window as unknown as { posthog: typeof posthog }).posthog = posthog;
        })
        .catch(() => { /* dependency not installed — no-op */ });
    };

    // Read existing consent
    try {
      const match = document.cookie.split("; ").find((c) => c.startsWith("wasfix-consent="));
      if (match) {
        const consent = JSON.parse(decodeURIComponent(match.split("=")[1]));
        if (consent.analytics) initIfAllowed(true);
      }
    } catch { /* ignore */ }

    // Listen for consent updates
    const onConsent = (e: Event) => {
      const detail = (e as CustomEvent).detail as { analytics?: boolean };
      if (detail?.analytics) initIfAllowed(true);
    };
    window.addEventListener("wasfix-consent-update", onConsent);
    return () => window.removeEventListener("wasfix-consent-update", onConsent);
  }, []);

  return <>{children}</>;
}
