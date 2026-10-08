/**
 * HTTP smoke test — hits the most important pages and API endpoints of a
 * running instance and fails when anything returns an unexpected status.
 *
 * Usage: BASE_URL=http://localhost:3000 npx tsx scripts/smoke.ts
 */
import { catalogStats, formatCount } from "../src/lib/catalog-stats";
import { PLANS, formatPlanPrice } from "../src/lib/plans";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

// The pages that quote catalogue sizes must quote the CURRENT ones. This used
// to assert the literal "331", which meant the test enforced a stale number
// and broke the moment the catalogue was corrected — the same hardcoded-count
// problem the pages themselves had.
const STATS = catalogStats();

type Check = {
  path: string;
  expect: number | number[];
  method?: "GET" | "POST";
  body?: unknown;
  /** Extra request headers. */
  headers?: Record<string, string>;
  contains?: string;
  /** Passes only when the body does NOT contain this. */
  notContains?: string;
  /** Passes when ANY of these response headers exists and contains `headerContains`. */
  anyHeader?: string[];
  headerContains?: string;
};

const checks: Check[] = [
  { path: "/", expect: 200, contains: "WasFix" },
  { path: "/diagnose", expect: 200 },
  { path: "/foutcodes", expect: 200 },
  { path: "/foutcodes/Bosch-E18", expect: 200, contains: "E18" },
  { path: "/onderdelen", expect: 200 },
  { path: "/onderdelen/WF-PUMP-01", expect: 200, contains: "Afvoerpomp" },
  { path: "/gidsen", expect: 200 },
  { path: "/gidsen/filter-reinigen", expect: 200 },
  { path: "/merken", expect: 200 },
  { path: "/merken/Bosch", expect: 200 },
  { path: "/bosch-wasmachine-reparatie", expect: 200, contains: "Bosch" },
  { path: "/prijzen", expect: 200 },
  { path: "/monteur", expect: 200 },
  { path: "/checkout", expect: 200 },
  { path: "/inloggen", expect: 200 },
  { path: "/registreren", expect: 200 },
  { path: "/dashboard", expect: [200, 307] },
  { path: "/admin", expect: [200, 307] },
  { path: "/monteur/dashboard", expect: [200, 307] },
  { path: "/monteur/klanten", expect: [200, 307] },
  { path: "/monteur/werkorders", expect: [200, 307] },
  { path: "/admin/onderdelen", expect: [200, 307] },
  { path: "/admin/gidsen", expect: [200, 307] },
  { path: "/admin/foutcodes", expect: [200, 307] },
  { path: "/admin/aanvragen", expect: [200, 307] },
  { path: "/dashboard/referrals", expect: [200, 307] },
  { path: "/help", expect: 200 },
  { path: "/blog", expect: 200 },
  { path: "/privacy", expect: 200 },
  { path: "/voorwaarden", expect: 200 },
  { path: "/sitemap.xml", expect: 200, contains: "<urlset" },
  { path: "/robots.txt", expect: 200 },
  { path: "/manifest.webmanifest", expect: 200 },
  // A 404 page names no canonical address (rel="canonical"): the root layout's relative canonical used to resolve to the internal /_not-found route.
  { path: "/does-not-exist", expect: 404, notContains: 'rel="canonical"' },
  { path: "/api/v1/health", expect: 200, contains: "\"status\":\"ok\"" },
  // Readiness, not just liveness: the database and migration state are part of the answer.
  { path: "/api/v1/health", expect: 200, contains: "\"database\"" },
  // Platform (bundle S6): the security headers are there (the policy is enforcing on a production build and
  // Report-Only on a dev server, hence two header names), the old service worker is a kill switch, and the
  // browser error report endpoint accepts a report.
  { path: "/", expect: 200, anyHeader: ["content-security-policy", "content-security-policy-report-only"], headerContains: "default-src 'self'" },
  { path: "/", expect: 200, anyHeader: ["strict-transport-security"], headerContains: "max-age=" },
  { path: "/sw.js", expect: 200, contains: "unregister" },
  // /api/client-error is public: it must accept a same-origin report and refuse everything that is not one.
  { path: "/api/client-error", method: "POST", body: { name: "Error", message: "smoke test", path: "/smoke" }, headers: { "Sec-Fetch-Site": "same-origin" }, expect: 202 },
  { path: "/api/client-error", method: "POST", body: { name: "Error", message: "smoke test", path: "/smoke" }, expect: 403 },
  { path: "/api/client-error", method: "POST", body: { name: "Error", message: "smoke test", path: "/smoke" }, headers: { "Sec-Fetch-Site": "cross-site" }, expect: 403 },
  { path: "/api/client-error", method: "POST", body: { name: "Error", message: "x".repeat(3000), path: "/smoke" }, headers: { "Sec-Fetch-Site": "same-origin" }, expect: 413 },
  { path: "/api/stats", expect: 200 },
  { path: "/api/parts", expect: 200 },
  { path: "/api/parts/WF-PUMP-01", expect: 200 },
  { path: "/api/errorcodes/E18", expect: 200 },
  { path: "/api/guides", expect: 200 },
  { path: "/api/search?q=bosch", expect: 200, contains: "hits" },
  { path: "/api/reviews?sku=WF-PUMP-01", expect: 200 },
  // The referral programme is OFF unless NEXT_PUBLIC_FEATURE_REFERRAL=true (it cannot pay out yet, see
  // src/lib/referrals.ts). Off means off: stats are not served, and a click records no row and sets no cookie.
  // CI and production run it off, so that is what is asserted here; scripts/qa-plans.ts covers the on state.
  { path: "/api/referral/stats", expect: 404 },
  { path: "/api/referral/track", method: "POST", body: { code: "SMOKE1" }, expect: 200, contains: '"tracked":false' },
  { path: "/api/referral/track", method: "POST", body: { code: "bad code!" }, expect: 200, contains: '"enabled":false' },
  { path: "/api/v1/parts/WF-PUMP-01", expect: 401 },
  { path: "/api/v1/parts/WF-PUMP-01?api_key=wf_demo_FREE_PUBLIC_DEMO_KEY_ONLY_LIMITED", expect: 200 },
  { path: "/api/qr/generate?brand=Bosch&model=WAU28T40NL", expect: 200 },
  {
    path: "/api/diagnose",
    method: "POST",
    body: { messages: [{ role: "user", content: "Bosch E18 water blijft staan" }] },
    expect: 200,
    contains: "recommendedParts",
  },
  {
    path: "/api/checkout",
    method: "POST",
    body: {
      items: [{ sku: "WF-PUMP-01", quantity: 1 }],
      email: "smoke@example.com",
      name: "Smoke Test",
      // Phone is required, and the payment method is explicit: checkout never switches method on its own.
      phone: "06 12345678",
      paymentMethod: "bank_transfer",
      address: { street: "Hoofdstraat", houseNumber: "1", postalCode: "1234 AB", city: "Amsterdam" },
    },
    expect: 200,
    contains: "orderId",
  },
  { path: "/api/newsletter", method: "POST", body: { email: "smoke@example.com" }, expect: 200 },
  {
    path: "/api/reviews",
    method: "POST",
    body: {
      targetType: "part",
      targetSku: "WF-PUMP-01",
      rating: 5,
      title: "Smoke test review",
      body: "Automatische smoke-test review, wordt niet gepubliceerd zonder moderatie.",
      author: "Smoke Test",
      email: "smoke@example.com",
    },
    expect: 200,
    contains: "moderatie",
  },
  { path: "/api/stripe/webhook", method: "POST", body: {}, expect: [200, 400] },
  // Commercial surfaces: prices must render from the shared config, and the
  // invoice route must refuse to expose someone else's order.
  { path: "/prijzen", expect: 200, contains: formatPlanPrice(PLANS.PARTICULIER) },
  { path: "/upgrade?plan=MONTEUR_PRO", expect: 200, contains: formatPlanPrice(PLANS.MONTEUR_PRO) },
  { path: "/upgrade?plan=BEDRIJF", expect: 200, contains: formatPlanPrice(PLANS.BEDRIJF) },
  { path: "/upgrade?plan=NONSENSE", expect: 200, contains: "Onbekend plan" },
  // /bestelling/* is NOT sent to sign-in any more: a guest who has just ordered has no account and
  // reaches the page with the ?t= token from their link (decision D2). The page itself is the gate;
  // anyone without the token (or a session) gets the same 404 as for an id that does not exist, so the
  // answer does not tell a stranger which order ids are real. The positive case (right token -> 200)
  // needs an order and is covered by scripts/qa-checkout.ts.
  { path: "/bestelling/does-not-exist/factuur", expect: 404 },
  // Claims on public pages must match the catalog, not invented numbers.
  { path: "/", expect: 200, contains: formatCount(STATS.errorCodes) },
  { path: "/over", expect: 200, contains: formatCount(STATS.errorCodes) },
  { path: "/pers", expect: 200, contains: "Achtergrond" },
  { path: "/monteur", expect: 200, contains: "Factuur direct vanaf de werkorder" },
  { path: "/monteur/instellingen", expect: [200, 307] },
  { path: "/wasmachine-kapot/amsterdam", expect: 200 },
];

