/**
 * Platform checks for bundle S6: the things that make a deployment survive.
 *
 *   npx tsx scripts/qa-platform.ts
 *   DATABASE_URL=postgresql://.../migrated_db npx tsx scripts/qa-platform.ts     + health route against a real database
 *   QA_REQUIRE_BROWSER=1 ...                                                      fail instead of skipping when no Chromium
 *
 * Covers: NEXT_PUBLIC_APP_URL handling, next.config (CSP header, canonical-host redirect, build refusal
 * on Vercel), rate-limit identity and degraded-mode warning, logger visibility in production, error
 * monitoring (cool-down and cap, end to end into a fake Slack), the health route, migrate.ts,
 * vercel.json, the service-worker kill switch, and that .env.example matches the code.
 *
 * Which checks would have FAILED on the earlier code is stated per section ("fails before:"); a check
 * without that note is a regression guard for behaviour that already existed, or a presence check on a
 * document, and is labelled as such. Checks that need Chromium are skipped silently unless QA_REQUIRE_BROWSER=1
 * (CI sets it).
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { spawn } from "node:child_process";
import { alternateHost, checkAppUrl, siteUrl, type EnvLike } from "../src/lib/site-url";
import { AlertGate, ErrorReporter, firstLine, makeErrorSink, normaliseForSignature, pathOnly, reportableFields, startupProblems } from "../src/lib/monitoring";
import { alertableName, alertablePath, sameOrigin } from "../src/lib/client-error";
import { adminList } from "./preflight";
import { buildMigrateEnv, describeUrl, looksPooled } from "./migrate";
import { HANDLED_STRIPE_EVENTS } from "../src/lib/stripe-events";
import { loadPlaywright, makeChecker } from "./lib/browser";

const { check, note, finish } = makeChecker("qa-platform");
const ROOT = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wasfix-platform-"));
let seq = 0;

// The repository's modules are CommonJS under tsx; a named ESM import of them fails, a dynamic import + this unwrap works.
const PREAMBLE = `const imp = async (p) => { const m = await import(p); return m.default && typeof m.default === "object" ? { ...m.default, ...m } : m; };\n`;
type Sub = { code: number; out: string; err: string };
/** Run a TypeScript snippet in a fresh process (so module-level state and env are real). */
function sub(source: string, env: Record<string, string | undefined>, flags: string[] = []): Promise<Sub> {
  const file = path.join(tmp, `fx-${++seq}.mts`);
  fs.writeFileSync(file, PREAMBLE + source.replaceAll("@repo/", `${ROOT}/`));
  return new Promise((resolve) => {
    const clean: EnvLike = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", TSX_TSCONFIG_PATH: path.join(ROOT, "tsconfig.json") };
    for (const [k, v] of Object.entries(env)) if (v !== undefined) clean[k] = v;
    const child = spawn("npx", ["--no-install", "tsx", ...flags, file], { cwd: ROOT, env: clean as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"] as const });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => resolve({ code: code ?? -1, out, err }));
  });
}

const fakeReq = (headers: Record<string, string>) => ({ headers: new Headers(headers) }) as unknown as import("next/server").NextRequest;

async function section1_siteUrl() {
  note("NEXT_PUBLIC_APP_URL (A1-17, A3-08, A6-20): it used to default to http://localhost:3000 in production");
  check(checkAppUrl(undefined).url === null && checkAppUrl("").errors.length === 1, "unset -> unusable, one clear error");
  check(checkAppUrl("http://localhost:3000").url === null && checkAppUrl("https://127.0.0.1").url === null && checkAppUrl("https://0.0.0.0").url === null, "localhost / loopback -> unusable");
  check(checkAppUrl("http://wasfix.nl").url === null && checkAppUrl("http://wasfix.nl").errors.some((e) => /https/.test(e)), "http:// -> unusable (Stripe live needs https)");
  check(checkAppUrl("https://wasfix.nl/nl").url === null && checkAppUrl("https://wasfix.nl?x=1").url === null, "a path or query -> unusable");
  check(checkAppUrl("not a url").url === null, "garbage -> unusable");
  check(checkAppUrl("https://wasfix.nl").url === "https://wasfix.nl" && checkAppUrl(" https://wasfix.nl/ ").url === "https://wasfix.nl", "https://wasfix.nl (and a pasted trailing slash/space) -> https://wasfix.nl");
  check(checkAppUrl("https://x-1.vercel.app").url === "https://x-1.vercel.app" && checkAppUrl("https://x-1.vercel.app").warnings.length === 1, "*.vercel.app is usable but warned about");
  check(siteUrl({ NODE_ENV: "production" }) === null, "production + unset: siteUrl() is null (callers publish nothing instead of localhost)");
  check(siteUrl({ NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "https://wasfix.nl" }) === "https://wasfix.nl", "production + valid: the value");
  check(siteUrl({ NODE_ENV: "development" }) === "http://localhost:3000", "development + unset: localhost is fine");
  check(alternateHost("https://wasfix.nl") === "www.wasfix.nl" && alternateHost("https://www.wasfix.nl") === "wasfix.nl" && alternateHost("https://x.vercel.app") === null && alternateHost("http://localhost:3000") === null && alternateHost(null) === null, "alternateHost: apex <-> www, never for vercel.app/localhost");

  const problems = startupProblems({ NODE_ENV: "production" });
  check(problems.some((p) => p.level === "error" && /NEXT_PUBLIC_APP_URL/.test(p.message)) && problems.some((p) => /CRON_SECRET/.test(p.message)) && problems.some((p) => /ADMIN_EMAILS/.test(p.message)) && problems.some((p) => /Clerk/.test(p.message)) && problems.some((p) => /DATABASE_URL/.test(p.message)), "boot check: a bare production environment reports APP_URL, DATABASE_URL, Clerk, CRON_SECRET and ADMIN_EMAILS");
  check(startupProblems({ NODE_ENV: "development" }).length === 0, "boot check: silent outside production");
}

async function section1c_cartGate() {
  note("checkout gate and the build share ONE definition of a usable NEXT_PUBLIC_APP_URL (fails before: the gate only refused unset/localhost, so 'wasfix.nl' passed and Stripe rejected the return URLs)");
  const script = `
    const gate = await imp("@repo/src/lib/cart-gate");
    console.log(JSON.stringify(gate.checkoutBlockedReason()));
  `;
  const base = {
    NODE_ENV: "production", DATABASE_URL: "postgresql://u:p@127.0.0.1:1/db",
    COMPANY_NAME: "WasFix Test B.V.", COMPANY_STREET: "Teststraat 1", COMPANY_POSTAL_CODE: "1011 AB", COMPANY_CITY: "Amsterdam",
    COMPANY_KVK: "90000001", COMPANY_VAT: "NL900000010B01", COMPANY_IBAN: "NL02ABNA0123456789", COMPANY_EMAIL: "info@shop.example.nl",
  };
  const cases: Array<[string | undefined, boolean]> = [
    [undefined, true], ["", true], ["http://localhost:3000", true],
    ["wasfix.nl", true], ["http://wasfix.nl", true], ["https://wasfix.nl/nl", true], ["https://wasfix.nl?x=1", true],
    ["https://wasfix.nl", false], ["https://x-1.vercel.app", false],
  ];
  const results = await Promise.all(cases.map(([value]) => sub(script, { ...base, NEXT_PUBLIC_APP_URL: value }, ["--conditions=react-server"])));
  cases.forEach(([value, blocked], i) => {
    const out = results[i].out.trim().split("\n").pop() ?? "";
    const got = out === "null" ? null : (() => { try { return JSON.parse(out) as { code: string }; } catch { return undefined; } })();
    check(blocked ? got?.code === "app_url" : got === null, `NEXT_PUBLIC_APP_URL=${JSON.stringify(value)} -> ${blocked ? "checkout refused (app_url)" : "checkout allowed"}`, `${out} ${results[i].err.slice(0, 200)}`);
  });
}

async function section1b_sitemapRobots() {
  note("sitemap.xml / robots.txt in production without a usable NEXT_PUBLIC_APP_URL (A6-20: they advertised http://localhost:3000)");
  const script = `
    const robots = (await imp("@repo/src/app/robots")).default();
    const sitemap = await (await imp("@repo/src/app/sitemap")).default();
    await new Promise((r) => setTimeout(r, 1200));
    const again = await (await imp("@repo/src/app/sitemap")).default();
    const dates = (list) => list.map((e) => e.url + "|" + (e.lastModified ? new Date(e.lastModified).toISOString() : ""));
    const sample = (u) => sitemap.find((e) => e.url.endsWith(u));
    console.log(JSON.stringify({ sitemap: robots.sitemap ?? null, host: robots.host ?? null, urls: sitemap.length, first: sitemap[0]?.url ?? null,
      stable: JSON.stringify(dates(sitemap)) === JSON.stringify(dates(again)),
      withDate: sitemap.filter((e) => e.lastModified).length,
      partHasDate: Boolean(sitemap.find((e) => e.url.includes("/onderdelen/"))?.lastModified),
      homeHasDate: Boolean(sample("/")?.lastModified) }));
  `;
  const parse = (r: Sub) => { try { return JSON.parse(r.out.trim().split("\n").pop()!) as { sitemap: string[] | null; host: string | null; urls: number; first: string | null; stable?: boolean; withDate?: number; partHasDate?: boolean; homeHasDate?: boolean }; } catch { return null; } };
  const none = parse(await sub(script, { NODE_ENV: "production" }, ["--conditions=react-server"]));
  check(!!none && none.sitemap === null && none.host === null && none.urls === 0, "unset: robots.txt names no host or sitemap, sitemap.xml is empty (never localhost)", JSON.stringify(none));
  const local = parse(await sub(script, { NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "http://localhost:3000" }, ["--conditions=react-server"]));
  check(!!local && local.sitemap === null && local.urls === 0, "localhost: the same", JSON.stringify(local));
  const good = parse(await sub(script, { NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "https://shop.example.nl/" }, ["--conditions=react-server"]));
  check(!!good && good.sitemap?.[0] === "https://shop.example.nl/sitemap.xml" && good.host === "https://shop.example.nl" && good.urls > 400 && good.first === "https://shop.example.nl/", "a valid value (even with a pasted trailing slash): every URL is on it", JSON.stringify(good));
  check(!!good && good.stable === true && good.partHasDate === false && good.homeHasDate === false, "lastmod is not 'now': two generations 1.2 s apart are identical, and entries without a real date (home, parts) publish none (fails before: every lastmod was the generation time)", JSON.stringify(good));
  check(!!good && (good.withDate ?? 0) > 0, "entries that DO have a date (blog posts, guides) still publish it", JSON.stringify(good));
}

async function section2_nextConfig() {
  note("next.config.ts: CSP, canonical host, refusal to build a broken production on Vercel (A5-01, A5-26, A1-17)");
  const probe = `
    process.on("uncaughtException", (e) => { console.log("THROWN:" + String(e.message).split("\\n")[0]); process.exit(0); });
    if (process.env.QA_ARGV_BUILD === "1") process.argv.push("build");
    const mod = await imp("@repo/next.config");
    const cfg = mod.default;
    const headers = await cfg.headers();
    const redirects = await cfg.redirects();
    const all = headers[0].headers;
    const csp = all.find((h) => /^content-security-policy/i.test(h.key));
    const cors = headers.find((h) => h.source === "/api/:path*").headers.find((h) => h.key === "Access-Control-Allow-Origin");
    console.log(JSON.stringify({ cspKey: csp.key, csp: csp.value, cors: cors?.value ?? null, redirects, env: cfg.env }));
  `;
  const PK = `pk_live_${Buffer.from("clerk.shop.example.nl$").toString("base64").replace(/=+$/, "")}`;
  const good = await sub(probe, { NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "https://shop.example.nl", NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: PK, CLERK_SECRET_KEY: "sk_live_x", DEMO_MODE: "true" });
  let g: { cspKey: string; csp: string; cors: string | null; redirects: Array<{ source: string; has?: Array<{ value: string }>; destination: string; permanent: boolean }>; env: Record<string, string> } | null = null;
  try { g = JSON.parse(good.out.trim().split("\n").pop()!); } catch { /* reported below */ }
  check(!!g, "next.config.ts loads in a production environment", good.out + good.err);
  if (g) {
    check(g.cspKey === "Content-Security-Policy" && g.csp.includes("https://clerk.shop.example.nl") && g.csp.includes("https://challenges.cloudflare.com") && g.csp.includes("worker-src 'self' blob:"), "the production header is enforcing and names the Clerk host from the publishable key", g.csp);
    check(g.cors === "https://shop.example.nl", "CORS origin = NEXT_PUBLIC_APP_URL");
    const www = g.redirects.find((r) => r.has?.some((h) => h.value === "www\\.shop\\.example\\.nl"));
    check(!!www && www.destination === "https://shop.example.nl/:path*" && www.permanent === true && www.source === "/:path*", "www.<apex> is redirected permanently to the host in NEXT_PUBLIC_APP_URL", JSON.stringify(g.redirects));
    check(g.env.NEXT_PUBLIC_CLERK_ENABLED === "true", "DEMO_MODE=true in a PRODUCTION build no longer switches the sign-in UI off (it showed 'Demo modus' while the middleware wanted Clerk)", JSON.stringify(g.env));
    check(typeof g.env.WASFIX_EXPECTED_MIGRATIONS === "string" && JSON.parse(g.env.WASFIX_EXPECTED_MIGRATIONS).length >= 4, "the migration folders are baked in for the health route");
  }
  const apex = await sub(probe, { NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "https://www.shop.example.nl" });
  check(/"has":\[\{"type":"host","value":"shop\\\\\.example\\\\\.nl"\}\]/.test(apex.out), "a www canonical host redirects the bare domain to www", apex.out.slice(0, 300));
  const bad = await sub(probe, { NODE_ENV: "production", VERCEL_ENV: "production" });
  check(/THROWN:.*NEXT_PUBLIC_APP_URL/.test(bad.out), "Vercel production build without NEXT_PUBLIC_APP_URL refuses to build, with a clear message", bad.out + bad.err);
  const local = await sub(probe, { NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "http://localhost:3000", VERCEL_ENV: "production" });
  check(/THROWN:/.test(local.out), "Vercel production build with a localhost NEXT_PUBLIC_APP_URL refuses too");
  const preview = await sub(probe, { NODE_ENV: "production", VERCEL_ENV: "preview" });
  check(!/THROWN/.test(preview.out) && /"cors":null/.test(preview.out), "a Vercel PREVIEW build does not refuse, and then sends no CORS origin instead of localhost", preview.out.slice(0, 300));
  const selfHosted = await sub(probe, { NODE_ENV: "production", QA_ARGV_BUILD: "1" });
  check(!/THROWN/.test(selfHosted.out) && /WAARSCHUWING/.test(selfHosted.err), "outside Vercel, during `next build`, the same problem is a loud warning on stderr, not a crash", selfHosted.err.slice(0, 200));
  const lint = await sub(probe, { NODE_ENV: "production" });
  check(!/THROWN/.test(lint.out) && !/WAARSCHUWING/.test(lint.err), "...but not when next.config.ts is loaded by `next lint` (same NODE_ENV, no `build` argument): the warning printed on every local lint run (fails before)", lint.err.slice(0, 200));
  const dev = await sub(probe, { NODE_ENV: "development" });
  check(/"cspKey":"Content-Security-Policy-Report-Only"/.test(dev.out) && /unsafe-eval/.test(dev.out), "development: Report-Only header, unsafe-eval for HMR");
}

async function section3_rateLimit() {
  note("rate limit identity and degraded mode (A4-21, A5-19)");
  const { clientIp, getClientKey } = await import("../src/lib/ratelimit");
  const prod = { NODE_ENV: "production" };
  const onVercel = { NODE_ENV: "production", VERCEL: "1" };
  const spoof = fakeReq({ "x-vercel-forwarded-for": "20.0.0.1", "x-forwarded-for": "9.9.9.9, 10.1.1.1" });
  check(clientIp(spoof, onVercel) === "20.0.0.1", "on Vercel: x-vercel-forwarded-for is the identity");
  check(clientIp(spoof, prod) === "10.1.1.1", "NOT on Vercel: x-vercel-forwarded-for is ignored (it let a client mint a bucket per request); the last x-forwarded-for hop is used", clientIp(spoof, prod));
  check(clientIp(fakeReq({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 3.3.3.3" }), prod) === "3.3.3.3", "the FIRST x-forwarded-for entry (client-controlled) is never the identity");
  check(clientIp(fakeReq({ "x-real-ip": "4.4.4.4" }), prod) === "4.4.4.4", "x-real-ip is the fallback behind a proxy");
  const warnings: string[] = [];
  const realWarn = console.warn;
  console.warn = (...a: unknown[]) => { warnings.push(a.join(" ")); };
  check(clientIp(fakeReq({}), prod) === "" && getClientKey(fakeReq({})) === "anon", "no address at all -> empty identity / shared 'anon' bucket");
  clientIp(fakeReq({}), prod);
  console.warn = realWarn;
  check(warnings.filter((w) => /no client address/.test(w)).length === 1, "...and that is logged ONCE in production", warnings.join("|"));
  check(getClientKey(spoof, "user_1") === "user:user_1", "a signed-in caller is keyed on the account");

  const script = `
    const { rateLimit } = await imp("@repo/src/lib/ratelimit");
    const ok = [];
    for (let i = 0; i < 3; i++) ok.push(await rateLimit("k", 2, 60000));
    const t0 = Date.now();
    await rateLimit("k2", 5, 60000);
    await rateLimit("k3", 5, 60000);
    console.log(JSON.stringify({ ok, ms: Date.now() - t0 }));
  `;
  const noUpstash = await sub(script, { NODE_ENV: "production" });
  const warnLines = noUpstash.err.split("\n").filter((l) => /UPSTASH_REDIS_REST_URL\/TOKEN are not set/.test(l));
  check(warnLines.length === 1 && /times the number of instances/.test(warnLines[0]) && /"level":"warn"/.test(warnLines[0]), "production without Upstash: ONE loud warning that spells out the consequence", noUpstash.err.slice(0, 400));
  check(JSON.parse(noUpstash.out.trim()).ok.join() === "true,true,false", "...and the memory limiter still limits (2 allowed, 3rd refused)");
  const dev = await sub(script, { NODE_ENV: "development" });
  check(!/not set/.test(dev.err), "development without Upstash: no warning");
  const down = await sub(script, { NODE_ENV: "production", UPSTASH_REDIS_REST_URL: "http://127.0.0.1:1", UPSTASH_REDIS_REST_TOKEN: "t" });
  const downResult = JSON.parse(down.out.trim());
  check(downResult.ok.join() === "true,true,false", "an unreachable Upstash fails open to the memory limiter, which still limits", down.out + down.err.slice(0, 300));
  check(down.err.split("\n").filter((l) => /Upstash unreachable/.test(l)).length === 1, "...Upstash is tried once, then skipped for 30 s: ONE warning for five calls, not one (and one timeout) per request");
}

async function section4_logger() {
  note("logger: info is visible in production; errors carry their cause (A5-07)");
  const r = await sub(`
    const { logger } = await imp("@repo/src/lib/logger");
    logger.info("audit line", { invoice: "2026-00001" });
    logger.warn("warn line");
    logger.error("error line", new Error("the cause"));
  `, { NODE_ENV: "production" });
  const outLines = r.out.trim().split("\n").map((l) => { try { return JSON.parse(l); } catch { return null; } });
  const errLines = r.err.trim().split("\n").map((l) => { try { return JSON.parse(l); } catch { return null; } });
  check(outLines[0]?.level === "info" && outLines[0]?.msg === "audit line" && outLines[0]?.data?.invoice === "2026-00001", "production: logger.info is emitted as one JSON line on stdout (regression guard: this behaviour existed before this bundle)", r.out);
  check(errLines.some((l) => l?.level === "error" && l?.data?.message === "the cause" && /Error: the cause/.test(l.data.stack)), "production: logger.error carries the error message and stack, as JSON", r.err.slice(0, 300));
  const sink = await sub(`
    const { logger, setErrorSink } = await imp("@repo/src/lib/logger");
    const seen = [];
    setErrorSink((m) => { seen.push(m); throw new Error("a broken sink must not break logging"); });
    logger.error("one"); logger.error("two", new Error("x"), { report: false }); logger.info("three");
    console.log(JSON.stringify(seen));
  `, { NODE_ENV: "development" });
  check(sink.out.includes('["one"]'), "logger.error forwards to the sink; report:false and info/warn do not; a throwing sink never breaks the caller", sink.out + sink.err.slice(0, 200));
}

type Hit = { path: string; body: string };
async function fakeSlack() {
  const hits: Hit[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => { hits.push({ path: req.url ?? "", body }); res.writeHead(200); res.end("ok"); });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`, hits, close: () => server.close() };
}

async function section5_monitoring() {
  note("error monitoring: cool-down per signature and a cap on the total (A5-07)");
  let now = 1_000_000;
  const gate = new AlertGate({ cooldownMs: 60_000, maxPerWindow: 3, windowMs: 3_600_000, now: () => now });
  check(gate.admit("a").send && !gate.admit("a").send && gate.admit("b").send, "the same signature is sent once per cool-down, another signature passes");
  now += 61_000;
  const again = gate.admit("a");
  check(again.send && again.suppressed === 1, "after the cool-down it is sent again and says how many were suppressed", JSON.stringify(again));
  check(!gate.admit("c").send && gate.admit("c").reason === "cap", "the total is capped per window whatever the signatures");
  now += 3_700_000;
  check(gate.admit("d").send, "the cap releases after the window");

  check(normaliseForSignature("Order 4821 failed for 3f2a9c1e-0b4d-4e6f-8a11-1234567890ab") === normaliseForSignature("Order 7 failed for aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"), "ids and numbers do not make a new signature");
  check(firstLine("Invalid `prisma.order.create()` invocation:\n\n  data: { email: \"secret@x.nl\" }") === "Invalid `prisma.order.create()` invocation:" && pathOnly("/bestelling/abc?t=SECRET") === "/bestelling/abc", "only the first message line and the path without query ever leave (a Prisma error lists values after the first line; an order link carries its token in the query)");

  check(firstLine("\nInvalid `prisma.order.create()` invocation:\n\n  data: { email: \"secret@x.nl\" }") === "Invalid `prisma.order.create()` invocation:" && firstLine("\n\n  \n") === "", "firstLine skips the leading blank lines real Prisma messages start with (fails before: it returned '' and the alert read 'PrismaClientKnownRequestError: ')");

  note("what a logger.error PAYLOAD turns into (fails before: a plain object read 'NonError: [object Object]', the order id was lost)");
  const rows: Array<{ msg: string; ctx: Record<string, unknown> }> = [];
  const rep = () => new ErrorReporter(new AlertGate({ cooldownMs: 60_000, maxPerWindow: 50, now: () => 5 }), async (err, ctx) => { rows.push({ msg: err.message, ctx }); });
  const r1 = rep();
  await r1.loggedError("Paid order oversold", { orderId: "ord_ABC123", parts: ["SKU-1", "SKU-2"], email: "jan@example.nl", name: "Jan de Vries", address: "Straat 1", note: { nested: true } });
  const o = JSON.stringify(rows[0]);
  check(/ord_ABC123/.test(o) && /SKU-1,SKU-2/.test(o) && !/object Object|NonError/.test(o), "an object payload: the order id and the parts reach the message, no '[object Object]'", o);
  check(!/jan@example|Jan de Vries|Straat 1|nested|email|address/.test(o), "...and keys outside the allow-list (email, name, address, anything nested) are dropped", o);
  await r1.loggedError("Webhook handler error", { type: "invoice.paid", id: "evt_9", attempt: 2, err: new Error("\nInvalid `prisma.order.update()` invocation:\n\n  data: { email: 'x@y.nl' }\nrecord not found") });
  const w = JSON.stringify(rows[1]);
  check(/evt_9/.test(w) && /invoice\.paid/.test(w) && /prisma\.order\.update\(\)/.test(w) && !/x@y\.nl|object Object/.test(w), "a payload with a nested err: its first non-empty line is the reason, its values stay out", w);
  await r1.loggedError("[checkout] Stripe session could not be created", { type: "StripeConnectionError", code: "ECONNRESET", statusCode: 502 });
  check(rows[2].ctx.code === "ECONNRESET" && JSON.stringify(rows[2]).includes("502"), "code and statusCode are kept", JSON.stringify(rows[2]));
  const keys = Object.keys(reportableFields({ orderId: "o", email: "e@x.nl", phone: "06", iban: "NL02", name: "n", customer: { a: 1 }, parts: [1, { x: 1 }, "s"] }));
  check(keys.join() === "orderId,parts", "reportableFields: only allow-listed scalar keys survive (arrays keep scalar members only)", keys.join());

  note("Prisma errors: the code is part of the signature (fails before: one signature per route, the second failure was suppressed)");
  const prismaLike = (code: string) => Object.assign(new Error("\nInvalid `prisma.order.create()` invocation:\n\n  data: {...}\nsomething"), { name: "PrismaClientKnownRequestError", code });
  const rp = rep();
  const before = rows.length;
  await rp.requestError(prismaLike("P2002"), { method: "POST", path: "/api/checkout" }, { routePath: "/api/checkout" });
  await rp.requestError(prismaLike("P2002"), { method: "POST", path: "/api/checkout" }, { routePath: "/api/checkout" });
  await rp.requestError(prismaLike("P1001"), { method: "POST", path: "/api/checkout" }, { routePath: "/api/checkout" });
  const prismaRows = rows.slice(before);
  check(prismaRows.length === 2 && prismaRows[0].msg === "PrismaClientKnownRequestError: Invalid `prisma.order.create()` invocation:" && prismaRows[0].ctx.code === "P2002" && prismaRows[1].ctx.code === "P1001", "same code twice -> one message; a different code on the same route -> its own message; the reason is not empty", JSON.stringify(prismaRows));

  note("the logger.error sink: registered with after() inside a request, plain call outside it");
  const registered: Array<() => Promise<unknown>> = [];
  const rs = rep();
  const sink = makeErrorSink(rs, (task) => { registered.push(task); });
  const n0 = rows.length;
  sink("Sink test A", { orderId: "ord_SINK1" });
  check(registered.length === 1, "inside a request the alert is handed to after(), so a serverless host keeps the function alive until it is sent (fails before: fire-and-forget)");
  if (registered[0]) await registered[0](); else await new Promise((r) => setTimeout(r, 50));
  check(rows.length === n0 + 1 && /ord_SINK1/.test(JSON.stringify(rows[n0])), "...and the promise it registered resolves after the alert was sent");
  const sink2 = makeErrorSink(rs, () => { throw new Error("after() was called outside a request scope"); });
  let threw = false;
  try { sink2("Sink test B", { orderId: "ord_SINK2" }); } catch { threw = true; }
  await new Promise((r) => setTimeout(r, 50));
  check(!threw && rows.some((r) => /ord_SINK2/.test(JSON.stringify(r))), "outside a request after() throws: the sink swallows that and still sends the alert");

  const sent: string[] = [];
  const reporter = new ErrorReporter(new AlertGate({ cooldownMs: 60_000, maxPerWindow: 10, now: () => 5 }), async (err, ctx) => { sent.push(`${ctx.where} | ${err.message} | ${JSON.stringify(ctx)}`); });
  for (let i = 0; i < 500; i++) await reporter.requestError(new Error(`Timeout talking to Stripe (attempt ${i})`), { method: "POST", path: "/api/checkout?x=1" }, { routePath: "/api/checkout", routeType: "route" });
  check(sent.length === 1, `an error storm (500 identical failures) produces ONE message, not 500 (got ${sent.length})`);
  await reporter.requestError(new Error("Different problem"), { method: "GET", path: "/bestelling/abc?t=TOKEN123" }, { routePath: "/bestelling/[id]" });
  check(sent.length === 2 && !sent.join("").includes("TOKEN123") && sent[1].includes("/bestelling/[id]"), "a different error is reported, with the route PATTERN and never the token");

  note("end to end: instrumentation -> notify -> a fake Slack");
  const slack = await fakeSlack();
  try {
    const run = await sub(`
      process.env.NEXT_RUNTIME = "nodejs";
      const inst = await imp("@repo/src/instrumentation");
      await inst.register();
      const { logger } = await imp("@repo/src/lib/logger");
      const err = Object.assign(new Error("Connection refused\\n  password=hunter2 email=jan@example.nl"), { digest: "d1g3st" });
      for (let i = 0; i < 40; i++) await inst.onRequestError(err, { method: "GET", path: "/bestelling/abc?t=SECRETTOKEN" }, { routePath: "/bestelling/[id]", routeType: "render" });
      for (let i = 0; i < 40; i++) logger.error("Stripe session create failed", new Error("socket hang up"));
      logger.error("[checkout] refused: deployment cannot take orders", { reason: "company", missing: ["COMPANY_KVK", "COMPANY_VAT"] });
      logger.error("Paid order oversold — stock went negative", { orderId: "ord_ABC123", parts: ["SKU-1"], email: "jan@example.nl", name: "Jan de Vries" });
      logger.error("Webhook handler error", { type: "invoice.paid", id: "evt_9", attempt: 2, err: new Error("\\nInvalid \`prisma.order.update()\` invocation:\\n\\n  data: { email: 'x@y.nl' }\\nrecord not found") });
      await new Promise((r) => setTimeout(r, 800));
      Promise.reject(new Error("nobody awaited me"));
      await new Promise((r) => setTimeout(r, 800));
      console.log("done");
    `, { NODE_ENV: "production", SLACK_WEBHOOK_URL: slack.url, NEXT_PUBLIC_APP_URL: "https://shop.example.nl" }, ["--conditions=react-server"]);
    check(run.out.includes("done") && run.code === 0, "the process survives 80 failures and an unhandled rejection", run.out + run.err.slice(0, 400));
    const texts = slack.hits.map((h) => JSON.parse(h.body).text as string);
    check(texts.filter((t) => /bestelling/.test(t)).length === 1, `40 identical request errors -> exactly 1 Slack message (got ${texts.filter((t) => /bestelling/.test(t)).length})`, texts.join("\n---\n"));
    check(texts.filter((t) => /Stripe session create failed/.test(t)).length === 1, "40 identical logger.error calls -> exactly 1 Slack message");
    check(texts.some((t) => /nobody awaited me/.test(t)), "an unhandled promise rejection reaches the owner");
    const all = texts.join("\n");
    check(!/SECRETTOKEN|hunter2|jan@example\.nl|password=/.test(all), "no query string, no later message lines, no e-mail address reaches the channel", all);
    check(/d1g3st/.test(all) && /\/bestelling\/\[id\]/.test(all), "the digest and the route pattern DO reach it, so the owner can find the stack in the platform log");
    check(/shop\.example\.nl|FOUT|\[FOUT\]/.test(all), "the message is marked as an error");
    check(/COMPANY_KVK/.test(all) && /ord_ABC123/.test(all) && /evt_9/.test(all) && /prisma\.order\.update/.test(all), "real logger.error calls with a plain object reach Slack WITH their identifiers (checkout refused, oversold, webhook error)", all);
    check(!/object Object|NonError/.test(all) && !/Jan de Vries|jan@example|x@y\.nl/.test(all), "...no '[object Object]' and no customer name or address", all);
  } finally {
    slack.close();
  }
}

async function section5b_clientError() {
  note("/api/client-error: a public route must not become a free-text channel into the owner's Slack (fails before: any text and any link was forwarded, 18 messages from 30 requests)");
  const h = new Headers({ "sec-fetch-site": "same-origin" });
  check(sameOrigin(h) && !sameOrigin(new Headers()) && !sameOrigin(new Headers({ "sec-fetch-site": "cross-site" })) && !sameOrigin(new Headers({ "sec-fetch-site": "same-site" })), "sameOrigin: same-origin yes; no headers, cross-site and same-site no");
  check(sameOrigin(new Headers({ origin: "https://shop.example.nl", host: "shop.example.nl" })) && !sameOrigin(new Headers({ origin: "https://evil.example", host: "shop.example.nl" })) && !sameOrigin(new Headers({ origin: "not a url", host: "x" })), "sameOrigin falls back to Origin == Host when Sec-Fetch-Site is absent");
  check(alertableName("SecurityAlert") === "Error" && alertableName("TypeError") === "TypeError" && alertableName(42) === "Error", "only error names from a fixed list are kept");
  check(alertablePath("/bestelling/abc?t=SECRET") === "/bestelling/abc" && alertablePath("https://evil.example/login") === "?" && alertablePath("/a b") === "?" && alertablePath("/x".repeat(80)) === "?" && alertablePath("/") === "/", "only a strict path pattern is kept (no scheme, no spaces, no query)");

  const slack = await fakeSlack();
  try {
    const run = await sub(`
      process.env.NEXT_RUNTIME = "nodejs";
      const inst = await imp("@repo/src/instrumentation");
      await inst.register();
      const { POST } = await imp("@repo/src/app/api/client-error/route");
      const ns = await import("@repo/node_modules/next/server.js");
      const NextRequest = ns.NextRequest ?? ns.default.NextRequest;
      let n = 0;
      const send = async (body, headers) => {
        const res = await POST(new NextRequest("http://localhost/api/client-error", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { host: "localhost", "x-forwarded-for": headers?.xff ?? "10.1.0." + (++n), ...(headers?.h ?? { "sec-fetch-site": "same-origin" }) } }));
        return res.status;
      };
      const out = {};
      out.noHeaders = await send({ name: "TypeError", path: "/x" }, { h: {} });
      out.crossSite = await send({ name: "TypeError", path: "/x" }, { h: { "sec-fetch-site": "cross-site" } });
      out.evilOrigin = await send({ name: "TypeError", path: "/x" }, { h: { origin: "http://evil.example" } });
      out.sameOrigin = await send({ name: "TypeError", message: "x is not a function", path: "/checkout" });
      out.phish = await send({ name: "SecurityAlert", message: "Je Stripe-account is opgeschort, verifieer op https://stripe-verify.example.com/login nu", path: "https://evil.example/login" });
      out.tooBig = await send("x".repeat(2000));
      out.garbage = await send("not json");
      // The same client address, six times in a minute: the 6th is refused.
      const same = [];
      for (let i = 0; i < 6; i++) same.push(await send({ name: "Error", path: "/same" }, { xff: "7.7.7.7" }));
      out.sameClient = same;
      // 30 different clients, 30 different paths and names: a spray.
      const names = ["TypeError", "RangeError", "ReferenceError", "SyntaxError", "ChunkLoadError"];
      for (let i = 0; i < 30; i++) await send({ name: names[i % 5], message: "spam " + i + " https://x.example/" + i, path: "/spray/" + String.fromCharCode(97 + (i % 26)) + String.fromCharCode(97 + (i % 7)) });
      await new Promise((r) => setTimeout(r, 800));
      // A real server error afterwards must still get through.
      await inst.onRequestError(new Error("Database fell over"), { method: "GET", path: "/api/orders" }, { routePath: "/api/orders", routeType: "route" });
      await new Promise((r) => setTimeout(r, 600));
      console.log("RESULT " + JSON.stringify(out));
    `, { NODE_ENV: "production", SLACK_WEBHOOK_URL: slack.url, NEXT_PUBLIC_APP_URL: "https://shop.example.nl" }, ["--conditions=react-server"]);
    const line = run.out.split("\n").find((l) => l.startsWith("RESULT "));
    const r = line ? (JSON.parse(line.slice(7)) as Record<string, number | number[]>) : null;
    check(!!r, "the route runs in a production-mode process", run.out + run.err.slice(0, 500));
    if (r) {
      check(r.noHeaders === 403 && r.crossSite === 403 && r.evilOrigin === 403, "a request without same-origin proof, from another site or from another origin is refused (403)", JSON.stringify(r));
      check(r.sameOrigin === 202 && r.phish === 202 && r.tooBig === 413 && r.garbage === 202, "same-origin 202; 2 KB body 413; garbage dropped quietly with 202", JSON.stringify(r));
      check(Array.isArray(r.sameClient) && r.sameClient.join() === "202,202,202,202,202,429", "the route keys its rate limit on the client address: the 6th request in a minute from one address is 429, while the other addresses above were not affected", JSON.stringify(r.sameClient));
    }
    const texts = slack.hits.map((h2) => JSON.parse(h2.body).text as string);
    const browser = texts.filter((t) => /browser/.test(t));
    const all = texts.join("\n---\n");
    check(browser.length >= 1 && browser.some((t) => /TypeError in de browser/.test(t) && /\/checkout/.test(t)), "an ordinary report reaches the owner as: error name + route", all);
    check(!/stripe-verify|opgeschort|SecurityAlert|evil\.example|spam|x is not a function/.test(all), "NO text from the browser reaches the channel: not the message, not a link, not an invented error name (fails before)", all);
    check(browser.length <= 3, `30 sprayed requests from 30 addresses produce at most 3 browser alerts (got ${browser.length}; fails before: 18)`, all);
    check(texts.some((t) => /Database fell over/.test(t)), "a real server error right after the spray is still delivered: browsers cannot use up the shared cap", all);
    check(/stripe-verify/.test(run.err) && /"level":"warn"/.test(run.err), "the browser's own text is in the platform log (JSON warn line), where the owner can read it", run.err.slice(0, 300));
  } finally {
    slack.close();
  }
}

async function sectionAdminList() {
  note("preflight reads ADMIN_EMAILS the way the app does (fails before: split on ',' only, so 'a@x.nl; b@x.nl' was a false BLOCK)");
  const samples = ["owner@shop.example.nl", "a@x.nl; b@x.nl", "a@x.nl b@x.nl", "a@x.nl,b@x.nl;c@x.nl", " A@X.nl ,, ", "", "not-an-email"];
  const r = await sub(`
    const { parseAdminEmails } = await imp("@repo/src/lib/auth");
    const { adminList } = await imp("@repo/scripts/preflight");
    const valid = (e) => /^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(e);
    const rows = ${JSON.stringify(samples)}.map((raw) => ({ raw, app: parseAdminEmails(raw), pre: adminList(raw).map((e) => e.toLowerCase()).filter(valid) }));
    console.log("RESULT " + JSON.stringify(rows));
  `, { NODE_ENV: "production" }, ["--conditions=react-server"]);
  const line = r.out.split("\n").find((l) => l.startsWith("RESULT "));
  const rows = line ? (JSON.parse(line.slice(7)) as Array<{ raw: string; app: string[]; pre: string[] }>) : [];
  check(rows.length === samples.length && rows.every((x) => JSON.stringify(x.app) === JSON.stringify(x.pre)), "preflight's adminList and src/lib/auth.ts parseAdminEmails agree on every sample (comma, semicolon, space, case, empty)", r.out + r.err.slice(0, 300));
  check(adminList("a@x.nl; b@x.nl").length === 2, "adminList splits on semicolon and space");
}

async function section6_health() {
  note("health route (A5-07): truthful about the database and migrations, 503 when unusable, no details leaked");
  const dbUrl = process.env.QA_PLATFORM_DB_URL ?? process.env.DATABASE_URL;
  const folders = fs.readdirSync(path.join(ROOT, "prisma", "migrations"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  const script = `
    const { GET } = await imp("@repo/src/app/api/v1/health/route");
    const res = await GET();
    const body = await res.json();
    console.log(JSON.stringify({ status: res.status, body }));
  `;
  const parse = (r: Sub) => { try { return JSON.parse(r.out.trim().split("\n").pop()!) as { status: number; body: { status: string; checks: { database: string; migrations: string } } & Record<string, unknown> }; } catch { return null; } };
  if (dbUrl) {
    const ok = parse(await sub(script, { NODE_ENV: "production", DATABASE_URL: dbUrl, WASFIX_EXPECTED_MIGRATIONS: JSON.stringify(folders) }, ["--conditions=react-server"]));
    check(ok?.status === 200 && ok.body.status === "ok" && ok.body.checks.database === "ok" && ok.body.checks.migrations === "ok", "healthy: 200, database ok, migrations ok", JSON.stringify(ok));
    const pending = parse(await sub(script, { NODE_ENV: "production", DATABASE_URL: dbUrl, WASFIX_EXPECTED_MIGRATIONS: JSON.stringify([...folders, "29990101000000_not_applied_yet"]) }, ["--conditions=react-server"]));
    check(pending?.status === 503 && pending.body.status === "unavailable" && pending.body.checks.migrations === "pending", "a migration in this build that the database lacks: 503 / pending", JSON.stringify(pending));
    check(!JSON.stringify(pending).includes("29990101000000") && !JSON.stringify(pending).includes("not_applied_yet"), "...without naming the migration");
    const unknown = parse(await sub(script, { NODE_ENV: "production", DATABASE_URL: dbUrl }, ["--conditions=react-server"]));
    check(unknown?.status === 200 && unknown.body.checks.migrations === "unknown", "no baked-in migration list: migrations 'unknown', not 'ok'", JSON.stringify(unknown));
  } else note("SKIPPED health against a database: set DATABASE_URL");
  const dead = await sub(script, { NODE_ENV: "production", DATABASE_URL: "postgresql://nobody:topsecret@127.0.0.1:1/shop" }, ["--conditions=react-server"]);
  const d = parse(dead);
  check(d?.status === 503 && d.body.checks.database === "unreachable", "an unreachable database: 503 / unreachable (it used to answer 200 ok)", dead.out + dead.err.slice(0, 300));
  const deadBody = dead.out.trim().split("\n").pop() ?? "";
  check(!deadBody.includes("topsecret") && !deadBody.includes("127.0.0.1") && !deadBody.includes("nobody") && !deadBody.includes("shop\"") && !/prisma|invocation/i.test(deadBody), "...and the response body leaks no host, user, password, database name or Prisma text (the cause goes to the server log only)", deadBody);
  const none = parse(await sub(script, { NODE_ENV: "production" }, ["--conditions=react-server"]));
  check(none?.status === 503 && none.body.checks.database === "not_configured", "production without DATABASE_URL: 503 / not_configured");
  const devNone = parse(await sub(script, { NODE_ENV: "development" }, ["--conditions=react-server"]));
  check(devNone?.status === 200 && devNone.body.status === "ok" && devNone.body.checks.database === "not_configured", "development without a database: still 200 (the app runs on the static catalogue)");
  check(devNone?.body.status === "ok" && Array.isArray(devNone.body.endpoints) && !!devNone.body.limits, "the existing fields (status ok, endpoints, limits) are unchanged");
}

function section7_migrate() {
  note("scripts/migrate.ts (A5-13): migrations run over DIRECT_URL");
  const pooled = "postgresql://u:p@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1";
  const direct = "postgresql://u:p@aws-0-eu-central-1.pooler.supabase.com:5432/postgres";
  const a = buildMigrateEnv({ DATABASE_URL: pooled, DIRECT_URL: direct });
  check(a.env.DATABASE_URL === direct && a.usingDirect && a.warnings.length === 0 && a.error === null, "DIRECT_URL set: the child process gets it as DATABASE_URL");
  const b = buildMigrateEnv({ DATABASE_URL: pooled });
  check(!b.usingDirect && b.env.DATABASE_URL === pooled && b.warnings.some((w) => /DIRECT_URL/.test(w)), "only a pooled DATABASE_URL: used, with a warning that names DIRECT_URL");
  const c = buildMigrateEnv({ DATABASE_URL: "postgresql://wasfix:wasfix@localhost:5432/wasfix" });
  check(c.warnings.length === 0 && !c.usingDirect, "a plain local DATABASE_URL: no warning (local dev, CI)");
  check(buildMigrateEnv({ DIRECT_URL: pooled }).warnings.some((w) => /pooler/.test(w)), "a pooled DIRECT_URL is called out");
  check(buildMigrateEnv({}).error !== null, "neither variable: an error, not a silent default");
  check(describeUrl(direct) === "aws-0-eu-central-1.pooler.supabase.com:5432/postgres" && !String(describeUrl(direct)).includes("u:p") && describeUrl("junk") === null && looksPooled(pooled) && !looksPooled(direct), "what is printed never contains credentials");
  const schema = fs.readFileSync(path.join(ROOT, "prisma", "schema.prisma"), "utf8");
  check(!/directUrl/.test(schema), "schema.prisma stays free of directUrl (it would make DIRECT_URL mandatory for every prisma command, including postinstall)");
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
  check(pkg.scripts["db:migrate:deploy"] === "tsx scripts/migrate.ts deploy" && /migrate\.ts deploy/.test(pkg.scripts["db:setup"]) && /migrate\.ts seed/.test(pkg.scripts["db:seed"]), "the db scripts go through scripts/migrate.ts");
  for (const [name, cmd] of Object.entries(pkg.scripts)) {
    const files = [...cmd.matchAll(/(?:tsx(?: --conditions=[\w-]+)?|node) (scripts\/[\w./-]+|prisma\/[\w./-]+)/g)].map((m) => m[1]);
    for (const f of files) check(fs.existsSync(path.join(ROOT, f)), `package.json "${name}" points at an existing file (${f})`);
  }
}

function section8_vercelJson() {
  note("vercel.json (A5-12) and the scheduled routes");
  const v = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8")) as { regions?: string[]; crons?: Array<{ path: string; schedule: string }> };
  check(JSON.stringify(v.regions) === '["fra1"]', "region pinned (fra1, near a Frankfurt database; documented as a choice to change)");
  const crons = v.crons ?? [];
  const routes = fs.readdirSync(path.join(ROOT, "src/app/api/cron"), { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith("_")).map((d) => `/api/cron/${d.name}`).sort();
  check(JSON.stringify(crons.map((c) => c.path).sort()) === JSON.stringify(routes), `every cron route has a schedule and every schedule a route (${routes.join(", ")})`, `routes ${routes.join(",")} vs schedules ${crons.map((c) => c.path).join(",")}`);
  for (const c of crons) {
    const f = c.schedule.split(/\s+/);
    check(f.length === 5 && /^\d+$/.test(f[0]) && /^\d+$/.test(f[1]) && f[2] === "*" && f[3] === "*" && f[4] === "*", `${c.path}: ${c.schedule} runs once a day (safe on any plan; the route headers name the tighter intended schedule)`);
    const src = fs.readFileSync(path.join(ROOT, "src/app/api/cron", c.path.split("/").pop()!, "route.ts"), "utf8");
    check(/export async function GET/.test(src), `${c.path} answers GET (what Vercel Cron sends)`);
  }
  check(new Set(crons.map((c) => c.schedule)).size === crons.length, "the four jobs do not all start in the same minute");
  const uniq = (p: string) => /export const maxDuration = \d+/.test(fs.readFileSync(path.join(ROOT, p), "utf8"));
  check(uniq("src/app/api/checkout/route.ts") && uniq("src/app/api/stripe/webhook/route.ts"), "checkout and the Stripe webhook set maxDuration in the route file (the mechanism Vercel documents for App Router)");
}

// The REAL service worker the site shipped before this bundle (git history of public/sw.js), not a
// simplified stand-in: the test must show that what visitors actually have installed is removed.
const OLD_SW = fs.readFileSync(path.join(ROOT, "scripts", "fixtures", "old-sw.js"), "utf8");

async function section9_serviceWorker() {
  note("service worker (A5-22): the old one cached signed-in pages; the replacement removes it");
  const sw = fs.readFileSync(path.join(ROOT, "public", "sw.js"), "utf8");
  check(!/addEventListener\(\s*["']fetch["']/.test(sw) && /caches\.delete/.test(sw) && /unregister\(\)/.test(sw), "public/sw.js has no fetch handler, deletes all caches and unregisters itself");
  const reg = fs.readFileSync(path.join(ROOT, "src/components/ServiceWorkerRegister.tsx"), "utf8");
  check(!/serviceWorker\.register\(/.test(reg) && /unregister\(\)/.test(reg), "the page no longer registers a worker (it used to, before any consent); it unregisters the old one");

  const pw = loadPlaywright();
  if (!pw) {
    const msg = "Chromium/Playwright not found: service-worker browser test not run";
    if (process.env.QA_REQUIRE_BROWSER === "1") check(false, msg); else note(`SKIPPED ${msg}`);
    return;
  }
  let swSource = OLD_SW;
  const server = http.createServer((req, res) => {
    if (req.url === "/sw.js") { res.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-store" }); return res.end(swSource); }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<html><body>${req.url} signed-in page for Jan de Vries, Voorbeeldstraat 1</body></html>`);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const browser = await pw.chromium.launch();
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${origin}/`);
    await page.evaluate(async () => { await navigator.serviceWorker.register("/sw.js"); await navigator.serviceWorker.ready; });
    await page.goto(`${origin}/dashboard`);
    await page.waitForTimeout(500);
    await page.reload();
    await page.waitForTimeout(500);
    const before: string[] = await page.evaluate(async () => { const out: string[] = []; for (const n of await caches.keys()) for (const r of await (await caches.open(n)).keys()) out.push(r.url); return out; });
    check(before.some((u) => u.endsWith("/dashboard")), "BEFORE: the REAL old worker (scripts/fixtures/old-sw.js) has the signed-in /dashboard HTML in Cache Storage (the finding, reproduced)", JSON.stringify(before));

    swSource = sw;
    await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r?.update(); });
    let state = { regs: 1, caches: 1 };
    for (let i = 0; i < 40 && (state.regs > 0 || state.caches > 0); i++) {
      await page.waitForTimeout(250);
      state = await page.evaluate(async () => ({ regs: (await navigator.serviceWorker.getRegistrations()).length, caches: (await caches.keys()).length }));
    }
    check(state.regs === 0 && state.caches === 0, "AFTER: the new /sw.js unregisters itself and every cache is deleted", JSON.stringify(state));
    await page.goto(`${origin}/dashboard`);
    const controlled = await page.evaluate(() => navigator.serviceWorker.controller !== null);
    check(!controlled, "a fresh page load is not controlled by any worker");
  } finally {
    await browser.close();
    server.close();
  }
}

function section10_envExample() {
  note(".env.example against the code (A5-17: it listed variables nothing reads and omitted ones that matter)");
  const example = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");
  const documented = new Set([...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]{2,})=/gm)].map((m) => m[1]));
  const used = new Set<string>();
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx|mjs)$/.test(e.name) && !/^qa-/.test(e.name)) {
        const text = fs.readFileSync(p, "utf8");
        for (const m of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)|\bread\("([A-Z][A-Z0-9_]+)"\)/g)) used.add(m[1] ?? m[2]);
      }
    }
  };
  for (const d of ["src", "scripts", "prisma"]) walk(path.join(ROOT, d));
  used.add("NEXT_PUBLIC_APP_URL");
  const NOT_FOR_THE_OWNER = new Set(["NODE_ENV", "NEXT_RUNTIME", "NEXT_DIST_DIR", "ANALYZE", "BASE_URL", "VERCEL", "VERCEL_ENV", "PLAYWRIGHT_PATH", "SEED_DEMO", "WASFIX_EXPECTED_MIGRATIONS", "NEXT_PUBLIC_CLERK_ENABLED", "HOME", "PATH", "RESEND_BASE_URL", "TSX_TSCONFIG_PATH", "CI", "INTERNAL_API_KEY", "SEED_USERS"]);
  // INTERNAL_API_KEY: declared in src/lib/env.ts; no other file reads it (grep). SEED_USERS: prisma/seed.ts only prints that it is ignored.
  const missing = [...used].filter((v) => !documented.has(v) && !NOT_FOR_THE_OWNER.has(v) && !/^(QA_|PROBE_|STRIPE_API_BASE)/.test(v)).sort();
  check(missing.length === 0, "every variable the code reads is in .env.example (or is a test/platform variable)", `missing from .env.example: ${missing.join(", ")}`);
  // SEED_DEMO is read through the env object handed to seedMode() in prisma/seed-mode.ts; the Clerk sign-in URLs are read by Clerk itself.
  const dead = [...documented].filter((v) => !used.has(v) && v !== "SEED_DEMO" && !/^NEXT_PUBLIC_CLERK_SIGN_(IN|UP)_URL$/.test(v)).sort();
  check(dead.length === 0, "no variable in .env.example is read by nothing", `documented but unused: ${dead.join(", ")}`);
  check(!/^DEMO_MODE=true/m.test(example) && !/^NODE_ENV=/m.test(example), ".env.example no longer tells the owner to set DEMO_MODE=true / NODE_ENV=development (the documented setup used to break a deploy)");
  for (const v of ["ADMIN_EMAILS", "SLACK_WEBHOOK_URL", "DISCORD_WEBHOOK_URL", "ORDER_NOTIFY_EMAIL", "CRON_SECRET", "DIRECT_URL"]) check(documented.has(v), `${v} is documented`);
}

function section11_docs() {
  note("documents against the code (A5-17: the runbook claimed things that were false or never checked)");
  const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
  const blocked = read("BLOCKED.md");
  const missingEvents = HANDLED_STRIPE_EVENTS.filter((e) => !blocked.includes(e));
  check(missingEvents.length === 0, `BLOCKED.md lists every Stripe event the webhook handles (${HANDLED_STRIPE_EVENTS.length})`, `missing from BLOCKED.md: ${missingEvents.join(", ")}`);
  const apiVersion = /STRIPE_API_VERSION\s*=\s*"([^"]+)"/.exec(read("src/lib/stripe.ts"))?.[1] ?? "";
  check(apiVersion.length > 0 && blocked.includes(apiVersion), `BLOCKED.md names the webhook API version the code is written for (${apiVersion})`);
  for (const term of ["NEXT_PUBLIC_APP_URL", "CRON_SECRET", "ADMIN_EMAILS", "make-admin", "DIRECT_URL", "pgbouncer=true", "connection_limit=1", "fra1", "npm run preflight", "Authorization: Bearer", "tax_behavior", "€ 199", "ESTIMATE", "niet gecontroleerd"]) {
    check(blocked.includes(term), `BLOCKED.md mentions ${term} (presence only: the behaviour is checked elsewhere in this suite and in qa-preflight)`);
  }
  for (const stale of ["Set `DATABASE_URL` in Vercel (Production + Preview)", "DKIM/SPF DNS already exist", "Stripe orders are unaffected", "claims the seeded ADMIN row", "Mollie alternative", "1,5 dag", "set `DEMO_MODE=false`"]) {
    check(!blocked.includes(stale), `BLOCKED.md no longer says "${stale}"`);
  }
  check(/geen enkele\s+klantmail/.test(blocked) && /\*\*onbekend\*\*/.test(blocked), "BLOCKED.md states the Resend DNS claim as unverified");
  const decisions = read("DECISIONS.md");
  const missingD = Array.from({ length: 13 }, (_, i) => `D${i + 1}`).filter((d) => !new RegExp(`\\*\\*${d}[ .]`).test(decisions));
  check(missingD.length === 0, "DECISIONS.md records D1 to D13", `missing: ${missingD.join(", ")}`);
  const readme = read("README.md");
  check(readme.includes("BLOCKED.md") && !/Bancontact/.test(readme) && !/DEMO_MODE=false/.test(readme) && !/`DEMO_MODE=true` \(default\)/.test(readme), "README points at the runbook, mentions no Bancontact and no DEMO_MODE=false setup step");
  const money = read("MONETIZATION.md");
  check(/schatting/i.test(money) && /ESTIMATE/.test(money) && /\/admin\/economie/.test(money), "MONETIZATION.md says its margins rest on estimated costs and points at /admin/economie");
  const arch = read("ARCHITECTURE.md");
  check(!/Bancontact/.test(arch.replace(/Bancontact is removed[^\n]*/g, "")), "ARCHITECTURE.md mentions no Bancontact");
  const ci = read(".github/workflows/ci.yml");
  const suitesInCi = ["qa-admin", "qa-plans", "qa-orders", "qa-stripe", "qa-diagnose", "qa-notify", "qa-checkout", "qa-storefront", "qa-csp", "qa-platform", "qa-preflight"];
  check(suitesInCi.every((n) => ci.includes(`scripts/${n}.ts`) && fs.existsSync(path.join(ROOT, "scripts", `${n}.ts`))), "CI runs every offline QA suite and each file exists");
  check(/qa-admin\.ts/.test(ci) && !/--conditions=react-server scripts\/qa-admin/.test(ci) && !/--conditions=react-server scripts\/qa-plans/.test(ci), "CI runs qa-admin and qa-plans WITHOUT the react-server condition (they crash with it)");
  check(/--conditions=react-server scripts\/qa-(orders|stripe|checkout|storefront)\.ts/.test(ci), "CI runs the server-only suites with --conditions=react-server");
  check(/NEXT_PUBLIC_APP_URL:/.test(ci) && /CRON_SECRET:/.test(ci), "the CI production build has NEXT_PUBLIC_APP_URL and CRON_SECRET");
  const chromiumAt = ci.indexOf("npx playwright install");
  const offlineAt = ci.indexOf("Offline QA suites");
  check(chromiumAt > 0 && chromiumAt < offlineAt && /suite platform\s+env QA_REQUIRE_BROWSER=1/.test(ci), "CI installs Chromium BEFORE the offline suites and qa-platform runs with QA_REQUIRE_BROWSER=1, so its service-worker half cannot be skipped silently (fails before: it ran before Chromium existed)");
  const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
  check(/migrate\.ts resolve/.test(pkg.scripts["db:baseline"] ?? ""), "db:baseline goes through scripts/migrate.ts (DIRECT_URL), as the runbook recommends it for a pooled connection (fails before: it called prisma directly)", pkg.scripts["db:baseline"]);
  check(/baked|ingebakken/.test(blocked) === false && !/ingebakken|baked into the build/.test(read("README.md") + read(".env.example") + read("ARCHITECTURE.md")), "no document claims NEXT_PUBLIC_* values are 'baked into the build' (server code also reads NEXT_PUBLIC_APP_URL at run time)");
  check(/per serverinstantie/.test(blocked.slice(blocked.indexOf("afkoelperiode"))), "BLOCKED.md says the hourly cap is per server instance");
}

async function main() {
  await section1_siteUrl();
  await section1c_cartGate();
  await section1b_sitemapRobots();
  await section2_nextConfig();
  await section3_rateLimit();
  await section4_logger();
  await section5_monitoring();
  await section5b_clientError();
  await sectionAdminList();
  await section6_health();
  section7_migrate();
  section8_vercelJson();
  await section9_serviceWorker();
  section10_envExample();
  section11_docs();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(finish());
}

void main();
