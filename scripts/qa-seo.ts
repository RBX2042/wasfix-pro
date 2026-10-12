/**
 * SEO readiness (bundle S, decision D23): is every page that should rank crawlable, indexable, self-canonical, with its
 * own title and description and structured data that the page backs; is every page that should not be indexed kept out
 * the same way in robots.txt, the robots tag, the X-Robots-Tag header and the sitemap; and does the sitemap list exactly
 * the first kind. It reads the running site like a crawler does. Nothing here is submitted to a search engine: no
 * network beyond QA_BASE_URL is touched.
 *
 *   QA_BASE_URL=http://localhost:3000 npx tsx scripts/qa-seo.ts
 *
 * Meant for a PRODUCTION server (`next build` + `next start`, with NEXT_PUBLIC_APP_URL set: the URLs it prints are on
 * that origin, which this script maps back to QA_BASE_URL when it fetches). Without QA_BASE_URL only the checks on the
 * helper modules and on the source tree run, and the HTTP half is reported as SKIPPED; QA_REQUIRE_SERVER=1 turns that
 * into a failure.
 *
 *   QA_SEO_FULL=1              crawl every URL of the sitemap (default: all static pages, plus the first 3 and every
 *                              12th of each dynamic family: parts, error codes, models, brands, guides, help, blog,
 *                              vs, brand repair pages)
 *   QA_SEO_SEED=n              shifts the "every 12th" window (n modulo 12), so successive runs cover other pages
 *   QA_SEO_STRICT_HEADINGS=1   a skipped heading level (h1 straight to h3) fails instead of being listed
 *   QA_EXPECT_GOOGLE_VERIFICATION / QA_EXPECT_BING_VERIFICATION
 *                              the token the server was built with: the home page must carry that tag
 *
 * Two parts run without a server: the helper modules and the source tree, and the deployment environments (robots.ts and
 * next.config.ts are loaded in child processes with VERCEL_ENV unset, production, preview and development: a preview
 * must answer Disallow: / and noindex everywhere, production must not).
 *
 * The crawl runs as Googlebot (smartphone), and a separate section fetches the dynamic pages and a filter variant as
 * every crawler that matters (Googlebot in four forms, Bingbot, Applebot, the link-preview bots): title, description,
 * canonical, Open Graph and the robots tag must be inside <head> for each of them, not streamed into <body>.
 *
 * The last section feeds sixteen defects to the same audit functions (a broken canonical, a duplicated title, a rating
 * without reviews, a noindex URL in the sitemap, a missing h1, a FAQPage nobody can read, a wrong price, a private path
 * robots.txt lets through, metadata that sits after </head>, and more) and fails when one of them is NOT caught by the
 * check that is named for it. The lists of paths that must stay private and of parameters that make a list page a
 * variant are written out below on purpose: a test that reads its expectation from the list it tests passes when
 * somebody deletes an entry from that list.
 *
 * In CI, right after "HTTP smoke test (production build, database)" and BEFORE "Checkout + storefront against the
 * production server" (qa-checkout creates and deletes catalogue parts, which this suite reads through the sitemap):
 *   QA_BASE_URL=http://localhost:3000 QA_REQUIRE_SERVER=1 npx tsx scripts/qa-seo.ts
 * and by hand before a release, against the live domain: QA_BASE_URL=https://<domein> QA_SEO_FULL=1 npx tsx scripts/qa-seo.ts
 *
 * When the owner flips CITY_PAGES_INDEXABLE in src/lib/seo.ts, flip EXPECT_CITY_PAGES_INDEXABLE below with it: the
 * check `city-switch-agrees-with-the-expectation` fails until both say the same, and says so.
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import { spawn } from "node:child_process";
import {
  CITY_PAGES_INDEXABLE,
  DESCRIPTION_MAX,
  DESCRIPTION_MIN,
  IMAGE_CACHE_CONTROL,
  LIST_FILTER_PARAMS,
  OG_LOCALE,
  PRIVATE_PATH_PREFIXES,
  SITEMAP_STATIC_PATHS,
  SITE_NAME,
  TITLE_MAX,
  TITLE_MIN,
  TITLE_SUFFIX,
  coveredBrands,
  indexability,
  isListVariant,
  isNonProductionDeployment,
  isPrivatePath,
  listMetadata,
  pageDescription,
  pageMetadata,
  pageTitle,
  privateHeaderSources,
  robotsMeta,
  stripBrandSuffix,
  variantHeaderRules,
  STATIC_NOINDEX_SOURCES,
  verificationMetadata,
} from "../src/lib/seo";
import { UNIVERSAL_BRAND, articleLd, breadcrumbLd, ldJson, organizationLd, productLd, websiteLd } from "../src/lib/json-ld";

const BASE = (process.env.QA_BASE_URL ?? "").replace(/\/+$/, "");
const FULL = process.env.QA_SEO_FULL === "1";
const SEED = Number.parseInt(process.env.QA_SEO_SEED ?? "0", 10) || 0;
const STRICT_HEADINGS = process.env.QA_SEO_STRICT_HEADINGS === "1";
// The crawl runs as Googlebot (smartphone). Next sends a dynamic page's title, description, canonical and robots tag
// blocking, inside <head>, only to the user agents on its htmlLimitedBots list; any other client may get them streamed
// into <body> after </head>. Next leaves Googlebot off that list, on the assumption that it renders the page and finds the
// tags again; a Chromium with a Googlebot user agent does not move them (measured on /contact, /onderdelen, /diagnose,
// /gidsen, see decision D23), and Google documents the canonical and the robots tag for <head>. next.config.ts therefore
// adds Googlebot to htmlLimitedBots; the checks `metadata-in-head` (every crawled page) and `crawler-gets-metadata-in-head`
// (the dynamic pages, for every crawler below) fail when a crawler is served the streamed form.
const UA_GOOGLEBOT = "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const UA = UA_GOOGLEBOT;
/** [name, user agent]: the crawlers whose view of <head> decides what is indexed or shown in a link preview. */
const CRAWLERS: Array<[string, string]> = [
  ["Googlebot smartphone", UA_GOOGLEBOT],
  ["Googlebot desktop", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"],
  ["Googlebot-Image", "Googlebot-Image/1.0"],
  ["Google-InspectionTool", "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36 (compatible; Google-InspectionTool/1.0)"],
  ["Bingbot", "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36"],
  ["Applebot", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.1 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)"],
  ["Twitterbot", "Twitterbot/1.0"],
  ["facebookexternalhit", "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"],
  ["Slackbot", "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)"],
];
/** An ordinary browser: it may get the streamed form, and must (the crawler rule costs nothing for visitors). */
const UA_BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const ROOT = path.resolve(__dirname, "..");

/**
 * The paths that must be private, written out here ON PURPOSE instead of read from src/lib/seo.ts: a test that takes
 * its expectation from the list it tests passes when somebody deletes a path from that list. Adding a private path to
 * seo.ts needs nothing here; removing one fails `private-list-keeps-the-expected-paths`.
 */
const EXPECTED_PRIVATE = ["/api/", "/admin", "/dashboard", "/monteur/dashboard", "/monteur/klanten", "/monteur/onderdelen", "/monteur/werkorders", "/monteur/instellingen", "/checkout", "/inloggen", "/registreren", "/upgrade", "/bestelling"];
const ALL_PRIVATE = [...new Set([...EXPECTED_PRIVATE, ...PRIVATE_PATH_PREFIXES])];
/** The static documents in public/ that carry a noindex header, written out like the lists above (STATIC_NOINDEX_SOURCES feeds the headers). */
const EXPECTED_STATIC_NOINDEX = ["/leadmagnets/:path*", "/offline.html"];
/**
 * The query parameters that turn a list page into a noindex variant, also written out: src/lib/seo.ts LIST_FILTER_PARAMS
 * feeds the page metadata and the X-Robots-Tag rules, and a parameter dropped from it would drop both at once.
 */
const EXPECTED_VARIANT_PARAMS: Record<string, string[]> = {
  "/onderdelen": ["q", "cat", "brand", "sort", "n"],
  "/foutcodes": ["q", "brand", "n"],
  "/gidsen": ["q", "difficulty"],
};
const ALL_VARIANT_PARAMS: Record<string, string[]> = Object.fromEntries(
  [...new Set([...Object.keys(EXPECTED_VARIANT_PARAMS), ...Object.keys(LIST_FILTER_PARAMS)])].map((p) => [
    p,
    [...new Set([...(EXPECTED_VARIANT_PARAMS[p] ?? []), ...(((LIST_FILTER_PARAMS as Record<string, readonly string[]>)[p]) ?? [])])],
  ]),
);
/** A value that makes the parameter real on the live page (the filter finds something or at least answers 200). */
const variantValue = (p: string, key: string) => ({ q: "pomp", cat: "PUMP", brand: "Bosch", sort: "prijs-op", n: p === "/foutcodes" ? "100" : "48", difficulty: "EASY" })[key] ?? "x";
/** The city pages are noindex while their copy is one template; the owner's switch is CITY_PAGES_INDEXABLE (src/lib/seo.ts). */
const EXPECT_CITY_PAGES_INDEXABLE: boolean = false;
/**
 * The brands in src/data/brands.json that have no catalogue (no error codes, machines or parts): their repair pages are
 * thin, noindex and out of the sitemap, yet the footer and /merken still link to them (open question to the owner of
 * those two files). Named here, not matched by pattern: a page that SHOULD be indexed and is not (Bosch, say) must still
 * fail `link-to-noindex-page`. `known-thin-brands-are-the-brands-without-a-sitemap-entry` keeps this list honest in both
 * directions (a brand that gains a catalogue has to leave it).
 */
const KNOWN_THIN_BRANDS = ["zanussi", "hotpoint", "candy", "haier", "panasonic"];
/** Private as THIS test understands it (the list above), not as src/lib/seo.ts does: the two are compared in the helper checks. */
const isPrivate = (pathname: string) => ALL_PRIVATE.some((p) => pathname === p.replace(/\/$/, "") || pathname.startsWith(p.endsWith("/") ? p : `${p}/`));

// ───────────────────────────── ledger: named checks, counted per subject ─────────────────────────────

class Ledger {
  readonly seen = new Map<string, number>();
  readonly failed = new Map<string, string[]>();
  readonly notes: string[] = [];
  rec(check: string, subject: string, cond: boolean, detail = ""): boolean {
    this.seen.set(check, (this.seen.get(check) ?? 0) + 1);
    if (!cond) {
      const list = this.failed.get(check) ?? [];
      list.push(detail ? `${subject} (${detail})` : subject);
      this.failed.set(check, list);
    }
    return cond;
  }
  failedChecks(): string[] {
    return [...this.failed.keys()];
  }
}

const L = new Ledger();
const sections: string[] = [];
const section = (name: string) => sections.push(name);
/** One-off check with its own wording (counts as one subject). */
const check = (name: string, cond: boolean, detail = "") => L.rec(name, "-", cond, detail);
const note = (text: string) => L.notes.push(text);

// ───────────────────────────── small helpers ─────────────────────────────

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try {
        return String.fromCodePoint(n);
      } catch {
        return m;
      }
    }
    return ENT[e.toLowerCase()] ?? m;
  });
}
const squash = (s: string) => s.replace(/[\s ]+/g, " ").trim();

function attrsOf(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const inner = tag.replace(/^<[a-zA-Z0-9]+/, "").replace(/\/?>$/, "");
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner))) out[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? "");
  return out;
}

type Facts = {
  lang: string | null;
  titles: string[];
  metas: Array<Record<string, string>>;
  links: Array<Record<string, string>>;
  headings: Array<{ level: number; text: string }>;
  ld: Array<{ value?: unknown; error?: string }>;
  anchors: Array<Record<string, string>>;
  imgs: Array<Record<string, string>>;
  text: string;
  /** Where </head> is, and where the title / canonical start: a crawler must find them in the head. */
  headEnd: number;
  titleAt: number;
  canonicalAt: number;
  descriptionAt: number;
  ogTitleAt: number;
  robotsAt: number;
};

function extract(html: string): Facts {
  const langM = /<html\b[^>]*\blang="([^"]*)"/i.exec(html);
  const titles = [...html.matchAll(/<title[^>]*>([\s\S]*?)<\/title>/gi)].map((m) => squash(decode(m[1])));
  const metas = [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => attrsOf(m[0]));
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => attrsOf(m[0]));
  const headings = [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map((m) => ({ level: Number(m[1]), text: squash(decode(m[2].replace(/<[^>]+>/g, " "))) }));
  const ld: Facts["ld"] = [];
  for (const m of html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      ld.push({ value: JSON.parse(m[1]) });
    } catch (e) {
      ld.push({ error: String(e) });
    }
  }
  const anchors = [...html.matchAll(/<a\b[^>]*>/gi)].map((m) => attrsOf(m[0]));
  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => attrsOf(m[0]));
  const text = squash(
    decode(
      html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
        .replace(/<template[\s\S]*?<\/template>/gi, " ")
        .replace(/<[^>]+>/g, " "),
    ),
  );
  const headEnd = html.search(/<\/head>/i);
  return { lang: langM ? langM[1] : null, titles, metas, links, headings, ld, anchors, imgs, text, headEnd, titleAt: html.search(/<title/i), canonicalAt: html.search(/<link[^>]*rel="canonical"/i), descriptionAt: html.search(/<meta[^>]*name="description"/i), ogTitleAt: html.search(/<meta[^>]*property="og:title"/i), robotsAt: html.search(/<meta[^>]*name="robots"/i) };
}

/**
 * The search-relevant tags that are NOT inside <head>. A dynamic page can have them streamed into <body> after </head>;
 * a crawler that reads only the head (or a rule that says "in the head") then sees none of them.
 */
function tagsOutsideHead(f: Facts, want: { canonical: boolean; robots: boolean }): string[] {
  const inHead = (at: number) => f.headEnd > 0 && at >= 0 && at < f.headEnd;
  const out: string[] = [];
  if (!inHead(f.titleAt)) out.push("title");
  if (!inHead(f.descriptionAt)) out.push("description");
  if (!inHead(f.ogTitleAt)) out.push("og:title");
  if (want.canonical && !inHead(f.canonicalAt)) out.push("canonical");
  if (want.robots && !inHead(f.robotsAt)) out.push("robots");
  return out;
}

const metaAll = (f: Facts, key: string) => f.metas.filter((m) => m.name === key || m.property === key).map((m) => m.content ?? "");
const linkAll = (f: Facts, rel: string) => f.links.filter((l) => l.rel === rel).map((l) => l.href ?? "");
const h1s = (f: Facts) => f.headings.filter((h) => h.level === 1);

type Resp = { url: string; status: number; headers: Record<string, string>; location: string | null; body: string };

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

// ───────────────────────────── robots.txt: parse and match like a crawler ─────────────────────────────

