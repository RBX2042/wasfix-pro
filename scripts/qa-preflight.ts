/**
 * Tests for scripts/preflight.ts, run as the owner runs it: a separate process per
 * environment, reading a variables file, judged by its exit code and its JSON.
 *
 *   npx tsx scripts/qa-preflight.ts
 *   DATABASE_URL=postgresql://.../migrated_db npx tsx scripts/qa-preflight.ts    + the --live-checks database part
 *
 * A complete, well-formed production environment must come out READY with exit 0.
 * Each way of getting it wrong must come out NOT READY with exit 1 and name the variable.
 * (Every case below is a one-line change to the good environment, so a case that passes
 * proves that exactly that line is what the preflight objected to.)
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { spawn } from "node:child_process";
import { makeChecker } from "./lib/browser";
import { resolveKey } from "./lib/indexnow";

const { check, note, finish } = makeChecker("qa-preflight");

function iban(bank: string, account: string): string {
  const rearranged = `${bank}${account}NL00`;
  let digits = "";
  for (const ch of rearranged) digits += /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
  let r = 0;
  for (const d of digits) r = (r * 10 + Number(d)) % 97;
  return `NL${String(98 - r).padStart(2, "0")}${bank}${account}`;
}
const b64 = (host: string) => Buffer.from(`${host}$`).toString("base64").replace(/=+$/, "");

const GOOD: Record<string, string> = {
  NEXT_PUBLIC_APP_URL: "https://shop.example.nl",
  DATABASE_URL: "postgresql://postgres.abcdefgh:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1",
  DIRECT_URL: "postgresql://postgres.abcdefgh:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: `pk_live_${b64("clerk.shop.example.nl")}`,
  // Built at run time on purpose: a literal sk_live_ plus 24 characters is exactly the shape of a real
  // Stripe/Clerk secret key, and GitHub push protection refuses a push that contains one (even this fake).
  CLERK_SECRET_KEY: ["sk", "live", "a".repeat(24)].join("_"),
  CLERK_WEBHOOK_SECRET: "whsec_aaaaaaaaaaaaaaaa",
  ADMIN_EMAILS: "owner@shop.example.nl",
  STRIPE_SECRET_KEY: ["sk", "live", "b".repeat(24)].join("_"),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_bbbbbbbbbbbbbbbb",
  STRIPE_WEBHOOK_SECRET: "whsec_bbbbbbbbbbbbbbbb",
  STRIPE_PRICE_PARTICULIER: "price_1",
  STRIPE_PRICE_MONTEUR: "price_2",
  STRIPE_PRICE_BEDRIJF: "price_3",
  RESEND_API_KEY: "re_cccccccccccccccc",
  RESEND_FROM_EMAIL: "Shop <noreply@shop.example.nl>",
  SLACK_WEBHOOK_URL: "https://hooks.slack.test/services/T/B/x",
  GEMINI_API_KEY: ["AIza", "SyD" + "D".repeat(32)].join(""),
  CRON_SECRET: "fedcba9876543210fedcba9876543210",
  UPSTASH_REDIS_REST_URL: "https://eu1-x.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "tok_xxxxxxxx",
  COMPANY_NAME: "Shop Example B.V.",
  COMPANY_STREET: "Voorbeeldstraat 12",
  COMPANY_POSTAL_CODE: "1017 AB",
  COMPANY_CITY: "Amsterdam",
  COMPANY_KVK: "12345679",
  COMPANY_VAT: "NL001234567B01",
  COMPANY_IBAN: iban("RABO", "0123456789"),
  COMPANY_EMAIL: "info@shop.example.nl",
  // D24: unset verification tokens are warnings (zoekmachines group), so a READY environment sets both.
  GOOGLE_SITE_VERIFICATION: "gsv-TOKEN-0123456789abcdef",
  BING_SITE_VERIFICATION: "0123456789ABCDEF0123456789ABCDEF",
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wasfix-preflight-"));
let seq = 0;

type Run = { code: number; report: { verdict: string; blockers: number; warnings: number; checks: Array<{ group: string; level: string; message: string; fix?: string }> } | null; text: string };

function runCli(env: Record<string, string | undefined>, extra: string[] = [], json = true): Promise<Run> {
  const file = path.join(dir, `env-${++seq}.env`);
  fs.writeFileSync(file, Object.entries(env).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}="${v}"`).join("\n"));
  return new Promise((resolve) => {
    const child = spawn("npx", ["--no-install", "tsx", "--conditions=react-server", "scripts/preflight.ts", "--env-file", file, ...(json ? ["--json"] : []), ...extra], { cwd: process.cwd(), env: { PATH: process.env.PATH, HOME: process.env.HOME } as unknown as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"] as const });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => {
      let report: Run["report"] = null;
      try {
        report = JSON.parse(out);
      } catch {
        // crash: leave null
      }
      resolve({ code: code ?? -1, report, text: out + err });
    });
  });
}

const without = (...names: string[]) => Object.fromEntries(Object.entries(GOOD).filter(([k]) => !names.includes(k)));
const blocksOf = (r: Run) => (r.report?.checks ?? []).filter((c) => c.level === "block");
const warnsOf = (r: Run) => (r.report?.checks ?? []).filter((c) => c.level === "warn");

// The IndexNow key file this repository ships (public/<key>.txt): the preflight finds it the same way seo-submit does.
const repoKeyRes = resolveKey(undefined, path.join(process.cwd(), "public"));
const repoKey = repoKeyRes.ok ? repoKeyRes.key : null;

type Case = { name: string; env: Record<string, string | undefined>; args?: string[]; expect: "block" | "warn" | "clean"; mention?: RegExp };
const CASES: Case[] = [
  { name: "good environment", env: GOOD, expect: "clean" },
  { name: "NEXT_PUBLIC_APP_URL missing", env: without("NEXT_PUBLIC_APP_URL"), expect: "block", mention: /NEXT_PUBLIC_APP_URL/ },
  { name: "NEXT_PUBLIC_APP_URL = localhost", env: { ...GOOD, NEXT_PUBLIC_APP_URL: "http://localhost:3000" }, expect: "block", mention: /localhost/ },
  { name: "NEXT_PUBLIC_APP_URL over http", env: { ...GOOD, NEXT_PUBLIC_APP_URL: "http://shop.example.nl" }, expect: "block", mention: /https/ },
  { name: "NEXT_PUBLIC_APP_URL with a path", env: { ...GOOD, NEXT_PUBLIC_APP_URL: "https://shop.example.nl/nl" }, expect: "block", mention: /pad/ },
  { name: "NEXT_PUBLIC_APP_URL is *.vercel.app (warning only)", env: { ...GOOD, NEXT_PUBLIC_APP_URL: "https://shop-abc.vercel.app" }, expect: "warn", mention: /vercel\.app/ },
  { name: "DATABASE_URL still the template", env: { ...GOOD, DATABASE_URL: "postgresql://postgres:[YOUR-PASSWORD]@db.abc.supabase.co:5432/postgres" }, expect: "block", mention: /DATABASE_URL/ },
  { name: "DATABASE_URL pooler without pgbouncer=true", env: { ...GOOD, DATABASE_URL: "postgresql://u:p@aws-0-eu-central-1.pooler.supabase.com:6543/postgres" }, expect: "warn", mention: /pgbouncer/ },
  { name: "DATABASE_URL = Supabase direct host", env: { ...GOOD, DATABASE_URL: "postgresql://postgres:pw@db.abcdefgh.supabase.co:5432/postgres" }, expect: "warn", mention: /IPv6|directe/ },
  { name: "COMPANY_IBAN is the CI test IBAN (production refuses test numbers)", env: { ...GOOD, COMPANY_IBAN: "NL02ABNA0123456789" }, expect: "block", mention: /COMPANY_IBAN/ },
  { name: "COMPANY_KVK is the test number", env: { ...GOOD, COMPANY_KVK: "90000001" }, expect: "block", mention: /COMPANY_KVK/ },
  { name: "COMPANY_KVK test number is only a warning on staging", env: { ...GOOD, COMPANY_KVK: "90000001" }, args: ["--target", "staging"], expect: "warn", mention: /COMPANY_KVK/ },
  { name: "COMPANY_VAT malformed", env: { ...GOOD, COMPANY_VAT: "NL123" }, expect: "block", mention: /COMPANY_VAT/ },
  { name: "COMPANY_EMAIL missing", env: without("COMPANY_EMAIL"), expect: "block", mention: /COMPANY_EMAIL/ },
  { name: "COMPANY_EMAIL is not an address (decision D15: part of readiness)", env: { ...GOOD, COMPANY_EMAIL: "geen-adres" }, expect: "block", mention: /COMPANY_EMAIL is geen geldig/ },
  { name: "COMPANY_IBAN has a bad checksum", env: { ...GOOD, COMPANY_IBAN: "NL44RABO0123456788" }, expect: "block", mention: /COMPANY_IBAN/ },
  { name: "Clerk keys missing", env: without("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY"), expect: "block", mention: /Clerk/ },
  { name: "Clerk test keys in production", env: { ...GOOD, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: `pk_test_${b64("casual-lion-1.clerk.accounts.dev")}`, CLERK_SECRET_KEY: "sk_test_aaaaaaaaaaaaaaaaaaaa" }, expect: "block", mention: /TESTinstantie/ },
  { name: "Clerk and Stripe test keys on staging are warnings, not blockers", env: { ...GOOD, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: `pk_test_${b64("casual-lion-1.clerk.accounts.dev")}`, CLERK_SECRET_KEY: "sk_test_aaaaaaaaaaaaaaaaaaaa", STRIPE_SECRET_KEY: "sk_test_bbbbbbbbbbbbbbbbbbbb", NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_bbbbbbbbbbbbbbbb" }, args: ["--target", "staging"], expect: "warn", mention: /TESTinstantie/ },
  { name: "Clerk live publishable + test secret", env: { ...GOOD, CLERK_SECRET_KEY: "sk_test_aaaaaaaaaaaaaaaaaaaa" }, expect: "block", mention: /dezelfde instantie/ },
  { name: "Stripe test key in production", env: { ...GOOD, STRIPE_SECRET_KEY: "sk_test_bbbbbbbbbbbbbbbbbbbb", NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_bbbbbbbbbbbbbbbb" }, expect: "block", mention: /testsleutel/ },
  { name: "Stripe secret live / publishable test", env: { ...GOOD, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_bbbbbbbbbbbbbbbb" }, expect: "block", mention: /Stripe/ },
  { name: "STRIPE_WEBHOOK_SECRET missing", env: without("STRIPE_WEBHOOK_SECRET"), expect: "block", mention: /STRIPE_WEBHOOK_SECRET/ },
  { name: "a price id is a product id", env: { ...GOOD, STRIPE_PRICE_MONTEUR: "prod_123" }, expect: "block", mention: /STRIPE_PRICE_MONTEUR/ },
  { name: "two plans share one price id", env: { ...GOOD, STRIPE_PRICE_BEDRIJF: "price_1" }, expect: "block", mention: /hetzelfde/ },
  { name: "no Stripe key at all (bank transfer only)", env: without("STRIPE_SECRET_KEY", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_PARTICULIER", "STRIPE_PRICE_MONTEUR", "STRIPE_PRICE_BEDRIJF"), expect: "warn", mention: /STRIPE_SECRET_KEY/ },
  { name: "no owner channel (RESEND key alone is not one, no address)", env: without("SLACK_WEBHOOK_URL", "COMPANY_EMAIL", "ORDER_NOTIFY_EMAIL"), expect: "block", mention: /meldingskanaal/ },
  { name: "ORDER_NOTIFY_EMAIL + Resend is a channel", env: { ...without("SLACK_WEBHOOK_URL"), ORDER_NOTIFY_EMAIL: "owner@shop.example.nl" }, expect: "clean" },
  { name: "RESEND_API_KEY missing", env: without("RESEND_API_KEY"), expect: "block", mention: /RESEND_API_KEY/ },
  { name: "CRON_SECRET missing", env: without("CRON_SECRET"), expect: "block", mention: /CRON_SECRET/ },
  { name: "only one Upstash variable", env: without("UPSTASH_REDIS_REST_TOKEN"), expect: "block", mention: /UPSTASH/ },
  { name: "no Upstash: degraded but allowed, consequence spelled out", env: without("UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"), expect: "warn", mention: /per serverinstantie/ },
  { name: "ADMIN_EMAILS missing (warning, make-admin is the alternative)", env: without("ADMIN_EMAILS"), expect: "warn", mention: /make-admin/ },
  { name: "ADMIN_EMAILS has a malformed address", env: { ...GOOD, ADMIN_EMAILS: "owner@shop.example.nl, not-an-email" }, expect: "block", mention: /ADMIN_EMAILS/ },
  // The app (src/lib/auth.ts parseAdminEmails) accepts comma, semicolon and whitespace; the preflight used to split on commas only and BLOCKed this.
  { name: "ADMIN_EMAILS separated by semicolon and space is accepted like the app accepts it", env: { ...GOOD, ADMIN_EMAILS: "owner@shop.example.nl; second@shop.example.nl third@shop.example.nl" }, expect: "clean" },
  { name: "ADMIN_EMAILS with a semicolon-separated malformed entry still blocks", env: { ...GOOD, ADMIN_EMAILS: "owner@shop.example.nl;not-an-email" }, expect: "block", mention: /ADMIN_EMAILS/ },
  { name: "DIRECT_URL missing behind the pooler (warning)", env: without("DIRECT_URL"), expect: "warn", mention: /DIRECT_URL/ },
  { name: "DEMO_MODE=true in production (warning)", env: { ...GOOD, DEMO_MODE: "true" }, expect: "warn", mention: /DEMO_MODE/ },
  { name: "referral programme switched on (warning)", env: { ...GOOD, NEXT_PUBLIC_FEATURE_REFERRAL: "true" }, expect: "warn", mention: /verwijsprogramma/ },
  { name: "no GEMINI key (warning)", env: without("GEMINI_API_KEY"), expect: "warn", mention: /GEMINI_API_KEY/ },
  // D24, group zoekmachines (offline half). Verification can also be done with a DNS TXT record, so "not set" is a warning, never a block.
  { name: "GOOGLE_SITE_VERIFICATION not set (warning: DNS TXT is the alternative)", env: without("GOOGLE_SITE_VERIFICATION"), expect: "warn", mention: /GOOGLE_SITE_VERIFICATION is niet ingesteld[\s\S]*DNS-TXT/ },
  { name: "BING_SITE_VERIFICATION not set (warning)", env: without("BING_SITE_VERIFICATION"), expect: "warn", mention: /BING_SITE_VERIFICATION is niet ingesteld[\s\S]*DNS-TXT/ },
  { name: "GOOGLE_SITE_VERIFICATION is not a valid token (the site would emit no tag)", env: { ...GOOD, GOOGLE_SITE_VERIFICATION: "x" }, expect: "warn", mention: /GOOGLE_SITE_VERIFICATION is ingesteld maar geen geldig token/ },
  { name: "BING_SITE_VERIFICATION is junk", env: { ...GOOD, BING_SITE_VERIFICATION: 'a"><script>' }, expect: "warn", mention: /BING_SITE_VERIFICATION is ingesteld maar geen geldig token/ },
  { name: "verification tokens unset on staging are information only", env: without("GOOGLE_SITE_VERIFICATION", "BING_SITE_VERIFICATION"), args: ["--target", "staging"], expect: "clean" },
  { name: "INDEXNOW_KEY has the wrong shape", env: { ...GOOD, INDEXNOW_KEY: "has a space" }, expect: "warn", mention: /INDEXNOW_KEY heeft niet het goede formaat/ },
  { name: "INDEXNOW_KEY is too short", env: { ...GOOD, INDEXNOW_KEY: "abc" }, expect: "warn", mention: /INDEXNOW_KEY heeft niet het goede formaat/ },
  { name: "INDEXNOW_KEY is valid but public/ holds no key file with it", env: { ...GOOD, INDEXNOW_KEY: "0123456789abcdef0123456789abcdef" }, expect: "warn", mention: /geen sleutelbestand met precies die sleutel/ },
  ...(repoKey ? [{ name: "INDEXNOW_KEY equal to the key file in public/ is fine", env: { ...GOOD, INDEXNOW_KEY: repoKey }, expect: "clean" as const }] : []),
];

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => { while (next < items.length) await fn(items[next++]); }));
}

async function liveDatabase() {
  const url = process.env.QA_PREFLIGHT_DB_URL ?? process.env.DATABASE_URL;
  if (!url) { note("SKIPPED live database part: set DATABASE_URL to a migrated database"); return; }
  note("--live-checks against the real database");
  const live = await runWith({ ...GOOD, DATABASE_URL: url }, ["--live-checks", "--only", "database,catalog"]);
  const msgs = (live.report?.checks ?? []).map((c) => `${c.level}:${c.message}`);
  check(msgs.some((m) => m.startsWith("ok:De database is bereikbaar")), "live: the database is reachable", msgs.join(" | "));
  check(msgs.some((m) => /^ok:Alle \d+ migraties zijn toegepast/.test(m)), "live: every migration folder is applied", msgs.join(" | "));
  check(msgs.some((m) => /beheerder|Beheerder/.test(m)), "live: admins are looked at (present, or reported missing)", msgs.join(" | "));
  check(msgs.some((m) => /kostprijs|offerte|Alle \d+ onderdelen|onderdelen hebben voorraad/.test(m)), "live: parts on ESTIMATE / stock 0 are counted", msgs.join(" | "));
  const unreachable = await runWith({ ...GOOD, DATABASE_URL: "postgresql://nobody:pw@127.0.0.1:1/none" }, ["--live-checks", "--only", "database"]);
  check(unreachable.code === 1 && blocksOf(unreachable).some((c) => /niet bereikbaar/.test(c.message)), "live: an unreachable database is a blocker", unreachable.text.slice(0, 300));
}
const runWith = runCli;

function stubSite(kind: "good" | "bad" | "stale") {
  const server = http.createServer((req, res) => {
    const origin = `http://${req.headers.host}`;
    const url = req.url ?? "/";
    const send = (status: number, body: string, headers: Record<string, string> = {}) => { res.writeHead(status, { "content-type": "text/html", ...headers }); res.end(body); };
    // "stale": healthy in every way, but the legal pages were prerendered by a build that had no COMPANY_* values.
    const good = kind !== "bad";
    const csp: Record<string, string> = good ? { "content-security-policy": "default-src 'self'; script-src 'self' https://clerk.shop.example.nl", "strict-transport-security": "max-age=1" } : {};
    if (url.startsWith("/api/v1/health")) return send(good ? 200 : 503, JSON.stringify(good ? { status: "ok", checks: { database: "ok", migrations: "ok" } } : { status: "unavailable", checks: { database: "ok", migrations: "pending" } }), { "content-type": "application/json" });
    if (url === "/inloggen") return send(200, good ? "<html>clerk.shop.example.nl</html>" : "<html>Demo modus</html>", csp);
    if (["/dashboard", "/admin", "/monteur/dashboard"].includes(url)) return good ? (res.writeHead(307, { location: "/inloggen" }), res.end()) : send(200, "admin");
    if (url === "/robots.txt") return send(200, `User-agent: *\nSitemap: ${good ? origin : "http://localhost:3000"}/sitemap.xml\n`);
    if (url === "/sitemap.xml") return send(200, `<urlset><url><loc>${good ? origin : "http://localhost:3000"}/</loc></url></urlset>`);
    if (url.startsWith("/onderdelen/")) return send(200, `<link rel="canonical" href="${good ? origin : "https://wasfix.nl"}${url}"/>`);
    if (url === "/api/stripe/webhook") return send(good ? 400 : 200, good ? "{}" : '{"demo":true}');
    if (url.startsWith("/api/cron/")) return send(good ? 401 : 503, "{}");
    if (url === "/voorwaarden") return send(200, kind === "good" ? "<h1>Algemene voorwaarden</h1><p>Shop Example B.V., Voorbeeldstraat 12, KvK <!-- -->12345679</p>" : "<p>WasFix Pro (in oprichting), KvK volgt na inschrijving</p>");
    if (url === "/contact") return send(200, kind === "good" ? '<a href="mailto:info@shop.example.nl">info@shop.example.nl</a><dd>12345679</dd>' : "<p>Contact: (e-mailadres volgt na inschrijving)</p>");
    if (url === "/checkout") return send(200, good ? '<p>NL44RABO0123456789</p><input placeholder="1234 AB"><input placeholder="06 12345678"><input placeholder="NL123456789B01">' : "<p>NL123456789B01</p>");
    return send(200, "<html>home</html>", csp);
  });
  return new Promise<{ origin: string; close: () => void }>((resolve) => server.listen(0, "127.0.0.1", () => resolve({ origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() })));
}

// ── D24, group zoekmachines: the half that reads the deployed site ───────────────────────────────────────────────
type SeoStub = {
  robots?: "good" | "404" | "nositemap" | "foreign" | "disallowall";
  sitemap?: "good" | "404" | "html" | "empty" | "foreign" | "private" | "noindex-family" | "index";
  header?: "ok" | "noindex";
  meta?: "ok" | "noindex";
  canonical?: "ok" | "wrong" | "missing";
  keyFile?: "ok" | "404" | "wrong" | "redirect" | "json";
  tags?: "ok" | "missing";
  /** The address the pages name (robots Sitemap line, sitemap URLs, canonical). Default: the stub's own address. */
  publicOrigin?: string;
};

