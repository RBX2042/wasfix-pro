/**
 * Tests for the IndexNow tooling (decision D24): scripts/lib/indexnow.ts, scripts/seo-submit.ts, the key file in
 * public/, .github/workflows/seo-submit.yml and the documents that describe them. No database, no real network.
 *
 *   npx tsx scripts/qa-indexnow.ts
 *   QA_BASE_URL=http://localhost:3000 npx tsx scripts/qa-indexnow.ts      + the key file and the real sitemap of a running PRODUCTION server
 *   QA_REQUIRE_SERVER=1 ...                                              fail instead of skipping the server half
 *
 * Nothing here is sent to a search engine: the "engine" is a fake IndexNow server on 127.0.0.1 that records every
 * request, and the "site" is a fake server that serves sitemap.xml, the key file and robots.txt. What the suites prove is
 * that the tool builds the right payload, refuses what it must refuse, retries and reports honestly, and never prints the
 * key. They do not prove that any engine accepts it: that has never been tried.
 *
 * What is covered: the cases listed in the report of the change and in the checks below (the repair of this suite added the
 * ones a reviewer found uncovered: the POST that must not follow a redirect, the size and count limits, the timeouts, the
 * noindex families, the closing dot of a host name, a hostile sitemap; the integration added an empty query string, a
 * sitemap whose <url> is never closed, the length boundary, the reserved names, a '#' in the endpoint, the single noindex
 * files). The evidence that a case can fail is the mutation list in those reports, not this comment. This suite does NOT
 * claim that every rule D24 names has a case: a rule with no case is a defect of the suite, found by mutating the rule.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { makeChecker } from "./lib/browser";
import * as nx from "./lib/indexnow";
import { run, type Env, type RunOptions } from "./seo-submit";
import { CITY_PAGES_INDEXABLE, SITEMAP_STATIC_PATHS } from "../src/lib/seo";

const { check, note, finish } = makeChecker("qa-indexnow");
const ROOT = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wasfix-indexnow-"));
const KEY = crypto.randomBytes(16).toString("hex");
const KEY2 = crypto.randomBytes(16).toString("hex");
const ORIGIN = nx.parseOrigin("https://shop.example.nl");
if (!ORIGIN.ok) throw new Error("fixture origin");
const O = ORIGIN.value;
/** Everything every in-process run printed: the key must not be in any of it. */
const printed: string[] = [];

// ── fake servers ──────────────────────────────────────────────────────────────

type Route = { status: number; body?: string; type?: string; location?: string };
function listen(server: http.Server): Promise<string> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
}
const shut = (server: http.Server) => { server.closeAllConnections?.(); server.close(); };

/** The fake site: serves what the test put there, records every request line. */
async function startSite() {
  const routes = new Map<string, Route>();
  const hits: string[] = [];
  const server = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    const r = routes.get((req.url ?? "/").split("?")[0]);
    if (!r) { res.writeHead(404, { "content-type": "text/plain" }); res.end("niet gevonden"); return; }
    res.writeHead(r.status, { "content-type": r.type ?? "text/plain; charset=utf-8", ...(r.location ? { location: r.location } : {}) });
    res.end(r.body ?? "");
  });
  const origin = await listen(server);
  return {
    origin,
    hits,
    put(p: string, route: Route) { routes.set(p, route); },
    reset() { routes.clear(); hits.length = 0; },
    close() { shut(server); },
  };
}

type Post = { method: string; url: string; contentType: string; userAgent: string; raw: string; body: Record<string, unknown> | null; at: number };
/** The fake engine: records every POST, answers from a queue (then 200). */
async function startEngine() {
  const posts: Post[] = [];
  let queue: Array<{ status: number; headers?: Record<string, string>; body?: string }> = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      let body: Record<string, unknown> | null = null;
      try { body = JSON.parse(raw); } catch { /* recorded as null */ }
      posts.push({ method: req.method ?? "", url: req.url ?? "", contentType: String(req.headers["content-type"] ?? ""), userAgent: String(req.headers["user-agent"] ?? ""), raw, body, at: Date.now() });
      const next = queue.shift() ?? { status: 200 };
      res.writeHead(next.status, { "content-type": "application/json", ...(next.headers ?? {}) });
      res.end(next.body ?? "");
    });
  });
  const base = await listen(server);
  return {
    endpoint: `${base}/indexnow`,
    posts,
    reset() { posts.length = 0; queue = []; },
    queue(...answers: typeof queue) { queue.push(...answers); },
    close() { shut(server); },
  };
}