type RobotsGroup = { agents: string[]; rules: Array<{ allow: boolean; pattern: string }> };
function parseRobots(txt: string): { groups: RobotsGroup[]; sitemaps: string[] } {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let cur: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const i = line.indexOf(":");
    if (i < 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const val = line.slice(i + 1).trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [] };
        groups.push(cur);
      }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else if (key === "allow" || key === "disallow") {
      lastWasAgent = false;
      if (cur && val !== "") cur.rules.push({ allow: key === "allow", pattern: val });
    } else if (key === "sitemap") {
      sitemaps.push(val);
    } else {
      lastWasAgent = false;
    }
  }
  return { groups, sitemaps };
}
function patternToRegex(p: string): RegExp {
  const esc = p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${esc.endsWith("\\$") ? `${esc.slice(0, -2)}$` : esc}`);
}
function pickGroup(groups: RobotsGroup[], agent: string): RobotsGroup | null {
  const a = agent.toLowerCase();
  let named: RobotsGroup | null = null;
  let namedLen = 0;
  let star: RobotsGroup | null = null;
  for (const g of groups) {
    for (const token of g.agents) {
      if (token === "*") star = star ?? g;
      else if (a.includes(token) && token.length > namedLen) {
        named = g;
        namedLen = token.length;
      }
    }
  }
  return named ?? star;
}
/** What a parser that stops at the FIRST matching rule concludes (Python's urllib.robotparser, older tools). */
function robotsAllowsFirstMatch(groups: RobotsGroup[], agent: string, pathWithQuery: string): boolean {
  const best = pickGroup(groups, agent);
  if (!best) return true;
  for (const r of best.rules) if (patternToRegex(r.pattern).test(pathWithQuery)) return r.allow;
  return true;
}
/** Google's rule: the most specific user-agent group, then the longest matching pattern; Allow wins a tie. */
function robotsAllows(groups: RobotsGroup[], agent: string, pathWithQuery: string): boolean {
  const best = pickGroup(groups, agent);
  if (!best) return true;
  let verdict = true;
  let len = -1;
  for (const r of best.rules) {
    if (patternToRegex(r.pattern).test(pathWithQuery)) {
      const l = r.pattern.length;
      if (l > len || (l === len && r.allow)) {
        verdict = r.allow;
        len = l;
      }
    }
  }
  return verdict;
}

// ───────────────────────────── the audit functions (shared by the real run and the mutation proofs) ─────────────────────────────

type PageCtx = {
  /** The URL as the sitemap names it (on the public origin). */
  loc: string;
  origin: string;
  rootDescription: string | null;
  robots: RobotsGroup[];
  family: string;
};

const sameUrl = (a: string, b: string) => a.replace(/\/$/, "") === b.replace(/\/$/, "");
const isNoindex = (f: Facts, headers: Record<string, string>) =>
  metaAll(f, "robots").some((c) => /\b(noindex|none)\b/i.test(c)) || /\b(noindex|none)\b/i.test(headers["x-robots-tag"] ?? "");

function auditPage(l: Ledger, resp: Resp, f: Facts, ctx: PageCtx): void {
  const u = ctx.loc;
  const at = new URL(u).pathname + new URL(u).search;
  l.rec("status-200", u, resp.status === 200, `HTTP ${resp.status}`);
  l.rec("no-redirect", u, resp.location === null, `-> ${resp.location}`);
  l.rec("html-response", u, /text\/html/i.test(resp.headers["content-type"] ?? ""));
  l.rec("no-soft-404", u, !/pagina niet gevonden/i.test(f.text.slice(0, 4000)) && !h1s(f).some((h) => /niet gevonden/i.test(h.text)), "a 200 that says 'niet gevonden'");
  l.rec("indexable", u, !isNoindex(f, resp.headers), `robots meta ${JSON.stringify(metaAll(f, "robots"))}, header ${resp.headers["x-robots-tag"] ?? "-"}`);
  l.rec("robots-allowed", u, robotsAllows(ctx.robots, "Googlebot", at), "disallowed in robots.txt but listed in the sitemap");
  l.rec("lang-nl", u, f.lang === "nl", `lang=${f.lang}`);
  const outside = tagsOutsideHead(f, { canonical: true, robots: false });
  l.rec("metadata-in-head", u, outside.length === 0, `not inside <head>: ${outside.join(", ")}`);

  // title
  const title = f.titles[0] ?? "";
  l.rec("title-single", u, f.titles.length === 1 && title.length > 0, `${f.titles.length} <title> tags`);
  l.rec("title-length", u, title.length >= TITLE_MIN && title.length <= TITLE_MAX, `${title.length}: ${title}`);
  l.rec("title-brand-once", u, (title.match(/wasfix pro/gi) ?? []).length <= 1, title);
  if (title.endsWith("…")) l.notes.push(`title cut at a word boundary to fit ${TITLE_MAX} characters: ${u}`);

  // description
  const desc = metaAll(f, "description");
  l.rec("description-single", u, desc.length === 1 && desc[0].trim().length > 0, `${desc.length} description tags`);
  const d = desc[0] ?? "";
  l.rec("description-length", u, d.length >= DESCRIPTION_MIN && d.length <= DESCRIPTION_MAX, `${d.length}: ${d.slice(0, 80)}`);
  l.rec("description-not-generic", u, !ctx.rootDescription || d !== ctx.rootDescription, "the site-wide default description");
  // The absolute promise "nooit meer een verkeerd onderdeel" was cut from the /monteur description by D23 and stayed in its h1, the line
  // a snippet is built from. An AI indication cannot promise "never again", so no title, description or h1 may.
  const promises = [title, d, ...h1s(f).map((h) => h.text)].filter((t) => /\bnooit meer\b/i.test(t));
  l.rec("no-never-again-promise-in-title-description-or-h1", u, promises.length === 0, promises.join(" | ").slice(0, 120));
  // The /contact description is built once for both states of the page (company details configured or still to follow): it must not promise
  // the details "zodra de inschrijving rond is" and then sit above a page that prints them.
  if (new URL(u).pathname === "/contact") l.rec("contact-description-is-true-in-both-states", u, !/inschrijving|zodra|volgt/i.test(d), d.slice(0, 120));

  // canonical
  const canon = linkAll(f, "canonical");
  l.rec("canonical-single", u, canon.length === 1, `${canon.length} canonical tags`);
  const c = canon[0] ?? "";
  l.rec("canonical-self", u, canon.length === 1 && sameUrl(c, u), `canonical ${c}`);
  l.rec("canonical-clean", u, !/[?#]/.test(c) && c.startsWith(`${ctx.origin}/`) || c === ctx.origin, `canonical ${c}`);

  // headings
  const one = h1s(f);
  l.rec("one-h1", u, one.length === 1 && one[0].text.length > 0, `${one.length} h1`);
  let skipped = "";
  let prev = 0;
  for (const h of f.headings) {
    if (prev && h.level > prev + 1 && !skipped) skipped = `h${prev} -> h${h.level} "${h.text.slice(0, 30)}"`;
    prev = h.level;
  }
  if (STRICT_HEADINGS) l.rec("heading-order", u, skipped === "", skipped);
  else if (skipped) l.notes.push(`heading level skipped on ${u}: ${skipped}`);

  // Open Graph and Twitter
  const og = (k: string) => metaAll(f, k)[0] ?? "";
  l.rec("og-title", u, og("og:title").length > 0);
  l.rec("og-description", u, og("og:description").length > 0);
  l.rec("og-url", u, sameUrl(og("og:url"), c || u), `og:url ${og("og:url")} vs canonical ${c}`);
  l.rec("og-type", u, ["website", "article"].includes(og("og:type")), og("og:type"));
  l.rec("og-locale", u, og("og:locale") === OG_LOCALE, og("og:locale"));
  l.rec("og-site-name", u, og("og:site_name") === SITE_NAME, og("og:site_name"));
  const ogImage = og("og:image");
  l.rec("og-image", u, /^https?:\/\//.test(ogImage) && !/placehold/i.test(ogImage), ogImage);
  l.rec("og-image-size", u, Number(og("og:image:width")) > 0 && Number(og("og:image:height")) > 0 || !ogImage.startsWith(ctx.origin), "og:image:width/height missing for our own card");
  l.rec("twitter-card", u, og("twitter:card") === "summary_large_image", og("twitter:card"));
  l.rec("twitter-text", u, og("twitter:title").length > 0 && og("twitter:description").length > 0);
  l.rec("twitter-image", u, /^https?:\/\//.test(og("twitter:image")), og("twitter:image"));

  // images
  for (const img of f.imgs) {
    const src = (img.src ?? "").slice(0, 70);
    l.rec("img-alt", `${u} ${src}`, img.alt !== undefined, "no alt attribute");
    l.rec("img-dimensions", `${u} ${src}`, Boolean(img.width && img.height) || img["data-nimg"] === "fill", "no width/height and not a fill image");
  }

  auditJsonLd(l, resp, f, ctx);
}

// ───────────────────────────── structured data: parse, then check it against what the page shows ─────────────────────────────

const ALLOWED_TYPES = new Set(["Organization", "WebSite", "SoftwareApplication", "WebApplication", "Service", "Product", "BreadcrumbList", "TechArticle", "Article", "HowTo"]);
const PLACEHOLDER = /voorbeeld|placeholder|example\.|xxxx|0000000|in oprichting|jouw-domein|tbd|lorem/i;

type Node = Record<string, unknown>;
function nodesOf(f: Facts): Node[] {
  const out: Node[] = [];
  for (const b of f.ld) {
    if (!b.value) continue;
    for (const n of Array.isArray(b.value) ? b.value : [b.value]) if (n && typeof n === "object") out.push(n as Node);
  }
  return out;
}
const typeOf = (n: Node) => String(n["@type"] ?? "");
function walk(value: unknown, visit: (node: Node, key: string) => void, key = ""): void {
  if (Array.isArray(value)) value.forEach((v) => walk(v, visit, key));
  else if (value && typeof value === "object") {
    visit(value as Node, key);
    for (const [k, v] of Object.entries(value as Node)) walk(v, visit, k);
  }
}
const money = (n: number) => squash(new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(n));

function auditJsonLd(l: Ledger, resp: Resp, f: Facts, ctx: PageCtx): void {
  const u = ctx.loc;
  const text = f.text;
  l.rec("jsonld-parses", u, f.ld.every((b) => !b.error), f.ld.find((b) => b.error)?.error ?? "");
  const nodes = nodesOf(f);
  for (const n of nodes) {
    l.rec("jsonld-context", u, n["@context"] === "https://schema.org", String(n["@context"]));
    l.rec("jsonld-known-type", u, ALLOWED_TYPES.has(typeOf(n)), `unreviewed @type ${typeOf(n)}: add its truthfulness rule to scripts/qa-seo.ts first`);
  }

  // Nothing a search engine reads may point at a placeholder tile or a private page.
  const raw = JSON.stringify(nodes);
  l.rec("jsonld-no-placeholder-image", u, !/placehold\.co|via\.placeholder|dummyimage/i.test(raw));
  walk(nodes, (node, key) => {
    for (const k of ["url", "item", "target", "@id", "logo", "merchantReturnLink"]) {
      const v = node[k];
      if (typeof v === "string" && /^https?:\/\//.test(v)) {
        const p = new URL(v.replace("{search_term_string}", "x"));
        l.rec("jsonld-url-public", `${u} ${k}`, p.origin === ctx.origin && !isPrivate(p.pathname), `${v} (${key})`);
      }
    }
  });

  // Ratings and reviews only with reviews the page prints.
  let rating = false;
  const reviews: Node[] = [];
  walk(nodes, (node) => {
    if (typeOf(node) === "AggregateRating") rating = true;
    if (typeOf(node) === "Review") reviews.push(node);
  });
  if (rating || reviews.length > 0) {
    const bodies = reviews.map((r) => squash(String(r.reviewBody ?? "")).slice(0, 40));
    l.rec("jsonld-rating-needs-reviews", u, reviews.length > 0 && bodies.every((b) => b.length > 0 && text.includes(b)), "AggregateRating/Review in the markup without the review text on the page");
  } else {
    l.rec("jsonld-rating-needs-reviews", u, true);
  }
  l.rec("jsonld-no-fake-rating-keys", u, rating || reviews.length > 0 || !/"(ratingValue|reviewCount|ratingCount|bestRating)"/.test(raw), "rating fields outside an AggregateRating/Review");

  // FAQPage: every question printed.
  for (const n of nodes) {
    if (typeOf(n) !== "FAQPage") continue;
    const qs = (Array.isArray(n.mainEntity) ? n.mainEntity : []) as Node[];
    l.rec("jsonld-faq-visible", u, qs.length > 0 && qs.every((q) => text.includes(squash(String(q.name ?? "")))), "a FAQPage question that is not printed on the page");
  }

  // Dates: ISO, not in the future, and printed.
  walk(nodes, (node) => {
    for (const k of ["datePublished", "dateModified"]) {
      const v = node[k];
      if (typeof v === "string") l.rec("jsonld-date-valid", `${u} ${k}`, !Number.isNaN(Date.parse(v)) && Date.parse(v) <= Date.now() + 86_400_000, v);
    }
  });

  // Breadcrumbs: consecutive positions, linked crumbs are real pages, the names are on the page.
  for (const n of nodes.filter((x) => typeOf(x) === "BreadcrumbList")) {
    const items = (Array.isArray(n.itemListElement) ? n.itemListElement : []) as Node[];
    l.rec("breadcrumb-positions", u, items.length >= 1 && items.every((it, i) => it.position === i + 1), JSON.stringify(items.map((i) => i.position)));
    items.forEach((it, i) => {
      const name = squash(String(it.name ?? ""));
      l.rec("breadcrumb-name-visible", `${u} ${name}`, name.length > 0 && text.includes(name), "crumb name is not on the page");
      if (typeof it.item === "string") {
        const p = new URL(it.item);
        l.rec("breadcrumb-linked-visible", `${u} ${name}`, f.anchors.some((a) => a.href && sameUrl(new URL(a.href, u).pathname, p.pathname)), "the page shows no link to this crumb");
        pendingBreadcrumbTargets.add(it.item);
      } else {
        l.rec("breadcrumb-last-is-page", `${u} ${name}`, i === items.length - 1, "only the last crumb may omit its address");
      }
    });
  }

  // Product / Offer: the database's price and stock, as printed.
  for (const n of nodes.filter((x) => typeOf(x) === "Product")) {
    const offer = (n.offers ?? {}) as Node;
    const price = Number(offer.price);
    const sku = decodeURIComponent(new URL(u).pathname.split("/").pop() ?? "");
    l.rec("product-sku-matches-url", u, n.sku === sku, `sku ${String(n.sku)}`);
    l.rec("product-name-is-h1", u, squash(String(n.name)) === (h1s(f)[0]?.text ?? ""), `${String(n.name)} vs ${h1s(f)[0]?.text}`);
    l.rec("product-price-format", u, /^\d+\.\d{2}$/.test(String(offer.price)) && offer.priceCurrency === "EUR", `${String(offer.price)} ${String(offer.priceCurrency)}`);
    l.rec("product-price-visible", u, Number.isFinite(price) && text.replace(/ /g, " ").includes(money(price)), `${money(price)} is not printed on the page`);
    const avail = String(offer.availability);
    const sold = /Tijdelijk uitverkocht/.test(text);
    const stocked = /Op voorraad|Beperkt voorradig/.test(text);
    l.rec("product-availability-visible", u, avail.endsWith("OutOfStock") ? sold : avail.endsWith("InStock") ? stocked && !sold : false, `${avail} vs page (uitverkocht ${sold}, voorraad ${stocked})`);
    l.rec("product-url-is-canonical", u, sameUrl(String(offer.url), linkAll(f, "canonical")[0] ?? ""), String(offer.url));
    const ship = Number((((offer.shippingDetails ?? {}) as Node).shippingRate as Node | undefined)?.value);
    l.rec("product-shipping-matches-terms", u, price >= 50 ? ship === 0 : ship === 5.95, `price ${price}, shipping ${ship}`);
    if (n.image) l.rec("product-image-real", u, !/placehold/i.test(JSON.stringify(n.image)));
    // "Universeel" says what the part fits, not who made it.
    const brandName = (n.brand as Node | undefined)?.name;
    l.rec("product-brand-is-a-manufacturer", u, brandName === undefined || squash(String(brandName)).toLowerCase() !== "universeel", `brand ${String(brandName)}`);
  }

  // A plan's price says per month and with or without VAT, as the page prints it ("€ 29,00 per maand · excl. btw").
  for (const n of nodes.filter((x) => typeOf(x) === "SoftwareApplication" || typeOf(x) === "WebApplication")) {
    const offer = n.offers as Node | undefined;
    const price = Number(offer?.price);
    if (!offer || !(price > 0)) continue;
    const spec = offer.priceSpecification as Node | undefined;
    const subject = `${u} ${String(n.name)}`;
    l.rec("plan-offer-states-period-and-vat", subject, !!spec && spec["@type"] === "UnitPriceSpecification" && spec.billingDuration === "P1M" && typeof spec.valueAddedTaxIncluded === "boolean" && Number(spec.price) === price, "a recurring price without billingDuration and valueAddedTaxIncluded reads as a one-off amount");
    const label = `${money(price)} per maand · ${spec?.valueAddedTaxIncluded === true ? "incl" : "excl"}. btw`;
    l.rec("plan-offer-matches-the-printed-price", subject, text.includes(label), `"${label}" is not printed on the page`);
  }

  // Articles: headline length; a date only when the page prints it.
  for (const n of nodes.filter((x) => typeOf(x) === "Article" || typeOf(x) === "TechArticle")) {
    l.rec("article-headline-length", u, String(n.headline ?? "").length > 0 && String(n.headline).length <= 110, String(n.headline).length.toString());
    if (typeof n.datePublished === "string") {
      const dt = new Date(n.datePublished);
      const shown = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(dt);
      l.rec("article-date-visible", u, text.includes(shown), `datePublished ${n.datePublished} is not printed (${shown})`);
    }
    l.rec("article-no-invented-author", u, !n.author || typeOf(n.author as Node) === "Organization", JSON.stringify(n.author));
  }

  // HowTo: the steps in the markup are the steps on the page.
  for (const n of nodes.filter((x) => typeOf(x) === "HowTo")) {
    const steps = (Array.isArray(n.step) ? n.step : []) as Node[];
    l.rec("howto-steps-visible", u, steps.length > 0 && steps.every((s) => text.includes(squash(String(s.name)))), "a step in the markup is not printed");
    l.rec("howto-no-cost-total", u, n.estimatedCost === undefined, "estimatedCost is a total the page does not show");
  }

  // Organization / WebSite: the origin, and only facts the site prints.
  for (const n of nodes.filter((x) => typeOf(x) === "Organization")) {
    l.rec("organization-url", u, n.url === `${ctx.origin}/`, String(n.url));
    const facts: string[] = [];
    const addr = n.address as Node | undefined;
    if (addr) {
      l.rec("organization-address-complete", u, Boolean(addr.streetAddress && addr.postalCode && addr.addressLocality), "an address without street, postcode or city");
      for (const k of ["streetAddress", "postalCode", "addressLocality"]) if (addr[k]) facts.push(String(addr[k]));
    }
    for (const k of ["legalName", "vatID", "email", "telephone"]) if (n[k]) facts.push(String(n[k]));
    if (n.identifier) facts.push(String((n.identifier as Node).value));
    for (const v of facts) {
      l.rec("organization-no-placeholder", `${u} ${v}`, !PLACEHOLDER.test(v), v);
      pendingCompanyFacts.add(v);
    }
  }
  for (const n of nodes.filter((x) => typeOf(x) === "WebSite")) {
    l.rec("website-url", u, n.url === `${ctx.origin}/`, String(n.url));
    const action = n.potentialAction as Node | undefined;
    if (action) pendingSearchTargets.add(String(action.target));
  }
}

/** Collected while auditing; resolved against the crawl in the cross-page checks. */
const pendingBreadcrumbTargets = new Set<string>();
const pendingCompanyFacts = new Set<string>();
const pendingSearchTargets = new Set<string>();

// ───────────────────────────── sitemap: format, content, and agreement with the pages ─────────────────────────────

type SitemapEntry = { loc: string; lastmod: string | null };
function parseSitemap(xml: string): { entries: SitemapEntry[]; problems: string[] } {
  const problems: string[] = [];
  if (!/^<\?xml version="1\.0" encoding="UTF-8"\?>\s*<urlset\b[^>]*xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"/.test(xml)) problems.push("no XML declaration + urlset in the sitemap namespace");
  if (!/<\/urlset>\s*$/.test(xml)) problems.push("urlset is not closed at the end");
  const entries: SitemapEntry[] = [];
  const blocks = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)];
  const opened = (xml.match(/<url>/g) ?? []).length;
  if (opened !== blocks.length) problems.push(`${opened} <url> opened, ${blocks.length} closed`);
  for (const b of blocks) {
    const tags = [...b[1].matchAll(/<([a-z:]+)>/g)].map((m) => m[1]);
    const bad = tags.filter((t) => !["loc", "lastmod", "changefreq", "priority"].includes(t));
    if (bad.length) problems.push(`unexpected tag(s) ${bad.join(",")}`);
    const loc = /<loc>([^<]*)<\/loc>/.exec(b[1]);
    if (!loc || (b[1].match(/<loc>/g) ?? []).length !== 1) {
      problems.push("a <url> without exactly one <loc>");
      continue;
    }
    entries.push({ loc: decode(loc[1]), lastmod: /<lastmod>([^<]*)<\/lastmod>/.exec(b[1])?.[1] ?? null });
  }
  if (/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i.test(xml)) problems.push("an unescaped & in the XML");
  return { entries, problems };
}

/** Sitemap content rules. Fetches each URL through `get` so the mutation proof can feed it a URL that is noindex. */
async function sitemapContent(l: Ledger, locs: string[], get: (u: string) => Promise<{ resp: Resp; f: Facts }>, origin: string, robots: RobotsGroup[]): Promise<void> {
  await pool(locs, 6, async (loc) => {
    const p = new URL(loc);
    l.rec("sitemap-no-private-path", loc, !isPrivate(p.pathname), "a private path is listed");
    l.rec("sitemap-allowed-by-robots", loc, robotsAllows(robots, "Googlebot", p.pathname + p.search), "listed but disallowed in robots.txt");
    const { resp, f } = await get(loc);
    l.rec("sitemap-no-noindex", loc, !isNoindex(f, resp.headers), `robots ${JSON.stringify(metaAll(f, "robots"))} / ${resp.headers["x-robots-tag"] ?? "-"}`);
    l.rec("sitemap-status-200", loc, resp.status === 200, `HTTP ${resp.status}`);
    l.rec("sitemap-canonical-is-the-url", loc, resp.status !== 200 || sameUrl(linkAll(f, "canonical")[0] ?? "", loc), `canonical ${linkAll(f, "canonical")[0] ?? "-"}`);
    l.rec("sitemap-on-the-public-origin", loc, p.origin === origin, p.origin);
  });
}

// ───────────────────────────── network ─────────────────────────────

let SITE_ORIGIN = "";
const cache = new Map<string, Promise<Resp>>();
const toLocal = (u: string) => (SITE_ORIGIN && u.startsWith(SITE_ORIGIN) ? BASE + u.slice(SITE_ORIGIN.length) : u.startsWith("/") ? BASE + u : u);

function request(url: string, headers: Record<string, string> = {}): Promise<Resp> {
  const target = toLocal(url);
  return new Promise((resolve, reject) => {
    const req = (target.startsWith("https:") ? https : http).request(target, { method: "GET", headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,application/xml,*/*", ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const h: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) h[k] = Array.isArray(v) ? v.join(", ") : String(v ?? "");
        resolve({ url, status: res.statusCode ?? 0, headers: h, location: h.location ?? null, body: Buffer.concat(chunks).toString("utf8") });
      });
    });
    req.on("error", reject);
    req.setTimeout(30_000, () => req.destroy(new Error(`timeout ${target}`)));
    req.end();
  });
}
const get = (u: string): Promise<Resp> => {
  let p = cache.get(u);
  if (!p) {
    p = request(u);
    cache.set(u, p);
  }
  return p;
};
async function getBinary(u: string): Promise<{ status: number; type: string; cacheControl: string; bytes: Buffer }> {
  const target = toLocal(u);
  return new Promise((resolve, reject) => {
    (target.startsWith("https:") ? https : http)
      .get(target, { headers: { "user-agent": UA } }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, type: String(res.headers["content-type"] ?? ""), cacheControl: String(res.headers["cache-control"] ?? ""), bytes: Buffer.concat(chunks) }));
      })
      .on("error", reject);
  });
}
/**
 * The generated images are addressed without a content hash (og:image, the manifest, the Organization logo), so they must
 * not be cached for a year as `immutable` (next/og's default): a changed card or icon would not reach anybody for a year.
 */
function imageCacheProblem(cacheControl: string): string | null {
  if (!cacheControl) return "no Cache-Control";
  if (/\bimmutable\b/i.test(cacheControl)) return `immutable: ${cacheControl}`;
  const ages = [...cacheControl.matchAll(/\b(?:s-)?max-?age=(\d+)/gi)].map((m) => Number(m[1]));
  if (ages.length === 0) return `no max-age: ${cacheControl}`;
  if (ages.some((a) => a > 86_400)) return `longer than a day: ${cacheControl}`;
  return null;
}
const pngSize = (b: Buffer) => (b.length > 24 && b.readUInt32BE(0) === 0x89504e47 ? { w: b.readUInt32BE(16), h: b.readUInt32BE(20) } : null);

// ───────────────────────────── 1. the helper modules (no server needed) ─────────────────────────────

function helperChecks(): void {
  section("helpers: src/lib/seo.ts and src/lib/json-ld.ts");
  // titles
  const t1 = pageTitle("Contact");
  check("helper-title-plain", t1 === "Contact", String(t1));
  check("helper-title-strips-own-suffix", pageTitle("Contact · WasFix Pro") === "Contact", String(pageTitle("Contact · WasFix Pro")));
  const own = pageTitle("WasFix Pro vs Coolblue — eerlijke vergelijking");
  check("helper-title-brand-is-absolute", typeof own === "object" && own.absolute.startsWith("WasFix Pro vs"), JSON.stringify(own));
  const long = "Wasmachine maakt lawaai bij centrifugeren — diagnose van het probleem";
  const fit = pageTitle(`${long}: stap-voor-stap reparatiegids`, long);
  const fitText = typeof fit === "string" ? fit : fit.absolute;
  check("helper-title-never-over-limit", (typeof fit === "string" ? fit.length + TITLE_SUFFIX.length : fit.absolute.length) <= TITLE_MAX && fitText.length > 10, fitText);
  const alt = pageTitle("Bosch E21 foutcode: Motorstoring / trommel draait niet", "Bosch E21: Motorstoring / trommel draait niet", "Bosch E21 foutcode");
  check("helper-title-picks-first-fitting-candidate", alt === "Bosch E21: Motorstoring / trommel draait niet", JSON.stringify(alt));
  check("helper-title-absolute-when-only-room-without-suffix", JSON.stringify(pageTitle("Wasmachine kapot? Repareren of vervangen in 2026 · Blog")) === JSON.stringify({ absolute: "Wasmachine kapot? Repareren of vervangen in 2026 · Blog" }), JSON.stringify(pageTitle("Wasmachine kapot? Repareren of vervangen in 2026 · Blog")));
  check("helper-strip-brand-suffix", stripBrandSuffix("Prijzen | WasFix Pro") === "Prijzen" && stripBrandSuffix("Over WasFix Pro") === "Over WasFix Pro");
  // descriptions
  const dShort = pageDescription("Samsung wasmachine toont 3E? Toerental-feedback ontbreekt.", "Mogelijke oorzaken, of je het zelf kunt oplossen en welke onderdelen erbij horen.");
  check("helper-description-padded-to-minimum", dShort.length >= DESCRIPTION_MIN && dShort.length <= DESCRIPTION_MAX, `${dShort.length}`);
  const dLong = pageDescription("Woord ".repeat(60));
  check("helper-description-cut-at-word", dLong.length <= DESCRIPTION_MAX && dLong.endsWith("…") && !/\sWoo…$/.test(dLong), dLong.slice(-20));
  check("helper-description-keeps-a-long-enough-one", pageDescription("x".repeat(100)) === "x".repeat(100));
  // metadata
  const m = pageMetadata({ title: "Contact", description: "d".repeat(80), path: "/contact" });
  check("helper-metadata-complete", m.alternates?.canonical === "/contact" && m.openGraph?.url === "/contact" && (m.openGraph as { siteName?: string }).siteName === SITE_NAME && (m.openGraph as { locale?: string }).locale === OG_LOCALE && (m.twitter as { card?: string }).card === "summary_large_image", JSON.stringify(m).slice(0, 200));
  check("helper-metadata-noindex-keeps-follow", JSON.stringify(pageMetadata({ title: "x", description: "d", path: "/x", noindex: true }).robots) === JSON.stringify({ index: false, follow: true }));
  check("helper-robots-meta", robotsMeta(true) === undefined && JSON.stringify(robotsMeta(false, false)) === JSON.stringify({ index: false, follow: false }));
  // list variants
  const seo = { title: "t", description: "d".repeat(80), path: "/onderdelen" };
  const plain = listMetadata(seo, {}, LIST_FILTER_PARAMS["/onderdelen"]);
  const filtered = listMetadata(seo, { q: "pomp" }, LIST_FILTER_PARAMS["/onderdelen"]);
  const tracked = listMetadata(seo, { utm_source: "x", ref: "y" }, LIST_FILTER_PARAMS["/onderdelen"]);
  check("helper-list-plain-is-indexable-with-canonical", plain.alternates?.canonical === "/onderdelen" && !plain.robots);
  check("helper-list-filter-is-noindex-without-canonical", filtered.robots !== undefined && JSON.stringify(filtered.robots) === JSON.stringify({ index: false, follow: true }) && filtered.alternates?.canonical === undefined);
  check("helper-list-tracking-params-do-not-make-a-variant", tracked.alternates?.canonical === "/onderdelen" && !tracked.robots && !isListVariant({ utm_medium: "x" }, LIST_FILTER_PARAMS["/foutcodes"]) && !isListVariant({ q: "  " }, LIST_FILTER_PARAMS["/foutcodes"]) && isListVariant({ q: ["", "E18"] }, LIST_FILTER_PARAMS["/foutcodes"]));
  // indexability
  const covered = coveredBrands([{ machine: { brand: "Bosch" } }]);
  check("helper-indexability", indexability({ kind: "brandRepair", brand: "Bosch", covered }).index && !indexability({ kind: "brandRepair", brand: "Zanussi", covered }).index && !indexability({ kind: "city" }).index && indexability({ kind: "brandHub", machines: 2 }).index && !indexability({ kind: "brandHub", machines: 0 }).index && !indexability({ kind: "part", exists: false }).index);
  // private paths
  check("helper-private-paths", isPrivatePath("/admin") && isPrivatePath("/admin/x") && isPrivatePath("/monteur/dashboard") && isPrivatePath("/api/parts") && !isPrivatePath("/api-docs") && !isPrivatePath("/api-info") && !isPrivatePath("/monteur") && !isPrivatePath("/administrator") && isPrivatePath("/bestelling/abc"));
  check("helper-private-header-sources", privateHeaderSources().every((s) => s.endsWith("/:path*")) && !privateHeaderSources().includes("/api/:path*") && privateHeaderSources().includes("/admin/:path*"));
  check("helper-private-predicate-agrees-with-the-expected-list", EXPECTED_PRIVATE.every((p) => isPrivatePath(p.replace(/\/$/, "")) && isPrivatePath(`${p.replace(/\/$/, "")}/x`)), EXPECTED_PRIVATE.filter((p) => !isPrivatePath(p.replace(/\/$/, ""))).join(" "));
  check("helper-sitemap-static-paths-are-public", SITEMAP_STATIC_PATHS.every((p) => p.startsWith("/") && !isPrivatePath(p)) && new Set(SITEMAP_STATIC_PATHS).size === SITEMAP_STATIC_PATHS.length);
  // header rules for the noindex variants
  const rules = variantHeaderRules();
  const ruleKeys = new Set(rules.filter((r) => r.has).map((r) => `${r.source}?${r.has![0].key}`));
  const missingRules = Object.entries(ALL_VARIANT_PARAMS).flatMap(([p, keys]) => keys.filter((k) => !ruleKeys.has(`${p}?${k}`)).map((k) => `${p}?${k}`));
  check("helper-variant-header-rules-cover-every-filter-parameter", missingRules.length === 0 && rules.every((r) => /noindex/.test(r.robots)), `no X-Robots-Tag rule for ${missingRules.join(", ")}`);
  check("helper-variant-header-rules-ignore-blank-values", rules.filter((r) => r.has && r.has[0].key !== "t").every((r) => new RegExp(`^${r.has![0].value}$`).test("pomp") && !new RegExp(`^${r.has![0].value}$`).test("") && !new RegExp(`^${r.has![0].value}$`).test("  ") && !new RegExp(`^${r.has![0].value}$`).test(" \n\t ")), "a blank ?q= is the page itself (isListVariant), so it must not get a noindex header");
  // Next anchors the value (`^...$`) and `.` does not match a line break: a value such as "a\nb" is a variant (the page carries the tag) and must get the header too.
  check("helper-variant-header-rules-match-a-value-with-a-line-break", rules.filter((r) => r.has && r.has[0].key !== "t").every((r) => ["a\nb", "\nab", "ab\n", "a\r\nb", "pomp"].every((v) => new RegExp(`^${r.has![0].value}$`).test(v))) && isListVariant({ q: "a\nb" }, LIST_FILTER_PARAMS["/onderdelen"]) && isListVariant({ q: "\nab" }, LIST_FILTER_PARAMS["/onderdelen"]), "header and meta tag disagree for a value with a line break");
  check("helper-static-documents-have-a-noindex-header-rule", EXPECTED_STATIC_NOINDEX.every((src) => STATIC_NOINDEX_SOURCES.includes(src) && rules.some((r) => r.source === src && !r.has && /noindex/.test(r.robots))), JSON.stringify(STATIC_NOINDEX_SOURCES));
  check("helper-variant-keeps-the-expected-parameters", Object.entries(EXPECTED_VARIANT_PARAMS).every(([p, keys]) => keys.every((k) => ((LIST_FILTER_PARAMS as Record<string, readonly string[]>)[p] ?? []).includes(k))), "a parameter was dropped from LIST_FILTER_PARAMS (src/lib/seo.ts)");
  check("helper-variant-header-covers-the-return-token-and-qr", rules.some((r) => r.source === "/retour/start" && r.has?.[0].key === "t" && r.robots === "noindex, nofollow") && rules.some((r) => r.source === "/qr/:path*" && !r.has));
  // images
  check("helper-image-cache-is-short", imageCacheProblem(IMAGE_CACHE_CONTROL) === null && imageCacheProblem("public, immutable, no-transform, max-age=31536000") !== null && imageCacheProblem("public, max-age=86400, s-maxage=31536000") !== null && imageCacheProblem("") !== null, IMAGE_CACHE_CONTROL);
  // non-production
  check("helper-non-production", isNonProductionDeployment({ VERCEL_ENV: "preview" }) && isNonProductionDeployment({ VERCEL_ENV: "development" }) && !isNonProductionDeployment({ VERCEL_ENV: "production" }) && !isNonProductionDeployment({}));
  // verification
  check("helper-verification-absent-means-no-tag", verificationMetadata({}) === undefined && verificationMetadata({ GOOGLE_SITE_VERIFICATION: "  ", BING_SITE_VERIFICATION: "" }) === undefined);
  const v = verificationMetadata({ GOOGLE_SITE_VERIFICATION: "abcDEF123_-xyz", BING_SITE_VERIFICATION: "0123456789ABCDEF" });
  check("helper-verification-tags", v?.google === "abcDEF123_-xyz" && (v?.other as Record<string, string>)?.["msvalidate.01"] === "0123456789ABCDEF", JSON.stringify(v));
  check("helper-verification-bing-only-or-google-only", JSON.stringify(verificationMetadata({ GOOGLE_SITE_VERIFICATION: "abcDEF123_-xyz" })) === JSON.stringify({ google: "abcDEF123_-xyz" }) && JSON.stringify(verificationMetadata({ BING_SITE_VERIFICATION: "0123456789ABCDEF" })) === JSON.stringify({ other: { "msvalidate.01": "0123456789ABCDEF" } }));
  check("helper-verification-accepts-a-pasted-meta-tag", verificationMetadata({ GOOGLE_SITE_VERIFICATION: '<meta name="google-site-verification" content="tokenTOKEN12345" />' })?.google === "tokenTOKEN12345");
  check("helper-verification-rejects-junk", verificationMetadata({ GOOGLE_SITE_VERIFICATION: 'a"><script>alert(1)</script>' }) === undefined && verificationMetadata({ BING_SITE_VERIFICATION: "short" }) === undefined);

  // JSON-LD
  const hostile = ldJson({ review: "</script><script>alert(1)</script>", sep: "a b" });
  check("helper-ldjson-cannot-close-the-script-element", !hostile.includes("</") && !hostile.includes(" ") && JSON.parse(hostile).review === "</script><script>alert(1)</script>", hostile);
  const prev = process.env.NEXT_PUBLIC_APP_URL;
  const prevNode = process.env.NODE_ENV;
  process.env.NEXT_PUBLIC_APP_URL = "https://shop.example.nl";
  (process.env as Record<string, string>).NODE_ENV = "production";
  try {
    const bare = organizationLd({ name: "X B.V.", street: null, postalCode: null, city: null, kvk: null, vatNumber: null, email: null, phone: null, ready: false }, { name: "WasFix Pro", description: "d" });
    check("helper-organization-omits-what-is-not-configured", !("address" in bare) && !("legalName" in bare) && !("vatID" in bare) && !("identifier" in bare) && !("email" in bare) && !("telephone" in bare) && bare.url === "https://shop.example.nl/", JSON.stringify(bare));
    const partial = organizationLd({ name: "X B.V.", street: "Straat 1", postalCode: null, city: "Den Haag", kvk: "12345678", vatNumber: null, email: "a@b.nl", phone: null, ready: true }, { name: "WasFix Pro", description: "d" });
    check("helper-organization-never-prints-half-an-address", !("address" in partial) && partial.legalName === "X B.V." && (partial.identifier as { value: string }).value === "12345678");
    const full = organizationLd({ name: "X B.V.", street: "Straat 1", postalCode: "1011 AB", city: "Amsterdam", kvk: "12345678", vatNumber: "NL123456789B01", email: "a@b.nl", phone: "0201234567", ready: true }, { name: "WasFix Pro", description: "d" });
    check("helper-organization-full", (full.address as { streetAddress: string }).streetAddress === "Straat 1" && full.vatID === "NL123456789B01" && full.telephone === "0201234567");
    const p = productLd({ sku: "S-1", name: "N", description: "d", brand: "B", categoryLabel: "C", priceEur: 28, inStock: false, imageUrl: null, shippingEur: 5.95, returnDays: 30 });
    const universal = productLd({ sku: "S-2", name: "N", description: "d", brand: UNIVERSAL_BRAND, categoryLabel: "C", priceEur: 28, inStock: true, imageUrl: null, shippingEur: 5.95, returnDays: 30 });
    const branded = productLd({ sku: "S-3", name: "N", description: "d", brand: "Bosch", categoryLabel: "C", priceEur: 28, inStock: true, imageUrl: null, shippingEur: 5.95, returnDays: 30 });
    check("helper-product-brand-only-for-a-manufacturer", !("brand" in universal) && (branded.brand as { name: string }).name === "Bosch" && UNIVERSAL_BRAND === "Universeel");
    check("helper-product-no-image-no-rating-without-input", !("image" in p) && !("aggregateRating" in p) && !("review" in p) && (p.offers as { availability: string }).availability.endsWith("OutOfStock") && (p.offers as { price: string }).price === "28.00");
    const b = breadcrumbLd([{ name: "A", path: "/a" }, { name: "B" }]);
    const items = b.itemListElement as Array<{ position: number; item?: string }>;
    check("helper-breadcrumb", items[0].position === 1 && items[0].item === "https://shop.example.nl/a" && items[1].position === 2 && items[1].item === undefined);
    check("helper-website-search-action-only-when-given", !("potentialAction" in websiteLd({ name: "W" })) && "potentialAction" in websiteLd({ name: "W", searchPath: "/foutcodes?q={search_term_string}" }));
    const a = articleLd({ headline: "x".repeat(200), description: "d", path: "/blog/x" });
    check("helper-article-headline-cut-and-no-date-by-default", String(a.headline).length <= 110 && !("datePublished" in a) && (a.author as { "@type": string })["@type"] === "Organization");
  } finally {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = prev;
    if (prevNode === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV;
    else (process.env as Record<string, string>).NODE_ENV = prevNode;
  }
}

// ───────────────────────────── 1b. deployment environments (child processes, no server needed) ─────────────────────────────

// The repository's modules are CommonJS under tsx; a named ESM import of them fails, a dynamic import + this unwrap works
// (the same preamble scripts/qa-platform.ts uses).
const CHILD_PREAMBLE = `const imp = async (p) => { const m = await import(p); return m.default && typeof m.default === "object" ? { ...m.default, ...m } : m; };\n`;
function runChild(source: string, env: Record<string, string | undefined>): Promise<{ code: number; out: string; err: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wasfix-seo-"));
  const file = path.join(dir, "probe.mts");
  fs.writeFileSync(file, CHILD_PREAMBLE + source.replaceAll("@repo/", `${ROOT}/`));
  return new Promise((resolve) => {
    const clean: Record<string, string> = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", TSX_TSCONFIG_PATH: path.join(ROOT, "tsconfig.json") };
    for (const [k, v] of Object.entries(env)) if (v !== undefined) clean[k] = v;
    const child = spawn("npx", ["--no-install", "tsx", file], { cwd: ROOT, env: clean as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"] as const });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => {
      fs.rmSync(dir, { recursive: true, force: true });
      resolve({ code: code ?? -1, out, err });
    });
  });
}

type EnvProbe = {
  robots: { rules: Array<{ userAgent: string | string[]; allow?: string[]; disallow?: string[] }>; sitemap?: string[]; host?: string };
  x: Array<{ source: string; has: Array<{ type: string; key: string; value?: string }> | null; value: string }>;
  bots: { source: string; flags: string };
};
const ENV_PROBE = `
  const robots = (await imp("@repo/src/app/robots")).default();
  const cfg = (await imp("@repo/next.config")).default;
  const headers = await cfg.headers();
  const x = headers.flatMap((h) => h.headers.filter((k) => k.key === "X-Robots-Tag").map((k) => ({ source: h.source, has: h.has ?? null, value: k.value })));
  console.log(JSON.stringify({ robots, x, bots: { source: cfg.htmlLimitedBots.source, flags: cfg.htmlLimitedBots.flags } }));
`;

async function environmentChecks(): Promise<void> {
  section("deployment environments: robots.ts and next.config.ts under VERCEL_ENV (child processes)");
  const base = { NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "https://wasfix.nl" };
  const cases: Array<[string, string | undefined]> = [["unset", undefined], ["production", "production"], ["preview", "preview"], ["development", "development"]];
  const results = await Promise.all(cases.map(([, v]) => runChild(ENV_PROBE, { ...base, VERCEL_ENV: v })));
  const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
  results.forEach((res, i) => {
    const [label, v] = cases[i];
    let probe: EnvProbe | null = null;
    try {
      probe = JSON.parse(res.out.trim().split("\n").pop() ?? "") as EnvProbe;
    } catch {
      /* reported below */
    }
    L.rec("env-probe-ran", label, probe !== null, `${res.err.slice(0, 300)} ${res.out.slice(-200)}`);
    if (!probe) return;
    const star = probe.robots.rules.find((r) => (Array.isArray(r.userAgent) ? r.userAgent : [r.userAgent]).includes("*"));
    const nonProd = v !== undefined && v !== "production";
    const globalNoindex = probe.x.filter((h) => h.source === "/(.*)");
    if (nonProd) {
      // A preview or development deployment is not the shop: nothing on it is for a search engine.
      L.rec("env-preview-robots-disallow-everything", label, probe.robots.rules.length === 1 && sameSet(star?.disallow ?? [], ["/"]) && probe.robots.sitemap === undefined && probe.robots.host === undefined, `robots ${JSON.stringify(probe.robots)}`);
      const last = probe.x[probe.x.length - 1];
      L.rec("env-preview-global-noindex-header-wins", label, globalNoindex.length === 1 && globalNoindex.every((h) => h.value === "noindex, nofollow") && last?.source === "/(.*)", `last X-Robots-Tag rule ${JSON.stringify(last)}; global rules ${globalNoindex.length}`);
    } else {
      L.rec("env-production-robots-lists-the-private-paths-and-the-sitemap", label, !!star && sameSet(star.disallow ?? [], ALL_PRIVATE) && JSON.stringify(probe.robots.sitemap) === JSON.stringify(["https://wasfix.nl/sitemap.xml"]), `disallow ${JSON.stringify(star?.disallow)}; sitemap ${JSON.stringify(probe.robots.sitemap)}`);
      const ai = probe.robots.rules.find((r) => Array.isArray(r.userAgent) && r.userAgent.includes("GPTBot") && r.userAgent.includes("CCBot"));
      L.rec("env-production-keeps-the-ai-crawler-opt-out", label, !!ai && sameSet(ai.disallow ?? [], ["/"]), "the owner's documented AI-crawler opt-out group is missing or changed");
      L.rec("env-production-has-no-global-noindex-header", label, globalNoindex.length === 0, "every page of the shop would carry noindex");
      for (const p of EXPECTED_PRIVATE.filter((x) => x !== "/bestelling")) {
        const source = p === "/api/" ? "/api/:path*" : `${p}/:path*`;
        L.rec("env-production-private-paths-get-a-noindex-header", `${label} ${source}`, probe.x.some((h) => h.source === source && /noindex/.test(h.value) && !h.has), "no X-Robots-Tag rule");
      }
      for (const [p, keys] of Object.entries(ALL_VARIANT_PARAMS)) {
        for (const key of keys) {
          L.rec("env-production-variants-get-a-noindex-header", `${label} ${p}?${key}`, probe.x.some((h) => h.source === p && h.value === "noindex, follow" && h.has?.length === 1 && h.has[0].key === key), "no X-Robots-Tag rule for this parameter");
        }
      }
      for (const source of EXPECTED_STATIC_NOINDEX) {
        L.rec("env-production-static-documents-get-a-noindex-header", `${label} ${source}`, probe.x.some((h) => h.source === source && /noindex/.test(h.value) && !h.has), "no X-Robots-Tag rule for this file");
      }
      L.rec("env-production-return-token-and-qr-get-a-noindex-header", label, probe.x.some((h) => h.source === "/retour/start" && h.value === "noindex, nofollow" && h.has?.[0]?.key === "t") && probe.x.some((h) => h.source === "/qr/:path*" && /noindex/.test(h.value)), JSON.stringify(probe.x.filter((h) => /retour|qr/.test(h.source))));
    }
    // Whatever the environment: a robots.txt that names no Allow rule (see src/app/robots.ts) and crawlers that get <head> metadata.
    L.rec("env-robots-has-no-allow-rule", label, probe.robots.rules.every((r) => !r.allow || r.allow.length === 0), "an Allow line above the Disallow lines makes a first-match parser read every private path as open");
    const re = new RegExp(probe.bots.source, probe.bots.flags);
    for (const [name, ua] of CRAWLERS) L.rec("env-crawler-gets-blocking-metadata-per-config", `${label} ${name}`, re.test(ua), "htmlLimitedBots in next.config.ts does not match this user agent");
    L.rec("env-visitors-keep-the-streamed-form", label, !re.test(UA_BROWSER) && !re.test("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"), "an ordinary browser would be treated as a crawler (a slower first byte for every visitor)");
  });
}

// ───────────────────────────── 2. the source tree (no server needed) ─────────────────────────────

function walkFiles(dir: string, accept: (f: string) => boolean, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, accept, out);
    else if (accept(p)) out.push(p);
  }
  return out;
}

function sourceChecks(): void {
  section("source tree: every page is classified, every private area is marked, no raw JSON in a script tag");
  const appDir = path.join(ROOT, "src", "app");
  const pages = walkFiles(appDir, (f) => f.endsWith(`${path.sep}page.tsx`));
  const routeOf = (f: string) => "/" + path.relative(appDir, path.dirname(f)).split(path.sep).filter((s) => s && !(s.startsWith("(") && s.endsWith(")"))).join("/");
  const statics = pages.map(routeOf).filter((r) => !r.includes("["));
  const inSitemap = new Set(SITEMAP_STATIC_PATHS);
  for (const route of statics.map((r) => (r === "/" ? "/" : r.replace(/\/$/, "")))) {
    const classified = inSitemap.has(route) || isPrivate(route);
    L.rec("source-page-classified", route, classified, "a public page that is neither in SITEMAP_STATIC_PATHS nor under PRIVATE_PATH_PREFIXES (src/lib/seo.ts): add it to one of them");
  }
  for (const p of SITEMAP_STATIC_PATHS) {
    const file = p === "/" ? path.join(appDir, "page.tsx") : path.join(appDir, ...p.split("/").filter(Boolean), "page.tsx");
    L.rec("source-sitemap-path-exists", p, fs.existsSync(file), "listed in SITEMAP_STATIC_PATHS but no such page");
  }
  // Private areas: a layout (or the page) above every page carries robots noindex.
  for (const prefix of ALL_PRIVATE) {
    if (prefix === "/api/") continue;
    const dir = path.join(appDir, ...prefix.split("/").filter(Boolean));
    if (!fs.existsSync(dir)) {
      L.rec("source-private-area-marked", prefix, false, "no such directory under src/app");
      continue;
    }
    const layout = path.join(dir, "layout.tsx");
    const marked = fs.existsSync(layout) && /robotsMeta\(false|index:\s*false/.test(fs.readFileSync(layout, "utf8"));
    const pageFiles = walkFiles(dir, (f) => f.endsWith(`${path.sep}page.tsx`));
    const everyPageMarked = pageFiles.length > 0 && pageFiles.every((f) => /index:\s*false|robotsMeta\(false/.test(fs.readFileSync(f, "utf8")));
    L.rec("source-private-area-marked", prefix, marked || everyPageMarked, "no robots noindex in a layout.tsx at the root of the area (see src/app/admin/layout.tsx)");
  }
  // The title template and the helper agree.
  const layoutSrc = fs.readFileSync(path.join(appDir, "layout.tsx"), "utf8");
  check("source-title-template-uses-the-helper-suffix", /template:\s*`%s\$\{TITLE_SUFFIX\}`/.test(layoutSrc), "src/app/layout.tsx must build its title template from TITLE_SUFFIX");
  check("source-layout-wires-verification", /verificationMetadata\(\{[^}]*process\.env\.GOOGLE_SITE_VERIFICATION[^}]*process\.env\.BING_SITE_VERIFICATION/.test(layoutSrc) && /verification: VERIFICATION/.test(layoutSrc));
  check("source-layout-has-no-meta-keywords", !/^\s*keywords:/m.test(layoutSrc));
  // JSON-LD goes through ldJson (escaping), never straight through JSON.stringify.
  const tsx = walkFiles(path.join(ROOT, "src"), (f) => f.endsWith(".tsx"));
  for (const f of tsx) {
    const src = fs.readFileSync(f, "utf8");
    // Every JSON-LD script element: the expression after __html: must start with ldJson( (a window, because the expression can hold braces).
    for (const m of src.matchAll(/application\/ld\+json[\s\S]{0,160}?__html:\s*(\S+)/g)) {
      L.rec("source-jsonld-is-escaped", path.relative(ROOT, f), m[1].startsWith("ldJson("), `uses ${m[1].slice(0, 40)} instead of ldJson()`);
    }
  }
  // robots.ts reads the private list; sitemap.ts reads the static list and the indexability function.
  const robotsSrc = fs.readFileSync(path.join(appDir, "robots.ts"), "utf8");
  const sitemapSrc = fs.readFileSync(path.join(appDir, "sitemap.ts"), "utf8");
  check("source-robots-uses-the-shared-private-list", /disallow:\s*\[\.\.\.PRIVATE_PATH_PREFIXES\]/.test(robotsSrc) && !/"\/(admin|dashboard|checkout|inloggen|registreren|upgrade|monteur\/)/.test(robotsSrc), "robots.ts must not carry its own list of private paths");
  check("source-sitemap-uses-the-shared-rules", /SITEMAP_STATIC_PATHS/.test(sitemapSrc) && /indexability\(/.test(sitemapSrc) && !/changeFrequency\s*:|priority\s*:\s*\d/.test(sitemapSrc));
}

// ───────────────────────────── 3. the running site ─────────────────────────────

const FAMILIES: Array<[string, (p: string) => boolean]> = [
  ["static", (p) => (SITEMAP_STATIC_PATHS as readonly string[]).includes(p)],
  ["help", (p) => p.startsWith("/help/")],
  ["blog", (p) => p.startsWith("/blog/")],
  ["vs", (p) => p.startsWith("/vs/")],
  ["brand-repair", (p) => /^\/[a-z0-9]+-wasmachine-reparatie$/.test(p)],
  ["error-code", (p) => p.startsWith("/foutcodes/")],
  ["guide", (p) => p.startsWith("/gidsen/")],
  ["model", (p) => /^\/merken\/[^/]+\/[^/]+$/.test(p)],
  ["brand", (p) => /^\/merken\/[^/]+$/.test(p)],
  ["part", (p) => p.startsWith("/onderdelen/")],
  ["city", (p) => p.startsWith("/wasmachine-kapot/")],
];
const familyOf = (p: string) => FAMILIES.find(([, f]) => f(p))?.[0] ?? "other";

const EXPECT_TYPES: Record<string, string[]> = {
  part: ["Product", "BreadcrumbList"],
  "error-code": ["TechArticle", "BreadcrumbList"],
  guide: ["HowTo", "BreadcrumbList"],
  blog: ["Article"],
  help: ["Article"],
  "brand-repair": ["Service"],
};

/** Links to a noindex page that are known and tracked (KNOWN_THIN_BRANDS, with the open question that removes them). */
const isKnownThinBrandPath = (pathname: string) => KNOWN_THIN_BRANDS.some((slug) => pathname === `/${slug}-wasmachine-reparatie`);

async function httpChecks(): Promise<void> {
  section(`the running site at ${BASE}`);

  // ── robots.txt ──
  const robotsResp = await request("/robots.txt");
  check("robots-txt-served", robotsResp.status === 200 && /text\/plain/.test(robotsResp.headers["content-type"] ?? ""), `HTTP ${robotsResp.status} ${robotsResp.headers["content-type"]}`);
  const robotsTxt = parseRobots(robotsResp.body);
  const sitemapLines = robotsTxt.sitemaps;
  check("robots-names-exactly-one-sitemap", sitemapLines.length === 1 && /\/sitemap\.xml$/.test(sitemapLines[0] ?? ""), JSON.stringify(sitemapLines));
  const sitemapUrl = new URL(sitemapLines[0] ?? `${BASE}/sitemap.xml`);
  SITE_ORIGIN = sitemapUrl.origin;
  if (process.env.QA_SITE_ORIGIN) check("robots-sitemap-on-the-configured-origin", SITE_ORIGIN === process.env.QA_SITE_ORIGIN.replace(/\/+$/, ""), `${SITE_ORIGIN} vs QA_SITE_ORIGIN`);
  check("robots-sitemap-is-not-localhost", !/^(localhost|127\.|0\.0\.0\.0)/.test(sitemapUrl.hostname) || /^https?:\/\/(localhost|127\.)/.test(BASE), SITE_ORIGIN);
  const g = robotsTxt.groups;
  const star = g.find((x) => x.agents.includes("*"));
  const disallowed = new Set((star?.rules ?? []).filter((r) => !r.allow).map((r) => r.pattern));
  check("private-list-keeps-the-expected-paths", EXPECTED_PRIVATE.every((p) => (PRIVATE_PATH_PREFIXES as readonly string[]).includes(p)), `removed from PRIVATE_PATH_PREFIXES: ${EXPECTED_PRIVATE.filter((p) => !(PRIVATE_PATH_PREFIXES as readonly string[]).includes(p)).join(" ")}`);
  check("robots-disallows-exactly-the-private-paths", disallowed.size === ALL_PRIVATE.length && ALL_PRIVATE.every((p) => disallowed.has(p)), `robots: ${[...disallowed].join(" ")} | expected: ${ALL_PRIVATE.join(" ")}`);
  for (const p of ALL_PRIVATE) {
    const concrete = p.endsWith("/") ? `${p}x` : p;
    L.rec("robots-blocks-private-path", concrete, !robotsAllows(g, "Googlebot", concrete) && !robotsAllows(g, "Bingbot", concrete), "reachable for a crawler");
    L.rec("robots-blocks-private-path-first-match", concrete, !robotsAllowsFirstMatch(g, "Googlebot", concrete), "a parser that stops at the first matching rule reads it as allowed (an Allow line above the Disallow lines?)");
  }
  for (const p of ["/", "/onderdelen", "/foutcodes/Bosch-E18", "/monteur", "/api-docs", "/api-info", "/retour/start", "/wasmachine-kapot/amsterdam", "/zanussi-wasmachine-reparatie", "/sitemap.xml", "/icon", "/apple-icon", "/opengraph-image", "/manifest.webmanifest", "/_next/static/css/x.css", "/_next/static/chunks/x.js", "/_next/image?url=%2Fx.png&w=640&q=75", "/?utm_source=x", "/onderdelen?utm_medium=y", "/diagnose?ref=abc"]) {
    L.rec("robots-does-not-block", p, robotsAllows(g, "Googlebot", p) && robotsAllows(g, "Bingbot", p), "blocked: a crawler needs it to render or consolidate the page");
  }
  check("robots-has-no-blanket-block-for-search-engines", robotsAllows(g, "Googlebot", "/") && robotsAllows(g, "Bingbot", "/") && robotsAllows(g, "Googlebot-Image", "/opengraph-image"));
  check("robots-sets-no-parameter-patterns", !(star?.rules ?? []).some((r) => /[?*]/.test(r.pattern)), "a ?utm_/?ref= Disallow cannot strip a parameter and hides the canonical of the page");

  // ── sitemap ──
  const sm = await request(`${SITE_ORIGIN}/sitemap.xml`);
  check("sitemap-served-as-xml", sm.status === 200 && /xml/.test(sm.headers["content-type"] ?? ""), `HTTP ${sm.status} ${sm.headers["content-type"]}`);
  const { entries, problems } = parseSitemap(sm.body);
  check("sitemap-well-formed", problems.length === 0, problems.join("; "));
  check("sitemap-limits", entries.length > 0 && entries.length <= 50_000 && Buffer.byteLength(sm.body) <= 50 * 1024 * 1024, `${entries.length} URLs, ${Buffer.byteLength(sm.body)} bytes`);
  const locs = entries.map((e) => e.loc);
  check("sitemap-no-duplicates", new Set(locs).size === locs.length, `${locs.length - new Set(locs).size} duplicates`);
  check("sitemap-all-one-host", locs.every((u) => new URL(u).origin === SITE_ORIGIN), locs.find((u) => new URL(u).origin !== SITE_ORIGIN) ?? "");
  const cleanPath = (u: string) => {
    const p = new URL(u);
    return !p.search && !p.hash && (p.pathname === "/" || !p.pathname.endsWith("/"));
  };
  check("sitemap-no-query-no-fragment-no-trailing-slash", locs.every(cleanPath), locs.find((u) => !cleanPath(u)) ?? "");
  const encoded = (u: string) => !/[\s<>"]/.test(u) && (new URL(u).href === u || new URL(u).href === `${u}/`);
  check("sitemap-urls-are-encoded", locs.every(encoded), locs.find((u) => !encoded(u)) ?? "");
  check("sitemap-https-on-a-real-host", SITE_ORIGIN.startsWith("https://") || /localhost|127\./.test(SITE_ORIGIN), SITE_ORIGIN);
  const staticListed = new Set(locs.map((u) => new URL(u).pathname).filter((p) => (SITEMAP_STATIC_PATHS as readonly string[]).includes(p)));
  check("sitemap-lists-every-static-page", SITEMAP_STATIC_PATHS.every((p) => staticListed.has(p)), SITEMAP_STATIC_PATHS.filter((p) => !staticListed.has(p)).join(", "));
  for (const e of entries) {
    if (e.lastmod === null) continue;
    const t = Date.parse(e.lastmod);
    const fam = familyOf(new URL(e.loc).pathname);
    L.rec("sitemap-lastmod-valid-and-not-future", e.loc, /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2}))?$/.test(e.lastmod) && !Number.isNaN(t) && t <= Date.now() + 86_400_000, e.lastmod);
    L.rec("sitemap-lastmod-only-where-a-date-exists", e.loc, fam === "blog" || fam === "guide", `a lastmod on a ${fam} page: only blog posts and guides carry a real date`);
  }
  check("city-switch-agrees-with-the-expectation", CITY_PAGES_INDEXABLE === EXPECT_CITY_PAGES_INDEXABLE, "CITY_PAGES_INDEXABLE (src/lib/seo.ts) was flipped: flip EXPECT_CITY_PAGES_INDEXABLE in scripts/qa-seo.ts with it, once the city pages carry copy of their own");
  const cityListed = locs.some((u) => familyOf(new URL(u).pathname) === "city");
  check("sitemap-city-pages-follow-the-switch", cityListed === EXPECT_CITY_PAGES_INDEXABLE, EXPECT_CITY_PAGES_INDEXABLE ? "city pages are meant to be indexable and the sitemap lists none" : "city pages are noindex and the sitemap lists some");
  // Every listed URL, not a sample: 200, indexable, names itself as canonical, allowed by robots.txt, not private.
  await sitemapContent(L, locs, async (u) => {
    const r = await get(u);
    return { resp: r, f: extract(r.body) };
  }, SITE_ORIGIN, g);

  // ── which URLs to crawl ──
  const byFamily = new Map<string, string[]>();
  for (const u of locs) {
    const fam = familyOf(new URL(u).pathname);
    byFamily.set(fam, [...(byFamily.get(fam) ?? []), u]);
  }
  const picks: string[] = [];
  const summary: string[] = [];
  for (const [fam, list] of byFamily) {
    const sorted = [...list].sort();
    const chosen = fam === "static" || FULL ? sorted : [...new Set([...sorted.slice(0, 3), ...sorted.filter((_, i) => i % 12 === SEED % 12)])];
    picks.push(...chosen);
    summary.push(`${fam} ${chosen.length}/${list.length}`);
  }
  console.log(`sitemap: ${locs.length} URLs; crawling ${picks.length}${FULL ? " (QA_SEO_FULL)" : ""}: ${summary.join(", ")}`);
  check("sitemap-families-are-all-known", !byFamily.has("other"), (byFamily.get("other") ?? []).slice(0, 5).join(", "));

  // ── crawl ──
  const rootSrc = fs.readFileSync(path.join(ROOT, "src", "app", "layout.tsx"), "utf8");
  const rootDescription = /description:\s*"([^"]+)"/.exec(rootSrc)?.[1] ?? null;
  const pages = new Map<string, { resp: Resp; f: Facts }>();
  await pool(picks, 6, async (loc) => {
    const resp = await get(loc);
    pages.set(loc, { resp, f: extract(resp.body) });
  });
  const ctxFor = (loc: string): PageCtx => ({ loc, origin: SITE_ORIGIN, rootDescription, robots: g, family: familyOf(new URL(loc).pathname) });
  for (const [loc, { resp, f }] of pages) auditPage(L, resp, f, ctxFor(loc));
  const imgCount = [...pages.values()].reduce((n, p) => n + p.f.imgs.length, 0);
  if (imgCount === 0) note("no crawled page renders an <img> (graphics are SVG, CSS and the generated icons): img-alt and img-dimensions only ran on the planted defect, and there is no hero image to prioritise or size (no LCP image handling to check)");

  // uniqueness across the crawled set
  const titleOwners = new Map<string, string[]>();
  const descOwners = new Map<string, string[]>();
  for (const [loc, { f }] of pages) {
    const t = f.titles[0] ?? "";
    const d = metaAll(f, "description")[0] ?? "";
    titleOwners.set(t, [...(titleOwners.get(t) ?? []), loc]);
    descOwners.set(d, [...(descOwners.get(d) ?? []), loc]);
  }
  uniqueChecks(L, titleOwners, descOwners);

  // family expectations
  for (const [loc, { f }] of pages) {
    const fam = familyOf(new URL(loc).pathname);
    const have = new Set(nodesOf(f).map(typeOf));
    for (const t of EXPECT_TYPES[fam] ?? []) L.rec("family-structured-data-present", `${loc} ${t}`, have.has(t), `a ${fam} page without ${t}`);
    if (fam === "error-code") {
      const code = decodeURIComponent(new URL(loc).pathname.split("/").pop() ?? "");
      const [brand, ...rest] = code.split("-");
      L.rec("family-error-code-names-brand-and-code", loc, (f.titles[0] ?? "").includes(brand) && (f.titles[0] ?? "").includes(rest.join("-")) && (h1s(f)[0]?.text ?? "").includes(rest.join("-")), f.titles[0] ?? "");
    }
  }
  const home = pages.get(`${SITE_ORIGIN}/`);
  if (home) {
    const have = new Set(nodesOf(home.f).map(typeOf));
    check("home-has-organization-and-website", have.has("Organization") && have.has("WebSite"));
    check("home-has-no-faq-page", !have.has("FAQPage"));
    const gv = process.env.QA_EXPECT_GOOGLE_VERIFICATION;
    const bv = process.env.QA_EXPECT_BING_VERIFICATION;
    if (gv) check("verification-google-tag-present", metaAll(home.f, "google-site-verification").includes(gv));
    if (bv) check("verification-bing-tag-present", metaAll(home.f, "msvalidate.01").includes(bv));
    check("verification-tags-are-never-empty", ["google-site-verification", "msvalidate.01"].every((k) => metaAll(home.f, k).every((v) => v.length > 0)));
    check("home-links-manifest-and-icons", linkAll(home.f, "manifest").length === 1 && linkAll(home.f, "icon").length >= 1 && linkAll(home.f, "apple-touch-icon").length === 1);
  } else {
    check("home-is-in-the-crawl", false, "/ is not in the sitemap");
  }

  // company facts in JSON-LD must be printed somewhere on the site
  const allText = [...pages.values()].map((p) => p.f.text).join(" ");
  const factPages = await Promise.all(["/contact", "/voorwaarden", "/privacy", "/retourvoorwaarden"].map((p) => get(`${SITE_ORIGIN}${p}`)));
  const siteText = `${allText} ${factPages.map((r) => extract(r.body).text).join(" ")}`;
  for (const v of pendingCompanyFacts) L.rec("organization-fact-is-printed", v, siteText.includes(v), "in the markup but not printed anywhere on the pages crawled");

  // Search action target works
  for (const target of pendingSearchTargets) {
    const r = await get(target.replace("{search_term_string}", "E18"));
    L.rec("website-search-target-works", target, r.status === 200 && /E18/.test(extract(r.body).text), `HTTP ${r.status}`);
  }

  // ── links ──
  await linkChecks(pages, g, locs);

  // breadcrumb targets
  for (const t of pendingBreadcrumbTargets) {
    const r = await get(t);
    const f = extract(r.body);
    L.rec("breadcrumb-target-is-an-indexable-200", t, r.status === 200 && !isNoindex(f, r.headers) && sameUrl(linkAll(f, "canonical")[0] ?? "", t), `HTTP ${r.status}`);
  }

  // OG image + logo are real PNGs
  const images = new Set<string>();
  for (const { f } of pages.values()) {
    const i = metaAll(f, "og:image")[0];
    if (i && i.startsWith(SITE_ORIGIN)) images.add(i);
  }
  for (const i of images) {
    const r = await getBinary(i);
    const s = pngSize(r.bytes);
    L.rec("og-image-is-1200x630-png", i, r.status === 200 && /png/.test(r.type) && s?.w === 1200 && s?.h === 630, `HTTP ${r.status} ${r.type} ${s ? `${s.w}x${s.h}` : "not a png"}`);
    L.rec("image-cache-is-at-most-a-day", i, imageCacheProblem(r.cacheControl) === null, imageCacheProblem(r.cacheControl) ?? "");
  }
  // The generated images pages and the manifest name without a content hash.
  for (const p of ["/opengraph-image", "/icon", "/apple-icon"]) {
    const r = await getBinary(`${SITE_ORIGIN}${p}`);
    L.rec("image-cache-is-at-most-a-day", p, r.status === 200 && imageCacheProblem(r.cacheControl) === null, `HTTP ${r.status}: ${imageCacheProblem(r.cacheControl) ?? ""}`);
  }
  if (home) {
    for (const n of nodesOf(home.f).filter((x) => typeOf(x) === "Organization")) {
      const logo = String(n.logo ?? "");
      const r = await getBinary(logo);
      const s = pngSize(r.bytes);
      check("organization-logo-is-a-real-image-of-at-least-112px", r.status === 200 && /png/.test(r.type) && (s?.w ?? 0) >= 112 && (s?.h ?? 0) >= 112, `${logo}: HTTP ${r.status} ${s ? `${s.w}x${s.h}` : r.type}`);
      L.rec("image-cache-is-at-most-a-day", logo, imageCacheProblem(r.cacheControl) === null, imageCacheProblem(r.cacheControl) ?? "");
    }
  }

  await exclusionChecks(g, new Set(locs), rootDescription, pages);
  await crawlerDeliveryChecks(locs);
  await notFoundChecks();
  await redirectChecks();
  await manifestChecks(home?.f ?? null);

  // ── the defect proofs ──
  await mutationProofs(pages, locs, g, rootDescription, titleOwners, descOwners);
}

/**
 * The dynamic pages (they read searchParams or cookies, so Next streams their metadata for a client it does not know as a
 * crawler) and a few filter variants, fetched as each crawler: the title, description, Open Graph and the canonical (or the
 * robots tag, on a noindex variant) must be inside <head>.
 */
async function crawlerDeliveryChecks(locs: string[]): Promise<void> {
  section("crawler delivery: the metadata is inside <head> for every crawler");
  const pathOf = (fam: string) => locs.map((u) => new URL(u).pathname).find((p) => familyOf(p) === fam);
  const indexable = ["/", "/diagnose", "/onderdelen", "/contact", "/foutcodes", "/retour/start", "/gidsen", "/over", pathOf("part"), pathOf("error-code"), pathOf("guide"), pathOf("brand-repair")].filter((p): p is string => !!p);
  const noindex = ["/onderdelen?q=pomp", "/foutcodes?brand=Bosch", "/gidsen?difficulty=EASY", "/retour/start?t=abc", "/qr/ABC123"];
  const jobs: Array<[string, string, string, boolean]> = [];
  for (const [name, ua] of CRAWLERS) {
    for (const p of indexable) jobs.push([name, ua, p, false]);
    for (const p of noindex) jobs.push([name, ua, p, true]);
  }
  await pool(jobs, 6, async ([name, ua, p, noindexVariant]) => {
    const r = await request(`${SITE_ORIGIN}${p}`, { "user-agent": ua });
    const outside = tagsOutsideHead(extract(r.body), { canonical: !noindexVariant, robots: noindexVariant });
    L.rec("crawler-gets-metadata-in-head", `${name} ${p}`, r.status === 200 && outside.length === 0, `HTTP ${r.status}; not inside <head>: ${outside.join(", ")}`);
  });
  // An ordinary visitor is not a crawler: the rule above must not turn every visit into a blocking render. (Informational:
  // a page that is static anyway has its metadata in the head for everybody.)
  const streamed: string[] = [];
  for (const p of indexable) {
    const r = await request(`${SITE_ORIGIN}${p}`, { "user-agent": UA_BROWSER });
    if (tagsOutsideHead(extract(r.body), { canonical: true, robots: false }).length > 0) streamed.push(p);
  }
  note(`streamed metadata for ordinary visitors (by design, only crawlers get it blocking): ${streamed.length} of ${indexable.length} probe pages${streamed.length ? `, e.g. ${streamed.slice(0, 5).join(" ")}` : ""}`);
}

function uniqueChecks(l: Ledger, titleOwners: Map<string, string[]>, descOwners: Map<string, string[]>): void {
  for (const [t, owners] of titleOwners) l.rec("title-unique", owners[0], owners.length === 1, `shared by ${owners.length}: ${t}`);
  for (const [d, owners] of descOwners) l.rec("description-unique", owners[0], owners.length === 1, `shared by ${owners.length}: ${d.slice(0, 60)}`);
}

async function linkChecks(pages: Map<string, { resp: Resp; f: Facts }>, robots: RobotsGroup[], sitemapLocs: string[]): Promise<void> {
  const targets = new Map<string, { sample: string; from: string }>();
  const linkedPaths = new Set<string>();
  const sitemapPaths = new Set(sitemapLocs.map((u) => decodeURI(new URL(u).pathname)));
  const stateOnly = new Set(["prefill", "onderwerp", "subject", "plan", "order", "utm_source", "utm_medium", "utm_campaign", "ref", "next", "redirect_url"]);
  for (const [loc, { f }] of pages) {
    for (const a of f.anchors) {
      const href = a.href;
      if (!href || /^(mailto:|tel:|javascript:|#)/i.test(href)) continue;
      if ((a.rel ?? "").split(/\s+/).includes("nofollow")) continue;
      let u: URL;
      try {
        u = new URL(href, loc);
      } catch {
        continue;
      }
      if (u.origin !== SITE_ORIGIN) continue;
      if (u.pathname.startsWith("/api/") || u.pathname.startsWith("/_next/")) continue;
      linkedPaths.add(decodeURI(u.pathname));
      const names = [...u.searchParams.keys()].sort();
      // One representative per (path, parameter names): /diagnose?prefill=<text> is 360 addresses of one page.
      const key = `${u.pathname}?${names.join("&")}`;
      if (!targets.has(key)) targets.set(key, { sample: u.pathname + u.search, from: loc });
    }
  }
  let knownDebt = 0;
  await pool([...targets.entries()], 6, async ([, { sample, from }]) => {
    const full = `${SITE_ORIGIN}${sample}`;
    const p = new URL(full);
    let r = await get(full);
    let hops = 0;
    while (r.status >= 300 && r.status < 400 && r.location && hops < 4) {
      r = await get(new URL(r.location, full).href);
      hops++;
    }
    const f = extract(r.body);
    L.rec("link-resolves", `${sample} <- ${from}`, r.status < 400 || isPrivate(p.pathname), `HTTP ${r.status}`);
    if (isPrivate(p.pathname)) return;
    // The other half of "no orphans": an indexable page that pages link to must be in the sitemap.
    if (r.status === 200 && !isNoindex(f, r.headers)) {
      const landed = decodeURI(new URL(r.url, SITE_ORIGIN).pathname);
      L.rec("linked-indexable-page-is-in-the-sitemap", `${sample} <- ${from}`, sitemapPaths.has(landed), `${landed} is indexable and linked but not in the sitemap`);
    }
    L.rec("link-not-a-redirect", `${sample} <- ${from}`, hops === 0, `${hops} redirect(s)`);
    if (r.status === 200 && isNoindex(f, r.headers)) {
      // A filtered variant of an indexable list page is a navigation control, not a content link.
      const isVariantOfList = Object.keys(LIST_FILTER_PARAMS).includes(p.pathname) && [...p.searchParams.keys()].some((k) => !stateOnly.has(k));
      if (isVariantOfList) return;
      if (isKnownThinBrandPath(p.pathname)) {
        knownDebt++;
        return;
      }
      L.rec("link-to-noindex-page", `${sample} <- ${from}`, false, "an indexable page links to a noindex page");
    } else {
      L.rec("link-to-noindex-page", sample, true);
    }
  });
  void robots;
  // Reachability needs the whole link graph, so it is only judged when every sitemap page was crawled.
  if (FULL) {
    for (const path of sitemapPaths) L.rec("sitemap-page-is-linked-from-somewhere", path, path === "/" || linkedPaths.has(path), "no crawled page links to it (an orphan)");
  } else {
    note("sitemap-page-is-linked-from-somewhere is only judged with QA_SEO_FULL=1 (a sample of pages cannot show a page is an orphan).");
  }
  if (knownDebt > 0) note(`KNOWN, tracked in the report (openQuestions): ${knownDebt} link(s) from indexable pages to thin brand pages that are noindex (footer and /merken list every brand in brands.json, five have no catalogue).`);
  console.log(`links: ${targets.size} distinct internal targets (by path and parameter names) from ${pages.size} pages`);
}

async function exclusionChecks(robots: RobotsGroup[], inSitemap: Set<string>, rootDescription: string | null, pages: Map<string, { resp: Resp; f: Facts }>): Promise<void> {
  void rootDescription;
  void pages;
  const listed = (p: string) => inSitemap.has(`${SITE_ORIGIN}${p}`);
  // Private and transactional: noindex as header and tag, disallowed in robots.txt, not in the sitemap.
  for (const p of ["/checkout", "/inloggen", "/registreren", "/upgrade", "/upgrade?plan=PARTICULIER"]) {
    const r = await get(p);
    const f = extract(r.body);
    L.rec("private-noindex-header", p, /noindex/.test(r.headers["x-robots-tag"] ?? ""), `X-Robots-Tag ${r.headers["x-robots-tag"] ?? "-"}`);
    L.rec("private-noindex-tag", p, metaAll(f, "robots").some((c) => /noindex/.test(c)), `robots meta ${JSON.stringify(metaAll(f, "robots"))}`);
    L.rec("private-disallowed-in-robots", p, !robotsAllows(robots, "Googlebot", p));
    L.rec("private-not-in-sitemap", p, !listed(p.split("?")[0]));
  }
  // Behind a login: an anonymous caller is sent to sign-in, and the redirect itself says noindex.
  for (const p of ["/dashboard", "/dashboard/profiel", "/dashboard/bestellingen", "/admin", "/admin/bestellingen", "/monteur/dashboard", "/monteur/klanten", "/monteur/onderdelen", "/monteur/werkorders", "/monteur/instellingen"]) {
    const r = await get(p);
    L.rec("private-area-is-closed-to-anonymous", p, [301, 302, 303, 307, 308, 401, 403, 404].includes(r.status), `HTTP ${r.status}`);
    L.rec("private-area-noindex-header", p, /noindex/.test(r.headers["x-robots-tag"] ?? ""), `X-Robots-Tag ${r.headers["x-robots-tag"] ?? "-"}`);
    L.rec("private-disallowed-in-robots", p, !robotsAllows(robots, "Googlebot", p));
    L.rec("private-not-in-sitemap", p, !listed(p));
  }
  for (const p of ["/bestelling/abc", "/bestelling/abc/factuur"]) {
    const r = await get(p);
    L.rec("private-noindex-header", p, /noindex/.test(r.headers["x-robots-tag"] ?? ""), `X-Robots-Tag ${r.headers["x-robots-tag"] ?? "-"}`);
    L.rec("private-disallowed-in-robots", p, !robotsAllows(robots, "Googlebot", p));
  }
  for (const p of ["/api/parts", "/api/v1/health"]) {
    const r = await get(p);
    L.rec("private-noindex-header", p, /noindex/.test(r.headers["x-robots-tag"] ?? ""), `X-Robots-Tag ${r.headers["x-robots-tag"] ?? "-"}`);
    L.rec("private-disallowed-in-robots", p, !robotsAllows(robots, "Googlebot", p));
  }

  // Crawlable noindex: thin pages and parameter variants. They must stay reachable (so the tag is seen), and stay out of the sitemap.
  const brands = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "data", "brands.json"), "utf8")) as Array<{ slug: string }>;
  const thin = brands.map((b) => `/${b.slug}-wasmachine-reparatie`).filter((p) => !listed(p));
  check("some-brand-has-no-catalogue", thin.length > 0, "brands.json brands without a sitemap entry");
  const knownThinPaths = KNOWN_THIN_BRANDS.map((slug) => `/${slug}-wasmachine-reparatie`);
  check("known-thin-brands-are-the-brands-without-a-sitemap-entry", thin.length === knownThinPaths.length && thin.every((p) => knownThinPaths.includes(p)), `brands without a sitemap entry: ${thin.join(" ")} | KNOWN_THIN_BRANDS in scripts/qa-seo.ts: ${knownThinPaths.join(" ")}`);
  // Every filter parameter of every list page, from the expected table: each must give a noindex,follow variant without a canonical.
  const variants = Object.entries(ALL_VARIANT_PARAMS).flatMap(([p, keys]) => keys.map((k) => `${p}?${k}=${variantValue(p, k)}`));
  const crawlableNoindex = [...(EXPECT_CITY_PAGES_INDEXABLE ? [] : ["/wasmachine-kapot/amsterdam"]), ...thin.slice(0, 2), ...variants, "/qr/ABC123"];
  for (const p of crawlableNoindex) {
    const r = await get(p);
    const f = extract(r.body);
    L.rec("noindex-page-answers-200", p, r.status === 200, `HTTP ${r.status}`);
    L.rec("noindex-page-has-the-tag", p, metaAll(f, "robots").some((c) => /noindex/.test(c)), `robots meta ${JSON.stringify(metaAll(f, "robots"))}`);
    L.rec("noindex-page-has-exactly-one-robots-tag", p, metaAll(f, "robots").length === 1, `${metaAll(f, "robots").length} tags`);
    L.rec("noindex-page-stays-crawlable", p, robotsAllows(robots, "Googlebot", p), "disallowed: the noindex tag could never be read");
    // (A variant's base page IS listed; the variant itself, with its query string, never is.)
    L.rec("noindex-page-not-in-sitemap", p, !listed(p));
    if (p.includes("?") || p.startsWith("/qr/") === false) {
      // A variant does not name another page as its canonical next to its noindex (a mixed signal).
      const canon = linkAll(f, "canonical");
      // (A variant has none at all; a noindex page without a query may name itself.)
      const selfOrNone = p.includes("?") ? canon.length === 0 : canon.length === 0 || sameUrl(canon[0], `${SITE_ORIGIN}${p}`);
      L.rec("noindex-page-no-mixed-canonical", p, selfOrNone, `canonical ${canon[0] ?? "-"}`);
    }
  }
  // The same noindex as a response header (next.config.ts), so the signal does not depend on how the HTML is delivered.
  // (A value with a line break too: Next anchors the header's value pattern and `.` does not match a line break, which once left
  // `?q=a%0Ab` with the tag in the page and no header.)
  for (const p of [...variants, "/onderdelen?q=a%0Ab", "/qr/ABC123", "/retour/start?t=abc"]) {
    const r = await get(p);
    const header = r.headers["x-robots-tag"] ?? "";
    const tag = metaAll(extract(r.body), "robots").join(" ");
    L.rec("variant-noindex-header", p, /\bnoindex\b/i.test(header), `X-Robots-Tag ${header || "-"}`);
    L.rec("variant-header-agrees-with-the-tag", p, /\bnofollow\b/i.test(header) === /\bnofollow\b/i.test(tag), `header "${header}" vs tag "${tag}"`);
  }
  // A file in public/ cannot carry a robots tag, so its header is the only signal: every HTML or PDF document there is noindex (the lead-magnet
  // cheat sheet is handed out for an e-mail address, the offline page belongs to the service worker), and none is listed in the sitemap.
  // The one kind of file that must stay plain is the IndexNow key (public/<key>.txt): the engine has to read it.
  {
    const publicDir = path.join(ROOT, "public");
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
    const files = walk(publicDir).map((f) => `/${path.relative(publicDir, f).split(path.sep).join("/")}`);
    const documents = files.filter((f) => /\.(html?|pdf)$/i.test(f));
    const keyFiles = files.filter((f) => /^\/[A-Za-z0-9-]{8,128}\.txt$/.test(f));
    check("public-documents-are-found", documents.length >= 3 && documents.includes("/offline.html") && documents.some((f) => f.startsWith("/leadmagnets/")), documents.join(" "));
    for (const f of documents) {
      const r = await get(f);
      L.rec("static-document-noindex-header", f, r.status === 200 && /\bnoindex\b/i.test(r.headers["x-robots-tag"] ?? ""), `HTTP ${r.status}, X-Robots-Tag ${r.headers["x-robots-tag"] ?? "-"}`);
      L.rec("static-document-not-in-sitemap", f, !listed(f));
    }
    for (const f of keyFiles) {
      const r = await get(f);
      L.rec("indexnow-key-file-stays-plain", f, r.status === 200 && !/\bnoindex\b/i.test(r.headers["x-robots-tag"] ?? "") && robotsAllows(robots, "bingbot", f), `HTTP ${r.status}, X-Robots-Tag ${r.headers["x-robots-tag"] ?? "-"}`);
    }
  }
  // ...and the addresses that are the page itself carry none (a blank ?q= and tracking parameters are not variants).
  for (const p of ["/", "/over", "/onderdelen", "/onderdelen?q=", "/onderdelen?q=%20", "/onderdelen?utm_source=x", "/foutcodes?utm_medium=y", "/gidsen", "/retour/start", "/retour/start?order=x"]) {
    const r = await get(p);
    L.rec("indexable-url-has-no-noindex-header", p, !/\bnoindex\b/i.test(r.headers["x-robots-tag"] ?? ""), `X-Robots-Tag ${r.headers["x-robots-tag"] ?? "-"}`);
  }
  // The return form with a token is private; without it the page is a normal one.
  const rt = await get("/retour/start?t=abc");
  const rtF = extract(rt.body);
  check("retour-with-token-is-noindex-without-canonical", metaAll(rtF, "robots").some((c) => /noindex/.test(c)) && linkAll(rtF, "canonical").length === 0, JSON.stringify(metaAll(rtF, "robots")));
  const rp = await get("/retour/start?order=x");
  check("retour-with-order-number-only-is-the-normal-page", !metaAll(extract(rp.body), "robots").some((c) => /noindex/.test(c)) && sameUrl(linkAll(extract(rp.body), "canonical")[0] ?? "", `${SITE_ORIGIN}/retour/start`));

  // Parameters that do not change the content consolidate onto the clean address.
  for (const [p, canonical] of [["/?utm_source=x", `${SITE_ORIGIN}`], ["/?ref=abc", `${SITE_ORIGIN}`], ["/onderdelen?utm_medium=y", `${SITE_ORIGIN}/onderdelen`], ["/onderdelen?q=", `${SITE_ORIGIN}/onderdelen`], ["/onderdelen?q=%20", `${SITE_ORIGIN}/onderdelen`], ["/diagnose?prefill=Mijn%20Bosch%20E18", `${SITE_ORIGIN}/diagnose`], ["/blog?x=1", `${SITE_ORIGIN}/blog`], ["/contact?onderwerp=monteur-demo", `${SITE_ORIGIN}/contact`], ["/foutcodes/Bosch-E18?utm_campaign=a", `${SITE_ORIGIN}/foutcodes/Bosch-E18`]] as const) {
    const r = await get(p);
    const f = extract(r.body);
    L.rec("tracking-parameter-consolidates-onto-the-clean-url", p, r.status === 200 && sameUrl(linkAll(f, "canonical")[0] ?? "", canonical) && !isNoindex(f, r.headers), `HTTP ${r.status}, canonical ${linkAll(f, "canonical")[0] ?? "-"}`);
  }
}

async function notFoundChecks(): Promise<void> {
  for (const p of ["/definitely-not-a-page-xyz", "/onderdelen/NOPE-1", "/foutcodes/Bosch-ZZZ99", "/gidsen/nope", "/blog/nope", "/help/nope", "/vs/nope", "/merken/Bosch/NOPE", "/merken/Zanussi", "/wasmachine-kapot/nergens", "/nope-wasmachine-reparatie", "/cart", "/winkelwagen"]) {
    const r = await get(p);
    const f = extract(r.body);
    L.rec("404-status", p, r.status === 404, `HTTP ${r.status}`);
    L.rec("404-noindex", p, metaAll(f, "robots").some((c) => /noindex/.test(c)), `robots meta ${JSON.stringify(metaAll(f, "robots"))}`);
    L.rec("404-exactly-one-robots-tag", p, metaAll(f, "robots").length === 1, `${metaAll(f, "robots").length} tags`);
    L.rec("404-no-canonical", p, linkAll(f, "canonical").length === 0, linkAll(f, "canonical").join(","));
    // (On a dynamic route the 404 body can be rendered by the browser, so the title is what the HTML itself says.)
    L.rec("404-says-so", p, /niet gevonden/i.test(f.titles[0] ?? ""), f.titles[0] ?? "");
  }
  const bad = await get("/foutcodes/%ZZ");
  check("malformed-escape-is-400-not-500", bad.status === 400, `HTTP ${bad.status}`);
}

async function redirectChecks(): Promise<void> {
  const expect: Array<[string, number[], string]> = [
    ["/onderdelen/", [308], "/onderdelen"],
    ["/foutcodes/Bosch-E18/", [308], "/foutcodes/Bosch-E18"],
    ["/merken/bosch", [308], "/merken/Bosch"],
    ["/foutcodes/bosch-e18", [308], "/foutcodes/Bosch-E18"],
    ["/reparatie/bosch", [308], "/bosch-wasmachine-reparatie"],
    ["/index", [308], "/"],
    ["/voor-monteurs", [308], "/monteur"],
    ["/login", [308], "/inloggen"],
    ["/register", [308], "/registreren"],
    ["/favicon.ico", [307, 308], "/icon"],
  ];
  for (const [from, statuses, to] of expect) {
    const r = await get(from);
    const dest = r.location ? new URL(r.location, `${SITE_ORIGIN}${from}`).pathname : "";
    L.rec("redirect-is-permanent-and-lands-on-the-canonical", from, statuses.includes(r.status) && dest === to, `HTTP ${r.status} -> ${r.location}`);
  }
  const brandPage = await get("/bosch-wasmachine-reparatie");
  check("brand-repair-page-is-served-at-its-pretty-url", brandPage.status === 200 && sameUrl(linkAll(extract(brandPage.body), "canonical")[0] ?? "", `${SITE_ORIGIN}/bosch-wasmachine-reparatie`));
  // www / apex: only meaningful when the origin is a real domain; the redirect needs the Host header of the other variant.
  const host = new URL(SITE_ORIGIN).hostname;
  if (!/^(localhost|127\.|0\.0\.0\.0|\d+\.\d+\.\d+\.\d+)$/.test(host) && !/\.vercel\.app$/.test(host)) {
    const other = host.startsWith("www.") ? host.slice(4) : `www.${host}`;
    const r = await request("/onderdelen", { host: other });
    check("other-host-variant-redirects-permanently-to-the-canonical-host", r.status === 308 && r.location === `${SITE_ORIGIN}/onderdelen`, `HTTP ${r.status} -> ${r.location}`);
  } else {
    note("www/apex redirect not tested: the public origin is not a real domain here. It is configured in next.config.ts and proved by scripts/qa-platform.ts; DNS and the host-level redirect are the owner's (BLOCKED.md step 2).");
  }
}

async function manifestChecks(home: Facts | null): Promise<void> {
  const mr = await get("/manifest.webmanifest");
  let man: Record<string, unknown> = {};
  try {
    man = JSON.parse(mr.body) as Record<string, unknown>;
  } catch {
    /* reported below */
  }
  check("manifest-is-json", mr.status === 200 && /json/.test(mr.headers["content-type"] ?? "") && typeof man.name === "string", `HTTP ${mr.status}`);
  check("manifest-required-members", ["name", "short_name", "start_url", "display", "icons", "lang", "theme_color", "background_color"].every((k) => man[k] !== undefined), Object.keys(man).join(","));
  check("manifest-colors-are-hex", /^#[0-9a-f]{6}$/i.test(String(man.theme_color)) && /^#[0-9a-f]{6}$/i.test(String(man.background_color)), `${String(man.theme_color)} ${String(man.background_color)}`);
  check("manifest-start-url-in-scope", String(man.start_url).startsWith(String(man.scope ?? "/")));
  const icons = (Array.isArray(man.icons) ? man.icons : []) as Array<{ src: string; sizes?: string; type?: string; purpose?: string }>;
  for (const ic of icons) {
    const r = await getBinary(ic.src);
    const s = pngSize(r.bytes);
    const declared = /^(\d+)x(\d+)$/.exec(ic.sizes ?? "");
    L.rec("manifest-icon-is-a-png", ic.src, r.status === 200 && /png/.test(r.type) && s !== null, `HTTP ${r.status} ${r.type}`);
    L.rec("manifest-icon-size-is-the-declared-size", ic.src, !!declared && !!s && s.w === Number(declared[1]) && s.h === Number(declared[2]), `declared ${ic.sizes}, file ${s ? `${s.w}x${s.h}` : "?"}`);
    L.rec("image-cache-is-at-most-a-day", ic.src, imageCacheProblem(r.cacheControl) === null, imageCacheProblem(r.cacheControl) ?? "");
  }
  const anyIcons = icons.filter((i) => !i.purpose || /\bany\b/.test(i.purpose));
  check("manifest-installable-icons", anyIcons.some((i) => i.sizes === "192x192") && anyIcons.some((i) => i.sizes === "512x512"), "an installable app needs a 192 and a 512 px icon with purpose any");
  check("manifest-has-a-maskable-icon", icons.some((i) => /maskable/.test(i.purpose ?? "")));
  // The favicon Google uses: a multiple of 48 px.
  const fav = home ? linkAll(home, "icon")[0] : undefined;
  if (fav) {
    const r = await getBinary(new URL(fav, SITE_ORIGIN).href);
    const s = pngSize(r.bytes);
    check("favicon-is-a-multiple-of-48px", r.status === 200 && !!s && s.w === s.h && s.w % 48 === 0, s ? `${s.w}x${s.h}` : `HTTP ${r.status}`);
    L.rec("image-cache-is-at-most-a-day", fav, imageCacheProblem(r.cacheControl) === null, imageCacheProblem(r.cacheControl) ?? "");
  }
  const apple = home ? linkAll(home, "apple-touch-icon")[0] : undefined;
  if (apple) {
    const r = await getBinary(new URL(apple, SITE_ORIGIN).href);
    const s = pngSize(r.bytes);
    check("apple-touch-icon-is-180px", r.status === 200 && s?.w === 180 && s?.h === 180, s ? `${s.w}x${s.h}` : `HTTP ${r.status}`);
    L.rec("image-cache-is-at-most-a-day", apple, imageCacheProblem(r.cacheControl) === null, imageCacheProblem(r.cacheControl) ?? "");
  }
}

// ───────────────────────────── 4. defects: each one must be caught by the check named for it ─────────────────────────────

/** The streamed form: the tags a crawler needs sit right after <body>, past </head>. */
function moveMetadataIntoBody(h: string): string {
  const moved: string[] = [];
  const take = (re: RegExp) => {
    h = h.replace(re, (m) => {
      moved.push(m);
      return "";
    });
  };
  take(/<title[^>]*>[\s\S]*?<\/title>/i);
  take(/<meta[^>]*name="description"[^>]*>/i);
  take(/<link[^>]*rel="canonical"[^>]*>/i);
  take(/<meta[^>]*property="og:title"[^>]*>/i);
  return h.replace(/<body[^>]*>/i, (m) => `${m}${moved.join("")}`);
}

async function mutationProofs(
  pages: Map<string, { resp: Resp; f: Facts }>,
  locs: string[],
  robots: RobotsGroup[],
  rootDescription: string | null,
  titleOwners: Map<string, string[]>,
  descOwners: Map<string, string[]>,
): Promise<void> {
  section("defect proofs: the checks above must notice these");
  const partUrl = [...pages.keys()].find((u) => familyOf(new URL(u).pathname) === "part");
  const codeUrl = [...pages.keys()].find((u) => familyOf(new URL(u).pathname) === "error-code");
  const staticUrl = `${SITE_ORIGIN}/over`;
  const pricesUrl = `${SITE_ORIGIN}/prijzen`;
  if (!partUrl || !codeUrl || !pages.has(staticUrl) || !pages.has(pricesUrl)) {
    check("mutation-proofs-have-pages-to-work-on", false, "need a part page, an error code page, /over and /prijzen in the crawl");
    return;
  }
  const ctxFor = (loc: string): PageCtx => ({ loc, origin: SITE_ORIGIN, rootDescription, robots, family: familyOf(new URL(loc).pathname) });
  const base = pages.get(partUrl)!;
  const run = (loc: string, html: string, headers?: Record<string, string>) => {
    const l = new Ledger();
    const resp: Resp = { ...pages.get(loc)!.resp, body: html, headers: headers ?? pages.get(loc)!.resp.headers };
    auditPage(l, resp, extract(html), ctxFor(loc));
    return l;
  };
  type Proof = { name: string; mutation: string; expect: string; run: () => Promise<Ledger> | Ledger };
  const html = (loc: string) => pages.get(loc)!.resp.body;
  const proofs: Proof[] = [
    {
      name: "a broken canonical",
      mutation: "the canonical of a part page points at /",
      expect: "canonical-self",
      run: () => run(partUrl, html(partUrl).replace(/(<link[^>]*rel="canonical"[^>]*href=")[^"]*"/i, `$1${SITE_ORIGIN}/"`)),
    },
    {
      name: "a duplicated title",
      mutation: "a second page gets the title of the first",
      expect: "title-unique",
      run: () => {
        const l = new Ledger();
        const owners = new Map(titleOwners);
        const first = [...owners.entries()].find(([, o]) => o.length === 1)!;
        const other = [...owners.entries()].find(([t, o]) => o.length === 1 && t !== first[0])!;
        owners.set(first[0], [...first[1], other[1][0]]);
        owners.delete(other[0]);
        uniqueChecks(l, owners, new Map(descOwners));
        return l;
      },
    },
    {
      name: "an AggregateRating without reviews",
      mutation: 'a part page gains {"@type":"AggregateRating","ratingValue":"4.8","reviewCount":"127"} that no review on the page backs',
      expect: "jsonld-rating-needs-reviews",
      run: () =>
        run(
          partUrl,
          html(partUrl).replace(/("@type":"Product")/, '$1,"aggregateRating":{"@type":"AggregateRating","ratingValue":"4.8","reviewCount":"127","bestRating":"5","worstRating":"1"}'),
        ),
    },
    {
      name: "a noindex URL in the sitemap",
      mutation: `the sitemap also lists ${SITE_ORIGIN}/onderdelen?q=pomp`,
      expect: "sitemap-no-noindex",
      run: async () => {
        const l = new Ledger();
        await sitemapContent(l, [`${SITE_ORIGIN}/onderdelen?q=pomp`], async (u) => {
          const r = await get(u);
          return { resp: r, f: extract(r.body) };
        }, SITE_ORIGIN, robots);
        return l;
      },
    },
    {
      name: "a missing h1",
      mutation: "the h1 of an error code page is removed",
      expect: "one-h1",
      run: () => run(codeUrl, html(codeUrl).replace(/<h1\b[\s\S]*?<\/h1>/i, "")),
    },
    {
      name: "a page that is accidentally noindex",
      mutation: "the robots tag of /over says noindex",
      expect: "indexable",
      run: () => run(staticUrl, html(staticUrl).replace("</head>", '<meta name="robots" content="noindex"/></head>')),
    },
    {
      name: "a FAQPage whose questions are not on the page",
      mutation: "a part page gains a FAQPage",
      expect: "jsonld-faq-visible",
      run: () =>
        run(
          partUrl,
          html(partUrl).replace("</head>", '<script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Hoe lang gaat dit onderdeel mee?","acceptedAnswer":{"@type":"Answer","text":"Tien jaar."}}]}</script></head>'),
        ),
    },
    {
      name: "a product price that is not the printed price",
      mutation: "the price in the Product markup is changed to 1.00",
      expect: "product-price-visible",
      run: () => run(partUrl, html(partUrl).replace(/("price":")[0-9.]+(")/, "$11.00$2")),
    },
    {
      name: "a shared description",
      mutation: "a page uses the site-wide default description",
      expect: "description-not-generic",
      run: () => {
        if (!rootDescription) return new Ledger();
        return run(staticUrl, html(staticUrl).replace(/(<meta[^>]*name="description"[^>]*content=")[^"]*"/i, `$1${rootDescription.replace(/"/g, "&quot;")}"`));
      },
    },
    {
      name: "a title that carries the brand twice",
      mutation: "the title of /over becomes 'Over ons · WasFix Pro · WasFix Pro'",
      expect: "title-brand-once",
      run: () => run(staticUrl, html(staticUrl).replace(/<title>[^<]*<\/title>/i, "<title>Over ons · WasFix Pro · WasFix Pro</title>")),
    },
    {
      name: "an image without alt text",
      mutation: "an <img> without alt is added to /over",
      expect: "img-alt",
      run: () => run(staticUrl, html(staticUrl).replace("</body>", '<img src="/x.png" width="10" height="10"/></body>')),
    },
    {
      name: "a private path that robots.txt lets through",
      mutation: "the Disallow line for /checkout is removed",
      expect: "robots-blocks-private-path",
      run: () => {
        const l = new Ledger();
        const mutated = robots.map((g) => ({ ...g, rules: g.rules.filter((r) => r.pattern !== "/checkout") }));
        l.rec("robots-blocks-private-path", "/checkout", !robotsAllows(mutated, "Googlebot", "/checkout"), "reachable for a crawler");
        return l;
      },
    },
    {
      name: "metadata streamed into <body> for a crawler",
      mutation: "the title, description, canonical and og:title of a part page sit after </head> (the form Next sends a client it does not know as a crawler)",
      expect: "metadata-in-head",
      run: () => run(partUrl, moveMetadataIntoBody(html(partUrl))),
    },
    {
      name: "a plan price without period and VAT basis",
      mutation: "the priceSpecification is removed from the plan offers on /prijzen (a bare 29.00 reads as a one-off amount)",
      expect: "plan-offer-states-period-and-vat",
      run: () => run(pricesUrl, html(pricesUrl).replace(/"priceSpecification":\{[^}]*\},?/g, "")),
    },
    {
      name: "a universal part published with a brand",
      mutation: '"Universeel" is added as the Brand of a part',
      expect: "product-brand-is-a-manufacturer",
      run: () => run(partUrl, html(partUrl).replace('"offers":', '"brand":{"@type":"Brand","name":"Universeel"},"offers":')),
    },
    {
      name: "a sitemap that lists a private path",
      mutation: "the sitemap also lists /checkout",
      expect: "sitemap-no-private-path",
      run: async () => {
        const l = new Ledger();
        await sitemapContent(l, [`${SITE_ORIGIN}/checkout`], async (u) => {
          const r = await get(u);
          return { resp: r, f: extract(r.body) };
        }, SITE_ORIGIN, robots);
        return l;
      },
    },
  ];
  for (const p of proofs) {
    const l = await p.run();
    const caught = l.failedChecks();
    const ok = caught.includes(p.expect);
    L.rec("defect-is-caught-by-its-named-check", `${p.name}: ${p.mutation}`, ok, `expected ${p.expect}, the audit reported ${caught.join(", ") || "nothing"}`);
    console.log(`  ${ok ? "caught" : "MISSED"}: ${p.name} -> ${p.expect}`);
  }
  // The untouched pages must pass the very checks the defects trip (a check that always fails proves nothing).
  const clean = run(partUrl, html(partUrl));
  const cleanPrices = run(pricesUrl, html(pricesUrl));
  void base;
  check("untouched-page-passes-the-checks-the-defects-trip", ["canonical-self", "one-h1", "indexable", "jsonld-rating-needs-reviews", "jsonld-faq-visible", "product-price-visible", "product-brand-is-a-manufacturer", "metadata-in-head", "title-brand-once", "description-not-generic", "img-alt"].every((c) => !clean.failedChecks().includes(c)), clean.failedChecks().join(", "));
  check("untouched-plan-page-passes-the-plan-checks", ["plan-offer-states-period-and-vat", "plan-offer-matches-the-printed-price"].every((c) => !cleanPrices.failedChecks().includes(c)) && (cleanPrices.seen.get("plan-offer-states-period-and-vat") ?? 0) >= 2, `${cleanPrices.failedChecks().join(", ")}; plan offers seen: ${cleanPrices.seen.get("plan-offer-states-period-and-vat") ?? 0}`);
  void locs;
}

