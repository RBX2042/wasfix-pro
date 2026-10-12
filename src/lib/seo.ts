/**
 * SEO rules, in one place (decision D23).
 *
 * What lives here: the length rules for titles and descriptions, the complete page metadata (title,
 * description, canonical, Open Graph, Twitter) every public page is built from, the ONE indexability
 * function the page metadata and the sitemap both ask, the list of private paths robots.txt, the
 * X-Robots-Tag headers and the tests all read, the rule for parameter variants of a list page, and the
 * optional search-engine verification tags.
 *
 * Self-contained on purpose (relative imports only, no "@/" and nothing server-only): next.config.ts loads
 * it at build time for the X-Robots-Tag headers, and scripts/qa-seo.ts imports it to know the rules it
 * checks the running site against. JSON-LD builders are in ./json-ld.ts.
 *
 * Nothing here invents data: a title or description is built from what the page shows, and a page that
 * cannot say something true about itself falls back to a shorter, plainer sentence, never to a made-up one.
 */
import type { Metadata } from "next";
import { clipAtWord } from "./seo-text";

export type EnvLike = Record<string, string | undefined>;

// ─── Length rules ───────────────────────────────────────────────────────────────────────────────

export const SITE_NAME = "WasFix Pro";
/** The root layout's title template is "%s" + this. Keep the two in step (scripts/qa-seo.ts compares them). */
export const TITLE_SUFFIX = ` · ${SITE_NAME}`;
/** Longest whole title (suffix included) a result page shows before cutting it. Roughly 600 px. */
export const TITLE_MAX = 60;
export const TITLE_MIN = 20;
/** Longest text before the suffix that still fits TITLE_MAX. */
export const TITLE_BODY_MAX = TITLE_MAX - TITLE_SUFFIX.length;
export const DESCRIPTION_MIN = 70;
export const DESCRIPTION_MAX = 160;
export const OG_LOCALE = "nl_NL";
/** The one site-wide card (src/app/opengraph-image.tsx). `alt` is the same text that file exports. */
export const OG_IMAGE = { url: "/opengraph-image", width: 1200, height: 630, alt: "WasFix Pro — AI wasmachine diagnose" } as const;

