/**
 * Content-Security-Policy probe (src/lib/csp.ts).
 *
 *   npx tsx scripts/qa-csp.ts                                  policy + enforced-header probe (needs Chromium)
 *   QA_BASE_URL=http://localhost:3000 npx tsx scripts/qa-csp.ts   ... and real pages of a running server
 *   QA_CLERK_HOST=clerk.wasfix.nl  (with QA_BASE_URL)           the served header must name that Clerk host
 *   QA_REQUIRE_BROWSER=1                                         fail instead of skipping when no Chromium
 *
 * Part 1 (no server): the policy builder. A pk_live-shaped key yields its Clerk host
 *   in script-src and connect-src, Cloudflare in script-src and frame-src, blob: workers;
 *   a malformed key yields nothing; a hostile value cannot inject a directive.
 * Part 2 (Chromium): a local page served WITH the enforced policy built for a pk_live key
 *   loads every vendor the site uses (Clerk, Cloudflare challenge, Stripe, Vercel analytics,
 *   PostHog, Google Analytics, YouTube, Google Fonts, a blob: worker). None may raise a
 *   securitypolicyviolation event (a request to an unreachable host is a network error, not a
 *   violation, so the check does not depend on those hosts being reachable). An unknown host
 *   MUST raise one, for scripts, fetches and frames.
 * Part 3 (QA_BASE_URL): real pages of a running instance, with analytics consent given, produce
 *   zero violations, and the served header is the one csp.ts builds.
 *
 * Before the fix the policy had no Clerk frontend host: Part 1 and 2 fail on the old policy
 * (reproduced below with LEGACY_POLICY, copied from the previous next.config.ts).
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { buildCsp, clerkKeyInfo, cspFromEnv, cspHeaderName } from "../src/lib/csp";
import { loadPlaywright, makeChecker } from "./lib/browser";

const PK_LIVE = `pk_live_${Buffer.from("clerk.wasfix.nl$").toString("base64").replace(/=+$/, "")}`;
const PK_TEST = `pk_test_${Buffer.from("casual-lion-12.clerk.accounts.dev$").toString("base64").replace(/=+$/, "")}`;
const { check, note, finish } = makeChecker("qa-csp");

// The policy shipped before this change (next.config.ts, production), kept to show what the probe catches.
const LEGACY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'  https://va.vercel-scripts.com https://*.vercel-analytics.com https://*.posthog.com https://www.googletagmanager.com https://js.stripe.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https://*.supabase.co https://images.unsplash.com https://cdn.jsdelivr.net https://img.clerk.com https://placehold.co https://*.gravatar.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self' https://*.supabase.co https://*.clerk.accounts.dev https://api.stripe.com https://*.posthog.com https://va.vercel-scripts.com https://*.vercel-analytics.com https://generativelanguage.googleapis.com",
  "frame-src 'self' https://js.stripe.com https://*.youtube-nocookie.com https://www.youtube.com",
  "object-src 'none'",
].join("; ");

const directive = (policy: string, name: string) => (policy.split("; ").find((d) => d.startsWith(`${name} `)) ?? "").split(" ").slice(1);

/**
 * NOT circular: the hosts come from the INSTALLED @clerk/nextjs (its own default CSP,
 * node_modules/@clerk/nextjs/dist/esm/server/content-security-policy.js), not from our
 * assumption of what Clerk loads. After a Clerk upgrade that adds a host, this fails until
 * the policy covers it or the host is listed below with a reason.
 */