async function run() {
  let failed = 0;
  for (const c of checks) {
    const url = `${BASE}${c.path}`;
    try {
      const res = await fetch(url, {
        method: c.method ?? "GET",
        headers: c.body ? { "Content-Type": "application/json", ...c.headers } : c.headers,
        body: c.body ? JSON.stringify(c.body) : undefined,
        redirect: "manual",
      });
      const expected = Array.isArray(c.expect) ? c.expect : [c.expect];
      const text = await res.text();
      const statusOk = expected.includes(res.status);
      const containsOk = (!c.contains || text.includes(c.contains)) && (!c.notContains || !text.includes(c.notContains));
      const headerOk = !c.anyHeader || c.anyHeader.some((h) => (res.headers.get(h) ?? "").includes(c.headerContains ?? ""));
      const ok = statusOk && containsOk && headerOk;
      if (!ok) failed++;
      console.log(`${ok ? "✅" : "❌"} ${c.method ?? "GET"} ${c.path} → ${res.status}${!containsOk ? ` (body check failed: ${[c.contains && `needs "${c.contains}"`, c.notContains && `must not contain ${c.notContains}`].filter(Boolean).join(", ")})` : ""}${!headerOk ? ` (no ${c.anyHeader!.join(" / ")} containing "${c.headerContains}")` : ""}`);
    } catch (err) {
      failed++;
      console.log(`❌ ${c.method ?? "GET"} ${c.path} → ${(err as Error).message}`);
    }
  }
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
  if (failed > 0) process.exit(1);
}

run();