// ───────────────────────────── main ─────────────────────────────

async function main(): Promise<void> {
  console.log("SEO readiness: helpers and source first, then the running site");
  helperChecks();
  sourceChecks();
  await environmentChecks();
  if (!BASE) {
    if (process.env.QA_REQUIRE_SERVER === "1") check("a-server-was-given", false, "QA_BASE_URL is not set and QA_REQUIRE_SERVER=1");
    else console.log("SKIPPED: the HTTP half (robots.txt, sitemap, crawl, redirects, manifest, defect proofs): set QA_BASE_URL to a running production server.");
  } else {
    try {
      await httpChecks();
    } catch (e) {
      check("http-section-completed", false, e instanceof Error ? `${e.message}\n${e.stack}` : String(e));
    }
  }

  // report
  const names = [...L.seen.keys()];
  let failed = 0;
  for (const n of names) {
    const bad = L.failed.get(n);
    const total = L.seen.get(n) ?? 0;
    if (bad) {
      failed++;
      console.log(`❌ ${n}: ${bad.length} of ${total} failed`);
      for (const b of bad.slice(0, 6)) console.log(`     ${b}`);
      if (bad.length > 6) console.log(`     ... and ${bad.length - 6} more`);
    } else {
      console.log(`✅ ${n}${total > 1 ? ` (${total})` : ""}`);
    }
  }
  // Repeated notes are folded: one line with a count and the first three examples.
  const folded = new Map<string, string[]>();
  for (const n of L.notes) {
    const key = /^(.*?) (?:on|:) /.exec(n)?.[1] ?? n;
    folded.set(key, [...(folded.get(key) ?? []), n]);
  }
  for (const [key, list] of folded) {
    if (list.length <= 3) list.forEach((n) => console.log(`NOTE ${n}`));
    else console.log(`NOTE ${key}: ${list.length} pages, e.g. ${list.slice(0, 3).map((n) => n.replace(/^.*? on /, "")).join(" | ")}`);
  }
  if (sections.length) console.log(`\nsections: ${sections.join(" | ")}`);
  const subjects = [...L.seen.values()].reduce((a, b) => a + b, 0);
  console.log(`\n${names.length - failed}/${names.length} checks passed (${subjects} individual assertions)${failed ? `, ${failed} FAILED` : ""}`);
  process.exit(failed ? 1 : 0);
}

void main();
