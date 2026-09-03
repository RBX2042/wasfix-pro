"use client";

import * as React from "react";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

// Vercel Analytics en Speed Insights hingen in de root layout buiten elke
// toestemmingscheck, terwijl /cookies van precies deze twee belooft dat ze
// "alleen geplaatst na expliciete toestemming" zijn. Ze zetten geen cookie,
// maar leiden een bezoeker-hash af uit kenmerken van apparaat en verzoek —
// dat is uitlezen van gegevens op de randapparatuur en dus toestemmingsplichtig
// (art. 11.7a Telecommunicatiewet, art. 5 lid 3 ePrivacy).
//
// Zelfde patroon als PostHogProvider en LiveChat: de wasfix-consent-cookie
// lezen en luisteren naar het wasfix-consent-update event van CookieConsent.
// De scripts mounten pas ná opt-in; de eerste render is bewust leeg zodat
// server- en client-HTML gelijk zijn.
export function ConsentedAnalytics() {
  const [allowed, setAllowed] = React.useState(false);

  React.useEffect(() => {
    // Read existing consent
    try {
      const match = document.cookie.split("; ").find((c) => c.startsWith("wasfix-consent="));
      if (match) {
        const consent = JSON.parse(decodeURIComponent(match.split("=")[1]));
        if (consent.analytics) setAllowed(true);
      }
    } catch { /* ignore */ }

    // Listen for consent updates
    const onConsent = (e: Event) => {
      const detail = (e as CustomEvent).detail as { analytics?: boolean };
      if (detail?.analytics) setAllowed(true);
    };
    window.addEventListener("wasfix-consent-update", onConsent);
    return () => window.removeEventListener("wasfix-consent-update", onConsent);
  }, []);

  if (!allowed) return null;

  return (
    <>
      <Analytics />
      <SpeedInsights />
    </>
  );
}