function tidy(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** "Contact · WasFix Pro" -> "Contact": the template adds the suffix, a title must not bring its own. */
export function stripBrandSuffix(text: string): string {
  return tidy(text).replace(/\s*[·|–—-]\s*WasFix Pro$/i, "");
}

const mentionsBrand = (text: string) => text.toLowerCase().includes(SITE_NAME.toLowerCase());

/**
 * The title of a page, from candidates (most informative first):
 *   1. the first candidate that fits TITLE_MAX with the brand suffix the template adds;
 *   2. else the first that fits on its own, without the suffix (an absolute title: a long, specific title is
 *      worth more than the brand name, which og:site_name and the domain already carry);
 *   3. else the last candidate, cut at a word boundary to fit with the suffix.
 * The suffix therefore appears at most once. A candidate that already names the brand ("WasFix Pro vs Coolblue")
 * is always absolute, so the template never adds the brand a second time.
 */
export function pageTitle(...candidates: string[]): string | { absolute: string } {
  const bodies = candidates.map(stripBrandSuffix).filter((c) => c.length > 0);
  if (bodies.length === 0) throw new Error("pageTitle: no candidate");
  const withSuffix = bodies.find((b) => (mentionsBrand(b) ? b.length <= TITLE_MAX : b.length <= TITLE_BODY_MAX));
  if (withSuffix) return mentionsBrand(withSuffix) ? { absolute: withSuffix } : withSuffix;
  const alone = bodies.find((b) => b.length <= TITLE_MAX);
  if (alone) return { absolute: alone };
  const last = bodies[bodies.length - 1];
  const clipped = clipAtWord(last, mentionsBrand(last) ? TITLE_MAX : TITLE_BODY_MAX);
  return mentionsBrand(clipped) ? { absolute: clipped } : clipped;
}

/** The title as text, without the suffix: what Open Graph and Twitter print. */
export function titleText(title: string | { absolute: string }): string {
  return typeof title === "string" ? title : title.absolute;
}

/** The title as a search result shows it: the text plus the template's suffix, unless it is absolute. */
export function renderedTitle(title: string | { absolute: string }): string {
  return typeof title === "string" ? `${title}${TITLE_SUFFIX}` : title.absolute;
}

const endSentence = (s: string) => (/[.!?…]$/.test(s) ? s : `${s}.`);

/**
 * A description of 70 to 160 characters. `primary` is the sentence that says what is on THIS page; `extras`
 * are plain, true sentences that are appended (in order) only while the text is still shorter than
 * DESCRIPTION_MIN. Cut at a word boundary, never mid-word.
 */
export function pageDescription(primary: string, ...extras: string[]): string {
  let text = tidy(primary);
  for (const extra of extras) {
    if (text.length >= DESCRIPTION_MIN) break;
    const next = `${endSentence(text)} ${tidy(extra)}`;
    if (next.length <= DESCRIPTION_MAX) text = next;
  }
  return clipAtWord(text, DESCRIPTION_MAX);
}

// ─── Page metadata ──────────────────────────────────────────────────────────────────────────────

export type PageSeo = {
  /** From pageTitle(). */
  title: string | { absolute: string };
  /** From pageDescription() or a hand-written sentence of 70-160 characters. */
  description: string;
  /** Site-relative canonical path without query string: "/onderdelen/WF-PUMP-04". Resolved against metadataBase. */
  path: string;
  type?: "website" | "article";
  /** ISO date, only for an article that shows its date to the reader. */
  publishedTime?: string;
  /** A real photo of the thing the page is about; the site-wide card when absent. */
  image?: string;
  /** noindex, follow: thin or duplicate pages that must stay crawlable so the tag is seen. */
  noindex?: boolean;
};

/** Index/noindex as Metadata.robots. `undefined` = say nothing (indexable, the default). */
export function robotsMeta(index: boolean, follow = true): Metadata["robots"] {
  return index ? undefined : { index: false, follow };
}

/**
 * Title, description, self-canonical, Open Graph and Twitter in one object. A page that exports its own
 * `openGraph` REPLACES the root layout's (Next merges metadata one level deep), which is how 330 pages lost
 * og:url, og:locale and og:site_name; building every page from this function keeps the set complete.
 */
export function pageMetadata(seo: PageSeo): Metadata {
  const text = titleText(seo.title);
  const image = seo.image ? { url: seo.image } : OG_IMAGE;
  return {
    title: seo.title,
    description: seo.description,
    alternates: { canonical: seo.path },
    ...(seo.noindex ? { robots: robotsMeta(false, true) } : {}),
    openGraph: {
      title: text,
      description: seo.description,
      url: seo.path,
      siteName: SITE_NAME,
      locale: OG_LOCALE,
      type: seo.type ?? "website",
      ...(seo.publishedTime ? { publishedTime: seo.publishedTime } : {}),
      images: [image],
    },
    twitter: { card: "summary_large_image", title: text, description: seo.description, images: [image.url] },
  };
}

/**
 * Cache-Control of the generated images that are addressed without a content hash (the Open Graph card, the favicon,
 * the app icons, the manifest icons). `next/og` sends a year with `immutable` by default, which is right for an
 * address that changes with its content and wrong for these: a changed icon or card has to reach installed apps and
 * crawlers within a day. Every image route passes this as its `headers` option; scripts/qa-seo.ts reads the header
 * of each of them.
 */
export const IMAGE_CACHE_CONTROL = "public, max-age=86400, s-maxage=86400";

// ─── Parameter variants of list pages ───────────────────────────────────────────────────────────

type SearchParams = Record<string, string | string[] | undefined>;

/** The query parameters that change WHAT a list page shows (filters, search, sort, how many items). */
export const LIST_FILTER_PARAMS = {
  "/onderdelen": ["q", "cat", "brand", "sort", "n"],
  "/foutcodes": ["q", "brand", "n"],
  "/gidsen": ["q", "difficulty"],
} as const;

/** True when the address carries a parameter that changes the content (a non-empty value). */
export function isListVariant(sp: SearchParams, keys: readonly string[]): boolean {
  return keys.some((k) => {
    const v = sp[k];
    return Array.isArray(v) ? v.some((x) => x.trim() !== "") : typeof v === "string" && v.trim() !== "";
  });
}

/**
 * A list page with filters. Without a filter parameter it is the page itself. With one it is a variant: the
 * content differs from the page (so it is not a duplicate to canonicalise), it is thin as a landing page, and
 * the number of combinations is unbounded. It is noindex,follow WITHOUT a canonical tag: a canonical to the
 * unfiltered page next to a noindex is a mixed signal that Google may resolve by dropping the page it points
 * to. Parameters that do not change the content (utm_*, ref, fbclid) are not in the list: the page keeps its
 * self-canonical without the query string and those addresses consolidate onto it.
 */
export function listMetadata(seo: PageSeo, sp: SearchParams, keys: readonly string[]): Metadata {
  if (!isListVariant(sp, keys)) return pageMetadata(seo);
  return {
    title: seo.title,
    description: seo.description,
    alternates: {},
    robots: robotsMeta(false, true),
  };
}

/** A page that is crawlable but must not be indexed, expressed as an X-Robots-Tag header for next.config.ts. */
export type RobotsHeaderRule = {
  /** path-to-regexp source, as in next.config.ts headers(). */
  source: string;
  /** Only when the query parameter has a value (the same test as isListVariant: not empty, not blank). */
  has?: Array<{ type: "query"; key: string; value: string }>;
  /** The X-Robots-Tag value. */
  robots: string;
};

/**
 * A regular expression for "a value with at least one non-blank character" (isListVariant trims the same way). Next anchors
 * it (`^...$`), and `.` does not match a line break, so `.*\S.*` left a value such as `a%0Ab` without the header while the page
 * carried the tag; `[\s\S]` matches anything, line breaks included.
 */
const NON_BLANK = "[\\s\\S]*\\S[\\s\\S]*";

/** Files in public/ that are crawlable but must not be indexed (see variantHeaderRules): /leadmagnets/* and the offline page. */
export const STATIC_NOINDEX_SOURCES: readonly string[] = ["/leadmagnets/:path*", "/offline.html"];

/**
 * The same noindex that the pages put in a robots tag, as a response header. A header does not depend on how the
 * HTML is delivered: Next streams the metadata of a dynamic page (one that reads searchParams) into <body> for a
 * client it does not know as a crawler that needs it in <head>, and a robots tag or canonical outside <head> is not
 * something Google documents as honoured. The filter variants of the list pages carry no canonical, so the
 * noindex is their only signal and it must not hang on the delivery form. Rules, matching the page metadata:
 *   - a filtered, searched, sorted or "show more" variant of /onderdelen, /foutcodes, /gidsen: noindex, follow
 *     (listMetadata above; one rule per parameter in LIST_FILTER_PARAMS, so the two cannot drift apart);
 *   - /retour/start with an order token (?t=): noindex, nofollow, the page can carry the customer's access token;
 *   - /qr/<code>: one page per sticker, noindex, follow (the crawler may follow its links, the page itself is no landing page);
 *   - the static documents in public/ that are handed out or served for the app, not offered as landing pages: the lead-magnet
 *     cheat sheet (an e-mail address buys the link, a search result would hand it out for nothing) and the offline page of the
 *     service worker. A file cannot carry a robots tag, so the header is the only signal there is. The IndexNow key file is a
 *     static file too and stays plain on purpose (the engine has to read it).
 */
export function variantHeaderRules(): RobotsHeaderRule[] {
  const rules: RobotsHeaderRule[] = [];
  for (const [source, keys] of Object.entries(LIST_FILTER_PARAMS)) {
    for (const key of keys) rules.push({ source, has: [{ type: "query", key, value: NON_BLANK }], robots: "noindex, follow" });
  }
  rules.push({ source: "/retour/start", has: [{ type: "query", key: "t", value: ".+" }], robots: "noindex, nofollow" });
  rules.push({ source: "/qr/:path*", robots: "noindex, follow" });
  for (const source of STATIC_NOINDEX_SOURCES) rules.push({ source, robots: "noindex, follow" });
  return rules;
}

// ─── Indexability: one function, asked by the page metadata AND the sitemap ─────────────────────────

/**
 * Cities (/wasmachine-kapot/[stad]) are one template with the city name swapped in: a doorway-page pattern,
 * and the copy denies the local service the title would imply. Flip this together with copy that is
 * written per city; the page's robots tag and the sitemap follow.
 *
 * Flipping it has two more consequences, both caught by scripts/qa-seo.ts: flip EXPECT_CITY_PAGES_INDEXABLE there too
 * (`city-switch-agrees-with-the-expectation`), and link the city pages from somewhere on the site, because nothing links
 * to them today and a page in the sitemap that no page links to is an orphan (`sitemap-page-is-linked-from-somewhere`
 * fails for all 51, seen in the mutation run).
 *
 * Typed boolean, not the literal `false`: qa-seo compares it with its own expectation, and a literal type would turn the
 * owner flipping this switch into a type error that stops `next build` (scripts/ is part of the type check; the sandbox
 * build of the mutation proof found exactly that).
 */
export const CITY_PAGES_INDEXABLE: boolean = false;

export type Indexable =
  /** /{slug}-wasmachine-reparatie: `covered` = the brands the catalogue holds error codes for. */
  | { kind: "brandRepair"; brand: string; covered: ReadonlySet<string> }
  /** /merken/[brand]: machines of that brand. */
  | { kind: "brandHub"; machines: number }
  /** An entity page that exists (model, part, error code, guide, help article, blog post, comparison). */
  | { kind: "model" | "part" | "errorCode" | "guide" | "help" | "blog" | "vs"; exists: boolean }
  | { kind: "city" };

/** Why a page is, or is not, offered to a search engine. The sitemap lists exactly the `index: true` ones. */
export function indexability(i: Indexable): { index: boolean; reason: string } {
  switch (i.kind) {
    case "brandRepair":
      return i.covered.has(i.brand)
        ? { index: true, reason: "the catalogue holds codes for this brand" }
        : { index: false, reason: "no codes, machines or parts in the catalogue: thin page" };
    case "brandHub":
      return i.machines > 0 ? { index: true, reason: "has machines" } : { index: false, reason: "no machines" };
    case "city":
      return CITY_PAGES_INDEXABLE ? { index: true, reason: "city copy is unique" } : { index: false, reason: "doorway-page template" };
    default:
      return i.exists ? { index: true, reason: "exists" } : { index: false, reason: "does not exist" };
  }
}

/** The brands the catalogue holds error codes for: the input of indexability({ kind: "brandRepair" }). */
export function coveredBrands(errorCodes: ReadonlyArray<{ machine: { brand: string } }>): Set<string> {
  return new Set(errorCodes.map((ec) => ec.machine.brand));
}

// ─── The public sitemap: static pages ───────────────────────────────────────────────────────────

/**
 * Every static, public, indexable page. The sitemap lists exactly these plus the entity pages above;
 * scripts/qa-seo.ts walks src/app and fails for a public page that is in neither this list nor
 * PRIVATE_PATH_PREFIXES nor marked noindex, so a new page cannot be forgotten.
 */
export const SITEMAP_STATIC_PATHS: readonly string[] = [
  "/",
  "/diagnose",
  "/merken",
  "/foutcodes",
  "/gidsen",
  "/onderdelen",
  "/prijzen",
  "/monteur",
  "/help",
  "/blog",
  "/pers",
  "/right-to-repair",
  "/api-docs",
  "/contact",
  "/over",
  "/api-info",
  "/privacy",
  "/voorwaarden",
  "/cookies",
  "/garantie",
  "/klachten",
  "/disclaimer",
  "/retourvoorwaarden",
  "/retour/start",
  "/tools/repareren-of-vervangen",
  "/tools/garantie-check",
  "/tools/predictive",
  "/tools/qr-sticker",
];

// ─── Private and transactional paths ────────────────────────────────────────────────────────────

/**
 * Paths no search engine should crawl or index: the API, the admin, every account and technician screen,
 * checkout, sign-in and sign-up, the plan upgrade and the order pages. Read by robots.ts (Disallow), by
 * next.config.ts (X-Robots-Tag) and by scripts/qa-seo.ts.
 *
 * No trailing slash except /api/: a robots rule is a prefix match on the path, "/admin/" does not match the
 * page /admin and "/monteur/dashboard/" does not match /monteur/dashboard (the earlier list had exactly that
 * mistake). /api/ keeps its slash because /api-docs and /api-info are public pages. /monteur itself is the
 * public landing page for technicians and stays crawlable.
 */
export const PRIVATE_PATH_PREFIXES: readonly string[] = [
  "/api/",
  "/admin",
  "/dashboard",
  "/monteur/dashboard",
  "/monteur/klanten",
  "/monteur/onderdelen",
  "/monteur/werkorders",
  "/monteur/instellingen",
  "/checkout",
  "/inloggen",
  "/registreren",
  "/upgrade",
  "/bestelling",
];

/** True when `pathname` is under one of the private prefixes (a prefix of the path, as robots.txt reads it). */
export function isPrivatePath(pathname: string): boolean {
  return PRIVATE_PATH_PREFIXES.some((p) => pathname === p.replace(/\/$/, "") || pathname.startsWith(p.endsWith("/") ? p : `${p}/`));
}

/**
 * The paths that get an X-Robots-Tag header from next.config.ts, as path-to-regexp sources. /api/ has its own
 * entry there (with the CORS headers) and /bestelling is covered by src/middleware.ts, which also sets
 * no-referrer and no-store for it.
 */
export function privateHeaderSources(): string[] {
  return PRIVATE_PATH_PREFIXES.filter((p) => p !== "/api/" && p !== "/bestelling").map((p) => `${p}/:path*`);
}

// ─── Non-production deployments ─────────────────────────────────────────────────────────────────

/**
 * A Vercel preview or development deployment must never be indexed. VERCEL_ENV is "production" only for the
 * production deployment; it is absent on a self-hosted server and in CI, which are therefore treated as
 * production (a build there is what the QA suites measure). Vercel adds its own noindex header to previews;
 * this makes robots.txt and our headers say the same thing.
 */
export function isNonProductionDeployment(env: EnvLike = process.env): boolean {
  const v = (env.VERCEL_ENV ?? "").trim().toLowerCase();
  return v !== "" && v !== "production";
}

// ─── Search-engine verification (optional) ──────────────────────────────────────────────────────

function verificationToken(raw: string | undefined): string | null {
  if (!raw) return null;
  let v = raw.trim();
  // A pasted <meta ... content="TOKEN"> tag is accepted: take the content.
  const pasted = /content\s*=\s*["']([^"']+)["']/i.exec(v);
  if (pasted) v = pasted[1].trim();
  return /^[A-Za-z0-9_-]{8,200}$/.test(v) ? v : null;
}

/**
 * <meta name="google-site-verification"> from GOOGLE_SITE_VERIFICATION and <meta name="msvalidate.01"> from
 * BING_SITE_VERIFICATION. Both optional: an unset or malformed value emits no tag. They are read when the page
 * is built, so a change needs a redeploy. Verification by DNS record or by HTML file needs none of this.
 */
export function verificationMetadata(env: EnvLike = process.env): Metadata["verification"] | undefined {
  const google = verificationToken(env.GOOGLE_SITE_VERIFICATION);
  const bing = verificationToken(env.BING_SITE_VERIFICATION);
  if (!google && !bing) return undefined;
  return { ...(google ? { google } : {}), ...(bing ? { other: { "msvalidate.01": bing } } : {}) };
}
