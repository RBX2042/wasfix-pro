// Unified analytics layer — PostHog (if configured) + Vercel Analytics (always)
// + GA4 (if configured) + server-side conversion tracking via Measurement Protocol.
//
// Usage:
//   import { track } from "@/lib/analytics";
//   track("diagnose_started", { brand: "Bosch", code: "E18" });
//
// Falls back gracefully — if no provider is configured the call is a no-op.

import { logger } from "@/lib/logger";

type EventProps = Record<string, string | number | boolean | null | undefined>;

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com";
const GA_ID = process.env.NEXT_PUBLIC_GA_ID;
const GA_API_SECRET = process.env.GA_MEASUREMENT_PROTOCOL_API_SECRET;

// Client-side: forwards to PostHog (loaded via <script>) + dataLayer (GA4)
export function track(event: string, props?: EventProps) {
  if (typeof window === "undefined") return; // server: see trackServer

  try {
    // PostHog (loaded via PostHogProvider in layout)
    const ph = (window as unknown as { posthog?: { capture: (e: string, p?: EventProps) => void } }).posthog;
    if (ph?.capture) ph.capture(event, props);

    // GA4 via gtag
    const gtag = (window as unknown as { gtag?: (cmd: string, event: string, params?: EventProps) => void }).gtag;
    if (gtag) gtag("event", event, props);

    // Vercel Analytics custom events (any string event name works)
    const va = (window as unknown as { va?: (cmd: string, e: string, p?: EventProps) => void }).va;
    if (va) va("event", event, props);
  } catch (err) {
    logger.warn("[analytics] track failed", err);
  }
}

// Server-side: send to GA4 Measurement Protocol (resists ad-blockers)
// + PostHog Capture API
export async function trackServer(event: string, props?: EventProps & { client_id?: string }) {
  const clientId = props?.client_id ?? "anonymous-server";
  // GA4 Measurement Protocol
  if (GA_ID && GA_API_SECRET) {
    try {
      await fetch(`https://www.google-analytics.com/mp/collect?measurement_id=${GA_ID}&api_secret=${GA_API_SECRET}`, {
        method: "POST",
        body: JSON.stringify({
          client_id: clientId,
          events: [{ name: event.replace(/-/g, "_"), params: props ?? {} }],
        }),
      });
    } catch (err) {
      logger.warn("[analytics:server:GA4] failed", err);
    }
  }
  // PostHog Capture
  if (POSTHOG_KEY) {
    try {
      await fetch(`${POSTHOG_HOST}/capture/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: POSTHOG_KEY,
          event,
          distinct_id: clientId,
          properties: props ?? {},
        }),
      });
    } catch (err) {
      logger.warn("[analytics:server:PostHog] failed", err);
    }
  }
}

// Standard event names — centralized for type-safety and audit-trail
export const EVT = {
  DIAGNOSE_STARTED: "diagnose_started",
  DIAGNOSE_COMPLETED: "diagnose_completed",
  PART_VIEWED: "part_viewed",
  PART_ADDED_TO_CART: "part_added_to_cart",
  CHECKOUT_STARTED: "checkout_started",
  CHECKOUT_COMPLETED: "checkout_completed",
  SUBSCRIPTION_STARTED: "subscription_started",
  SUBSCRIPTION_CANCELLED: "subscription_cancelled",
  PRO_SIGNUP: "pro_signup",
  NEWSLETTER_SIGNUP: "newsletter_signup",
  RMA_SUBMITTED: "rma_submitted",
  REFERRAL_LINK_SHARED: "referral_link_shared",
  REFERRAL_CONVERSION: "referral_conversion",
} as const;
