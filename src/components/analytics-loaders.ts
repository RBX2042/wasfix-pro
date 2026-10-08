/**
 * Browser-side loaders for the optional analytics providers. Called only by
 * ConsentedAnalytics, only after the visitor ticked "Analytics".
 *
 * Why script injection instead of an npm import: PostHogProvider used to do
 * `import("posthog-js")` behind a webpackIgnore comment. A browser cannot
 * resolve a bare module specifier, so it threw "Failed to resolve module
 * specifier" on every consented page view and PostHog never loaded; GA4 had no
 * loader at all. Both providers publish a plain <script> loader, which needs no
 * dependency and no change to package.json.
 *
 * The hosts used here must be allowed by the CSP in next.config.ts: script-src
 * and connect-src already list *.posthog.com and googletagmanager.com; GA4 also
 * needs https://*.google-analytics.com in connect-src to send its hits.
 */

type W = Window & {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
  posthog?: unknown;
  [key: `ga-disable-${string}`]: boolean | undefined;
};

const GA_ID = process.env.NEXT_PUBLIC_GA_ID;
const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com";

export function loadGoogleAnalytics(): boolean {
  if (!GA_ID || !/^G-[A-Z0-9]+$/.test(GA_ID)) return false;
  const w = window as unknown as W;
  w[`ga-disable-${GA_ID}`] = false;
  if (document.getElementById("wasfix-ga")) return true;
  w.dataLayer = w.dataLayer || [];
  // gtag.js only understands the `arguments` object, not an array of arguments.
  w.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    (w.dataLayer as unknown[]).push(arguments);
  };
  w.gtag("js", new Date());
  // Page views are not sent automatically; the funnel events say what matters
  // and Vercel Analytics already counts page views.
  w.gtag("config", GA_ID, { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false });
  const s = document.createElement("script");
  s.id = "wasfix-ga";
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`;
  document.head.appendChild(s);
  return true;
}

export function loadPostHog(): boolean {
  if (!POSTHOG_KEY) return false;
  const w = window as unknown as W;
  if (w.posthog && (w.posthog as { __loaded?: boolean }).__loaded) {
    (w.posthog as { opt_in_capturing?: () => void }).opt_in_capturing?.();
    return true;
  }
  if (document.getElementById("wasfix-posthog")) return true;
  // PostHog's published async loader stub: queues calls made before array.js arrives.
  /* eslint-disable */
  (function (t: Document, e: any) {
    let o: string[], n: number, p: HTMLScriptElement, r: Element;
    if (e.__SV) return;
    (window as any).posthog = e;
    e._i = [];
    e.init = function (i: string, s: any, a?: string) {
      function g(t2: any, e2: string) {
        const o2 = e2.split(".");
        if (o2.length === 2) { t2 = t2[o2[0]]; e2 = o2[1]; }
        t2[e2] = function () { t2.push([e2].concat(Array.prototype.slice.call(arguments, 0))); };
      }
      p = t.createElement("script");
      p.id = "wasfix-posthog";
      p.type = "text/javascript";
      p.crossOrigin = "anonymous";
      p.async = true;
      p.src = s.api_host.replace(".i.posthog.com", "-assets.i.posthog.com") + "/static/array.js";
      r = t.getElementsByTagName("script")[0];
      r.parentNode!.insertBefore(p, r);
      let u = e;
      if (a !== undefined) u = e[a] = []; else a = "posthog";
      u.people = u.people || [];
      u.toString = function (t3?: number) { let e3 = "posthog"; if (a !== "posthog") e3 += "." + a; if (!t3) e3 += " (stub)"; return e3; };
      u.people.toString = function () { return u.toString(1) + ".people (stub)"; };
      o = "init capture register register_once unregister identify reset opt_in_capturing opt_out_capturing has_opted_out_capturing set_config debug".split(" ");
      for (n = 0; n < o.length; n++) g(u, o[n]);
      e._i.push([i, s, a]);
    };
    e.__SV = 1;
  })(document, (w.posthog as any) || []);
  /* eslint-enable */
  (w.posthog as { init: (k: string, c: Record<string, unknown>) => void }).init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    person_profiles: "identified_only",
    capture_pageview: false,
    capture_pageleave: false,
    disable_session_recording: true,
    autocapture: false,
  });
  return true;
}

/** Cookies the two providers set: GA4 (_ga, _ga_<id>, _gid) and PostHog (ph_<key>_posthog). */
const PROVIDER_COOKIE = /^(_ga(_[A-Z0-9]+)?|_gid|_gat.*|ph_.+_posthog)$/;

/** Expire the provider cookies on this host and on every parent domain they may sit on. */
export function removeProviderCookies(): void {
  const names = document.cookie
    .split("; ")
    .map((c) => c.split("=")[0])
    .filter((n) => PROVIDER_COOKIE.test(n));
  const parts = window.location.hostname.split(".");
  // "www.wasfix.nl" -> ["", "www.wasfix.nl", "wasfix.nl", "nl"]: GA writes to the registrable domain.
  const domains = ["", ...parts.map((_, i) => parts.slice(i).join("."))];
  for (const name of names) {
    for (const d of domains) {
      document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax${d ? `; Domain=${d}` : ""}`;
    }
  }
}

/**
 * The visitor withdrew consent: stop sending, without needing a reload, and
 * remove the cookies the providers already wrote (withdrawing used to leave
 * _ga* and ph_* cookies in the browser, which /cookies says are only placed
 * after consent).
 */
export function disableAnalyticsProviders(): void {
  const w = window as unknown as W;
  if (GA_ID) w[`ga-disable-${GA_ID}`] = true;
  (w.posthog as { opt_out_capturing?: () => void } | undefined)?.opt_out_capturing?.();
  removeProviderCookies();
}