const sitemapXml = (urls: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${u.replace(/&/g, "&amp;")}</loc></url>`).join("\n")}\n</urlset>\n`;
const indexXml = (urls: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<sitemap><loc>${u}</loc></sitemap>`).join("\n")}\n</sitemapindex>\n`;
const pathsFor = (n: number) => Array.from({ length: n }, (_, i) => (i === 0 ? "/" : `/onderdelen/WF-${String(i).padStart(5, "0")}`));

// ── running the command in-process ────────────────────────────────────────────

const keyDir = fs.mkdtempSync(path.join(tmp, "public-"));
fs.writeFileSync(path.join(keyDir, `${KEY}.txt`), KEY);
fs.writeFileSync(path.join(keyDir, "robots-notes.txt"), "not a key file");
const emptyDir = fs.mkdtempSync(path.join(tmp, "empty-"));

type Result = { code: number; out: string; err: string; all: string; waits: number[] };
async function cli(argv: string[], env: Env, opts: RunOptions = {}): Promise<Result> {
  const out: string[] = [];
  const err: string[] = [];
  const waits: number[] = [];
  const code = await run(argv, env, { out: (l) => out.push(l), err: (l) => err.push(l) }, { publicDir: keyDir, sleep: async (ms) => { waits.push(ms); }, ...opts });
  const r = { code, out: out.join("\n"), err: err.join("\n"), all: [...out, ...err].join("\n"), waits };
  printed.push(r.all);
  return r;
}

async function main() {
  const site = await startSite();
  const engine = await startEngine();
  const base: Env = { QA_INDEXNOW_ALLOW_LOCAL: "1", QA_INDEXNOW_BACKOFF_MS: "5", INDEXNOW_ENDPOINT: engine.endpoint };
  const good = (paths: string[] = pathsFor(14)) => {
    site.reset();
    engine.reset();
    site.put("/sitemap.xml", { status: 200, type: "application/xml", body: sitemapXml(paths.map((p) => `${site.origin}${p}`)) });
    site.put(`/${KEY}.txt`, { status: 200, body: KEY });
  };
  const dry = (extra: string[] = [], env: Env = {}, opts: RunOptions = {}) => cli(["--origin", site.origin, ...extra], { ...base, ...env }, opts);
  const live = (extra: string[] = [], env: Env = {}, opts: RunOptions = {}) => cli(["--origin", site.origin, "--live", ...extra], { ...base, ...env }, opts);
  const urlLines = (text: string, title: string): string[] => {
    const ls = text.split("\n");
    const at = ls.findIndex((l) => l.startsWith(title));
    if (at < 0) return [];
    const got: string[] = [];
    for (let i = at + 1; i < ls.length && /^ {2}https?:\/\//.test(ls[i]); i++) got.push(ls[i].trim());
    return got;
  };

  // ═══ 1. the pure functions ═════════════════════════════════════════════════
  note("key: 8 to 128 characters, a-z A-Z 0-9 and dash");
  check(nx.isValidKey("abcdefgh") && nx.isValidKey("a".repeat(128)) && nx.isValidKey("Ab-12-Cd-34") && nx.isValidKey(KEY), "valid keys: 8 and 128 characters, mixed case, dashes, 32 hex");
  check(!nx.isValidKey("abcdefg") && !nx.isValidKey("a".repeat(129)) && !nx.isValidKey("abcd_efgh") && !nx.isValidKey("abcd efgh") && !nx.isValidKey("abcdefgh\n") && !nx.isValidKey("abcdéfgh") && !nx.isValidKey("") && !nx.isValidKey(undefined) && !nx.isValidKey(12345678), "invalid keys: 7 and 129 characters, underscore, space, trailing newline, non-ASCII, empty, not a string");
  check(nx.keyFileUrl(O, KEY) === `https://shop.example.nl/${KEY}.txt`, "key file address: https://<host>/<key>.txt at the root");
  check((() => { try { nx.keyFileUrl(O, "short"); return false; } catch { return true; } })(), "key file address of an invalid key throws");

  note("site address");
  check(nx.parseOrigin("https://wasfix.nl").ok && nx.parseOrigin("https://wasfix.nl/").ok && nx.parseOrigin(" https://wasfix.nl ").ok, "https://wasfix.nl, with a trailing slash or spaces, is an origin");
  check(["", undefined, "wasfix.nl", "ftp://wasfix.nl", "https://wasfix.nl/nl", "https://wasfix.nl?x=1", "https://wasfix.nl/#a", "https://u:p@wasfix.nl"].every((v) => !nx.parseOrigin(v).ok), "no host / no scheme / wrong scheme / path / query / fragment / credentials: refused");
  {
    const dot = nx.parseOrigin("https://wasfix.nl.");
    check(dot.ok && dot.value.origin === "https://wasfix.nl" && dot.value.hostname === "wasfix.nl" && nx.keyFileUrl(dot.value, KEY) === `https://wasfix.nl/${KEY}.txt`, "a host with its closing dot (https://wasfix.nl.) is read as the plain name: origin, host name and key file address have no dot", JSON.stringify(dot));
    check(!nx.parseOrigin("https://wasfix.nl..").ok && !nx.parseOrigin("https://.").ok, "two closing dots, or a lone dot, is no name: refused");
  }

  note("which addresses may go live");
  check(nx.liveOriginProblems(O).length === 0, "https://shop.example.nl... is a public https domain: no objection");
  const live1 = (u: string, allowLocal = false) => { const p = nx.parseOrigin(u); return p.ok ? nx.liveOriginProblems(p.value, { allowLocal }) : ["unparsable"]; };
  check(live1("https://wasfix.nl").length === 0 && live1("https://www.wasfix.nl").length === 0, "https://wasfix.nl and https://www.wasfix.nl: allowed");
  check(live1("http://wasfix.nl").some((p) => /niet https/.test(p)), "http:// is refused (not https)");
  check(live1("https://localhost").some((p) => /geen publiek domein/.test(p)) && live1("https://127.0.0.1").some((p) => /geen publiek domein/.test(p)) && live1("https://[::1]").some((p) => /geen publiek domein/.test(p)) && live1("https://10.1.2.3").some((p) => /geen publiek domein/.test(p)), "localhost, 127.0.0.1, ::1 and any IP address are refused");
  check(live1("https://intranet").length > 0 && live1("https://shop.test").length > 0 && live1("https://x.localhost").length > 0 && live1("https://shop.local").length > 0 && live1("https://www.example.com").length > 0, "a single-label host and the reserved names (.test, .localhost, .local, example.com) are refused");
  check(["https://shop.invalid", "https://shop.internal", "https://www.example.org", "https://www.example.net", "https://example.org"].every((v) => live1(v).some((p) => /geen publiek domein/.test(p))) && live1("https://shop.example.nl").length === 0, "the other reserved names (.invalid, .internal, example.org, example.net) are refused too, while shop.example.nl is a public name");
  check(live1("https://wasfix-pro-abc.vercel.app").some((p) => /vercel\.app/.test(p)) && live1("https://vercel.app").some((p) => /vercel\.app/.test(p)), "*.vercel.app is refused");
  check(live1("https://wasfix-pro-abc.vercel.app", true).some((p) => /vercel\.app/.test(p)), "...also with the test-only switch (it never lifts the vercel.app rule)");
  check(live1("https://wasfix.nl:8443").some((p) => /poort 8443/.test(p)), "an explicit port is refused");
  check(live1("http://127.0.0.1:3000", true).length === 0, "the test-only switch lifts the http, local-host and port rules");
  check(["https://localhost.", "https://foo.localhost.", "https://shop.local.", "https://intranet."].every((v) => live1(v).some((p) => /geen publiek domein/.test(p))), "a closing dot does not hide a local name (https://localhost., https://foo.localhost., https://shop.local.)", JSON.stringify(["https://localhost.", "https://foo.localhost."].map((v) => live1(v))));
  check(live1("https://wasfix-pro-abc.vercel.app.").some((p) => /vercel\.app/.test(p)) && live1("https://wasfix.nl.").length === 0, "...nor a vercel.app name (https://x.vercel.app.), while https://wasfix.nl. is the public domain wasfix.nl");
  // The same rules one level lower, without parseOrigin's normalisation: isLocalHost and liveOriginProblems strip the dot themselves.
  check(nx.isLocalHost("localhost.") && nx.isLocalHost("foo.localhost.") && nx.isLocalHost("LOCALHOST") && nx.isLocalHost("[::1]") && !nx.isLocalHost("wasfix.nl.") && !nx.isLocalHost("www.wasfix.nl"), "isLocalHost: a closing dot, upper case and an IPv6 literal in brackets are read right; a public name is not local");
  check(nx.liveOriginProblems({ origin: "https://x.vercel.app.", protocol: "https:", hostname: "x.vercel.app.", port: "" }).some((p) => /vercel\.app/.test(p)), "liveOriginProblems: the vercel.app rule also holds for a name that still carries its closing dot");

  note("the URL filter: only what a search engine should be told");
  const u = (p: string) => `${O.origin}${p}`;
  const f = nx.filterUrls(
    [
      u("/"), u("/onderdelen/WF-PUMP-01"), u("/foutcodes/Bosch-E18"), u("/onderdelen/WF-PUMP-01"), // a duplicate
      "https://other.example.nl/x", "https://www.shop.example.nl/x", "http://shop.example.nl/x", "https://shop.example.nl:8443/x", // other host / www / http / port
      u("/onderdelen?q=pomp"), u("/onderdelen#top"), // query and fragment
      u("/admin"), u("/admin/bestellingen"), u("/checkout"), u("/api/v1/parts"), u("/bestelling/abc"), u("/dashboard"), u("/monteur/werkorders"), u("/Admin"), u("/%61dmin"), u("//checkout"), // private
      u("/wasmachine-kapot/amsterdam"), // city (noindex)
      "not a url", "https://u:p@shop.example.nl/x", `${O.origin}/${"a".repeat(2100)}`, "mailto:a@b.nl",
      "", "   ",
    ],
    O,
  );
  const reasonOf = (url: string) => f.dropped.find((d) => d.url === url)?.reason;
  check(f.kept.length === (CITY_PAGES_INDEXABLE ? 4 : 3) && f.kept.includes(u("/")) && f.kept.includes(u("/onderdelen/WF-PUMP-01")) && f.kept.includes(u("/foutcodes/Bosch-E18")), "kept: the home page, a part and an error code (the duplicate once); blank lines ignored", JSON.stringify(f.kept));
  check(reasonOf("https://other.example.nl/x") === "ander-adres" && reasonOf("https://www.shop.example.nl/x") === "ander-adres" && reasonOf("http://shop.example.nl/x") === "ander-adres" && reasonOf("https://shop.example.nl:8443/x") === "ander-adres", "host mismatch dropped: another domain, www vs apex, http vs https, another port");
  check(reasonOf(u("/onderdelen?q=pomp")) === "query" && reasonOf(u("/onderdelen#top")) === "fragment", "a query string and a fragment are dropped");
  check(["/admin", "/admin/bestellingen", "/checkout", "/api/v1/parts", "/bestelling/abc", "/dashboard", "/monteur/werkorders", "/Admin", "/%61dmin", "//checkout"].every((p) => reasonOf(u(p)) === "privepad"), "private paths are dropped (admin, checkout, api, order pages, dashboards, technician screens), also in another case, percent-escaped or with a double slash");
  check(CITY_PAGES_INDEXABLE ? f.kept.includes(u("/wasmachine-kapot/amsterdam")) : reasonOf(u("/wasmachine-kapot/amsterdam")) === "stadspagina", CITY_PAGES_INDEXABLE ? "city pages are indexable by decision now: kept" : "a city page (noindex by decision D23) is dropped");
  check(reasonOf("not a url") === "ongeldig" && reasonOf("https://u:p@shop.example.nl/x") === "ongeldig" && reasonOf("mailto:a@b.nl") === "ongeldig" && f.dropped.some((d) => d.reason === "te-lang") && f.dropped.filter((d) => d.reason === "dubbel").length === 1, "garbage, credentials, a non-web scheme, an over-long address and a duplicate are dropped with their own reasons");
  check(f.kept.every((k) => new URL(k).origin === O.origin) && f.kept.length + f.dropped.length === 25, "every kept URL is on the origin; kept + dropped = all non-blank input");
  check(nx.filterUrls(["https://Shop.Example.NL"], O).kept[0] === "https://shop.example.nl/", "the bare origin is normalised to https://shop.example.nl/");
  const statics = nx.filterUrls(SITEMAP_STATIC_PATHS.map((p) => u(p)), O);
  check(statics.dropped.length === 0 && statics.kept.length === SITEMAP_STATIC_PATHS.length, "the filter keeps every static page the sitemap publishes (SITEMAP_STATIC_PATHS): the two lists cannot drift apart unseen", JSON.stringify(statics.dropped));
  {
    // An empty fragment (`/a#`) leaves URL.hash empty, so the filter looks at the text as given as well.
    const g = nx.filterUrls([u("/a#"), u("/a#top"), u("/%E0%A4%A"), u("/qrcode-info"), u("/Qr-code")], O);
    const why = (url: string) => g.dropped.find((d) => d.url === url)?.reason;
    check(why(u("/a#")) === "fragment" && why(u("/a#top")) === "fragment", "an empty fragment (https://x/a#) is dropped like a filled one");
    check(why(u("/%E0%A4%A")) === "ongeldig", "a path with a malformed percent escape is dropped as invalid, not a crash");
    check(g.kept.includes(u("/qrcode-info")) && g.kept.includes(u("/Qr-code")) && g.kept.length === 2, "a path that only starts with the letters of a noindex family (/qrcode-info) is kept: the family is /qr and what is under it", JSON.stringify(g));
  }
  {
    // `new URL("https://x/a?").search` is "": a bare "?" is an address with a query string all the same (the sibling of the empty fragment).
    const q = nx.filterUrls([u("/a?"), u("/?"), u("/a?#top"), u("/a#x?y"), u("/a")], O);
    const why = (url: string) => q.dropped.find((d) => d.url === url)?.reason;
    check(why(u("/a?")) === "query" && why(u("/?")) === "query" && why(u("/a?#top")) === "query", "an empty query string (https://x/a?, https://x/?) is dropped like a filled one", JSON.stringify(q.dropped));
    check(why(u("/a#x?y")) === "fragment" && q.kept.length === 1 && q.kept[0] === u("/a"), "a '?' that sits after the '#' belongs to the fragment: dropped as a fragment, and the clean address is kept", JSON.stringify(q));
    // The length limit is exact: 2048 characters pass, 2049 do not.
    const pad = (n: number) => u(`/${"a".repeat(n - O.origin.length - 1)}`);
    const len = nx.filterUrls([pad(nx.MAX_URL_LENGTH), pad(nx.MAX_URL_LENGTH + 1)], O);
    check(pad(nx.MAX_URL_LENGTH).length === nx.MAX_URL_LENGTH && len.kept.length === 1 && len.kept[0].length === nx.MAX_URL_LENGTH && len.dropped.length === 1 && len.dropped[0].reason === "te-lang", "an address of exactly 2048 characters is kept, one of 2049 is dropped as too long", JSON.stringify(len.counts));
  }
  {
    // The families next.config.ts sends a noindex X-Robots-Tag for without a condition (variantHeaderRules): /qr/*.
    const prefixes = nx.noindexFamilyPrefixes();
    check(prefixes.includes("/qr") && prefixes.every((p) => /^\/[^/:*]+(\/[^/:*]+)*$/.test(p)), "the noindex families are read from the header rules of src/lib/seo.ts: /qr is one", JSON.stringify(prefixes));
    check(
      JSON.stringify(nx.noindexFamilyPrefixes([
        { source: "/foo/:path*", robots: "noindex, follow" },
        { source: "/bar/:path*", robots: "index, follow" },
        { source: "/baz/:path*", has: [{ type: "query", key: "q", value: ".+" }], robots: "noindex" },
        { source: "/retour/start", robots: "noindex, nofollow" },
        { source: "/:path*", robots: "noindex" },
      ])) === JSON.stringify(["/foo"]),
      "only an unconditional noindex rule on a /prefix/:path* source is a family (not an index rule, not a rule with a query condition, not a single page, not the whole site)",
    );
    const fam = nx.filterUrls([u("/qr/ABC123"), u("/qr/ABC123/extra"), u("/qr"), u("/qr/"), u("/QR/abc"), u("/Qr/abc/")], O);
    check(fam.kept.length === 0 && fam.dropped.length === 6 && fam.dropped.every((d) => d.reason === "noindex"), "/qr/<code>, deeper paths, /qr itself and other letter cases are dropped as noindex-familie", JSON.stringify(fam));
    check(prefixes.includes("/leadmagnets"), "the static documents of public/ that next.config.ts marks noindex (the lead-magnet cheat sheet) are a family too", JSON.stringify(prefixes));
    const exact = nx.noindexExactPaths();
    check(exact.includes("/offline.html") && exact.every((p) => /^\/[^:*()]*$/.test(p) && p === p.toLowerCase()), "the single noindex files are read from the header rules too: /offline.html is one", JSON.stringify(exact));
    check(
      JSON.stringify(nx.noindexExactPaths([
        { source: "/Foo.html", robots: "noindex" },
        { source: "/bar.html", robots: "index, follow" },
        { source: "/baz", has: [{ type: "query", key: "q", value: ".+" }], robots: "noindex" },
        { source: "/qr/:path*", robots: "noindex, follow" },
        { source: "/(.*)", robots: "noindex, nofollow" },
      ])) === JSON.stringify(["/foo.html"]),
      "only an unconditional noindex rule on a plain path is a single noindex file (not an index rule, not a rule with a query condition, not a family, not a pattern)",
    );
    const lead = nx.filterUrls([u("/leadmagnets/foutcodes-cheatsheet.html"), u("/Leadmagnets/x.pdf"), u("/offline.html"), u("/OFFLINE.HTML")], O);
    check(lead.kept.length === 0 && lead.dropped.length === 4 && lead.dropped.every((d) => d.reason === "noindex"), "the lead-magnet files and the offline page are dropped as noindex, in any letter case", JSON.stringify(lead));
    const every = nx.noindexFamilyPrefixes().flatMap((p) => [u(p), u(`${p}/x`), u(`${p}/x/y`)]).concat(nx.noindexExactPaths().map((p) => u(p)));
    check(every.length >= 3 && nx.filterUrls(every, O).kept.length === 0, "every unconditional noindex family of the header rules is dropped by the filter, whatever it is called (the two lists cannot drift apart)");
    const files = nx.filterUrls([u(`/${KEY}.txt`), u("/robots.txt"), u("/sitemap.xml"), u("/sitemap-2.xml"), u("/ROBOTS.TXT"), u("/llms.txt")], O);
    check(files.kept.length === 0 && files.dropped.every((d) => d.reason === "bestand"), "technical files (the key file itself, robots.txt, a sitemap, any .txt or .xml at the root) are dropped as 'bestand'", JSON.stringify(files));
    check(nx.filterUrls([u("/onderdelen/WF-1.txt"), u("/handleiding.pdf"), u("/data.json")], O).kept.length === 3, "a .txt deeper than the root, or another file type, is not caught by that rule");
    check(Object.keys(nx.DROP_LABEL).sort().join() === ["ander-adres", "bestand", "dubbel", "fragment", "noindex", "ongeldig", "privepad", "query", "stadspagina", "te-lang"].sort().join() && nx.DROP_LABEL.noindex.length > 20 && nx.DROP_LABEL.bestand.length > 20, "every drop reason has a Dutch label");
  }

  note("batches: at most 10000 per request");
  const mk = (n: number) => Array.from({ length: n }, (_, i) => `${O.origin}/p/${i}`);
  const sizes = (n: number) => nx.splitBatches(mk(n)).map((b) => b.length);
  check(JSON.stringify(sizes(0)) === "[]" && JSON.stringify(sizes(1)) === "[1]" && JSON.stringify(sizes(9999)) === "[9999]", "0, 1 and 9999 URLs: no batch, one, one");
  check(JSON.stringify(sizes(10000)) === "[10000]", "exactly 10000 URLs: ONE batch");
  check(JSON.stringify(sizes(10001)) === "[10000,1]", "10001 URLs: TWO batches (10000 and 1)");
  check(JSON.stringify(sizes(20000)) === "[10000,10000]" && JSON.stringify(sizes(20001)) === "[10000,10000,1]", "20000 and 20001 URLs: 2 and 3 batches");
  check([0, 10001, 1.5, -1].every((n) => { try { nx.splitBatches([1], n); return false; } catch { return true; } }) && nx.splitBatches([1, 2, 3], 2).length === 2, "a batch size of 0, over 10000 or not an integer throws; a smaller one is honoured");
  check(nx.splitBatches(mk(25)).flat().join() === mk(25).join(), "batching keeps order and loses nothing");

  note("payload: {host, key, keyLocation, urlList}");
  const pl = nx.buildPayload(O, KEY, [u("/"), u("/diagnose")]);
  check(JSON.stringify(Object.keys(pl)) === JSON.stringify(["host", "key", "keyLocation", "urlList"]) && pl.host === "shop.example.nl" && pl.key === KEY && pl.keyLocation === `https://shop.example.nl/${KEY}.txt` && pl.urlList.length === 2, "the payload has exactly host, key, keyLocation, urlList; keyLocation is the root key file", JSON.stringify(pl));
  const throws = (fn: () => unknown) => { try { fn(); return false; } catch { return true; } };
  check(throws(() => nx.buildPayload(O, KEY, ["https://other.example.nl/x"])), "a URL on another host never goes into a payload (throws)");
  check(throws(() => nx.buildPayload(O, KEY, mk(10001))) && !throws(() => nx.buildPayload(O, KEY, mk(10000))), "10001 URLs in one payload throw; 10000 do not");
  check(throws(() => nx.buildPayload(O, "short", [u("/")])) && throws(() => nx.buildPayload(O, KEY, [])), "an invalid key, or no URL, throws");
  check(throws(() => nx.buildPayload(O, KEY, [u("/")], `https://other.example.nl/${KEY}.txt`)) && throws(() => nx.buildPayload(O, KEY, [u("/")], `https://shop.example.nl/${KEY2}.txt`)), "a keyLocation on another host, or not named after the key, throws");
  const bb = nx.buildBatches(O, KEY, mk(10001));
  check(bb.length === 2 && bb[0].urlList.length === 10000 && bb[1].urlList.length === 1 && bb.every((b) => b.host === "shop.example.nl" && b.urlList.every((x) => new URL(x).hostname === b.host)), "buildBatches(10001): two payloads, every URL on the one host");

  note("status codes, in Dutch");
  const st = nx.interpretStatus;
  check(st(200).ok && st(200).kind === "accepted" && /ontvangen/.test(st(200).message) && /geen garantie/.test(st(200).message), "200: accepted = received, 'geen garantie'");
  check(st(202).ok && st(202).kind === "pending" && /sleutel/.test(st(202).message) && /loopt nog/.test(st(202).message), "202: accepted, key validation pending");
  check(!st(400).ok && !st(400).retry && /formaat/.test(st(400).message), "400: invalid format, not retried");
  check(!st(403).ok && !st(403).retry && /sleutel/.test(st(403).message) && /sleutelbestand/.test(st(403).message), "403: key invalid / not found, not retried");
  check(!st(422).ok && !st(422).retry && /host/.test(st(422).message) && /sleutel/.test(st(422).message), "422: URLs not on the host or key mismatch, not retried");
  check(!st(429).ok && st(429).retry && /Te veel aanvragen/.test(st(429).message), "429: too many requests, retried");
  check(!st(500).ok && st(500).retry && !st(404).ok && !st(404).retry && !st(301).ok && !st(301).retry && /doorverwijzing/.test(st(301).message), "5xx retried; 404 and a redirect are failures that are not retried or followed");
  check([100, 204, 201, 299].every((s) => !st(s).ok), "only 200 and 202 count as success");

  note("endpoint override");
  const ep = nx.resolveEndpoint;
  check(ep(undefined).ok && (ep(undefined) as { endpoint: string }).endpoint === "https://api.indexnow.org/indexnow" && ep("  ").ok, "unset: https://api.indexnow.org/indexnow");
  check(nx.INDEXNOW_ENGINE_ENDPOINTS.length === 5 && nx.INDEXNOW_ENGINE_ENDPOINTS.every((e) => ep(e).ok), "the five documented engine endpoints are allowed");
  check(ep("http://127.0.0.1:4567/indexnow").ok && ep("http://localhost:4567/anything").ok && ep("http://127.0.0.1/x").ok, "http://127.0.0.1 and http://localhost (tests) are allowed, any port and path");
  check(["https://evil.example/indexnow", "http://api.indexnow.org/indexnow", "https://api.indexnow.org/other", "https://api.indexnow.org.evil.com/indexnow", "https://api.indexnow.org@evil.com/indexnow", "https://u:p@api.indexnow.org/indexnow", "https://www.bing.com/indexnow?x=1", "https://www.bing.com/indexnow#x", "https://127.0.0.1/indexnow", "http://127.0.0.1.evil.com/indexnow", "http://10.0.0.5/indexnow", "http://[::1]/indexnow", "not a url", "ftp://127.0.0.1/"].every((e) => !ep(e).ok), "everything else is refused: another host, http for an engine, another path, look-alike hosts, credentials, a query, https on loopback, a private IP");

  note("backoff");
  const bo = nx.backoffDelayMs;
  check(bo(0, null, 2000) === 2000 && bo(1, null, 2000) === 4000 && bo(2, null, 2000) === 8000, "without a header: 2 s, 4 s, 8 s (doubling)");
  check(bo(10, null, 2000, 60000) === 60000, "bounded by the cap");
  check(bo(0, "30", 2000) === 30000 && bo(0, "1", 2000) === 2000 && bo(0, "9999", 2000, 60000) === 60000, "Retry-After in seconds is honoured, never shorter than the doubling, never above the cap");
  check(bo(0, new Date(1_000_000 + 12_000).toUTCString(), 2000, 60000, 1_000_000) >= 11_000 && bo(0, "garbage", 2000) === 2000 && bo(0, "", 2000) === 2000, "Retry-After as a date works; garbage and an empty header are ignored");

  note("posting a batch (injected fetch and clock)");
  const res = (status: number, headers: Record<string, string> = {}, body = "") => async () => new Response(body, { status, headers });
  const seq = (...fns: Array<() => Promise<Response>>) => { let i = 0; let calls = 0; return { fetchImpl: (async () => { calls++; return fns[Math.min(i++, fns.length - 1)](); }) as unknown as typeof fetch, calls: () => calls }; };
  const payload = nx.buildPayload(O, KEY, [u("/")]);
  {
    const waits: number[] = [];
    const s = seq(res(429), res(429), res(200));
    const r = await nx.postBatch("http://127.0.0.1:1/indexnow", payload, { fetchImpl: s.fetchImpl, sleep: async (ms) => { waits.push(ms); } });
    check(r.ok && r.attempts === 3 && s.calls() === 3 && JSON.stringify(waits) === "[2000,4000]", "429, 429, then 200: succeeds on the third try after waiting 2 s and 4 s", JSON.stringify({ ...r, waits }));
  }
  {
    const waits: number[] = [];
    const s = seq(res(429, { "retry-after": "7" }));
    const r = await nx.postBatch("http://127.0.0.1:1/indexnow", payload, { fetchImpl: s.fetchImpl, sleep: async (ms) => { waits.push(ms); } });
    check(!r.ok && r.attempts === nx.MAX_RETRIES + 1 && s.calls() === 4 && r.status === 429 && waits.length === 3 && waits[0] === 7000, "429 forever: gives up after 1 + 3 tries (bounded), reports 429, waited at least the Retry-After", JSON.stringify({ ...r, waits }));
  }
  {
    const s = seq(res(422, {}, "x".repeat(5000)));
    const waits: number[] = [];
    const r = await nx.postBatch("http://127.0.0.1:1/indexnow", payload, { fetchImpl: s.fetchImpl, sleep: async (ms) => { waits.push(ms); } });
    check(!r.ok && r.attempts === 1 && waits.length === 0 && r.status === 422 && r.body.length <= 300 && r.body.length > 100, "422: one try, no wait, and the body of the answer is cut to 300 characters", JSON.stringify({ ...r, body: r.body.length }));
  }
  {
    const s = seq(async () => { throw new Error("connect ECONNREFUSED"); }, res(500), res(202));
    const r = await nx.postBatch("http://127.0.0.1:1/indexnow", payload, { fetchImpl: s.fetchImpl, sleep: async () => undefined });
    check(r.ok && r.attempts === 3 && r.status === 202, "no answer, then 500, then 202: retried and accepted", JSON.stringify(r));
    const s2 = seq(async () => { throw new Error("connect ECONNREFUSED"); });
    const r2 = await nx.postBatch("http://127.0.0.1:1/indexnow", payload, { fetchImpl: s2.fetchImpl, sleep: async () => undefined });
    check(!r2.ok && r2.status === null && r2.error === "connect ECONNREFUSED" && r2.attempts === 4, "never an answer: reported as such after 4 tries", JSON.stringify(r2));
    const s3 = seq(res(301, { location: "https://elsewhere.example/" }));
    const r3 = await nx.postBatch("http://127.0.0.1:1/indexnow", payload, { fetchImpl: s3.fetchImpl, sleep: async () => undefined });
    check(!r3.ok && r3.attempts === 1 && s3.calls() === 1, "a redirect answer is a failure, not followed, not retried");
  }

  note("requests: no redirect is followed, nothing can hang, nothing is read without a limit");
  {
    const seen: RequestInit[] = [];
    const rec = (async (_url: string, init?: RequestInit) => { seen.push(init ?? {}); return new Response("", { status: 200 }); }) as unknown as typeof fetch;
    await nx.postBatch("http://127.0.0.1:1/indexnow", payload, { fetchImpl: rec, sleep: async () => undefined });
    check(seen.length === 1 && seen[0].method === "POST" && seen[0].redirect === "manual" && seen[0].signal instanceof AbortSignal, "the POST is made with redirect:'manual' (the key and the list go nowhere else) and with an abort signal (a timeout)", JSON.stringify({ method: seen[0]?.method, redirect: seen[0]?.redirect }));
    await nx.httpGet("http://127.0.0.1:1/x", { fetchImpl: rec });
    check(seen.length === 2 && seen[1].method === "GET" && seen[1].redirect === "manual" && seen[1].signal instanceof AbortSignal, "...and so is every GET of the site (a redirect is reported, not hidden; a timeout applies)");
  }
  {
    // Servers that misbehave. A watchdog turns a hang into a failed check instead of a stuck suite.
    const within = async <T>(p: Promise<T>, ms: number): Promise<T | "watchdog"> => {
      let timer: NodeJS.Timeout | undefined;
      const dog = new Promise<"watchdog">((r) => { timer = setTimeout(() => r("watchdog"), ms); });
      try { return await Promise.race([p, dog]); } finally { clearTimeout(timer); }
    };
    const hang = http.createServer(() => { /* never answers */ });
    const trickle = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      const t = setInterval(() => res.write("x"), 25);
      res.on("close", () => clearInterval(t));
    });
    const hangBase = await listen(hang);
    const trickleBase = await listen(trickle);
    const t0 = Date.now();
    const p1 = await within(nx.postBatch(`${hangBase}/indexnow`, payload, { timeoutMs: 250, maxRetries: 0 }), 4000);
    check(p1 !== "watchdog" && !p1.ok && p1.status === null && !!p1.error && Date.now() - t0 < 3500, "a POST to an engine that never answers is cut off by its timeout and reported as 'no answer'", JSON.stringify(p1));
    const g1 = await within(nx.httpGet(`${hangBase}/x`, { timeoutMs: 250 }).then(() => "answered", (e: Error) => e.name), 4000);
    check(g1 !== "watchdog" && g1 !== "answered", "a GET to a site that never answers is cut off by its timeout: an error, not a hang", String(g1));
    const g2 = await within(nx.httpGet(`${trickleBase}/x`, { timeoutMs: 300 }).then(() => "answered", (e: Error) => e.name), 4000);
    check(g2 !== "watchdog" && g2 !== "answered", "...and so is a site that trickles its answer a byte at a time (the timeout covers the whole body)", String(g2));
    shut(hang);
    shut(trickle);
    site.reset();
    site.put("/big", { status: 200, body: "y".repeat(5000) });
    const tooBig = await nx.httpGet(`${site.origin}/big`, { maxBytes: 4999 }).then(() => "answered", (e: Error) => e.message);
    const exact = await nx.httpGet(`${site.origin}/big`, { maxBytes: 5000 });
    check(/groter dan 4999 bytes/.test(tooBig) && exact.status === 200 && exact.text.length === 5000, "an answer one byte over the limit is refused, one of exactly the limit is read whole", tooBig);
    check(nx.MAX_RESPONSE_BYTES === 60 * 1024 * 1024, "the default limit for an answer of the site is 60 MB");
  }

  note("sitemap files");
  const ps = nx.parseSitemapXml;
  const a = ps(sitemapXml([u("/a"), u("/b?x=1&y=2")]));
  check(a.ok && a.kind === "urlset" && a.locs.length === 2 && a.locs[1] === u("/b?x=1&y=2"), "a <urlset> gives its <loc> values, with &amp; decoded");
  const idx = ps(indexXml([u("/s1.xml"), u("/s2.xml")]));
  check(idx.ok && idx.kind === "index" && idx.locs.length === 2, "a <sitemapindex> gives its child sitemaps");
  check(ps(`<?xml version="1.0"?><urlset><url><loc><![CDATA[${u("/c")}]]></loc></url></urlset>`).ok, "CDATA is read");
  check(nx.decodeXmlText("a&amp;lt;b&#47;&#x2F;") === "a&lt;b//", "entities are decoded once (&amp;lt; stays &lt;), numeric references too");
  check(!ps("<html><body>Hoi</body></html>").ok && !ps("").ok && !ps("<urlset><url><loc>x</loc></url>").ok, "HTML, an empty file and a cut-off file are not sitemaps");
  const em = ps(`<urlset></urlset>`);
  check(em.ok && em.locs.length === 0, "an empty <urlset> is valid and holds no URL");
  const nl = ps(`<urlset><url><lastmod>x</lastmod></url><url><loc>${u("/z")}</loc></url></urlset>`);
  check(nl.ok && nl.locs.length === 1 && nl.entriesWithoutLoc === 1, "an entry without <loc> is counted, not read");
  {
    // A <url> that is never closed used to end the scan (or swallow the next entry) and return ok with FEWER URLs and no note.
    const cases: Array<[string, string]> = [
      ["the last <url> never closed", `<urlset><url><loc>${u("/1")}</loc></url><url><loc>${u("/2")}</loc></urlset>`],
      ["an unclosed <url> in the middle swallows the next entry", `<urlset><url><loc>${u("/1")}</loc></url><url><loc>${u("/2")}<url><loc>${u("/3")}</loc></url><url><loc>${u("/4")}</loc></url></urlset>`],
      ["the only <url> never closed", `<urlset><url><loc>${u("/1")}</loc></urlset>`],
      ["an opening <url with no '>'", `<urlset><url><loc>${u("/1")}</loc></url><url </urlset>`],
      ["an index with an unclosed <sitemap>", `<sitemapindex><sitemap><loc>${u("/s1.xml")}</loc></sitemapindex>`],
    ];
    const bad = cases.filter(([, xml]) => { const r = ps(xml); return r.ok || !/niet goed gevormd/.test(r.reason); }).map(([name]) => name);
    check(bad.length === 0, "a sitemap with a <url> (or <sitemap>) that is never closed is refused with 'niet goed gevormd', not returned as a shorter list", `accepted: ${bad.join("; ")}`);
    const fine = ps(`<urlset><url><loc>${u("/1")}</loc></url><url/><url ><loc>${u("/2")}</loc></url></urlset>`);
    check(fine.ok && fine.locs.length === 2 && fine.entriesWithoutLoc === 1, "well-formed entries (also a self-closing one) are not mistaken for malformed ones");
    // Through readSitemap: the reason reaches the caller and nothing is returned.
    const broken: nx.HttpGet = async () => ({ status: 200, location: null, contentType: "application/xml", xRobotsTag: null, text: `<urlset><url><loc>${u("/1")}</loc></url><url><loc>${u("/2")}</loc></urlset>` });
    const rs = await nx.readSitemap(O, broken);
    check(!rs.ok && /niet goed gevormd/.test(rs.reason), "readSitemap passes that refusal on: no list is returned for a malformed file", JSON.stringify(rs));
  }
  {
    const c = ps(`<urlset><!-- <url><loc>${u("/old")}</loc></url> --><url><loc>${u("/new")}</loc></url><!--<url><loc>${u("/old2")}</loc></url>--></urlset>`);
    check(c.ok && c.locs.length === 1 && c.locs[0] === u("/new"), "an entry inside an XML comment is not read as a live URL", JSON.stringify(c));
    check(nx.stripXmlComments("a<!--b-->c<![CDATA[<!--d-->]]>e<!--f") === "ac<![CDATA[<!--d-->]]>e<!--f" && nx.stripXmlComments("no comment") === "no comment" && nx.stripXmlComments("<!--x--><!--y-->z") === "z", "stripXmlComments: comments go; a comment-like text inside CDATA stays; a comment that is never closed is left alone", nx.stripXmlComments("a<!--b-->c<![CDATA[<!--d-->]]>e<!--f"));
    const cd = ps(`<urlset><url><loc><![CDATA[${u("/a")}<!--x-->]]></loc></url></urlset>`);
    check(cd.ok && cd.locs[0] === `${u("/a")}<!--x-->`, "a CDATA <loc> that holds comment-like text is read as written", JSON.stringify(cd));
    const sc = ps(`<urlset><url/><url ><loc>${u("/yes")}</loc></url><urlx><loc>${u("/no")}</loc></urlx></urlset>`);
    check(sc.ok && sc.locs.length === 1 && sc.locs[0] === u("/yes") && sc.entriesWithoutLoc === 1, "a self-closing <url/> is an entry without <loc> (it does not swallow the next one); <urlx> is not a <url>", JSON.stringify(sc));
  }
  {
    // A hostile or broken file must cost time in proportion to its size (the old lazy regular expression was quadratic).
    const timed = (xml: string) => { const t = Date.now(); const r = ps(xml); return { ok: r.ok, ms: Date.now() - t }; };
    const runs = [
      timed(`<urlset>${"<url>".repeat(60000)}</urlset>`), // 60000 opening tags, none closed
      timed(`<urlset>${"<url".repeat(60000)}</urlset>`), // 60000 openings that never end
      timed(`<urlset>${"<url><loc>".repeat(60000)}</urlset>`), // unclosed entries with unclosed <loc>
      timed(`<urlset><!--${"<!--".repeat(60000)}</urlset>`), // comment openers, never closed
      timed(`<urlset>${"<![CDATA[".repeat(60000)}<!--</urlset>`), // CDATA openers, never closed
    ];
    check(runs.every((r) => r.ms < 1000), "five hostile files of 60000 unclosed tags each are parsed in linear time (each under a second)", JSON.stringify(runs));
    // The two with real, unclosed <url> tags are refused as malformed; the others hold no element a reader would call a <url> ("<url<url<url" is
    // no tag name, the comment and CDATA openers are never closed) and parse to an empty list.
    check(JSON.stringify(runs.map((r) => r.ok)) === JSON.stringify([false, true, false, true, true]), "...the files with unclosed <url> tags are refused, the ones without a real <url> element parse to an empty list", JSON.stringify(runs));
  }
  {
    const many = Array.from({ length: 300000 }, (_, i) => `<url><loc>${O.origin}/p/${i}</loc></url>`).join("");
    const getMany: nx.HttpGet = async (url) => ({ status: 200, location: null, contentType: "application/xml", xRobotsTag: null, text: url.endsWith("/sitemap.xml") ? indexXml([`${O.origin}/s1.xml`]) : `<urlset>${many}</urlset>` });
    let outcome = "";
    try {
      const r = await nx.readSitemap(O, getMany);
      outcome = r.ok ? String(r.urls.length) : r.reason;
    } catch (e) {
      outcome = `threw: ${e instanceof Error ? e.message : String(e)}`;
    }
    check(outcome === "300000", "an index whose child holds 300000 URLs is read whole (no stack overflow from spreading them into push)", outcome);
  }

  note("robots.txt and the page head");
  const rb = "User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /*.json$\n\nUser-agent: GPTBot\nUser-agent: CCBot\nDisallow: /\n\nUser-agent: bingbot\nDisallow: /nur\n\nSitemap: https://x.example/sitemap.xml\n";
  check(nx.robotsAllows(rb, "Googlebot", "/") && nx.robotsAllows(rb, "Googlebot", "/abc.txt") && !nx.robotsAllows(rb, "Googlebot", "/admin") && !nx.robotsAllows(rb, "*", "/admin/x"), "robotsAllows: the * group applies to an agent without a group of its own");
  check(!nx.robotsAllows(rb, "GPTBot", "/") && !nx.robotsAllows(rb, "CCBot/2.0", "/x") && nx.robotsAllows(rb, "Googlebot", "/x"), "robotsAllows: a group shared by two agents applies to both and to nobody else");
  check(nx.robotsAllows(rb, "bingbot", "/admin") && !nx.robotsAllows(rb, "bingbot/2.0", "/nur") && !nx.robotsAllows(rb, "Googlebot", "/data.json") && nx.robotsAllows(rb, "Googlebot", "/data.jsonx"), "robotsAllows: a specific group replaces the * group; * and $ work");
  check(nx.robotsAllows("User-agent: *\nDisallow: /a\nAllow: /a/b\n", "x", "/a/b/c") && !nx.robotsAllows("User-agent: *\nDisallow: /a\nAllow: /a/b\n", "x", "/a/c") && nx.robotsAllows("User-agent: *\nDisallow:\n", "x", "/anything"), "robotsAllows: the longest match wins; an empty Disallow allows everything");
  check(nx.robotsBlocksEverything("User-agent: *\nDisallow: /\n") && !nx.robotsBlocksEverything(rb) && !nx.robotsBlocksEverything("User-agent: *\nDisallow: /admin\n") && nx.robotsBlocksEverything("User-agent: Foo\nUser-agent: *\nDisallow: /\n"), "robotsBlocksEverything: only User-agent * with Disallow: / counts, not the AI-crawler group");
  const hs = nx.headSignals(`<html><head><meta name="robots" content="Index, FOLLOW"><META NAME="googlebot" CONTENT='noindex'><link rel="canonical" href="https://x.example/"/><link rel='alternate' href='/nl'><meta name="google-site-verification" content="tok123"/></head></html>`);
  check(hs.noindex && hs.robots.join() === "index,follow,noindex" && hs.canonical.join() === "https://x.example/" && hs.meta["google-site-verification"] === "tok123", "headSignals: robots directives of robots/googlebot, the canonical, meta tags by name; attribute case, quotes and tag case do not matter");
  check(!nx.headSignals(`<meta name="robots" content="index, follow"/>`).noindex && nx.headSignals(`<meta name="robots" content="none">`).noindex && !nx.headSignals("<p>no head</p>").noindex && nx.headSignals("<p>x</p>").canonical.length === 0, "headSignals: index,follow is not noindex; none means noindex; a page without a head has no signals");

  note("finding the key");
  const file = (name: string, content: string) => ({ name, content });
  check(nx.pickKeyFromFiles([file(`${KEY}.txt`, KEY), file("notes.txt", "x")]).ok, "one file whose content is its own name: that is the key");
  check(nx.pickKeyFromFiles([file(`${KEY}.txt`, `${KEY}\n`)]).ok, "...a trailing newline is tolerated when reading");
  const none = nx.pickKeyFromFiles([file(`${KEY}.txt`, "something else"), file("short.txt", "short"), file("robots_x.txt", "robots_x")]);
  check(!none.ok && /Geen IndexNow-sleutel/.test(none.reason) && none.candidates === 0, "content that is not its name, a short name and an invalid name are no candidates: refused with a clear message");
  const two = nx.pickKeyFromFiles([file(`${KEY}.txt`, KEY), file(`${KEY2}.txt`, KEY2)]);
  check(!two.ok && two.candidates === 2 && /2 sleutelbestanden/.test(two.reason) && /INDEXNOW_KEY/.test(two.reason) && !two.reason.includes(KEY) && !two.reason.includes(KEY2), "two candidates: refused, says to choose with INDEXNOW_KEY, and does not print either key");
  check(nx.resolveKey(KEY2, keyDir).ok && (nx.resolveKey(KEY2, keyDir) as { key: string }).key === KEY2, "INDEXNOW_KEY wins over the files");
  const badEnv = nx.resolveKey("bad key", keyDir);
  check(!badEnv.ok && /INDEXNOW_KEY heeft niet het goede formaat/.test(badEnv.reason) && !badEnv.reason.includes("bad key"), "an invalid INDEXNOW_KEY is refused, the value is not echoed");
  check(nx.resolveKey(undefined, keyDir).ok && !nx.resolveKey(undefined, emptyDir).ok && !nx.resolveKey(undefined, path.join(tmp, "nope")).ok, "from the directory: found in keyDir, nothing in an empty or missing one");
  {
    // A key file is at most 132 bytes; a bigger .txt is never a candidate, even when its trimmed content is its own name.
    const padded = fs.mkdtempSync(path.join(tmp, "padded-"));
    fs.writeFileSync(path.join(padded, `${KEY}.txt`), `${KEY}${" ".repeat(600)}`);
    check(nx.readPublicTextFiles(padded).length === 0 && !nx.resolveKey(undefined, padded).ok, "a .txt over 512 bytes is not read as a key file candidate (the key padded with spaces to 632 bytes is refused)");
  }
  check(nx.makeMasker(KEY)(`a ${KEY} b https://x/${KEY}.txt`) === `a ${nx.KEY_MASK} b https://x/${nx.KEY_MASK}.txt` && nx.makeMasker(null)("zzz") === "zzz", "the masker replaces the key everywhere in a text");

  // ═══ 2. the key file of this repository ═══════════════════════════════════
  note("the key file in public/");
  const realFiles = nx.readPublicTextFiles(path.join(ROOT, "public"));
  const real = nx.pickKeyFromFiles(realFiles);
  check(real.ok, "public/ holds exactly one IndexNow key file (name = key, content = key)", real.ok ? "" : real.reason);
  if (real.ok) {
    const name = `${real.key}.txt`;
    const buf = fs.readFileSync(path.join(ROOT, "public", name));
    check(buf.toString("utf8") === real.key && buf.length === real.key.length, "its content is exactly the key: no newline, no space, no BOM");
    check(real.key.length === 32 && /^[0-9a-f]{32}$/.test(real.key), "the key is 32 hex characters");
    const ign = spawnSync("git", ["check-ignore", "-q", `public/${name}`], { cwd: ROOT });
    check(ign.status === 1 || ign.error !== undefined || ign.status === 128, "the file is not git-ignored (it has to be committed: the site serves it)", `git check-ignore exit ${ign.status}`);
    const src = fs.readFileSync(path.join(ROOT, "scripts", "lib", "indexnow.ts"), "utf8") + fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");
    check(!src.includes(real.key), "the key is not written into the scripts or .env.example (it is read from public/)");
  }

  // ═══ 3. dry run ═══════════════════════════════════════════════════════════
  note("dry run: reads, prints, sends NOTHING");
  good(pathsFor(14));
  {
    const r = await dry();
    const first = urlLines(r.out, "Eerste 5:");
    const last = urlLines(r.out, "Laatste 5:");
    const all = pathsFor(14).map((p) => `${site.origin}${p}`.replace(/^(https?:\/\/[^/]+)$/, "$1/"));
    check(r.code === 0, "dry run exits 0", `exit ${r.code}: ${r.all}`);
    check(engine.posts.length === 0, "dry run: the engine received NOTHING", `${engine.posts.length} posts`);
    check(site.hits.some((h) => h.includes("/sitemap.xml")) && site.hits.every((h) => h.startsWith("GET ")), "dry run only reads the site (GET requests)", site.hits.join(" | "));
    check(/DROOGLOOP KLAAR: er is niets verstuurd/.test(r.out) && /Modus: DROOGLOOP/.test(r.out), "it says, twice, that it is a dry run and that nothing was sent");
    check(/Ter indiening: 14\. Overgeslagen: 0\./.test(r.out), "it prints the counts (14 to submit, 0 skipped)", r.out);
    check(first.length === 5 && JSON.stringify(first) === JSON.stringify(all.slice(0, 5)) && last.length === 5 && JSON.stringify(last) === JSON.stringify(all.slice(-5)), "it prints the first five and the last five URLs", JSON.stringify({ first, last }));
    check(/Batchplan: 1 verzoek\(en\), hoogstens 10000 URL's per verzoek: 1\) 14/.test(r.out), "it prints the batch plan", r.out);
    check(/Sleutel: aanwezig \(32 tekens/.test(r.out) && /Sleutelbestand: .*\[sleutel\]\.txt bereikbaar en bevat de sleutel/.test(r.out), "it reports the key by length only and that the key file is reachable and correct");
    check(/Een live indiening zou door de controles van dit script nu DOORGAAN/.test(r.out) && /blijkt pas bij de echte indiening/.test(r.out) && /Google doet niet mee/.test(r.out), "it says live would go ahead (in this fixture) and that Google is not reached");
    check(/TESTMODUS: QA_INDEXNOW_ALLOW_LOCAL=1 staat aan/.test(r.out), "with the test-only switch on, the output says so (TESTMODUS), so a rehearsal cannot be mistaken for a real run");
    check(/Per verzoek: host=127\.0\.0\.1, keyLocation=http:\/\/127\.0\.0\.1:\d+\/\[sleutel\]\.txt, urlList=/.test(r.out), "it prints what each request will carry (host, key location with the key masked, urlList)", r.out.split("\n").filter((l) => l.startsWith("Per verzoek")).join());
  }
  good(pathsFor(8));
  {
    const r = await dry();
    check(/Alle 8 URL's:/.test(r.out) && !/Eerste 5:/.test(r.out) && urlLines(r.out, "Alle 8").length === 8, "a list of 10 or fewer is printed whole, once");
  }

  note("dry run: what is dropped is counted and shown");
  good([...pathsFor(5), "/admin", "/checkout", "/onderdelen?q=x"]);
  site.put("/sitemap.xml", { status: 200, body: sitemapXml([...pathsFor(5).map((p) => `${site.origin}${p}`), `${site.origin}/admin`, `${site.origin}/checkout`, `${site.origin}/onderdelen?q=x`, "https://elders.example.nl/x", `${site.origin}/wasmachine-kapot/amsterdam`]) });
  {
    const r = await dry();
    check(r.code === 0 && new RegExp(`Ter indiening: ${CITY_PAGES_INDEXABLE ? 6 : 5}\\. Overgeslagen: ${CITY_PAGES_INDEXABLE ? 4 : 5}\\.`).test(r.out), "5 pages to submit; the private paths, the query variant, the foreign host and the city page are skipped", r.out);
    check(/overgeslagen \(2x\): privé- of transactiepad/.test(r.out) && /overgeslagen \(1x\): niet op het adres van de site/.test(r.out) && /overgeslagen \(1x\): met een query-string/.test(r.out) && (CITY_PAGES_INDEXABLE || /overgeslagen \(1x\): stadspagina/.test(r.out)), "each reason is shown with its count and an example", r.out);
  }

  note("dry run: a sitemap index is followed (children on this origin only)");
  good();
  site.put("/sitemap.xml", { status: 200, body: indexXml([`${site.origin}/sitemap-1.xml`, `${site.origin}/sitemap-2.xml`, "https://elders.example.nl/sitemap-3.xml"]) });
  site.put("/sitemap-1.xml", { status: 200, body: sitemapXml([`${site.origin}/a`, `${site.origin}/b`]) });
  site.put("/sitemap-2.xml", { status: 200, body: sitemapXml([`${site.origin}/c`, `${site.origin}/b`]) });
  {
    const r = await dry();
    check(r.code === 0 && /3 bestand\(en\), 4 adres\(sen\) gelezen/.test(r.out) && /Ter indiening: 3\. Overgeslagen: 1\./.test(r.out) && /overgeslagen \(1x\): dubbel/.test(r.out) && /staat op een ander adres dan .* en is overgeslagen/.test(r.out) && !site.hits.some((h) => h.includes("elders")), "an index with two children and one foreign child: 3 files read, the duplicate dropped, the foreign sitemap not fetched", r.out);
  }

  note("dry run: the limits of a sitemap index, and children that are broken");
  {
    good();
    const kids = Array.from({ length: 51 }, (_, i) => `${site.origin}/sitemap-${i}.xml`);
    site.put("/sitemap.xml", { status: 200, body: indexXml(kids) });
    kids.forEach((_k, i) => site.put(`/sitemap-${i}.xml`, { status: 200, body: sitemapXml([`${site.origin}/c/${i}`]) }));
    const r = await dry();
    const fetched = site.hits.filter((h) => /\/sitemap-\d+\.xml/.test(h)).length;
    check(r.code === 0 && fetched === 50 && !site.hits.some((h) => h.includes("/sitemap-50.xml")) && /de index noemt 51 sitemaps; alleen de eerste 50 zijn gelezen/.test(r.out) && /\(51 bestand\(en\), 50 adres\(sen\) gelezen\)/.test(r.out) && /Ter indiening: 50\./.test(r.out), "an index of 51 child sitemaps: only the first 50 are fetched and read, and the output says so", `fetched ${fetched}: ${r.out.slice(0, 500)}`);
  }
  {
    good();
    site.put("/sitemap.xml", { status: 200, body: indexXml([`${site.origin}/sitemap-a.xml`, `${site.origin}/sitemap-nested.xml`]) });
    site.put("/sitemap-a.xml", { status: 200, body: sitemapXml([`${site.origin}/a`]) });
    site.put("/sitemap-nested.xml", { status: 200, body: indexXml([`${site.origin}/sitemap-deep.xml`]) });
    site.put("/sitemap-deep.xml", { status: 200, body: sitemapXml([`${site.origin}/deep`]) });
    const r = await dry();
    check(r.code === 0 && /sitemap-nested\.xml is zelf een index; geneste indexen worden niet gevolgd/.test(r.out) && !site.hits.some((h) => h.includes("sitemap-deep.xml")) && /Ter indiening: 1\./.test(r.out), "a child that is itself an index is reported and not followed (its children are not fetched)", r.out);
  }
  {
    good();
    site.put("/sitemap.xml", { status: 200, body: indexXml(["not a url", `${site.origin}/sitemap-a.xml`]) });
    site.put("/sitemap-a.xml", { status: 200, body: sitemapXml([`${site.origin}/a`]) });
    const r = await dry();
    check(r.code === 0 && /een sitemap in de index is geen geldig adres en is overgeslagen/.test(r.out) && /Ter indiening: 1\./.test(r.out), "a child address that is no URL is skipped with a note; the others are read", r.out);
  }
  for (const mode of ["dry run", "live"]) {
    good();
    site.put("/sitemap.xml", { status: 200, body: indexXml([`${site.origin}/sitemap-a.xml`, `${site.origin}/sitemap-b.xml`]) });
    site.put("/sitemap-a.xml", { status: 200, body: sitemapXml([`${site.origin}/a`]) });
    site.put("/sitemap-b.xml", { status: 404 });
    const r = mode === "live" ? await live() : await dry();
    check(r.code === 2 && /sitemap-b\.xml antwoordt HTTP 404/.test(r.err) && engine.posts.length === 0, `${mode}: a child sitemap that fails makes the whole list unusable (exit 2, nothing sent): a silently incomplete list is never submitted`, r.all);
  }
  {
    good();
    site.put("/sitemap.xml", { status: 200, body: `<urlset><url><lastmod>2026-01-01</lastmod></url><url><loc>${site.origin}/ok</loc></url></urlset>` });
    const r = await dry();
    check(r.code === 0 && /1 onderdeel\/onderdelen van .*sitemap\.xml zonder <loc> overgeslagen/.test(r.out) && /Ter indiening: 1\./.test(r.out), "an entry without <loc> is skipped with a note in the output", r.out);
  }

  note("dry run: the verdict about live");
  good();
  {
    const r = await dry([], { INDEXNOW_KEY: undefined }, { publicDir: emptyDir });
    check(r.code === 0 && /zou nu WEIGEREN/.test(r.out) && /Geen IndexNow-sleutel/.test(r.out) && engine.posts.length === 0, "no key: the dry run still lists the URLs (exit 0), says live would refuse and why", r.all);
  }
  good();
  site.put(`/${KEY}.txt`, { status: 404 });
  {
    const r = await dry();
    check(r.code === 0 && /Sleutelbestand: NIET in orde: .*404/.test(r.out) && /zou nu WEIGEREN/.test(r.out), "key file missing on the site: reported, live would refuse, the dry run itself is not an error", r.all);
  }
  good();
  {
    const r = await cli(["--origin", site.origin], { ...base, QA_INDEXNOW_ALLOW_LOCAL: undefined });
    check(r.code === 0 && /zou nu WEIGEREN/.test(r.out) && /niet https/.test(r.out) && /geen publiek domein/.test(r.out), "a plain http://127.0.0.1 origin: the dry run reads it, and says live would refuse (http, not a public domain)", r.all);
  }
  good();
  {
    const r = await cli([], { ...base, NEXT_PUBLIC_APP_URL: site.origin });
    check(r.code === 0 && /Ter indiening: 14/.test(r.out), "without --origin the origin is NEXT_PUBLIC_APP_URL");
  }

  note("the list cannot be read: exit 2, nothing sent");
  good();
  site.put("/sitemap.xml", { status: 404 });
  { const r = await dry(); check(r.code === 2 && /Sitemap niet bruikbaar/.test(r.err) && /404/.test(r.err) && engine.posts.length === 0, "sitemap 404: exit 2", r.all); }
  site.put("/sitemap.xml", { status: 301, location: "https://www.elders.example/sitemap.xml" });
  { const r = await dry(); check(r.code === 2 && /verwijst door \(HTTP 301\)/.test(r.err) && /www\.elders\.example/.test(r.err), "sitemap redirect: exit 2, says where it goes", r.all); }
  site.put("/sitemap.xml", { status: 200, type: "text/html", body: "<html><body>Welkom</body></html>" });
  { const r = await dry(); check(r.code === 2 && /geen sitemap/.test(r.err), "a page that is not XML: exit 2", r.all); }
  site.put("/sitemap.xml", { status: 200, body: sitemapXml([]) });
  { const r = await dry(); check(r.code === 2 && /Geen enkele URL/.test(r.err), "an empty sitemap: exit 2", r.all); }
  site.put("/sitemap.xml", { status: 200, body: sitemapXml(["https://elders.example.nl/a", "https://elders.example.nl/b"]) });
  { const r = await dry(); check(r.code === 2 && /Geen enkele URL/.test(r.err) && /overgeslagen \(2x\): niet op het adres/.test(r.out), "a sitemap of only foreign URLs is empty after the host check: exit 2", r.all); }
  { const r = await cli(["--origin", "http://127.0.0.1:1"], base); check(r.code === 2 && /niet te lezen/.test(r.err), "an unreachable site: exit 2", r.all); }
  {
    // A VALID sitemap of 61 MB (one URL and a long comment): without the size limit it would parse fine, so only the limit refuses it.
    good();
    site.put("/sitemap.xml", { status: 200, type: "application/xml", body: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${site.origin}/a</loc></url><!--${"x".repeat(61 * 1024 * 1024)}--></urlset>` });
    const r = await dry();
    check(r.code === 2 && /groter dan 62914560 bytes/.test(r.err) && engine.posts.length === 0, "a sitemap over 60 MB is refused, not read: exit 2", r.all.slice(0, 300));
    site.put("/sitemap.xml", { status: 200, type: "application/xml", body: sitemapXml([`${site.origin}/a`]) });
  }

  note("arguments");
  { const r = await cli(["--bogus"], base); check(r.code === 1 && /Onbekend argument/.test(r.err), "an unknown flag: exit 1"); }
  { const r = await cli([], { ...base, NEXT_PUBLIC_APP_URL: undefined }); check(r.code === 1 && /Geen adres/.test(r.err), "no --origin and no NEXT_PUBLIC_APP_URL: exit 1"); }
  { const r = await cli(["--origin"], base); check(r.code === 1 && /heeft een waarde nodig/.test(r.err), "--origin without a value: exit 1"); }
  { const r = await cli(["--urls-file"], base); check(r.code === 1 && /bestandspad nodig/.test(r.err), "--urls-file without a path: exit 1"); }
  { const r = await cli(["--origin", "https://wasfix.nl/pad"], base); check(r.code === 1, "--origin with a path: exit 1"); }
  { const r = await cli(["--help"], base); check(r.code === 0 && /Afsluitcodes/.test(r.out), "--help prints the usage and the exit codes"); }
  good();
  { const r = await cli([`--origin=${site.origin}`], base); check(r.code === 0 && /Ter indiening: 14/.test(r.out) && engine.posts.length === 0, "--origin=<value> works like --origin <value>"); }
  { const r = await cli(["--live=true", "--origin", site.origin], base); check(r.code === 1 && /geen waarde/.test(r.err) && engine.posts.length === 0, "--live=true is not --live: refused, nothing sent"); }

  // ═══ 4. live ══════════════════════════════════════════════════════════════
  note("live: the payload");
  const expectedFor = (paths: string[]) => paths.map((p) => new URL(`${site.origin}${p}`).href);
  good(pathsFor(14));
  {
    const r = await live();
    const p = engine.posts[0];
    check(r.code === 0 && engine.posts.length === 1, "live: exit 0, exactly one POST for 14 URLs", `exit ${r.code} posts ${engine.posts.length}: ${r.all}`);
    check(p?.method === "POST" && p.url === "/indexnow" && /^application\/json/.test(p.contentType), "a POST to /indexnow with a JSON body", JSON.stringify({ m: p?.method, u: p?.url, c: p?.contentType }));
    check(!!p?.body && JSON.stringify(Object.keys(p.body)) === JSON.stringify(["host", "key", "keyLocation", "urlList"]), "the body has exactly host, key, keyLocation, urlList", p?.raw?.slice(0, 200));
    check(p?.body?.host === "127.0.0.1" && p.body.key === KEY && p.body.keyLocation === `${site.origin}/${KEY}.txt`, "host is the host name, key is the key, keyLocation is https://<host>/<key>.txt at the root of the site");
    check(JSON.stringify(p?.body?.urlList) === JSON.stringify(expectedFor(pathsFor(14))), "urlList is exactly the sitemap's URLs, in order");
    check(/^wasfix-seo-submit\//.test(p?.userAgent ?? ""), "the request identifies the tool in its User-Agent");
    check(/Batch 1\/1: 14 URL's naar 127\.0\.0\.1:\d+ -> 200 OK: .*ontvangen/.test(r.out) && /Klaar: 1 van 1 verzoek\(en\) aangenomen\./.test(r.out) && /niet geïndexeerd/.test(r.out) && /niet naar Google/.test(r.out), "one line per batch with the Dutch reading of the status, and the honest closing note (received, not indexed, not Google)", r.out);
    check(/Versturen naar 127\.0\.0\.1:\d+ \(afwijkend eindpunt, INDEXNOW_ENDPOINT\): 1 verzoek\(en\), tot 3 nieuwe pogingen/.test(r.out), "it names the engine it sends to, and says when that is not the default endpoint", r.out.split("\n").filter((l) => l.startsWith("Versturen")).join());
    const order = site.hits.map((h) => (h.includes(`${KEY}.txt`) ? "key" : h.includes("sitemap.xml") ? "sitemap" : "other")).join(",");
    check(order === "key,sitemap", "the key file is fetched BEFORE the sitemap", order);
  }
  good(pathsFor(6));
  engine.queue({ status: 202 });
  { const r = await live(); check(r.code === 0 && /202 Geaccepteerd/.test(r.out), "202 counts as accepted (key validation pending)", r.all); }

  note("live: 10001 URLs make two requests");
  good(pathsFor(10001));
  {
    const r = await live();
    check(r.code === 0 && engine.posts.length === 2 && (engine.posts[0].body?.urlList as string[]).length === 10000 && (engine.posts[1].body?.urlList as string[]).length === 1 && /Batch 1\/2/.test(r.out) && /Batch 2\/2/.test(r.out) && /Klaar: 2 van 2/.test(r.out), "10001 URLs: two POSTs of 10000 and 1, one result line each", `exit ${r.code} posts ${engine.posts.map((q) => (q.body?.urlList as string[] | undefined)?.length)}`);
    check(engine.posts.every((q) => q.body?.key === KEY && q.body.keyLocation === `${site.origin}/${KEY}.txt`), "each request carries the key and the key location");
  }
  good(pathsFor(10000));
  { const r = await live(); check(r.code === 0 && engine.posts.length === 1 && /Batchplan: 1 verzoek/.test(r.out), "exactly 10000 URLs: ONE POST"); }

  note("live: what the engine can answer");
  good(pathsFor(5));
  engine.queue({ status: 429, headers: { "retry-after": "0" } }, { status: 429 }, { status: 200 });
  {
    const r = await live();
    check(r.code === 0 && engine.posts.length === 3 && /\(na 3 pogingen\)/.test(r.out) && r.waits.length === 2 && r.waits[0] === 5 && r.waits[1] === 10, "429, 429, 200: retried with a growing wait (5 ms, 10 ms in this test) and reported as accepted after 3 tries", `waits ${r.waits} posts ${engine.posts.length}: ${r.all}`);
  }
  good(pathsFor(5));
  engine.queue({ status: 429 }, { status: 200 });
  {
    const r = await live();
    check(r.code === 0 && /poging 1 van 4: HTTP 429; wacht 5 ms en probeer opnieuw/.test(r.out), "a retry is announced in the output (which try, which status, how long it waits)", r.out);
  }
  for (const bad of ["abc", "-5"]) {
    good(pathsFor(5));
    engine.queue({ status: 429 }, { status: 429 }, { status: 429 }, { status: 429 });
    const r = await live([], { QA_INDEXNOW_BACKOFF_MS: bad });
    check(r.code === 3 && r.waits.join() === "2000,4000,8000", `an unusable QA_INDEXNOW_BACKOFF_MS (${bad}) falls back to the real 2 s base: waits 2/4/8 s`, `waits ${r.waits}`);
  }
  good(pathsFor(5));
  engine.queue({ status: 429 }, { status: 429 }, { status: 429 }, { status: 429 }, { status: 429 });
  {
    const r = await live();
    check(r.code === 3 && engine.posts.length === 4 && /429 Te veel aanvragen/.test(r.err) && /Opgegeven na 4 pogingen/.test(r.err) && r.waits.join() === "5,10,20", "429 forever: 4 tries (bounded), waits 5/10/20, reported as failed, exit 3", `exit ${r.code} posts ${engine.posts.length} waits ${r.waits}: ${r.all}`);
    check(/Klaar: 0 van 1 verzoek\(en\) aangenomen, 1 MISLUKT/.test(r.out), "...and the summary says 1 failed");
  }
  good(pathsFor(5));
  engine.queue({ status: 422, body: JSON.stringify({ message: "URLs do not belong to the host" }) });
  {
    const r = await live();
    check(r.code === 3 && engine.posts.length === 1 && /422 Geweigerd/.test(r.err) && /horen niet bij de opgegeven host/.test(r.err) && /Antwoord van de zoekmachine: .*URLs do not belong/.test(r.err) && r.waits.length === 0, "422: reported with the Dutch explanation and the engine's own words, exit 3, not retried", r.all);
  }
  for (const [status, re] of [[403, /403 Sleutel ongeldig/], [400, /400 Ongeldig formaat/]] as const) {
    good(pathsFor(5));
    engine.queue({ status });
    const r = await live();
    check(r.code === 3 && engine.posts.length === 1 && re.test(r.err), `${status}: reported in Dutch, exit 3, not retried`, r.all);
  }
  good(pathsFor(5));
  engine.queue({ status: 500 }, { status: 503 }, { status: 200 });
  { const r = await live(); check(r.code === 0 && engine.posts.length === 3, "server errors are retried like 429"); }
  good(pathsFor(10001));
  engine.queue({ status: 200 }, { status: 422 });
  {
    const r = await live();
    check(r.code === 3 && engine.posts.length === 2 && /Batch 1\/2: .*200 OK/.test(r.out) && /Batch 2\/2: .*MISLUKT: 422/.test(r.err) && /Klaar: 1 van 2 verzoek\(en\) aangenomen, 1 MISLUKT/.test(r.out), "two batches, the second refused: both lines shown, exit 3", r.all);
  }
  good(pathsFor(5));
  {
    const dead = await startEngine();
    const url = dead.endpoint;
    dead.close();
    const r = await live([], { INDEXNOW_ENDPOINT: url });
    check(r.code === 3 && /geen antwoord/.test(r.err) && /Opgegeven na 4 pogingen/.test(r.err), "an engine that does not answer at all: retried, then reported as 'geen antwoord', exit 3", r.all);
  }

  note("live: the POST never follows a redirect (the key and the list go only where the endpoint was configured)");
  {
    const elsewhere = await startEngine();
    for (const status of [301, 302, 307, 308]) {
      good(pathsFor(5));
      elsewhere.reset();
      engine.queue({ status, headers: { location: elsewhere.endpoint } });
      const r = await live();
      check(r.code === 3 && engine.posts.length === 1 && elsewhere.posts.length === 0 && r.waits.length === 0 && new RegExp(`${status} Onverwacht antwoord \\(een doorverwijzing wordt niet gevolgd\\)`).test(r.err), `an engine that answers ${status}: reported as failed (exit 3), not retried, and the redirect target received NOTHING`, `exit ${r.code} first ${engine.posts.length} target ${elsewhere.posts.length}: ${r.all.slice(0, 300)}`);
    }
    elsewhere.close();
  }

  note("live: the default endpoint (the network is injected: nothing real is contacted)");
  {
    const reply = (text: string, type: string) => ({ status: 200, location: null, contentType: type, xRobotsTag: null, text });
    const getStub: nx.HttpGet = async (url) => (url.endsWith(`/${KEY}.txt`) ? reply(KEY, "text/plain") : reply(sitemapXml(["https://shop.example.nl/", "https://shop.example.nl/diagnose"]), "application/xml"));
    const calls: string[] = [];
    const fetchStub = (async (url: string, init?: RequestInit) => { calls.push(`${init?.method} ${url}`); return new Response("", { status: 200 }); }) as unknown as typeof fetch;
    const r = await cli(["--origin", "https://shop.example.nl", "--live"], { INDEXNOW_KEY: undefined }, { get: getStub, fetchImpl: fetchStub });
    check(r.code === 0 && JSON.stringify(calls) === JSON.stringify(["POST https://api.indexnow.org/indexnow"]) && /Versturen naar api\.indexnow\.org: 1 verzoek/.test(r.out) && !/afwijkend eindpunt/.test(r.out), "without INDEXNOW_ENDPOINT a live run posts to https://api.indexnow.org/indexnow and does not call it 'afwijkend'", JSON.stringify(calls) + r.out.slice(0, 300));
  }

  note("live: a long answer is cut, and the key never appears in what is printed");
  good(pathsFor(5));
  engine.queue({ status: 403, body: `{"error":"key ${KEY} not found at https://x/${KEY}.txt ${"y".repeat(2000)}"}` });
  {
    const r = await live();
    const shown = /Antwoord van de zoekmachine: (.*)$/m.exec(r.err)?.[1] ?? "";
    check(r.code === 3 && shown.length > 0 && shown.length <= 300, "the engine's answer is shown at most 300 characters", `${shown.length} characters`);
    check(!r.all.includes(KEY) && r.all.includes("[sleutel]"), "an answer that echoes the key is masked: the key is not in the output", r.all.slice(0, 400));
  }

  note("live: refused, nothing sent");
  const noNet: RunOptions = { get: async () => { throw new Error("NETWORK USED"); } };
  const refusedStatic = async (name: string, argv: string[], env: Env, re: RegExp, opts: RunOptions = noNet) => {
    good();
    const r = await cli(argv, { ...base, ...env }, opts);
    check(r.code === 1 && re.test(r.err) && engine.posts.length === 0 && !/NETWORK USED/.test(r.all) && site.hits.length === 0, `${name}: exit 1, nothing sent, no request to the site`, `exit ${r.code} posts ${engine.posts.length} hits ${site.hits.length}: ${r.all.slice(0, 300)}`);
  };
  await refusedStatic("a localhost origin (without the test-only switch)", ["--origin", site.origin, "--live"], { QA_INDEXNOW_ALLOW_LOCAL: undefined }, /GEWEIGERD[\s\S]*geen publiek domein/);
  await refusedStatic("an http origin without the switch", ["--origin", "http://wasfix.nl", "--live"], { QA_INDEXNOW_ALLOW_LOCAL: undefined }, /niet https/);
  await refusedStatic("a *.vercel.app origin (also with the switch)", ["--origin", "https://wasfix-pro-abc.vercel.app", "--live"], {}, /vercel\.app/);
  await refusedStatic("an origin with a port", ["--origin", "https://wasfix.nl:8443", "--live"], { QA_INDEXNOW_ALLOW_LOCAL: undefined }, /poort 8443/);
  await refusedStatic("no key anywhere", ["--origin", "https://wasfix.nl", "--live"], { INDEXNOW_KEY: undefined }, /Geen IndexNow-sleutel/, { ...noNet, publicDir: emptyDir });
  await refusedStatic("an invalid INDEXNOW_KEY", ["--origin", "https://wasfix.nl", "--live"], { INDEXNOW_KEY: "bad key!" }, /goede formaat/);
  {
    const dir2 = fs.mkdtempSync(path.join(tmp, "two-"));
    fs.writeFileSync(path.join(dir2, `${KEY}.txt`), KEY);
    fs.writeFileSync(path.join(dir2, `${KEY2}.txt`), KEY2);
    await refusedStatic("two key files and no INDEXNOW_KEY", ["--origin", "https://wasfix.nl", "--live"], {}, /2 sleutelbestanden/, { ...noNet, publicDir: dir2 });
  }
  await refusedStatic("an endpoint nobody vouched for", ["--origin", "https://wasfix.nl", "--live"], { INDEXNOW_ENDPOINT: "https://evil.example/indexnow" }, /INDEXNOW_ENDPOINT is niet toegestaan/);
  {
    good();
    const r = await cli(["--origin", "https://wasfix.nl", "--live"], { ...base, INDEXNOW_ENDPOINT: "https://evil.example/indexnow" }, noNet);
    check(!r.all.includes(KEY), "...and the refusal does not print the key");
  }

  note("live: the key file and the sitemap");
  good();
  site.put(`/${KEY}.txt`, { status: 404 });
  { const r = await live(); check(r.code === 1 && /GEWEIGERD/.test(r.err) && /404/.test(r.err) && engine.posts.length === 0 && !site.hits.some((h) => h.includes("sitemap.xml")), "key file 404: refused (exit 1), nothing sent, the sitemap is not even read", r.all); }
  good();
  site.put(`/${KEY}.txt`, { status: 200, body: `x${KEY}` });
  { const r = await live(); check(r.code === 1 && /bevat niet de sleutel/.test(r.err) && engine.posts.length === 0, "key file with other content: refused", r.all); }
  good();
  site.put(`/${KEY}.txt`, { status: 200, body: "" });
  { const r = await live(); check(r.code === 1 && /bevat niet de sleutel/.test(r.err) && engine.posts.length === 0, "empty key file: refused", r.all); }
  good();
  site.put(`/${KEY}.txt`, { status: 301, location: `${site.origin}/elders.txt` });
  site.put("/elders.txt", { status: 200, body: KEY });
  { const r = await live(); check(r.code === 1 && /verwijst door \(HTTP 301\)/.test(r.err) && engine.posts.length === 0 && !site.hits.some((h) => h.includes("elders.txt")), "key file behind a redirect: refused, the redirect is not followed", r.all); }
  good();
  site.put(`/${KEY}.txt`, { status: 200, body: `${KEY}\n`, type: "text/plain" });
  { const r = await live(); check(r.code === 0 && engine.posts.length === 1, "a key file with a trailing newline is accepted when reading (the repository file has none)"); }
  good();
  site.put("/sitemap.xml", { status: 200, body: sitemapXml([]) });
  { const r = await live(); check(r.code === 2 && /Geen enkele URL/.test(r.err) && engine.posts.length === 0, "live with an empty sitemap: refused (exit 2), nothing sent", r.all); }
  good();
  site.put("/sitemap.xml", { status: 500 });
  { const r = await live(); check(r.code === 2 && engine.posts.length === 0, "live with an unreadable sitemap: exit 2, nothing sent", r.all); }

  note("live: --urls-file, INDEXNOW_KEY");
  good();
  {
    const f1 = path.join(tmp, "urls.txt");
    fs.writeFileSync(f1, `# een eigen lijst\n${site.origin}/diagnose\n\n${site.origin}/prijzen\nhttps://elders.example.nl/x\n${site.origin}/admin\n`);
    const r = await live(["--urls-file", f1]);
    check(r.code === 0 && engine.posts.length === 1 && JSON.stringify(engine.posts[0].body?.urlList) === JSON.stringify([`${site.origin}/diagnose`, `${site.origin}/prijzen`]) && !site.hits.some((h) => h.includes("sitemap.xml")), "--urls-file: only the file's URLs, host-checked and filtered (a foreign host and /admin dropped), the sitemap is not read", r.all + JSON.stringify(engine.posts.map((q) => q.body?.urlList)));
    const r2 = await live(["--urls-file", path.join(tmp, "nope.txt")]);
    check(r2.code === 2 && /niet te lezen/.test(r2.err), "--urls-file that does not exist: exit 2");
    const big = path.join(tmp, "big-urls.txt");
    fs.closeSync(fs.openSync(big, "w"));
    fs.truncateSync(big, 20 * 1024 * 1024 + 1); // a sparse file one byte over the limit; it is never read
    const sent = engine.posts.length;
    const r3 = await live(["--urls-file", big]);
    check(r3.code === 2 && /groter dan 20 MB/.test(r3.err) && engine.posts.length === sent, "--urls-file over 20 MB: refused without reading it (exit 2, nothing sent)", r3.all.slice(0, 200));
    const r4 = await live(["--urls-file", tmp]);
    check(r4.code === 2 && /is geen bestand/.test(r4.err) && engine.posts.length === sent, "--urls-file that is a directory: exit 2, nothing sent", r4.all.slice(0, 200));
    fs.writeFileSync(big, `${site.origin}/diagnose\n`);
    const r5 = await live(["--urls-file", big]);
    check(r5.code === 0 && engine.posts.length === sent + 1, "...and a small file at the same path is fine (the 20 MB rule is about size)", r5.all.slice(0, 200));
  }
  good();
  site.put(`/${KEY2}.txt`, { status: 200, body: KEY2 });
  { const r = await live([], { INDEXNOW_KEY: KEY2 }, { publicDir: emptyDir }); check(r.code === 0 && engine.posts[0]?.body?.key === KEY2 && /uit INDEXNOW_KEY/.test(r.out), "INDEXNOW_KEY (no key file in the directory) is used", r.all); }

  note("--ping-sitemap-only: there is no sitemap ping, and nothing is sent");
  good();
  for (const argv of [["--ping-sitemap-only"], ["--ping-sitemap-only", "--live", "--origin", site.origin]]) {
    const r = await cli(argv, base);
    check(r.code === 1 && /bestaat niet meer/.test(r.err) && /Er is niets verstuurd/.test(r.err) && /Search Console/.test(r.err) && /Bing Webmaster Tools/.test(r.err) && engine.posts.length === 0 && site.hits.length === 0, `${argv.join(" ")}: explains, exit 1, no request to the engine or the site`, r.all);
  }

  // ═══ 5. the real command line ═════════════════════════════════════════════
  note("the real command line (a separate process)");
  const spawnCli = (args: string[], env: Record<string, string | undefined>) =>
    new Promise<{ code: number; out: string; ms: number }>((resolve) => {
      const t0 = Date.now();
      const child = spawn("npx", ["--no-install", "tsx", "scripts/seo-submit.ts", ...args], { cwd: ROOT, env: { PATH: process.env.PATH, HOME: process.env.HOME, ...Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined)) } as unknown as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (out += d));
      child.on("close", (code) => resolve({ code: code ?? -1, out, ms: Date.now() - t0 }));
    });
  const realKey = real.ok ? real.key : KEY;
  good();
  site.put(`/${realKey}.txt`, { status: 200, body: realKey });
  {
    const r = await spawnCli(["--origin", site.origin], { INDEXNOW_ENDPOINT: engine.endpoint });
    check(r.code === 0 && /DROOGLOOP KLAAR/.test(r.out) && /Ter indiening: 14/.test(r.out) && engine.posts.length === 0, "process: a dry run exits 0, prints the plan, sends nothing; the key came from public/ (the repository's own key file)", `exit ${r.code}: ${r.out.slice(0, 500)}`);
    check(!r.out.includes(realKey) && /Sleutelbestand: .*\[sleutel\]\.txt bereikbaar/.test(r.out), "process: the repository key is served by the fake site and is not in the output");
    check(!/TESTMODUS/.test(r.out), "process: without the test-only switch there is no TESTMODUS line");
  }
  good();
  site.put(`/${realKey}.txt`, { status: 200, body: realKey });
  engine.queue({ status: 429 }, { status: 200 });
  {
    const r = await spawnCli(["--origin", site.origin, "--live"], { INDEXNOW_ENDPOINT: engine.endpoint, QA_INDEXNOW_ALLOW_LOCAL: "1", QA_INDEXNOW_BACKOFF_MS: "10" });
    check(r.code === 0 && engine.posts.length === 2 && engine.posts[0].body?.key === realKey && !r.out.includes(realKey), "process: --live with the test-only switch retries a 429 with real timers and exits 0; the key is not printed", `exit ${r.code} posts ${engine.posts.length}: ${r.out.slice(0, 400)}`);
    check(engine.posts.length === 2 && engine.posts[1].at - engine.posts[0].at >= 8, "process: the retry waited (>= the 10 ms base)", `${engine.posts[1]?.at - engine.posts[0]?.at} ms`);
  }
  good();
  {
    const r = await spawnCli(["--origin", site.origin, "--live"], { INDEXNOW_ENDPOINT: engine.endpoint });
    check(r.code === 1 && /GEWEIGERD/.test(r.out) && site.hits.length === 0 && engine.posts.length === 0, "process: --live against a localhost origin is refused with exit 1, no request is made", `exit ${r.code}: ${r.out.slice(0, 300)}`);
  }
  good();
  site.put(`/${realKey}.txt`, { status: 200, body: realKey });
  engine.queue({ status: 422 });
  {
    const r = await spawnCli(["--origin", site.origin, "--live"], { INDEXNOW_ENDPOINT: engine.endpoint, QA_INDEXNOW_ALLOW_LOCAL: "1" });
    check(r.code === 3, "process: a rejected batch gives exit 3", `exit ${r.code}`);
  }
  {
    const r = await spawnCli(["--ping-sitemap-only"], {});
    check(r.code === 1 && /bestaat niet meer/.test(r.out), "process: --ping-sitemap-only exits 1 and explains");
  }

  // ═══ 6. the workflow ══════════════════════════════════════════════════════
  note(".github/workflows/seo-submit.yml");
  type Step = { name?: string; run?: string; uses?: string; env?: Record<string, string> };
  type Workflow = { on?: Record<string, unknown>; permissions?: Record<string, string>; jobs?: Record<string, { steps: Step[] }> };
  const wfPath = path.join(ROOT, ".github", "workflows", "seo-submit.yml");
  const wfText = fs.readFileSync(wfPath, "utf8");
  let wf: Workflow | null = null;
  try {
    wf = (createRequire(path.join(ROOT, "package.json"))("js-yaml") as { load: (s: string) => unknown }).load(wfText) as Workflow;
  } catch {
    const py = spawnSync("python3", ["-c", "import json,sys,yaml; print(json.dumps(yaml.safe_load(sys.stdin.read())))"], { input: wfText, encoding: "utf8" });
    if (py.status === 0) wf = JSON.parse(py.stdout) as Workflow;
  }
  check(!!wf, "seo-submit.yml parses as YAML (js-yaml, else PyYAML)");
  if (wf) {
    const on = (wf.on ?? (wf as unknown as { true?: Record<string, unknown> }).true ?? {}) as Record<string, { inputs?: Record<string, { default?: unknown; type?: string }> }>;
    check(JSON.stringify(Object.keys(on)) === JSON.stringify(["workflow_dispatch"]), "triggers: workflow_dispatch and nothing else (no push, pull_request or schedule)", JSON.stringify(Object.keys(on)));
    const inputs = on.workflow_dispatch?.inputs ?? {};
    check(JSON.stringify(Object.keys(inputs)) === JSON.stringify(["origin", "live"]) && inputs.origin?.default === "" && inputs.live?.type === "boolean" && inputs.live?.default === false, "inputs: origin (default empty) and live (boolean, default false)", JSON.stringify(inputs));
    check(JSON.stringify(wf.permissions) === JSON.stringify({ contents: "read" }), "permissions: contents read, nothing more", JSON.stringify(wf.permissions));
    const conc = (wf as unknown as { concurrency?: { group?: string; "cancel-in-progress"?: boolean } }).concurrency;
    check(conc?.group === "seo-submit" && conc["cancel-in-progress"] === false, "concurrency: one run at a time (group seo-submit); a submission that is running is never cancelled", JSON.stringify(conc));
    check(!/\bsecrets\./.test(wfText) && !/\$\{\{\s*secrets/.test(wfText), "no secret is used (the key is public by design)");
    const steps = Object.values(wf.jobs ?? {})[0]?.steps ?? [];
    const submit = steps.find((s) => /seo-submit\.ts/.test(s.run ?? ""));
    check(!!submit && !/\$\{\{/.test(submit.run ?? ""), "the script step takes the inputs from the environment, not pasted into the shell text");
    const code = (submit?.run ?? "").split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
    check((code.match(/--live/g) ?? []).length === 1 && /args\+=\(--live\)/.test(code) && !/args=\(--origin "\$origin" --live/.test(code), "--live appears once, only in the branch where LIVE is true");
    // Run the step's shell text with a fake npx, in the four situations that matter.
    const bin = fs.mkdtempSync(path.join(tmp, "bin-"));
    const log = path.join(tmp, "npx.log");
    fs.writeFileSync(path.join(bin, "npx"), `#!/bin/sh\necho "$*" >> "${log}"\n`, { mode: 0o755 });
    const runWf = (env: Record<string, string>) => {
      fs.rmSync(log, { force: true });
      const summary = path.join(tmp, "summary.md");
      fs.rmSync(summary, { force: true });
      const r = spawnSync("bash", ["-eo", "pipefail", "-c", submit?.run ?? "exit 99"], { env: { PATH: `${bin}:${process.env.PATH}`, HOME: tmp, GITHUB_STEP_SUMMARY: summary, GITHUB_REF: "refs/heads/main", INPUT_ORIGIN: "", VAR_PUBLIC_SITE_URL: "", VAR_NEXT_PUBLIC_APP_URL: "", LIVE: "false", ...env } as unknown as NodeJS.ProcessEnv, encoding: "utf8" });
      return { code: r.status, called: fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim() : "", out: r.stdout + r.stderr, summary: fs.existsSync(summary) ? fs.readFileSync(summary, "utf8") : "" };
    };
    const w1 = runWf({ INPUT_ORIGIN: "https://wasfix.nl" });
    check(w1.code === 0 && w1.called === "tsx scripts/seo-submit.ts --origin https://wasfix.nl" && /droogloop/.test(w1.summary), "workflow: live not ticked = the dry run (no --live), summary says dry run", JSON.stringify(w1));
    const w2 = runWf({ INPUT_ORIGIN: "https://wasfix.nl", LIVE: "true" });
    check(w2.code === 0 && w2.called === "tsx scripts/seo-submit.ts --origin https://wasfix.nl --live" && /LIVE/.test(w2.summary), "workflow: live ticked on main = --live", JSON.stringify(w2));
    const w3 = runWf({ INPUT_ORIGIN: "https://wasfix.nl", LIVE: "true", GITHUB_REF: "refs/heads/feature-x" });
    check(w3.code === 1 && w3.called === "" && /alleen vanaf main/.test(w3.out), "workflow: live from another branch is refused before the script runs", JSON.stringify(w3));
    const w4 = runWf({ VAR_PUBLIC_SITE_URL: "https://a.example.nl", VAR_NEXT_PUBLIC_APP_URL: "https://b.example.nl" });
    check(w4.called === "tsx scripts/seo-submit.ts --origin https://a.example.nl", "workflow: empty origin = PUBLIC_SITE_URL first", JSON.stringify(w4));
    const w5 = runWf({ VAR_NEXT_PUBLIC_APP_URL: "https://b.example.nl" });
    check(w5.called === "tsx scripts/seo-submit.ts --origin https://b.example.nl", "workflow: ...then NEXT_PUBLIC_APP_URL");
    const w6 = runWf({});
    check(w6.code === 1 && w6.called === "" && /Geen adres/.test(w6.out), "workflow: no origin anywhere = an error, the script is not run");
    const w7 = runWf({ INPUT_ORIGIN: "https://wasfix.nl; echo pwned", LIVE: "false" });
    check(w7.called === "tsx scripts/seo-submit.ts --origin https://wasfix.nl; echo pwned" && !/pwned\n/.test(w7.out.replace(/--origin.*/, "")), "workflow: an origin with shell syntax stays ONE argument (no injection)", JSON.stringify(w7));
    check(steps.some((s) => /actions\/checkout@v4/.test(s.uses ?? "")) && steps.some((s) => /actions\/setup-node@v4/.test(s.uses ?? "")) && steps.some((s) => (s.run ?? "").trim() === "npm ci"), "it checks out, sets up Node and installs (tsx comes from the repository)");
  }

  // ═══ 7. the code and the documents ════════════════════════════════════════
  note("the code never reaches anywhere but the engines");
  const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/(^|[^:"'`])\/\/.*$/, "$1")).join("\n");
  const codeFiles = ["scripts/lib/indexnow.ts", "scripts/seo-submit.ts"].map((f) => ({ f, code: stripComments(fs.readFileSync(path.join(ROOT, f), "utf8")) }));
  const hosts = new Set(codeFiles.flatMap(({ code }) => [...code.matchAll(/https?:\/\/([a-z0-9][a-z0-9.-]*)/gi)].map((m) => m[1].toLowerCase())));
  const allowedHosts = new Set(["api.indexnow.org", "www.bing.com", "yandex.com", "search.seznam.cz", "searchadvisor.naver.com", "127.0.0.1", "localhost", "elsewhere.example"]);
  const stray = [...hosts].filter((h) => !allowedHosts.has(h));
  check(stray.length === 0, "the only hosts named in the code are the five engine endpoints (and loopback)", `also: ${stray.join(", ")}`);
  check(codeFiles.every(({ code }) => !/\/ping\b|ping\?sitemap|indexing\.googleapis|google\.com|\.vercel\.app\//i.test(code)), "no sitemap ping and no Google Indexing API call anywhere in the code");
  check(codeFiles.every(({ code }) => !/\b(sk|pk|rk)_(live|test)_|AIza|whsec_/.test(code)), "no key-shaped literal in the code");
  const forbiddenNames = new RegExp(["cla" + "ude", "anthro" + "pic", "gp" + "t-", "gem" + "ini", "open" + "ai"].join("|"), "i");
  const ownFiles = ["scripts/lib/indexnow.ts", "scripts/seo-submit.ts", "scripts/qa-indexnow.ts", ".github/workflows/seo-submit.yml"];
  check(ownFiles.every((f) => !forbiddenNames.test(fs.readFileSync(path.join(ROOT, f), "utf8"))), "no model name or AI-identity string in the files of this bundle");

  note("the middleware does not touch the files a crawler reads as they are");
  {
    // src/middleware.ts config.matcher: the one string literal that starts with "/((?!". Read as text (importing the middleware would load Clerk).
    const middlewareSource = fs.readFileSync(path.join(ROOT, "src/middleware.ts"), "utf8");
    const literal = /"(\/\(\(\?![^"\n]*)"/.exec(middlewareSource)?.[1];
    let matches: ((p: string) => boolean) | null = null;
    try {
      const re = literal ? new RegExp(`^${JSON.parse(`"${literal}"`) as string}$`) : null;
      matches = re ? (pathname) => re.test(pathname) : null;
    } catch {
      matches = null;
    }
    check(matches !== null, "the middleware matcher was found and read", literal ?? "no matcher literal in src/middleware.ts");
    if (matches) {
      const files = [`/${KEY}.txt`, "/robots.txt", "/sitemap.xml", "/sitemap-2.xml"];
      check(files.every((f) => !matches!(f)), "the key file, robots.txt and the sitemap skip the middleware: no locale-hint cookie, no redirect to /<locale>/... when NEXT_PUBLIC_FEATURE_I18N is on, no Clerk run per crawler fetch", JSON.stringify(files.filter((f) => matches!(f))));
      check(["/", "/onderdelen", "/api/orders/abc.pdf", "/api/x/report.txt", "/bosch-wasmachine-reparatie", "/admin"].every((f) => matches!(f)) && ["/_next/static/a.js", "/logo.png", "/offline.html"].every((f) => !matches!(f)), "...while pages, the API (also a path that ends in .txt under /api) and the private areas still go through it, and the earlier exclusions still hold");
    }
  }

  note("documents");
  const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
  const readme = read("README.md");
  // Line breaks in the documents must not decide whether a sentence is found: compare with whitespace folded.
  const flat = (s: string) => s.replace(/\s+/g, " ");
  const indexeren = flat(/^#{2,3} Indexeren[\s\S]*?(?=^## )/m.exec(readme)?.[0] ?? "");
  check(indexeren.length > 1500, "README has an 'Indexeren' section", `${indexeren.length} characters`);
  check(/Search Console/.test(indexeren) && /DNS/.test(indexeren) && /sitemap\.xml/.test(indexeren) && /URL Inspection|URL-inspectie/i.test(indexeren) && /Bing Webmaster Tools/.test(indexeren) && /IndexNow/.test(indexeren) && /--live/.test(indexeren) && /draai eerst de droogloop, dan pas live/i.test(indexeren), "README Indexeren: Search Console (DNS property), the sitemap, URL Inspection by hand, Bing Webmaster Tools, IndexNow dry run then live");
  check(/Google[^.]*\bniet\b[^.]*IndexNow|IndexNow[^.]*\bniet\b[^.]*Google/i.test(indexeren) && /Indexing API/.test(indexeren) && /ping/i.test(indexeren), "README Indexeren: Google is not reached by IndexNow, the Indexing API is not for these pages, the sitemap ping is retired");
  check(/Vanuit deze code is \*\*niets ingediend\*\* bij Google, Bing of IndexNow/.test(indexeren) && /geen netwerk naar die diensten/i.test(indexeren), "README Indexeren: states that nothing has been submitted from here and why");
  check(/volgt\s+na\s+inschrijving/.test(indexeren) && /preview|staging/i.test(indexeren), "README Indexeren: do not submit before the company data is in, never staging/preview");
  const blocked = flat(/\*\*Indexeren aanvragen \(D24[\s\S]*?(?=^## )/m.exec(read("BLOCKED.md"))?.[0] ?? "");
  check(/Indexeren aanvragen \(D24/.test(blocked) && /Search Console/.test(blocked) && /Bing Webmaster Tools/.test(blocked) && /sitemap\.xml/.test(blocked) && /IndexNow/.test(blocked) && /niets ingediend/.test(blocked) && /droogloop/.test(blocked) && /alleen vanaf `main`/.test(blocked), "BLOCKED.md has the indexing steps as owner actions (nothing submitted yet, dry run first, live only from main)");
  const decisions = read("DECISIONS.md");
  const d24 = flat(/^## [^\n]*D24[^\n]*\n[\s\S]*?(?=^## )/m.exec(decisions)?.[0] ?? "");
  check(d24.length > 2000 && /IndexNow/.test(d24) && /Indexing API/.test(d24) && /niets (ingediend|verstuurd)|Nothing was (submitted|sent)/i.test(d24) && /dry run|droogloop/i.test(d24) && /public by design|openbaar/i.test(d24), "DECISIONS.md D24: why IndexNow and the sitemap, the Indexing API, the public key, the dry-run default, and that nothing was submitted");
  check(/Een lijst die niet te lezen of leeg is[^.]*exitcode 2/.test(indexeren) && !/exitcode 1[^.]*minstens één URL/.test(indexeren), "README Indexeren: an unreadable or empty list is exit 2 (not 1), and the exit-1 sentence no longer lists the sitemap");
  check(/\/qr\/\*/.test(indexeren) && /technisch bestand/.test(indexeren) && /Een pagina die alleen via zijn eigen metadata noindex is/.test(indexeren), "README Indexeren: names the families the filter knows (city pages, /qr/*, technical files) and the one thing it cannot know");
  check(/is exit 2 and not 1, live or not/.test(d24) && !/and the list has at least one URL/.test(d24), "D24: an empty or unreadable list is exit 2, not one of the exit-1 refusals");
  check(/noindexFamilyPrefixes/.test(d24) && /`\/qr\/\*`/.test(d24) && /technical `\.txt` or `\.xml` file/.test(d24), "D24: the filter's noindex families (read from the header rules, /qr/*) and technical files are documented");
  check(/NEXT_PUBLIC_FEATURE_I18N/.test(d24) && /with the flag on/i.test(d24) && /txt\|xml/.test(d24) && /matcher/.test(d24) && /no longer/i.test(d24), "D24: the key file verification says what the i18n flag would have done, and that the middleware matcher now excludes txt and xml");
  const submitSrc = read("scripts/seo-submit.ts");
  const submitHeader = flat(submitSrc.slice(0, submitSrc.indexOf("import fs")).replace(/\n \* ?/g, " "));
  check(/the exit code is 2, live or not, and nothing is sent/.test(submitHeader) && !/and the list holds at least one URL/.test(submitHeader) && /technical file/.test(submitHeader), "seo-submit.ts header: the list rules are exit 2 and the refusal rules exit 1 (the same as the tables), and technical files are named");
  const envExample = read(".env.example");
  check(/^#?\s*INDEXNOW_KEY=/m.test(envExample) && /^#?\s*INDEXNOW_ENDPOINT=/m.test(envExample), ".env.example documents INDEXNOW_KEY and INDEXNOW_ENDPOINT");

  // ═══ 8. a running production server (optional) ════════════════════════════
  const BASE = (process.env.QA_BASE_URL ?? "").replace(/\/+$/, "");
  if (!BASE) {
    if (process.env.QA_REQUIRE_SERVER === "1") check(false, "", "QA_BASE_URL is not set and QA_REQUIRE_SERVER=1");
    else note("SKIPPED (not passed): the key file and the real sitemap on a running production server. Set QA_BASE_URL=http://localhost:3000 (a `next start` of a production build).");
  } else {
    note(`a running production server at ${BASE}`);
    const get = async (p: string) => (await fetch(`${BASE}${p}`, { redirect: "manual" }));
    if (real.ok) {
      const r = await get(`/${real.key}.txt`);
      const body = await r.text();
      check(r.status === 200 && body === real.key, "GET /<key>.txt answers 200 with exactly the key", `HTTP ${r.status}, ${body.length} characters`);
      check(/^text\/plain/i.test(r.headers.get("content-type") ?? ""), "...as text/plain", r.headers.get("content-type") ?? "-");
      check(!r.headers.get("location") && !/noindex/i.test(r.headers.get("x-robots-tag") ?? "") && r.headers.get("set-cookie") === null, "...with no redirect, no noindex header and no cookie", JSON.stringify([...r.headers.entries()]));
      // A visitor whose country and language map to another locale gets a 30-day hint cookie from the middleware on a page (and, with
      // NEXT_PUBLIC_FEATURE_I18N on, a redirect to /de/...). The files a crawler reads must not run through it. The control: the same
      // request for a page DOES get the cookie, so this check can see it.
      {
        const german = { "accept-language": "de-DE,de;q=0.9", "x-vercel-ip-country": "DE" };
        const ask = (p: string) => fetch(`${BASE}${p}`, { redirect: "manual", headers: german });
        const page = await ask("/");
        const control = /wasfix-locale-suggested=de/.test(page.headers.get("set-cookie") ?? "");
        const rows = await Promise.all([`/${real.key}.txt`, "/robots.txt", "/sitemap.xml"].map(async (p) => { const r = await ask(p); await r.text(); return { p, status: r.status, cookie: r.headers.get("set-cookie"), location: r.headers.get("location") }; }));
        check(control, "control: a page requested from Germany gets the locale-hint cookie from the middleware (so the next check can see one)", `set-cookie: ${page.headers.get("set-cookie")}`);
        check(rows.every((r) => r.status === 200 && r.cookie === null && r.location === null), "the key file, robots.txt and sitemap.xml requested from Germany answer 200 with no cookie and no redirect: the middleware does not run on them", JSON.stringify(rows));
      }
      const robots = await (await get("/robots.txt")).text();
      const shutOut = ["*", "bingbot", "YandexBot", "Googlebot", "SeznamBot", "Yeti", "IndexNow"].filter((ua) => !nx.robotsAllows(robots, ua, `/${real.key}.txt`));
      check(shutOut.length === 0, "robots.txt does not shut the key file out for any engine that reads it (the AI-crawler group does not count)", `disallowed for: ${shutOut.join(", ")}`);
      const sm = /^Sitemap:\s*(\S+)/im.exec(robots)?.[1];
      const siteOrigin = sm ? new URL(sm).origin : null;
      const po = siteOrigin ? nx.parseOrigin(siteOrigin) : null;
      if (po?.ok) {
        // The site's own address is its production domain, which this server does not answer to: map it to BASE.
        const mapped: nx.HttpGet = (url) => nx.httpGet(url.replace(po.value.origin, BASE));
        const sitemapRaw = await nx.readSitemap(po.value, mapped);
        check(sitemapRaw.ok && sitemapRaw.urls.length > 0, "the real sitemap is read and parsed by the tool", sitemapRaw.ok ? "" : sitemapRaw.reason);
        if (sitemapRaw.ok) {
          const filt = nx.filterUrls(sitemapRaw.urls, po.value);
          check(filt.dropped.length === 0 && filt.kept.length === sitemapRaw.urls.length && filt.kept.every((k, i) => k === sitemapRaw.urls[i]), "the tool's filter drops NOTHING from the real sitemap and changes no address: the submit list is the same list the sitemap publishes", `${sitemapRaw.urls.length} in the sitemap, ${filt.kept.length} kept, dropped: ${JSON.stringify(filt.counts)}`);
          engine.reset();
          const out: string[] = [];
          const code = await run(["--origin", po.value.origin, "--live"], { INDEXNOW_ENDPOINT: engine.endpoint, QA_INDEXNOW_BACKOFF_MS: "1" }, { out: (l) => out.push(l), err: (l) => out.push(l) }, { get: mapped, sleep: async () => undefined });
          printed.push(out.join("\n"));
          const sent = engine.posts.flatMap((q) => (q.body?.urlList as string[] | undefined) ?? []);
          check(code === 0 && engine.posts.length === Math.ceil(filt.kept.length / 10000) && JSON.stringify(sent) === JSON.stringify(filt.kept), "a live run against the real sitemap and the real key file (fake engine) sends exactly the sitemap's URLs", `exit ${code}: ${out.join(" | ").slice(0, 400)}`);
          check(engine.posts.every((q) => q.body?.keyLocation === `${po.value.origin}/${real.key}.txt` && q.body.host === po.value.hostname), "...with the key location on the site's own domain");
        }
      } else check(false, "", "robots.txt names no usable Sitemap line, so the real sitemap cannot be read");
    }
  }

  // ═══ 9. the key is nowhere in what any run printed ════════════════════════
  note("the key in the output");
  const blob = printed.join("\n");
  check(blob.length > 1000 && !blob.includes(KEY) && !blob.includes(KEY2) && !(real.ok && blob.includes(real.key)), "none of the in-process runs printed a key (test keys and the repository key), although most of them used it", `${blob.length} characters inspected`);

  site.close();
  engine.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(finish());
}

// A crash must still print every check that ran, and fail: a guard that throws instead of answering is a finding too.
main().catch((e) => {
  check(false, "", `the suite crashed: ${e instanceof Error ? e.stack ?? e.message : String(e)}`.slice(0, 600));
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(finish());
});