/** A site as a search engine sees it. Every option defaults to the healthy answer, so a case breaks exactly one thing. */
function stubSeoSite(o: SeoStub, key: string | null) {
  const server = http.createServer((req, res) => {
    const self = `http://${req.headers.host}`;
    const site = o.publicOrigin ?? self;
    const url = (req.url ?? "/").split("?")[0];
    const send = (status: number, body: string, headers: Record<string, string> = {}) => { res.writeHead(status, { "content-type": "text/html", ...headers }); res.end(body); };
    if (url === "/robots.txt") {
      const kind = o.robots ?? "good";
      if (kind === "404") return send(404, "nope");
      const sitemapLine = kind === "nositemap" ? "" : `Sitemap: ${kind === "foreign" ? "https://wasfix.example" : site}/sitemap.xml\n`;
      const rules = kind === "disallowall" ? "User-agent: *\nDisallow: /\n\n" : "User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\n\nUser-agent: GPTBot\nUser-agent: CCBot\nDisallow: /\n\n";
      return send(200, rules + sitemapLine, { "content-type": "text/plain" });
    }
    const urlset = (locs: string[]) => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs.map((l) => `<url><loc>${l}</loc></url>`).join("")}</urlset>`;
    if (url === "/sitemap.xml") {
      switch (o.sitemap ?? "good") {
        case "404": return send(404, "nope");
        case "html": return send(200, "<html><body>Welkom</body></html>");
        case "empty": return send(200, urlset([]), { "content-type": "application/xml" });
        case "foreign": return send(200, urlset([`${site}/`, "https://wasfix.example/diagnose"]), { "content-type": "application/xml" });
        case "private": return send(200, urlset([`${site}/`, `${site}/admin`, `${site}/diagnose`]), { "content-type": "application/xml" });
        case "noindex-family": return send(200, urlset([`${site}/`, `${site}/qr/ABC123`, `${site}/robots.txt`, `${site}/diagnose`]), { "content-type": "application/xml" });
        case "index": return send(200, `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${site}/sitemap-a.xml</loc></sitemap><sitemap><loc>${site}/sitemap-b.xml</loc></sitemap></sitemapindex>`, { "content-type": "application/xml" });
        default: return send(200, urlset([`${site}/`, `${site}/diagnose`, `${site}/onderdelen/WF-PUMP-01`]), { "content-type": "application/xml" });
      }
    }
    if (url === "/sitemap-a.xml") return send(200, urlset([`${site}/`, `${site}/diagnose`]), { "content-type": "application/xml" });
    if (url === "/sitemap-b.xml") return send(200, urlset([`${site}/onderdelen/WF-PUMP-01`]), { "content-type": "application/xml" });
    if (key && url === `/${key}.txt`) {
      switch (o.keyFile ?? "ok") {
        case "404": return send(404, "nope");
        case "wrong": return send(200, "something else", { "content-type": "text/plain" });
        case "redirect": return send(301, "", { location: "/elsewhere.txt" });
        case "json": return send(200, key, { "content-type": "application/json" });
        default: return send(200, key, { "content-type": "text/plain; charset=utf-8" });
      }
    }
    if (url === "/") {
      const head = [
        `<meta name="robots" content="${o.meta === "noindex" ? "noindex, nofollow" : "index, follow"}"/>`,
        o.canonical === "missing" ? "" : `<link rel="canonical" href="${o.canonical === "wrong" ? "https://wasfix.example" : site}/"/>`,
        o.tags === "missing" ? "" : `<meta name="google-site-verification" content="${GOOD.GOOGLE_SITE_VERIFICATION}"/><meta name="msvalidate.01" content="${GOOD.BING_SITE_VERIFICATION}"/>`,
      ].join("");
      return send(200, `<!doctype html><html><head><title>WasFix</title>${head}</head><body>home</body></html>`, o.header === "noindex" ? { "x-robots-tag": "noindex, nofollow" } : {});
    }
    return send(404, "nope");
  });
  return new Promise<{ origin: string; close: () => void }>((resolve) => server.listen(0, "127.0.0.1", () => resolve({ origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() })));
}

