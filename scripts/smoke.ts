/**
 * HTTP smoke test — hits the most important pages and API endpoints of a
 * running instance and fails when anything returns an unexpected status.
 *
 * Usage: BASE_URL=http://localhost:3000 npx tsx scripts/smoke.ts
 */
const BASE = process.env.BASE_URL ?? "http://localhost:3000";

type Check = { path: string; expect: number | number[]; method?: "GET" | "POST"; body?: unknown; contains?: string };

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
  { path: "/help", expect: 200 },
  { path: "/blog", expect: 200 },
  { path: "/privacy", expect: 200 },
  { path: "/voorwaarden", expect: 200 },
  { path: "/sitemap.xml", expect: 200, contains: "<urlset" },
  { path: "/robots.txt", expect: 200 },
  { path: "/manifest.webmanifest", expect: 200 },
  { path: "/does-not-exist", expect: 404 },
  { path: "/api/v1/health", expect: 200, contains: "\"status\":\"ok\"" },
  { path: "/api/stats", expect: 200 },
  { path: "/api/parts", expect: 200 },
  { path: "/api/parts/WF-PUMP-01", expect: 200 },
  { path: "/api/errorcodes/E18", expect: 200 },
  { path: "/api/guides", expect: 200 },
  { path: "/api/search?q=bosch", expect: 200, contains: "hits" },
  { path: "/api/reviews?sku=WF-PUMP-01", expect: 200 },
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
      address: { street: "Hoofdstraat", houseNumber: "1", postalCode: "1234 AB", city: "Amsterdam" },
    },
    expect: 200,
    contains: "orderId",
  },
  { path: "/api/newsletter", method: "POST", body: { email: "smoke@example.com" }, expect: 200 },
  { path: "/api/stripe/webhook", method: "POST", body: {}, expect: [200, 400] },
];

async function run() {
  let failed = 0;
  for (const c of checks) {
    const url = `${BASE}${c.path}`;
    try {
      const res = await fetch(url, {
        method: c.method ?? "GET",
        headers: c.body ? { "Content-Type": "application/json" } : undefined,
        body: c.body ? JSON.stringify(c.body) : undefined,
        redirect: "manual",
      });
      const expected = Array.isArray(c.expect) ? c.expect : [c.expect];
      const text = await res.text();
      const statusOk = expected.includes(res.status);
      const containsOk = !c.contains || text.includes(c.contains);
      const ok = statusOk && containsOk;
      if (!ok) failed++;
      console.log(`${ok ? "✅" : "❌"} ${c.method ?? "GET"} ${c.path} → ${res.status}${!containsOk ? ` (missing "${c.contains}")` : ""}`);
    } catch (err) {
      failed++;
      console.log(`❌ ${c.method ?? "GET"} ${c.path} → ${(err as Error).message}`);
    }
  }
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
  if (failed > 0) process.exit(1);
}

run();
