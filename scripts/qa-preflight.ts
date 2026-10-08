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
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wasfix-preflight-"));
let seq = 0;

type Run = { code: number; report: { verdict: string; blockers: number; warnings: number; checks: Array<{ group: string; level: string; message: string; fix?: string }> } | null; text: string };

function runCli(env: Record<string, string | undefined>, extra: string[] = []): Promise<Run> {
  const file = path.join(dir, `env-${++seq}.env`);
  fs.writeFileSync(file, Object.entries(env).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}="${v}"`).join("\n"));
  return new Promise((resolve) => {
    const child = spawn("npx", ["--no-install", "tsx", "--conditions=react-server", "scripts/preflight.ts", "--env-file", file, "--json", ...extra], { cwd: process.cwd(), env: { PATH: process.env.PATH, HOME: process.env.HOME } as unknown as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"] as const });
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

function stubSite(kind: "good" | "bad") {
  const server = http.createServer((req, res) => {
    const origin = `http://${req.headers.host}`;
    const url = req.url ?? "/";
    const send = (status: number, body: string, headers: Record<string, string> = {}) => { res.writeHead(status, { "content-type": "text/html", ...headers }); res.end(body); };
    const good = kind === "good";
    const csp: Record<string, string> = good ? { "content-security-policy": "default-src 'self'; script-src 'self' https://clerk.shop.example.nl", "strict-transport-security": "max-age=1" } : {};
    if (url.startsWith("/api/v1/health")) return send(good ? 200 : 503, JSON.stringify(good ? { status: "ok", checks: { database: "ok", migrations: "ok" } } : { status: "unavailable", checks: { database: "ok", migrations: "pending" } }), { "content-type": "application/json" });
    if (url === "/inloggen") return send(200, good ? "<html>clerk.shop.example.nl</html>" : "<html>Demo modus</html>", csp);
    if (["/dashboard", "/admin", "/monteur/dashboard"].includes(url)) return good ? (res.writeHead(307, { location: "/inloggen" }), res.end()) : send(200, "admin");
    if (url === "/robots.txt") return send(200, `User-agent: *\nSitemap: ${good ? origin : "http://localhost:3000"}/sitemap.xml\n`);
    if (url === "/sitemap.xml") return send(200, `<urlset><url><loc>${good ? origin : "http://localhost:3000"}/</loc></url></urlset>`);
    if (url.startsWith("/onderdelen/")) return send(200, `<link rel="canonical" href="${good ? origin : "https://wasfix.nl"}${url}"/>`);
    if (url === "/api/stripe/webhook") return send(good ? 400 : 200, good ? "{}" : '{"demo":true}');
    if (url.startsWith("/api/cron/")) return send(good ? 401 : 503, "{}");
    if (url === "/checkout") return send(200, good ? '<p>NL44RABO0123456789</p><input placeholder="1234 AB"><input placeholder="06 12345678"><input placeholder="NL123456789B01">' : "<p>NL123456789B01</p>");
    return send(200, "<html>home</html>", csp);
  });
  return new Promise<{ origin: string; close: () => void }>((resolve) => server.listen(0, "127.0.0.1", () => resolve({ origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() })));
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
  note("a run without a variables file takes NOTHING from this shell's app variables when --env-file is given");
  const empty = await runCli({});
  check(empty.code === 1 && blocksOf(empty).length >= 8, "an empty environment is NOT READY with many blockers", `exit ${empty.code}, blockers ${blocksOf(empty).length}`);
  check((empty.report?.checks ?? []).filter((c) => c.level === "skip").length >= 4 && (empty.report?.checks ?? []).every((c) => c.level !== "ok" || !/bereikbaar/.test(c.message)), "offline: network checks are reported as skipped, never as passed");

  note("--url: the deployed site, probed over HTTP (stub servers)");
  for (const kind of ["good", "bad"] as const) {
    const site = await stubSite(kind);
    try {
      const r = await runCli({ ...GOOD, NEXT_PUBLIC_APP_URL: site.origin }, ["--url", site.origin, "--only", "live"]);
      const liveBlocks = blocksOf(r).map((c) => c.message);
      if (kind === "good") check(r.code === 0 && liveBlocks.length === 0, "a correctly deployed site passes every deployed-site check", liveBlocks.join(" | ") || r.text.slice(0, 300));
      else {
        for (const [what, re] of [["health 503", /health/], ["demo login", /Demo modus/], ["unprotected /admin", /\/admin/], ["localhost robots", /robots\.txt/], ["localhost sitemap", /sitemap\.xml/], ["demo webhook", /webhook/], ["cron without secret", /CRON_SECRET/], ["placeholder IBAN on /checkout", /voorbeeldgegevens/], ["no enforced CSP", /Content-Security-Policy/]] as const) {
          check(liveBlocks.some((m) => re.test(m)), `bad site: ${what} is a blocker`, `bad site: ${what} not reported. blocks: ${liveBlocks.join(" | ")}`);
        }
        check(r.code === 1, "bad site: exit code 1");
      }
    } finally {
      site.close();
    }
  }

  await liveDatabase();
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(finish());
}

void main();