const CLERK_HOSTS_WE_DO_NOT_NEED: Record<string, string> = {
  "https://maps.googleapis.com": "Google Maps: the shop uses none",
  "https://images.clerkstage.dev": "Clerk's own staging avatars; a production instance serves them from img.clerk.com",
  "https://*.clerk-telemetry.com": "telemetry is posted to https://clerk-telemetry.com, which the policy allows (probed in Part 2); the wildcard subdomains were not needed there",
  "https://hooks.stripe.com": "3-D Secure runs inside Stripe-hosted Checkout, not in a frame on our pages",
  "https://*.js.stripe.com": "Stripe Elements / Clerk Billing are not used: payment is Stripe-hosted Checkout (a redirect)",
};
function clerkDefaultsAreCovered(policy: string) {
  const file = path.join(process.cwd(), "node_modules/@clerk/nextjs/dist/esm/server/content-security-policy.js");
  if (!fs.existsSync(file)) { note("SKIPPED @clerk/nextjs default CSP not found"); return; }
  const text = fs.readFileSync(file, "utf8");
  const block = /DEFAULT_DIRECTIVES = \{([\s\S]*?)\n\};/.exec(text)?.[1] ?? "";
  const defaults: Record<string, string[]> = {};
  for (const m of block.matchAll(/"([a-z-]+)": \[([\s\S]*?)\]/g)) defaults[m[1]] = [...m[2].matchAll(/"(https:\/\/[^"]+)"/g)].map((x) => x[1]);
  check(Object.keys(defaults).length >= 6 && (defaults["frame-src"] ?? []).includes("https://challenges.cloudflare.com"), "parsed Clerk's shipped default directives", JSON.stringify(Object.keys(defaults)));
  const covers = (allowed: string[], host: string) => allowed.some((a) => a === host || (a.startsWith("https://*.") && host.startsWith("https://") && host.slice(8).endsWith(a.slice(9))));
  const gaps: string[] = [];
  for (const [dir, hosts] of Object.entries(defaults)) {
    for (const h of hosts) {
      if (h in CLERK_HOSTS_WE_DO_NOT_NEED) continue;
      const allowed = directive(policy, dir);
      if (!covers(allowed, h)) gaps.push(`${dir} ${h}`);
    }
  }
  check(gaps.length === 0, "every host in Clerk's own default CSP is allowed by ours (or listed with a reason)", `not covered: ${gaps.join(", ")}`);
}

function part1() {
  note("Part 1: policy builder");
  check(clerkKeyInfo(PK_LIVE)?.host === "clerk.wasfix.nl" && clerkKeyInfo(PK_LIVE)?.mode === "live", "pk_live key decodes to its frontend host (clerk.wasfix.nl)", `decoded: ${JSON.stringify(clerkKeyInfo(PK_LIVE))}`);
  check(clerkKeyInfo(PK_TEST)?.mode === "test", "pk_test key is recognised as a test key");
  check(clerkKeyInfo("pk_live_!!!") === null && clerkKeyInfo("") === null && clerkKeyInfo(undefined) === null && clerkKeyInfo("sk_live_abc") === null, "malformed / empty / secret keys decode to nothing");
  const evil = `pk_live_${Buffer.from("evil.com; script-src *$").toString("base64").replace(/=+$/, "")}`;
  check(clerkKeyInfo(evil) === null && !buildCsp({ production: true, clerkPublishableKey: evil }).includes("evil.com"), "a key that decodes to something that is not a hostname cannot inject into the header");

  const live = buildCsp({ production: true, clerkPublishableKey: PK_LIVE });
  check(directive(live, "script-src").includes("https://clerk.wasfix.nl") && directive(live, "script-src").includes("https://challenges.cloudflare.com"), "script-src: Clerk host + Cloudflare challenge", directive(live, "script-src").join(" "));
  check(directive(live, "connect-src").includes("https://clerk.wasfix.nl") && directive(live, "connect-src").includes("https://clerk-telemetry.com"), "connect-src: Clerk host + clerk-telemetry.com");
  check(directive(live, "frame-src").includes("https://challenges.cloudflare.com"), "frame-src: Cloudflare challenge");
  check(directive(live, "worker-src").join(" ") === "'self' blob:", "worker-src: 'self' blob:", directive(live, "worker-src").join(" "));
  check(!live.includes("clerk.accounts.dev"), "a live key does not open *.clerk.accounts.dev");
  check(!directive(live, "script-src").includes("'unsafe-eval'") && !live.includes("posthog") && !live.includes("google-analytics"), "production: no unsafe-eval; PostHog and GA hosts only when configured");

  const test = buildCsp({ production: true, clerkPublishableKey: PK_TEST });
  check(directive(test, "script-src").includes("https://*.clerk.accounts.dev") && directive(test, "connect-src").includes("https://*.clerk.accounts.dev"), "a test key (preview deployments) opens *.clerk.accounts.dev");

  const none = buildCsp({ production: true });
  check(!none.includes("clerk.wasfix") && !none.includes("clerk-telemetry") && !none.includes("cloudflare") && !none.includes("clerk.accounts.dev"), "no Clerk key: no Clerk frontend host, Cloudflare or clerk.accounts.dev entries");
  const all = buildCsp({ production: true, clerkPublishableKey: PK_LIVE, posthogKey: "phc_x", gaId: "G-ABC123" });
  check(all.includes("https://*.posthog.com") && all.includes("https://*.google-analytics.com") && all.includes("https://www.googletagmanager.com"), "PostHog and GA hosts appear when their keys are set");
  check(buildCsp({ production: false }).includes("'unsafe-eval'") && cspHeaderName(false) === "Content-Security-Policy-Report-Only" && cspHeaderName(true) === "Content-Security-Policy", "development: unsafe-eval + Report-Only header; production: enforcing header");
  check(!/;\s*;|\s;/.test(live) && !/ {2}/.test(live), "no stray spaces or empty directives in the header value");

  clerkDefaultsAreCovered(live);

  note("What the old policy missed (the A5-01 reproduction)");
  check(!directive(LEGACY_POLICY, "script-src").includes("https://clerk.wasfix.nl") && !directive(LEGACY_POLICY, "script-src").includes("https://challenges.cloudflare.com") && !LEGACY_POLICY.includes("worker-src"), "old policy: no Clerk host, no Cloudflare, no worker-src (sign-in could never load)");
}