type SeoCase = { name: string; stub: SeoStub; args?: string[]; publicIsStub?: boolean; blocks?: RegExp; warns?: RegExp; warnCount?: number; infos?: RegExp; clean?: boolean };
const SEO_CASES: SeoCase[] = [
  { name: "a healthy site", stub: {}, clean: true },
  { name: "a sitemap index with two child sitemaps", stub: { sitemap: "index" }, clean: true },
  { name: "the deployment answers on another address than the public one (read from --url, judged against NEXT_PUBLIC_APP_URL)", stub: { publicOrigin: "https://shop.example.nl" }, publicIsStub: false, clean: true },
  { name: "robots.txt is a 404", stub: { robots: "404" }, blocks: /robots\.txt antwoordt HTTP 404/ },
  { name: "robots.txt names no sitemap", stub: { robots: "nositemap" }, blocks: /robots\.txt noemt geen Sitemap/ },
  { name: "robots.txt names a sitemap on another address", stub: { robots: "foreign" }, blocks: /robots\.txt wijst met Sitemap naar https:\/\/wasfix\.example\/sitemap\.xml/ },
  { name: "robots.txt shuts everybody out (User-agent: * Disallow: /)", stub: { robots: "disallowall" }, blocks: /sluit de hele site uit/ },
  { name: "sitemap.xml is a 404", stub: { sitemap: "404" }, blocks: /sitemap\.xml:.*404/ },
  { name: "sitemap.xml is an HTML page", stub: { sitemap: "html" }, blocks: /sitemap\.xml:.*geen sitemap/ },
  { name: "sitemap.xml is valid but empty", stub: { sitemap: "empty" }, blocks: /geldig maar bevat geen URL/ },
  { name: "sitemap.xml names a URL on another address", stub: { sitemap: "foreign" }, blocks: /1 van de 2 URL's in sitemap\.xml staan niet op/ },
  { name: "sitemap.xml lists a private path (warning)", stub: { sitemap: "private" }, warns: /1 URL's in sitemap\.xml horen niet bij zoekmachines[\s\S]*admin/ },
  { name: "sitemap.xml lists a /qr/ page (noindex family) and a technical file (warning)", stub: { sitemap: "noindex-family" }, warns: /2 URL's in sitemap\.xml horen niet bij zoekmachines[\s\S]*\/qr\/ABC123/ },
  { name: "the home page sends X-Robots-Tag: noindex", stub: { header: "noindex" }, blocks: /X-Robots-Tag: noindex/ },
  { name: "the home page has a noindex meta tag", stub: { meta: "noindex" }, blocks: /robots-meta-tag met noindex/ },
  { name: "the home page names another canonical", stub: { canonical: "wrong" }, blocks: /canonical van de startpagina is https:\/\/wasfix\.example\// },
  { name: "the home page names no canonical (warning)", stub: { canonical: "missing" }, warns: /noemt geen canonical/ },
  { name: "the IndexNow key file is a 404 (warning)", stub: { keyFile: "404" }, warns: /IndexNow:.*404/ },
  { name: "the IndexNow key file holds something else (warning)", stub: { keyFile: "wrong" }, warns: /bevat niet de sleutel/ },
  { name: "the IndexNow key file is behind a redirect (warning)", stub: { keyFile: "redirect" }, warns: /verwijst door/ },
  { name: "the IndexNow key file is served as JSON (still ok, noted)", stub: { keyFile: "json" }, clean: true },
  { name: "verification tokens are configured but the page lacks the tags (one warning per tag)", stub: { tags: "missing" }, warnCount: 2, warns: /GOOGLE_SITE_VERIFICATION is ingesteld maar de startpagina bevat de tag google-site-verification niet/ },
  { name: "staging: noindex everywhere and Disallow: / are what is wanted (information, no blocker)", stub: { robots: "disallowall", header: "noindex", meta: "noindex" }, args: ["--target", "staging"], infos: /juist voor een preview of staging/ },
];

async function searchEngineProbes() {
  note("D24 group zoekmachines, offline half: an environment is judged without touching the network");
  const offline = await runCli(GOOD, ["--only", "zoekmachines"]);
  const offlineChecks = offline.report?.checks ?? [];
  check(offlineChecks.length > 0 && offlineChecks.every((c) => c.group === "zoekmachines"), "--only zoekmachines selects exactly this group", JSON.stringify(offlineChecks.map((c) => c.group)));
  check(offlineChecks.some((c) => c.level === "skip" && /--url/.test(c.message) && /robots\.txt/.test(c.message)) && !offlineChecks.some((c) => c.level === "ok" && /200|sitemap\.xml|robots\.txt|canonical/.test(c.message)), "offline: the live-site checks are reported as skipped (use --url), never as passed", offlineChecks.map((c) => `${c.level}:${c.message}`).join(" | "));
  check(offlineChecks.some((c) => c.level === "ok" && /GOOGLE_SITE_VERIFICATION is ingesteld/.test(c.message)) && offlineChecks.some((c) => c.level === "ok" && /BING_SITE_VERIFICATION is ingesteld/.test(c.message)), "offline: configured verification tokens are reported as set");
  check(!repoKey || offlineChecks.some((c) => c.level === "ok" && /IndexNow-sleutel aanwezig \(32 tekens, uit public\/\)/.test(c.message)), "offline: the key file this repository ships is found in public/ (by length, the key is not printed)", offlineChecks.map((c) => c.message).join(" | "));
  const unset = await runCli(without("GOOGLE_SITE_VERIFICATION", "BING_SITE_VERIFICATION"), ["--only", "zoekmachines"]);
  check(unset.code === 0 && unset.report?.verdict === "READY WITH WARNINGS" && warnsOf(unset).length === 2 && blocksOf(unset).length === 0, "both tokens unset: two warnings, no blocker, exit 0 (verification by DNS is allowed)", JSON.stringify(unset.report?.checks.map((c) => `${c.level}:${c.message.slice(0, 50)}`)));

  note("D24 group zoekmachines, --url: a stub site per case (one thing wrong at a time)");
  const cases = repoKey ? SEO_CASES : SEO_CASES.filter((c) => !/key file/.test(c.name));
  const runs = new Map<string, Run>();
  await pool(cases, 4, async (c) => {
    const site = await stubSeoSite(c.stub, repoKey);
    try {
      const env = { ...GOOD, NEXT_PUBLIC_APP_URL: c.publicIsStub === false ? "https://shop.example.nl" : site.origin };
      runs.set(c.name, await runCli(env, ["--url", site.origin, "--only", "zoekmachines", ...(c.args ?? [])]));
    } finally {
      site.close();
    }
  });
  for (const c of cases) {
    const r = runs.get(c.name)!;
    const zm = (r.report?.checks ?? []).filter((x) => x.group === "zoekmachines");
    const blocks = zm.filter((x) => x.level === "block");
    const warns = zm.filter((x) => x.level === "warn");
    const infos = zm.filter((x) => x.level === "info");
    const dump = zm.map((x) => `${x.level}:${x.message}`).join(" | ") || r.text.slice(0, 300);
    if (!r.report) { check(false, c.name, `${c.name}: preflight crashed: ${r.text.slice(0, 300)}`); continue; }
    if (c.clean) {
      const oks = zm.filter((x) => x.level === "ok").map((x) => x.message);
      check(r.code === 0 && blocks.length === 0 && warns.length === 0 && oks.some((m) => /^robots\.txt antwoordt 200/.test(m)) && oks.some((m) => /^sitemap\.xml: 200, geldig, 3 URL's/.test(m)) && oks.some((m) => /geen noindex in de X-Robots-Tag-header/.test(m)) && oks.some((m) => /geen robots-meta-tag met noindex/.test(m)) && oks.some((m) => /canonical van de startpagina is/.test(m)) && oks.some((m) => /verificatietag google-site-verification/.test(m)) && oks.some((m) => /verificatietag msvalidate\.01/.test(m)) && (!repoKey || oks.some((m) => /IndexNow-sleutelbestand .*<sleutel>\.txt\) antwoordt 200 en bevat de sleutel/.test(m))), `${c.name}: every search-engine check passes (exit 0)`, `${c.name}: exit ${r.code}: ${dump}`);
    }
    if (c.blocks) check(r.code === 1 && blocks.length === 1 && c.blocks.test(blocks[0].message) && (blocks[0].fix ?? "").length > 20, `${c.name}: exactly one blocker, naming the problem and its fix (exit 1)`, `${c.name}: exit ${r.code}: ${dump}`);
    if (c.warns) check(r.code === 0 && blocks.length === 0 && warns.length === (c.warnCount ?? 1) && c.warns.test(`${warns[0].message}`) && warns.every((w) => (w.fix ?? "").length > 20), `${c.name}: ${c.warnCount ?? 1} warning(s) with a fix, no blocker (exit 0)`, `${c.name}: exit ${r.code}: ${dump}`);
    if (c.infos) check(r.code === 0 && blocks.length === 0 && warns.length === 0 && infos.some((x) => c.infos!.test(x.message)), `${c.name}: no blocker, no warning, explained as information (exit 0)`, `${c.name}: exit ${r.code}: ${dump}`);
  }
  const forbidden = [...runs.values()].filter((r) => repoKey && r.text.includes(repoKey));
  check(forbidden.length === 0, "no report prints the key (only its length)", `${forbidden.length} reports contain the key`);
}

async function main() {
  note("environments (one variable at a time)");
  const results = new Map<string, Run>();
  await pool(CASES, 4, async (c) => { results.set(c.name, await runCli(c.env, c.args)); });
  for (const c of CASES) {
    const r = results.get(c.name)!;
    if (!r.report) { check(false, c.name, `${c.name}: preflight crashed: ${r.text.slice(0, 400)}`); continue; }
    const blocks = blocksOf(r);
    const warns = warnsOf(r);
    if (c.expect === "clean") check(r.code === 0 && blocks.length === 0 && warns.length === 0 && r.report.verdict === "READY", `${c.name}: READY, exit 0, no warnings`, `${c.name}: verdict ${r.report.verdict}, exit ${r.code}, blocks=${blocks.map((b) => b.message).join(" | ")} warns=${warns.map((b) => b.message).join(" | ")}`);
    if (c.expect === "warn") check(r.code === 0 && blocks.length === 0 && r.report.verdict === "READY WITH WARNINGS" && warns.some((w) => c.mention!.test(`${w.message} ${w.fix}`)), `${c.name}: READY WITH WARNINGS, exit 0`, `${c.name}: verdict ${r.report.verdict}, exit ${r.code}, blocks=${blocks.map((b) => b.message).join(" | ")}, warns=${warns.map((b) => b.message).join(" | ")}`);
    if (c.expect === "block") check(r.code === 1 && r.report.verdict === "NOT READY" && blocks.some((b) => c.mention!.test(`${b.message} ${b.fix}`)) && blocks.every((b) => (b.fix ?? "").length > 10), `${c.name}: NOT READY, exit 1, names the problem and its fix`, `${c.name}: verdict ${r.report.verdict}, exit ${r.code}, blocks=${blocks.map((b) => b.message).join(" | ")}`);
  }

  note("--strict turns warnings into a failing exit code");
  const strict = await runCli(without("UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"), ["--strict"]);
  check(strict.code === 1 && strict.report?.verdict === "READY WITH WARNINGS", "READY WITH WARNINGS + --strict exits 1", `exit ${strict.code} verdict ${strict.report?.verdict}`);
  note("D9: the text report is Dutch, and a passing company line never sits next to a company BLOCK");
  const textGood = await runCli(GOOD, ["--only", "company"], false);
  check(/UITSLAG: KLAAR \(0 blokkerend, 0 waarschuwing\(en\)\)/.test(textGood.text) && !/RESULT:|NOTE:|NEXT STEP:/.test(textGood.text) && /\[company\]\n  ok    ?Bedrijfsgegevens .* zijn compleet, geldig en geen testnummers/.test(textGood.text), "text report: Dutch labels (UITSLAG), no RESULT/NOTE/NEXT STEP, and the company line is ok for a real identity", textGood.text.slice(0, 600));
  const textBad = await runCli({ ...GOOD, COMPANY_KVK: "90000001", COMPANY_IBAN: "NL02ABNA0123456789" }, ["--only", "company"], false);
  check(/UITSLAG: NIET KLAAR/.test(textBad.text) && /VOLGENDE STAP: \[company\]/.test(textBad.text) && !/zijn compleet, geldig/.test(textBad.text) && /BLOCK COMPANY_KVK is een testnummer/.test(textBad.text), "text report: test numbers give BLOCK lines and NO 'compleet en geldig' ok line for the same fields (before: both)", textBad.text.slice(0, 700));
  const jsonBad = await runCli({ ...GOOD, COMPANY_KVK: "90000001" }, ["--only", "company"]);
  check(!(jsonBad.report?.checks ?? []).some((c) => c.group === "company" && c.level === "ok"), "json report: no 'ok' check in the company group when the same group blocks", JSON.stringify(jsonBad.report?.checks));
  const noMail = await runCli(without("COMPANY_EMAIL"), ["--only", "company"]);
  check((noMail.report?.checks ?? []).some((c) => c.group === "company" && c.level === "block" && /COMPANY_EMAIL ontbreekt/.test(c.message) && /deploy opnieuw/.test(c.fix ?? "")), "COMPANY_EMAIL missing is a readiness PROBLEM (blocker with a fix), not a warning", JSON.stringify(noMail.report?.checks));
  const noMailStaging = await runCli(without("COMPANY_EMAIL"), ["--only", "company", "--target", "staging"]);
  check(noMailStaging.code === 1, "COMPANY_EMAIL missing blocks on staging too (checkout is closed without it everywhere)", `exit ${noMailStaging.code}`);

  note("a run without a variables file takes NOTHING from this shell's app variables when --env-file is given");
  const empty = await runCli({});
  check(empty.code === 1 && blocksOf(empty).length >= 8, "an empty environment is NOT READY with many blockers", `exit ${empty.code}, blockers ${blocksOf(empty).length}`);
  check((empty.report?.checks ?? []).filter((c) => c.level === "skip").length >= 4 && (empty.report?.checks ?? []).every((c) => c.level !== "ok" || !/bereikbaar/.test(c.message)), "offline: network checks are reported as skipped, never as passed");

  note("--url: the deployed site, probed over HTTP (stub servers)");
  for (const kind of ["good", "bad", "stale"] as const) {
    const site = await stubSite(kind);
    try {
      const r = await runCli({ ...GOOD, NEXT_PUBLIC_APP_URL: site.origin }, ["--url", site.origin, "--only", "live"]);
      const liveBlocks = blocksOf(r).map((c) => c.message);
      if (kind === "good") {
        check(r.code === 0 && liveBlocks.length === 0, "a correctly deployed site passes every deployed-site check", liveBlocks.join(" | ") || r.text.slice(0, 300));
        check((r.report?.checks ?? []).some((c) => c.level === "ok" && /live \/voorwaarden toont de ingestelde bedrijfsgegevens/.test(c.message)) && (r.report?.checks ?? []).some((c) => c.level === "ok" && /live \/contact toont de ingestelde/.test(c.message)), "live: /voorwaarden and /contact are compared with COMPANY_* and match", (r.report?.checks ?? []).map((c) => c.message).join(" | "));
        // The scheduled path itself is probed (vercel.json calls /api/cron/daily; a deploy without it would run no job at all), next to one single-job route.
        check((r.report?.checks ?? []).some((c) => c.level === "ok" && /^\/api\/cron\/daily weigert aanroepen zonder geheim \(401\)/.test(c.message)) && (r.report?.checks ?? []).some((c) => c.level === "ok" && /^\/api\/cron\/orders weigert aanroepen zonder geheim \(401\)/.test(c.message)), "live: the scheduled route /api/cron/daily AND /api/cron/orders are probed and answer 401 without the secret", (r.report?.checks ?? []).filter((c) => /cron/.test(c.message)).map((c) => `${c.level}:${c.message}`).join(" | "));
      } else if (kind === "stale") {
        // R2-19: a build without COMPANY_* started later with them. Every other check passes; only the comparison objects.
        check(liveBlocks.some((m) => /voorbeeldgegevens/.test(m)) && liveBlocks.filter((m) => /COMPANY_\*/.test(m)).length === 2 && liveBlocks.length === 3 && liveBlocks.some((m) => /\/voorwaarden toont de bedrijfsnaam en het KvK-nummer/.test(m)) && liveBlocks.some((m) => /\/contact toont het KvK-nummer en het contactadres/.test(m)) && (blocksOf(r).find((c) => /voorwaarden/.test(c.message))?.fix ?? "").includes("bouw opnieuw"), "stale build: /voorwaarden and /contact that do not show the COMPANY_* values are blockers, and the fix says to rebuild", liveBlocks.join(" | ") || r.text.slice(0, 300));
        check(r.code === 1, "stale build: exit code 1");
      } else {
        for (const [what, re] of [["health 503", /health/], ["demo login", /Demo modus/], ["unprotected /admin", /\/admin/], ["localhost robots", /robots\.txt/], ["localhost sitemap", /sitemap\.xml/], ["demo webhook", /webhook/], ["cron without secret", /CRON_SECRET/], ["placeholder IBAN on /checkout", /voorbeeldgegevens/], ["no enforced CSP", /Content-Security-Policy/]] as const) {
          check(liveBlocks.some((m) => re.test(m)), `bad site: ${what} is a blocker`, `bad site: ${what} not reported. blocks: ${liveBlocks.join(" | ")}`);
        }
        check(liveBlocks.filter((m) => /^\/api\/cron\/(daily|orders) antwoordt 503 cron_not_configured/.test(m)).length === 2, "bad site: the 503 without CRON_SECRET is reported for the scheduled route /api/cron/daily and for /api/cron/orders, each by name", `bad site cron blocks: ${liveBlocks.filter((m) => /cron/.test(m)).join(" | ")}`);
        check(r.code === 1, "bad site: exit code 1");
      }
    } finally {
      site.close();
    }
  }

  await searchEngineProbes();
  await liveDatabase();
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(finish());
}

void main();
