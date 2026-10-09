// Unified analytics layer.
//
//   Client: track() forwards one event to every provider that is actually
//           loaded (PostHog, GA4, Vercel Analytics) - and only after the visitor
//           has opted in to analytics in the cookie banner.
//   Server: trackServer() sends to the GA4 Measurement Protocol and the
//           PostHog capture API when those are configured.
//
// What an event may carry: see ALLOWED_PROPS. No e-mail, name, address, order
// number, free text or user id ever goes into an event.

import { track as vercelTrack } from "@vercel/analytics";
import { logger } from "@/lib/logger";

type EventProps = Record<string, string | number | boolean | null | undefined>;

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com";
const GA_ID = process.env.NEXT_PUBLIC_GA_ID;
const GA_API_SECRET = process.env.GA_MEASUREMENT_PROTOCOL_API_SECRET;

/**
 * The only property names an event may carry. Anything else is dropped before it
 * reaches a provider, so a future call site cannot ship personal data by adding a
 * property: it has to be added here, in review, first. Values are cut to 60
 * characters. (A referral `code` is deliberately NOT here: it identifies a user.)
 */
export const ALLOWED_PROPS: ReadonlySet<string> = new Set([
  "sku", "category", "brand", "error_code", "source", "plan", "count", "value", "step", "mode", "section", "method", "result", "rating", "hasComment",
]);

export function sanitizeProps(props?: EventProps): EventProps | undefined {
  if (!props) return undefined;
  const out: EventProps = {};
  for (const [k, v] of Object.entries(props)) {
    if (!ALLOWED_PROPS.has(k) || v === undefined || v === null) continue;
    out[k] = typeof v === "string" ? v.slice(0, 60) : v;
  }
  return out;
}

/** Has this browser said yes to analytics? Reads the cookie CookieConsent writes. */
export function analyticsAllowed(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const m = document.cookie.split("; ").find((c) => c.startsWith("wasfix-consent="));
    if (!m) return false;
    return JSON.parse(decodeURIComponent(m.split("=").slice(1).join("="))).analytics === true;
  } catch {
    return false;
  }
}

type Posthog = { capture?: (e: string, p?: EventProps) => void };
type Gtag = (cmd: string, event: string, params?: EventProps) => void;

/**
 * Fire a funnel event from the browser. A no-op without analytics consent, so
 * call sites never need their own consent check, and a no-op for every provider
 * whose script is not loaded (no key configured, or blocked by the visitor).
 */
export function track(event: string, props?: EventProps) {
  if (typeof window === "undefined") return; // server: see trackServer
  if (!analyticsAllowed()) return;
  const clean = sanitizeProps(props);

  try {
    const ph = (window as unknown as { posthog?: Posthog }).posthog;
    if (ph?.capture) ph.capture(event, clean);

    const gtag = (window as unknown as { gtag?: Gtag }).gtag;
    if (gtag) gtag("event", event, clean);

    // Vercel Analytics custom events; a silent no-op while its script is not there.
    vercelTrack(event, clean as Record<string, string | number | boolean | null | undefined> | undefined);
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
  /** First page of a browser tab session. Props: section only. */
  VISIT: "visit",
  DIAGNOSE_OPENED: "diagnose_opened",
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