type Probe = { name: string; kind: "script" | "fetch" | "frame" | "img" | "worker" | "font" | "style" | "eval"; url?: string };
const ALLOWED: Probe[] = [
  { name: "Clerk: clerk-js script", kind: "script", url: "https://clerk.wasfix.nl/npm/@clerk/clerk-js@5/dist/clerk.browser.js" },
  { name: "Clerk: frontend API call", kind: "fetch", url: "https://clerk.wasfix.nl/v1/client" },
  { name: "Clerk: telemetry", kind: "fetch", url: "https://clerk-telemetry.com/v1/event" },
  { name: "Clerk: avatar image", kind: "img", url: "https://img.clerk.com/x.png" },
  { name: "Clerk: Cloudflare challenge script", kind: "script", url: "https://challenges.cloudflare.com/turnstile/v0/api.js" },
  { name: "Clerk: Cloudflare challenge iframe", kind: "frame", url: "https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/x" },
  { name: "Clerk: blob: worker", kind: "worker" },
  { name: "Stripe: js.stripe.com script", kind: "script", url: "https://js.stripe.com/v3/" },
  { name: "Stripe: js.stripe.com iframe", kind: "frame", url: "https://js.stripe.com/v3/elements-inner.html" },
  { name: "Stripe: api.stripe.com", kind: "fetch", url: "https://api.stripe.com/v1/x" },
  { name: "Analytics: Vercel script", kind: "script", url: "https://va.vercel-scripts.com/v1/script.js" },
  { name: "Analytics: PostHog assets script", kind: "script", url: "https://eu-assets.i.posthog.com/static/array.js" },
  { name: "Analytics: PostHog capture", kind: "fetch", url: "https://eu.i.posthog.com/e/" },
  { name: "Analytics: gtag script", kind: "script", url: "https://www.googletagmanager.com/gtag/js?id=G-ABC123" },
  { name: "Analytics: GA collect", kind: "fetch", url: "https://www.google-analytics.com/g/collect" },
  { name: "YouTube: nocookie iframe", kind: "frame", url: "https://www.youtube-nocookie.com/embed/x" },
  { name: "YouTube: iframe", kind: "frame", url: "https://www.youtube.com/embed/x" },
  { name: "Fonts: Google Fonts stylesheet", kind: "style", url: "https://fonts.googleapis.com/css2?family=Inter" },
  { name: "Fonts: gstatic font file", kind: "font", url: "https://fonts.gstatic.com/s/inter/v1/x.woff2" },
];
const BLOCKED: Probe[] = [
  { name: "unknown host: script", kind: "script", url: "https://evil.example/x.js" },
  { name: "unknown host: fetch", kind: "fetch", url: "https://evil.example/collect" },
  { name: "unknown host: iframe", kind: "frame", url: "https://evil.example/" },
  { name: "unknown host: image", kind: "img", url: "https://evil.example/p.png" },
  { name: "another Clerk instance (*.clerk.accounts.dev) under a LIVE key", kind: "script", url: "https://attacker.clerk.accounts.dev/x.js" },
  { name: "eval()", kind: "eval" },
];

