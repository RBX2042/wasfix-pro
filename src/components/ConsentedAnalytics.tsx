"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { useCart, cartCount, cartTotal } from "@/components/cart-provider";
import { track, EVT, analyticsAllowed } from "@/lib/analytics";
import { loadGoogleAnalytics, loadPostHog, disableAnalyticsProviders } from "@/components/analytics-loaders";

// Vercel Analytics, Speed Insights, the optional PostHog/GA4 loaders and the
// funnel events all live behind this one component, and it renders nothing
// until the visitor ticks "Analytics". /cookies promises these are "alleen
// geplaatst na expliciete toestemming"; nothing here runs before that.
//
// The wasfix-consent cookie is read on mount and the wasfix-consent-update event
// of CookieConsent is followed in both directions: ticking it on mounts
// everything, withdrawing it unmounts the Vercel scripts and switches the
// others off without a reload.

type PathInfo = { section: string; sku?: string };

/** The coarse kind of page. Never the query string, never an order id. */
function classify(pathname: string): PathInfo {
  if (pathname === "/") return { section: "home" };
  const seg = pathname.split("/").filter(Boolean);
  if (seg[0] === "onderdelen") return seg[1] ? { section: "onderdeel", sku: decodeURIComponent(seg[1]).toUpperCase() } : { section: "onderdelen" };
  if (seg[0] === "foutcodes") return { section: seg[1] ? "foutcode" : "foutcodes" };
  if (seg[0] === "gidsen") return { section: seg[1] ? "gids" : "gidsen" };
  if (seg[0] === "diagnose") return { section: "diagnose" };
  if (seg[0] === "checkout") return { section: "checkout" };
  if (seg[0] === "bestelling") return { section: "bestelling" };
  if (seg[0] === "prijzen" || seg[0] === "upgrade") return { section: "prijzen" };
  return { section: "overig" };
}

/** True on the redirect checkout sends the customer to right after placing an order. */
function orderJustPlaced(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("success") === "1";
  } catch {
    return false;
  }
}

function once(key: string): boolean {
  try {
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, "1");
  } catch {
    // Storage blocked: better a duplicate event than a missing one.
  }
  return true;
}

/**
 * The funnel, from what the browser can see by itself: visit, diagnose opened,
 * part viewed, checkout started (cart is not empty), order confirmation seen.
 * Diagnose start/result and the add-to-cart button fire their own events from
 * their components via track(). Properties are coarse and carry no personal
 * data (see ALLOWED_PROPS in lib/analytics.ts).
 */
function FunnelEvents() {
  const pathname = usePathname() ?? "/";
  const items = useCart((s) => s.items);
  const itemCount = cartCount(items);
  const total = cartTotal(items);

  React.useEffect(() => {
    const { section, sku } = classify(pathname);
    if (once("wasfix-evt-visit")) track(EVT.VISIT, { section });
    if (section === "diagnose") track(EVT.DIAGNOSE_OPENED, { section });
    if (section === "onderdeel" && sku) track(EVT.PART_VIEWED, { sku });
    // Only the redirect our own checkout issues counts (?success=1, set by the card
    // success_url and by the bank-transfer branch). Counting every /bestelling/*
    // view also counted unpaid orders, e-mail revisits and 404s. The id stays in
    // the pathname, so `once` still fires once per order per browser session.
    if (section === "bestelling" && orderJustPlaced() && once(`wasfix-evt-order:${pathname}`)) {
      track(EVT.CHECKOUT_COMPLETED, { section });
    }
    // Only the pathname matters here: the checkout event has its own effect below.
  }, [pathname]);

  const startedRef = React.useRef(false);
  React.useEffect(() => {
    if (classify(pathname).section !== "checkout" || itemCount === 0 || startedRef.current) return;
    startedRef.current = true;
    track(EVT.CHECKOUT_STARTED, { count: itemCount, value: Math.round(total) });
  }, [pathname, itemCount, total]);

  return null;
}

export function ConsentedAnalytics() {
  const [allowed, setAllowed] = React.useState(false);

  React.useEffect(() => {
    setAllowed(analyticsAllowed());
    const onConsent = (e: Event) => {
      const detail = (e as CustomEvent).detail as { analytics?: boolean } | undefined;
      setAllowed(detail?.analytics === true);
    };
    window.addEventListener("wasfix-consent-update", onConsent);
    return () => window.removeEventListener("wasfix-consent-update", onConsent);
  }, []);

  React.useEffect(() => {
    if (allowed) {
      loadGoogleAnalytics();
      loadPostHog();
    } else {
      disableAnalyticsProviders();
    }
  }, [allowed]);

  if (!allowed) return null;

  return (
    <>
      <Analytics />
      <SpeedInsights />
      <FunnelEvents />
    </>
  );
}