const PROBE_SCRIPT = `
window.__violations = [];
document.addEventListener("securitypolicyviolation", (e) => window.__violations.push({ directive: e.violatedDirective, blocked: e.blockedURI, disposition: e.disposition }));
window.__run = async (p) => {
  const before = window.__violations.length;
  try {
    if (p.kind === "script") { const s = document.createElement("script"); s.src = p.url; document.head.appendChild(s); }
    else if (p.kind === "img") { const i = new Image(); i.src = p.url; }
    else if (p.kind === "style") { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = p.url; document.head.appendChild(l); }
    else if (p.kind === "frame") { const f = document.createElement("iframe"); f.src = p.url; document.body.appendChild(f); }
    else if (p.kind === "fetch") { await fetch(p.url, { mode: "no-cors" }).catch(() => null); }
    else if (p.kind === "worker") { const w = new Worker(URL.createObjectURL(new Blob(["self.postMessage(1)"]))); w.terminate(); }
    else if (p.kind === "font") { const st = document.createElement("style"); st.textContent = "@font-face{font-family:probe;src:url(" + p.url + ")} .probe{font-family:probe}"; document.head.appendChild(st); const d = document.createElement("div"); d.className = "probe"; d.textContent = "x"; document.body.appendChild(d); await document.fonts.load("12px probe").catch(() => null); }
    else if (p.kind === "eval") { await new Promise((r) => setTimeout(() => { try { eval("1+1"); } catch (e) {} r(); }, 0)); } // from a timer: code Playwright evaluates itself is exempt from the policy
  } catch (e) {}
  await new Promise((r) => setTimeout(r, 400));
  return window.__violations.slice(before);
};
`;

async function part2(pw: NonNullable<ReturnType<typeof loadPlaywright>>) {
  note("Part 2: Chromium against an ENFORCED policy built for a pk_live key");
  const policy = buildCsp({ production: true, clerkPublishableKey: PK_LIVE, posthogKey: "phc_x", gaId: "G-ABC123" });
  const server = http.createServer((req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.setHeader("content-security-policy", req.url?.startsWith("/legacy") ? LEGACY_POLICY : policy);
    res.end(`<!doctype html><html><head><script>${PROBE_SCRIPT}</script></head><body>probe</body></html>`);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const browser = await pw.chromium.launch();
  try {
    const run = async (path: string, probes: Probe[]) => {
      const ctx = await browser.newContext();
      // External hosts are not needed: the policy decision is made before any request leaves the page.
      await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route: { abort: () => Promise<void> }) => route.abort());
      const page = await ctx.newPage();
      await page.goto(`http://127.0.0.1:${port}${path}`);
      const results: Array<{ probe: Probe; violations: Array<{ directive: string; blocked: string }> }> = [];
      for (const probe of probes) results.push({ probe, violations: await page.evaluate((p: Probe) => (window as any).__run(p), probe) }); // eslint-disable-line @typescript-eslint/no-explicit-any
      await ctx.close();
      return results;
    };
    const allowed = await run("/", ALLOWED);
    for (const r of allowed) check(r.violations.length === 0, `allowed: ${r.probe.name}`, `BLOCKED but must be allowed: ${r.probe.name} -> ${JSON.stringify(r.violations)}`);
    const blocked = await run("/", BLOCKED);
    for (const r of blocked) check(r.violations.length > 0, `blocked: ${r.probe.name}`, `NOT blocked but must be: ${r.probe.name}`);

    const legacy = await run("/legacy", ALLOWED.filter((p) => /^Clerk/.test(p.name)));
    const legacyBlocked = legacy.filter((r) => r.violations.length > 0).map((r) => r.probe.name);
    check(legacyBlocked.length >= 5, `the OLD policy blocks ${legacyBlocked.length} of ${legacy.length} Clerk probes (this probe would have failed before the fix)`, `old policy blocked only: ${legacyBlocked.join(", ")}`);
  } finally {
    await browser.close();
    server.close();
  }
}

async function part3(pw: NonNullable<ReturnType<typeof loadPlaywright>>, base: string) {
  note(`Part 3: real pages of ${base}`);
  const head = await fetch(base + "/");
  const enforced = head.headers.get("content-security-policy");
  const reportOnly = head.headers.get("content-security-policy-report-only");
  const served = enforced ?? reportOnly ?? "";
  check(Boolean(served), "the home page carries a Content-Security-Policy header");
  const expectedHost = process.env.QA_CLERK_HOST;
  if (expectedHost) {
    check(directive(served, "script-src").includes(`https://${expectedHost}`) && directive(served, "connect-src").includes(`https://${expectedHost}`), `served header names the Clerk host ${expectedHost} in script-src and connect-src`, served);
    check(directive(served, "worker-src").includes("blob:") && directive(served, "frame-src").includes("https://challenges.cloudflare.com"), "served header has worker-src blob: and the Cloudflare frame");
  }
  note(`served header: ${enforced ? "Content-Security-Policy (enforcing)" : reportOnly ? "Content-Security-Policy-Report-Only (development server)" : "none"}`);

  const browser = await pw.chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    // Analytics consent given, so the consent-gated scripts (Vercel Analytics, Speed Insights, funnel events) really load.
    const u = new URL(base);
    await ctx.addCookies([{ name: "wasfix-consent", value: encodeURIComponent(JSON.stringify({ functional: true, analytics: true, marketing: true, ts: Date.now() })), domain: u.hostname, path: "/" }]);
    await ctx.route((url: URL) => url.origin !== u.origin, (route: { abort: () => Promise<void> }) => route.abort());
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      (window as any).__v = []; // eslint-disable-line @typescript-eslint/no-explicit-any
      document.addEventListener("securitypolicyviolation", (e) => (window as any).__v.push(`${e.violatedDirective} <- ${e.blockedURI}`)); // eslint-disable-line @typescript-eslint/no-explicit-any
    });
    const pages = ["/", "/onderdelen", "/onderdelen/WF-PUMP-01", "/foutcodes", "/foutcodes/Bosch-E18", "/gidsen", "/diagnose", "/prijzen", "/checkout", "/inloggen", "/registreren", "/over", "/contact", "/cookies"];
    for (const p of pages) {
      await page.goto(base + p, { waitUntil: "load", timeout: 90_000 }).catch(() => null);
      await page.waitForTimeout(800);
      const v: string[] = await page.evaluate(() => (window as any).__v ?? []); // eslint-disable-line @typescript-eslint/no-explicit-any
      check(v.length === 0, `no CSP violation on ${p}`, `${p}: ${v.slice(0, 4).join(" | ")}`);
    }
  } finally {
    await browser.close();
  }
}

async function main() {
  part1();
  // The environment the app itself will use must produce a well-formed policy too.
  const env = cspFromEnv({ NODE_ENV: "production", NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: PK_LIVE });
  check(env === buildCsp({ production: true, clerkPublishableKey: PK_LIVE, posthogKey: undefined, gaId: undefined }), "cspFromEnv(process env shape) equals buildCsp for the same inputs");

  const pw = loadPlaywright();
  if (!pw) {
    const msg = "Chromium/Playwright not found: parts 2 and 3 not run";
    if (process.env.QA_REQUIRE_BROWSER === "1") check(false, msg, msg);
    else note(`SKIPPED ${msg}`);
  } else {
    await part2(pw);
    if (process.env.QA_BASE_URL) await part3(pw, process.env.QA_BASE_URL.replace(/\/$/, ""));
    else note("SKIPPED part 3: set QA_BASE_URL to probe real pages");
  }
  process.exit(finish());
}

void main();
