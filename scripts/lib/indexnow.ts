/**
 * IndexNow: the testable parts (decision D24). Used by scripts/seo-submit.ts (the submit tool) and by
 * scripts/preflight.ts (the "zoekmachines" checks); proved by scripts/qa-indexnow.ts.
 *
 * WHAT THIS IS, AND WHAT IT IS NOT. IndexNow (https://www.indexnow.org/documentation) lets a site tell the
 * participating search engines (Bing, Yandex, Seznam, Naver, Yep and others) which URLs were added, changed or
 * removed: one POST with a JSON list of up to 10,000 URLs and a key. The engine checks the key by reading
 * https://<host>/<key>.txt. That is all it does.
 *   - Google does NOT take part. Google has no bulk "index everything" interface for ordinary pages (the Indexing API
 *     is for job postings and livestreams only). For Google the supported route is: verify the property in Search
 *     Console, submit the sitemap there, and use URL Inspection ("Request indexing") by hand for a few key pages.
 *   - Google's and Bing's sitemap "ping" endpoints were retired, so nothing here pings a sitemap (no code calls one).
 *   - A 200 or 202 means "received". It is not a promise that anything is indexed, and says nothing about ranking.
 *   - Nothing in this repository has ever been sent to an engine: there is no network to them from where this was
 *     built, and the site is not deployed anywhere. The tests talk to local fake servers only.
 *
 * The key is PUBLIC BY DESIGN: the protocol serves it from the site itself (public/<key>.txt). It is not a secret and
 * committing it is correct. The tools still print only its length, out of habit: whatever they print is masked with
 * makeMasker().
 *
 * Only indexable URLs are ever submitted. The list is the sitemap's (src/app/sitemap.ts, which asks
 * src/lib/seo.ts indexability()), and filterUrls() is a second, independent guard: it drops a URL on another host,
 * with a query string or fragment, under a private path (PRIVATE_PATH_PREFIXES), on a noindex family (the city
 * pages while CITY_PAGES_INDEXABLE is false, and every family that next.config.ts sends a noindex X-Robots-Tag for
 * without a condition, today /qr/*) or that is a technical file (the key file, robots.txt, a sitemap), so a sitemap
 * bug or a hand-made list cannot become a submission of a noindex page. What it cannot know: a page that is noindex
 * through its own metadata only, outside these families; the sitemap must not list one (scripts/qa-seo.ts checks that).
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { CITY_PAGES_INDEXABLE, isPrivatePath, variantHeaderRules, type RobotsHeaderRule } from "../../src/lib/seo";

// ─── Protocol constants ─────────────────────────────────────────────────────────────────────────

/** The shared endpoint: a submission here is passed on to every participating engine. */
export const INDEXNOW_ENDPOINT_DEFAULT = "https://api.indexnow.org/indexnow";
/** The endpoints the IndexNow documentation lists. INDEXNOW_ENDPOINT may name one of these, or a local test server. */
export const INDEXNOW_ENGINE_ENDPOINTS: readonly string[] = [
  "https://api.indexnow.org/indexnow",
  "https://www.bing.com/indexnow",
  "https://yandex.com/indexnow",
  "https://search.seznam.cz/indexnow",
  "https://searchadvisor.naver.com/indexnow",
];
/** The documented maximum number of URLs in one POST. */
export const MAX_URLS_PER_BATCH = 10_000;
/** The sitemap protocol's limit for one address; longer ones are not offered. */
export const MAX_URL_LENGTH = 2048;
export const KEY_MIN_LENGTH = 8;
export const KEY_MAX_LENGTH = 128;
/** A key file is named after its key: 8 to 128 of a-z, A-Z, 0-9 and dash, then .txt. */
export const KEY_FILE_NAME_RE = /^[a-zA-Z0-9-]{8,128}\.txt$/;
/** Tries after the first one when the engine answers 429 or a server error or does not answer. */
export const MAX_RETRIES = 3;
export const BACKOFF_BASE_MS = 2000;
export const BACKOFF_CAP_MS = 60_000;
/** What stands in for the key in anything printed. */
export const KEY_MASK = "[sleutel]";
const USER_AGENT = "wasfix-seo-submit/1.0 (IndexNow client)";

// ─── The key ────────────────────────────────────────────────────────────────────────────────────

/** 8 to 128 characters, a-z A-Z 0-9 and dash only (the IndexNow rule). */
export function isValidKey(key: unknown): boolean {
  return typeof key === "string" && new RegExp(`^[a-zA-Z0-9-]{${KEY_MIN_LENGTH},${KEY_MAX_LENGTH}}$`).test(key);
}

export type KeyPick = { ok: true; key: string } | { ok: false; reason: string; candidates: number };

const stripBom = (s: string) => s.replace(/^\uFEFF/, "");

/** Short, non-identifying form of a key file name for messages: the key itself is not printed. */
function shortName(name: string): string {
  const base = name.replace(/\.txt$/, "");
  return `${base.slice(0, 4)}….txt (${base.length} tekens)`;
}

/**
 * The key out of a list of files (name + content): exactly ONE whose name matches KEY_FILE_NAME_RE and whose content,
 * trimmed, equals its own name without .txt. Zero or several: refused with a message that says what to do.
 */
export function pickKeyFromFiles(files: ReadonlyArray<{ name: string; content: string }>): KeyPick {
  const found = files.filter((f) => KEY_FILE_NAME_RE.test(f.name) && stripBom(f.content).trim() === f.name.slice(0, -4));
  if (found.length === 1) return { ok: true, key: found[0].name.slice(0, -4) };
  if (found.length === 0) {
    return {
      ok: false,
      candidates: 0,
      reason:
        "Geen IndexNow-sleutel gevonden. Zet INDEXNOW_KEY, of zet in public/ een bestand <sleutel>.txt waarvan de inhoud precies de sleutel is " +
        "(8 tot 128 tekens: a-z, A-Z, 0-9 en -).",
    };
  }
  return {
    ok: false,
    candidates: found.length,
    reason:
      `Er zijn ${found.length} sleutelbestanden in public/ (${found.map((f) => shortName(f.name)).join(", ")}): welke is de goede? ` +
      "Zet INDEXNOW_KEY op de sleutel die je wilt gebruiken, of verwijder de andere bestanden.",
  };
}

/** The small .txt files of a directory (a key file is at most 128 characters, so anything over 512 bytes is skipped). */
export function readPublicTextFiles(dir: string): Array<{ name: string; content: string }> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: Array<{ name: string; content: string }> = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".txt")) continue;
    try {
      const file = path.join(dir, e.name);
      if (fs.statSync(file).size > 512) continue;
      out.push({ name: e.name, content: fs.readFileSync(file, "utf8") });
    } catch {
      // unreadable: not a candidate
    }
  }
  return out;
}

export type KeyResolution = { ok: true; key: string; source: "env" | "public" } | { ok: false; reason: string; candidates?: number };

/** INDEXNOW_KEY when set (and valid), else the one key file in `publicDir`. Never echoes a value. */
export function resolveKey(envValue: string | undefined, publicDir: string): KeyResolution {
  const fromEnv = envValue?.trim();
  if (fromEnv) {
    if (isValidKey(fromEnv)) return { ok: true, key: fromEnv, source: "env" };
    return {
      ok: false,
      reason: `INDEXNOW_KEY heeft niet het goede formaat (nu ${fromEnv.length} tekens): 8 tot ${KEY_MAX_LENGTH} tekens, alleen a-z, A-Z, 0-9 en -.`,
    };
  }
  const pick = pickKeyFromFiles(readPublicTextFiles(publicDir));
  return pick.ok ? { ok: true, key: pick.key, source: "public" } : { ok: false, reason: pick.reason, candidates: pick.candidates };
}

/** A function that replaces the key (and the key-file address) in a text with KEY_MASK. */
export function makeMasker(key: string | null | undefined): (text: string) => string {
  if (!key) return (text) => text;
  return (text) => text.split(key).join(KEY_MASK);
}

// ─── The site address ───────────────────────────────────────────────────────────────────────────

export type Origin = { origin: string; protocol: "http:" | "https:"; hostname: string; port: string };

/** `https://wasfix.nl` (a trailing slash is fine). Anything with a path, query, fragment or credentials is refused. */
export function parseOrigin(raw: string | undefined | null): { ok: true; value: Origin } | { ok: false; reason: string } {
  const text = (raw ?? "").trim();
  if (!text) return { ok: false, reason: "Geen adres van de site: geef --origin https://<domein> op, of zet NEXT_PUBLIC_APP_URL." };
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return { ok: false, reason: `"${text.slice(0, 80)}" is geen geldig adres. Gebruik de vorm https://<domein>.` };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, reason: `Het adres moet met https:// beginnen (nu ${u.protocol}//).` };
  if (u.username || u.password) return { ok: false, reason: "Het adres mag geen gebruikersnaam of wachtwoord bevatten." };
  if ((u.pathname !== "/" && u.pathname !== "") || u.search || u.hash) {
    return { ok: false, reason: "Geef alleen het domein op (https://<domein>), zonder pad, query of #-deel." };
  }
  // A fully qualified name with its closing dot (`https://wasfix.nl.`) is the same site as `https://wasfix.nl`. The dot is
  // dropped so that the origin, the key file address and the host comparison of the URL filter all read the plain name
  // (and so that `https://localhost.` cannot slip past the local-host rule). Two dots is no name.
  if (u.hostname.endsWith(".")) u.hostname = u.hostname.slice(0, -1);
  if (u.hostname.endsWith(".")) return { ok: false, reason: `"${text.slice(0, 80)}" is geen geldig adres. Gebruik de vorm https://<domein>.` };
  return { ok: true, value: { origin: u.origin, protocol: u.protocol, hostname: u.hostname, port: u.port } };
}

const RESERVED_TLDS = new Set(["test", "example", "invalid", "localhost", "local", "internal"]);

/** A host name as it is compared: no brackets around an IPv6 literal, lower case, no closing dot of a fully qualified name. */
function bareHost(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
}

/** A host name that cannot be a public domain: localhost, an IP address, a single label, a reserved name. */
export function isLocalHost(hostname: string): boolean {
  const h = bareHost(hostname);
  if (h === "" || h === "localhost" || net.isIP(h) !== 0 || !h.includes(".")) return true;
  const labels = h.split(".");
  if (RESERVED_TLDS.has(labels[labels.length - 1])) return true;
  return /(^|\.)example\.(com|org|net)$/.test(h);
}

/**
 * Why a LIVE submission for this address must be refused (empty = allowed). `allowLocal` is the test-only switch
 * (QA_INDEXNOW_ALLOW_LOCAL=1): it lifts the https, local-host and port rules so the tool can be exercised against a
 * fake server on 127.0.0.1. It never lifts the vercel.app rule.
 */
export function liveOriginProblems(o: Origin, opts: { allowLocal?: boolean } = {}): string[] {
  const problems: string[] = [];
  const host = bareHost(o.hostname);
  if (host === "vercel.app" || host.endsWith(".vercel.app")) {
    problems.push(
      `${host} is een tijdelijk adres van de host (preview of deployment-URL, met noindex). Dien alleen het eigen domein in, niet een vercel.app-adres.`,
    );
  }
  if (!opts.allowLocal) {
    if (o.protocol !== "https:") problems.push(`Het adres is ${o.protocol.replace(":", "")}, niet https. Een live indiening gaat alleen naar een https-site.`);
    if (isLocalHost(host)) problems.push(`${host} is geen publiek domein (localhost, IP-adres of gereserveerde naam): zoekmachines kunnen het sleutelbestand daar niet lezen.`);
    if (o.port) problems.push(`Het adres noemt poort ${o.port}. IndexNow werkt met het domein zelf (poort 443): gebruik het adres zonder poort.`);
  }
  return problems;
}

/** The address of the key file: always at the root of the site, https://<host>/<key>.txt. */
export function keyFileUrl(o: Origin, key: string): string {
  if (!isValidKey(key)) throw new Error("keyFileUrl: ongeldige sleutel");
  return `${o.origin}/${key}.txt`;
}

// ─── The URL list ───────────────────────────────────────────────────────────────────────────────

export type DropReason = "ongeldig" | "ander-adres" | "query" | "fragment" | "privepad" | "stadspagina" | "noindex" | "bestand" | "te-lang" | "dubbel";

/** Dutch explanation per reason, for the summary. */
export const DROP_LABEL: Record<DropReason, string> = {
  ongeldig: "geen geldig adres (of met inlognaam)",
  "ander-adres": "niet op het adres van de site (andere host, http in plaats van https, of andere poort)",
  query: "met een query-string (de canonieke adressen hebben er geen)",
  fragment: "met een #-deel",
  privepad: "privé- of transactiepad (hoort niet bij zoekmachines)",
  stadspagina: "stadspagina (noindex, besluit D23)",
  noindex: "noindex-familie (dezelfde regel als de X-Robots-Tag in next.config.ts, bijvoorbeeld /qr/*)",
  bestand: "technisch bestand (sleutelbestand, robots.txt of sitemap), geen pagina",
  "te-lang": `langer dan ${MAX_URL_LENGTH} tekens`,
  dubbel: "dubbel",
};

/**
 * The path prefixes that next.config.ts marks noindex WITHOUT a condition: a header rule without a query condition, on a
 * `/prefix/:path*` source, whose X-Robots-Tag says noindex. Read from variantHeaderRules() (src/lib/seo.ts), so the filter and
 * the headers cannot drift apart: a family added there is dropped here. Today: ["/qr"]. The filtered list variants (rules with
 * a query condition) are not families: they are addresses with a query string, dropped as such.
 */
export function noindexFamilyPrefixes(rules: readonly RobotsHeaderRule[] = variantHeaderRules()): string[] {
  return rules.filter((r) => !r.has && /noindex/i.test(r.robots) && /^\/[^:*]+\/:path\*$/.test(r.source)).map((r) => r.source.replace(/\/:path\*$/, ""));
}

/**
 * The single files next.config.ts marks noindex without a condition: a header rule without a query condition on a source that
 * is a plain path (no `:param`, no `*`), whose X-Robots-Tag says noindex. Today ["/offline.html"]. Read from
 * variantHeaderRules() like the families, in lower case (a path is compared lower-cased).
 */
export function noindexExactPaths(rules: readonly RobotsHeaderRule[] = variantHeaderRules()): string[] {
  return rules.filter((r) => !r.has && /noindex/i.test(r.robots) && /^\/[^:*()]*$/.test(r.source)).map((r) => r.source.toLowerCase());
}

const NOINDEX_FAMILIES = noindexFamilyPrefixes();
const NOINDEX_PATHS = noindexExactPaths();

export type FilterResult = {
  /** Normalised (URL.href), unique, in the order given. */
  kept: string[];
  dropped: Array<{ url: string; reason: DropReason }>;
  counts: Partial<Record<DropReason, number>>;
};

function dropReason(raw: string, o: Origin): { reason: DropReason } | { href: string } {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { reason: "ongeldig" };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { reason: "ongeldig" };
  if (u.username || u.password) return { reason: "ongeldig" };
  if (u.origin !== o.origin) return { reason: "ander-adres" };
  // `new URL("https://x/a?").search` is "" although the address carries a "?": the raw text before any "#" is looked at too,
  // exactly as the empty fragment below (a "?" that sits after the "#" belongs to the fragment).
  if (u.search || raw.split("#", 1)[0].includes("?")) return { reason: "query" };
  if (u.hash || raw.includes("#")) return { reason: "fragment" };
  if (u.href.length > MAX_URL_LENGTH) return { reason: "te-lang" };
  let decoded: string;
  try {
    decoded = decodeURIComponent(u.pathname);
  } catch {
    return { reason: "ongeldig" };
  }
  // The crawler-side rule: the path as the server reads it (percent-escapes decoded, repeated slashes collapsed), in both cases.
  const p = decoded.replace(/\/{2,}/g, "/");
  if (isPrivatePath(p) || isPrivatePath(p.toLowerCase())) return { reason: "privepad" };
  if (!CITY_PAGES_INDEXABLE && /^\/wasmachine-kapot(\/|$)/i.test(p)) return { reason: "stadspagina" };
  const lower = p.toLowerCase();
  if (NOINDEX_FAMILIES.some((f) => lower === f || lower.startsWith(`${f}/`)) || NOINDEX_PATHS.includes(lower)) return { reason: "noindex" };
  // A .txt or .xml file at the root is a technical file (the IndexNow key file, robots.txt, a sitemap), never a page to index.
  if (/^\/[^/]+\.(txt|xml)$/i.test(p)) return { reason: "bestand" };
  return { href: u.href };
}

/** Keep only URLs a search engine should be told about, on exactly this origin. See the header of this file. */
export function filterUrls(urls: readonly string[], o: Origin): FilterResult {
  const kept: string[] = [];
  const dropped: FilterResult["dropped"] = [];
  const counts: FilterResult["counts"] = {};
  const seen = new Set<string>();
  const drop = (url: string, reason: DropReason) => {
    dropped.push({ url, reason });
    counts[reason] = (counts[reason] ?? 0) + 1;
  };
  for (const raw0 of urls) {
    const raw = raw0.trim();
    if (!raw) continue;
    const r = dropReason(raw, o);
    if ("reason" in r) {
      drop(raw, r.reason);
      continue;
    }
    if (seen.has(r.href)) {
      drop(raw, "dubbel");
      continue;
    }
    seen.add(r.href);
    kept.push(r.href);
  }
  return { kept, dropped, counts };
}

/** Consecutive slices of at most `size` (default and maximum: 10,000). */
export function splitBatches<T>(items: readonly T[], size: number = MAX_URLS_PER_BATCH): T[][] {
  if (!Number.isInteger(size) || size < 1 || size > MAX_URLS_PER_BATCH) throw new Error(`splitBatches: batchgrootte moet 1 tot ${MAX_URLS_PER_BATCH} zijn`);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ─── The payload ────────────────────────────────────────────────────────────────────────────────

export type IndexNowPayload = { host: string; key: string; keyLocation: string; urlList: string[] };

/**
 * One POST body: {host, key, keyLocation, urlList}. Throws when it would break the protocol (a bad key, a URL not on
 * the host, more than 10,000 URLs, a key location that is not this key's file on this host): such a payload is a bug
 * in the caller, never something to send and see.
 */
export function buildPayload(o: Origin, key: string, urls: readonly string[], keyLocation: string = keyFileUrl(o, key)): IndexNowPayload {
  if (!isValidKey(key)) throw new Error("buildPayload: ongeldige sleutel");
  if (urls.length === 0) throw new Error("buildPayload: geen URL's");
  if (urls.length > MAX_URLS_PER_BATCH) throw new Error(`buildPayload: ${urls.length} URL's is meer dan ${MAX_URLS_PER_BATCH} per verzoek`);
  for (const u of urls) {
    let parsed: URL;
    try {
      parsed = new URL(u);
    } catch {
      throw new Error("buildPayload: een URL is niet geldig");
    }
    if (parsed.origin !== o.origin) throw new Error(`buildPayload: ${parsed.origin} is niet de host van de site (${o.origin})`);
  }
  let loc: URL;
  try {
    loc = new URL(keyLocation);
  } catch {
    throw new Error("buildPayload: keyLocation is geen geldig adres");
  }
  if (loc.origin !== o.origin || loc.pathname !== `/${key}.txt`) throw new Error("buildPayload: keyLocation is niet het sleutelbestand van deze site");
  return { host: o.hostname, key, keyLocation, urlList: [...urls] };
}

/** The URLs in batches of at most 10,000, each as a payload. */
export function buildBatches(o: Origin, key: string, urls: readonly string[], size: number = MAX_URLS_PER_BATCH): IndexNowPayload[] {
  return splitBatches(urls, size).map((batch) => buildPayload(o, key, batch));
}

// ─── The endpoint ───────────────────────────────────────────────────────────────────────────────

export type EndpointResolution = { ok: true; endpoint: string; custom: boolean } | { ok: false; reason: string };

/**
 * INDEXNOW_ENDPOINT: unset = the default. Otherwise only an endpoint from the IndexNow documentation, or an http
 * address on 127.0.0.1 or localhost (a test server). Anything else is refused: the key and the URL list never go to
 * an address nobody vouched for.
 */
export function resolveEndpoint(raw: string | undefined): EndpointResolution {
  const text = raw?.trim();
  if (!text) return { ok: true, endpoint: INDEXNOW_ENDPOINT_DEFAULT, custom: false };
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return { ok: false, reason: "INDEXNOW_ENDPOINT is geen geldig adres." };
  }
  if (u.username || u.password || u.search || u.hash) return { ok: false, reason: "INDEXNOW_ENDPOINT mag geen inlognaam, query of #-deel bevatten." };
  if (u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost")) return { ok: true, endpoint: u.href, custom: true };
  if (INDEXNOW_ENGINE_ENDPOINTS.includes(`${u.origin}${u.pathname}`)) return { ok: true, endpoint: `${u.origin}${u.pathname}`, custom: `${u.origin}${u.pathname}` !== INDEXNOW_ENDPOINT_DEFAULT };
  return {
    ok: false,
    reason:
      "INDEXNOW_ENDPOINT is niet toegestaan. Toegestaan: " +
      `${INDEXNOW_ENGINE_ENDPOINTS.join(", ")}, of een http-adres op 127.0.0.1 of localhost (voor tests).`,
  };
}

// ─── Reading the answer ─────────────────────────────────────────────────────────────────────────

export type StatusKind = "accepted" | "pending" | "bad_request" | "key_invalid" | "unprocessable" | "rate_limited" | "server_error" | "unexpected";
export type StatusInfo = { kind: StatusKind; ok: boolean; retry: boolean; message: string };

/** What an HTTP status from an IndexNow endpoint means, in Dutch. 200 and 202 are the only successes. */
export function interpretStatus(status: number): StatusInfo {
  switch (status) {
    case 200:
      return { kind: "accepted", ok: true, retry: false, message: "200 OK: de zoekmachine heeft de URL's ontvangen. Dat is een melding, geen garantie dat ze worden opgenomen of waar ze komen te staan." };
    case 202:
      return { kind: "pending", ok: true, retry: false, message: "202 Geaccepteerd: ontvangen, de controle van de sleutel loopt nog. Normaal bij de eerste keer; de zoekmachine haalt het sleutelbestand zelf op." };
    case 400:
      return { kind: "bad_request", ok: false, retry: false, message: "400 Ongeldig formaat: de aanvraag is niet in het IndexNow-formaat. Dit is een fout in dit script; meld het." };
    case 403:
      return { kind: "key_invalid", ok: false, retry: false, message: "403 Sleutel ongeldig: de zoekmachine vond het sleutelbestand niet of de inhoud komt niet overeen met de sleutel. Controleer dat https://<domein>/<sleutel>.txt de sleutel toont." };
    case 422:
      return { kind: "unprocessable", ok: false, retry: false, message: "422 Geweigerd: de URL's horen niet bij de opgegeven host, of de sleutel past niet bij het IndexNow-schema. Controleer --origin en het sleutelbestand." };
    case 429:
      return { kind: "rate_limited", ok: false, retry: true, message: "429 Te veel aanvragen: de zoekmachine vraagt om af te remmen (mogelijk als spam gezien). Het script wacht en probeert het een beperkt aantal keer opnieuw." };
    default:
      if (status >= 500 && status < 600) return { kind: "server_error", ok: false, retry: true, message: `${status} Fout bij de zoekmachine: probeer het later opnieuw.` };
      return { kind: "unexpected", ok: false, retry: false, message: `${status} Onverwacht antwoord (een doorverwijzing wordt niet gevolgd): niet als succes geteld.` };
  }
}

/** Seconds to wait before retry number `retryIndex` (0 = the first retry): doubling from `baseMs`, never below a Retry-After header, never above `capMs`. */
export function backoffDelayMs(retryIndex: number, retryAfter?: string | null, baseMs: number = BACKOFF_BASE_MS, capMs: number = BACKOFF_CAP_MS, now: number = Date.now()): number {
  const exp = baseMs * 2 ** Math.max(0, retryIndex);
  let header = 0;
  const t = retryAfter?.trim();
  if (t) {
    if (/^\d+$/.test(t)) header = Number(t) * 1000;
    else {
      const when = Date.parse(t);
      if (!Number.isNaN(when)) header = Math.max(0, when - now);
    }
  }
  return Math.min(capMs, Math.max(exp, header));
}

/** At most `maxChars` of a response body, on one line. The body of a failed submission is shown to the owner; never more than this. */
export function snippet(text: string, maxChars = 300): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > maxChars ? `${one.slice(0, maxChars - 1)}…` : one;
}

/** Reads at most `maxBytes` of a response body (the rest is dropped, the connection released). */
async function readLimited(res: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  if (!res.body) return { text: "", truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.byteLength > maxBytes) {
      chunks.push(value.subarray(0, maxBytes - total));
      total = maxBytes;
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  return { text: new TextDecoder("utf-8").decode(Buffer.concat(chunks)), truncated };
}

export type BatchOutcome = {
  ok: boolean;
  attempts: number;
  status: number | null;
  info: StatusInfo | null;
  /** The start of the answer's body, one line, at most 300 characters. */
  body: string;
  /** Set when the last attempt got no answer at all. */
  error?: string;
};

export type PostDeps = {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Base of the backoff; default 2000 ms. */
  baseDelayMs?: number;
  maxRetries?: number;
  timeoutMs?: number;
  /** Called before each wait. */
  log?: (line: string) => void;
};

/** POST one payload. Retries (bounded) on 429, on server errors and on no answer; never follows a redirect. */
export async function postBatch(endpoint: string, payload: IndexNowPayload, deps: PostDeps = {}): Promise<BatchOutcome> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxRetries = deps.maxRetries ?? MAX_RETRIES;
  let last: BatchOutcome = { ok: false, attempts: 0, status: null, info: null, body: "" };
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let status: number | null = null;
    let retryAfter: string | null = null;
    let body = "";
    let error: string | undefined;
    try {
      const res = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8", "user-agent": USER_AGENT },
        body: JSON.stringify(payload),
        redirect: "manual",
        signal: AbortSignal.timeout(deps.timeoutMs ?? 30_000),
      });
      status = res.status;
      retryAfter = res.headers.get("retry-after");
      body = snippet((await readLimited(res, 4096)).text);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    const info = status === null ? null : interpretStatus(status);
    last = { ok: info?.ok === true, attempts: attempt + 1, status, info, body, ...(error ? { error } : {}) };
    if (last.ok) return last;
    const retryable = info === null || info.retry;
    if (!retryable || attempt === maxRetries) return last;
    const wait = backoffDelayMs(attempt, retryAfter, deps.baseDelayMs);
    deps.log?.(`poging ${attempt + 1} van ${maxRetries + 1}: ${status === null ? "geen antwoord" : `HTTP ${status}`}; wacht ${wait} ms en probeer opnieuw`);
    await sleep(wait);
  }
  return last;
}

// ─── Reading the site ───────────────────────────────────────────────────────────────────────────

export type HttpResult = { status: number; location: string | null; contentType: string | null; xRobotsTag: string | null; text: string };
export type HttpGet = (url: string) => Promise<HttpResult>;

/** The most a site's answer may hold (a sitemap file is at most 50 MB by the protocol); more is refused, not read. */
export const MAX_RESPONSE_BYTES = 60 * 1024 * 1024;

/**
 * GET without following a redirect (a redirect is reported, not hidden). Throws on no answer, on a body over `maxBytes`
 * and when the answer, headers or body, is not complete within `timeoutMs` (default 20 s: one signal covers a server that
 * never answers and one that trickles its body).
 */
export async function httpGet(url: string, opts: { timeoutMs?: number; maxBytes?: number; fetchImpl?: typeof fetch } = {}): Promise<HttpResult> {
  const maxBytes = opts.maxBytes ?? MAX_RESPONSE_BYTES;
  const res = await (opts.fetchImpl ?? fetch)(url, {
    method: "GET",
    redirect: "manual",
    headers: { "user-agent": USER_AGENT, accept: "text/plain, application/xml, text/xml, text/html;q=0.8, */*;q=0.5" },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
  });
  const { text, truncated } = await readLimited(res, maxBytes);
  if (truncated) throw new Error(`het antwoord is groter dan ${maxBytes} bytes`);
  return { status: res.status, location: res.headers.get("location"), contentType: res.headers.get("content-type"), xRobotsTag: res.headers.get("x-robots-tag"), text };
}

/** `&amp; &lt; &gt; &quot; &apos;`, numeric references and CDATA, in one pass (so `&amp;lt;` stays `&lt;`). */
export function decodeXmlText(s: string): string {
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(s);
  if (cdata) return cdata[1];
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_m, ent: string) => {
    if (ent === "amp") return "&";
    if (ent === "lt") return "<";
    if (ent === "gt") return ">";
    if (ent === "quot") return '"';
    if (ent === "apos") return "'";
    const code = ent[1] === "x" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : _m;
  });
}

// ─── Reading a page head (for the preflight) ────────────────────────────────────────────────────

/** The attributes of one tag, names lower-cased: `<meta name="robots" content="noindex">` gives {name, content}. */
export function parseHtmlAttributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    out[m[1].toLowerCase()] = decodeXmlText(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return out;
}

export type HeadSignals = {
  /** Directives of <meta name="robots|googlebot|bingbot">, lower-cased, one entry per token. */
  robots: string[];
  /** True when one of them says noindex (or none, which means noindex and nofollow). */
  noindex: boolean;
  /** href of every <link rel="canonical">. */
  canonical: string[];
  /** content of every <meta> by lower-cased name (the first one wins). */
  meta: Record<string, string>;
};

/** What a crawler reads in a page's <head>: robots directives, the canonical link and meta tags. A page that is not HTML gives empty signals. */
export function headSignals(html: string): HeadSignals {
  const robots: string[] = [];
  const meta: Record<string, string> = {};
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const a = parseHtmlAttributes(m[0]);
    const name = (a.name ?? "").toLowerCase();
    if (!name || a.content === undefined) continue;
    if (!(name in meta)) meta[name] = a.content;
    if (name === "robots" || name === "googlebot" || name === "bingbot") robots.push(...a.content.toLowerCase().split(",").map((t) => t.trim()).filter(Boolean));
  }
  const canonical: string[] = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const a = parseHtmlAttributes(m[0]);
    if ((a.rel ?? "").toLowerCase().split(/\s+/).includes("canonical") && a.href) canonical.push(a.href);
  }
  return { robots, noindex: robots.includes("noindex") || robots.includes("none"), canonical, meta };
}

/** True when a robots.txt tells every crawler (User-agent: *) to stay away from the whole site (Disallow: /). */
export function robotsBlocksEverything(robotsTxt: string): boolean {
  let agents: string[] = [];
  let inRules = false;
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const field = m[1].toLowerCase();
    if (field === "user-agent") {
      if (inRules) {
        agents = [];
        inRules = false;
      }
      agents.push(m[2].trim().toLowerCase());
    } else if (field === "allow" || field === "disallow") {
      inRules = true;
      if (field === "disallow" && m[2].trim() === "/" && agents.includes("*")) return true;
    }
  }
  return false;
}

/**
 * May `agent` fetch `pathname` under this robots.txt? The group for the agent (its product token contained in a User-agent
 * line, else `*`), the longest matching Allow/Disallow wins, Allow wins a tie, `*` and a closing `$` work as in the
 * standard. Used to prove the IndexNow key file is not shut out for the engines that read it.
 */
export function robotsAllows(robotsTxt: string, agent: string, pathname: string): boolean {
  type Group = { agents: string[]; rules: Array<{ allow: boolean; pattern: string }> };
  const groups: Group[] = [];
  let current: Group | null = null;
  let inRules = false;
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(raw.replace(/#.*$/, "").trim());
    if (!m) continue;
    const field = m[1].toLowerCase();
    if (field === "user-agent") {
      if (!current || inRules) {
        current = { agents: [], rules: [] };
        groups.push(current);
        inRules = false;
      }
      current.agents.push(m[2].trim().toLowerCase());
    } else if ((field === "allow" || field === "disallow") && current) {
      inRules = true;
      if (m[2].trim() !== "") current.rules.push({ allow: field === "allow", pattern: m[2].trim() });
    }
  }
  const a = agent.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((x) => x !== "*" && a.includes(x)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes("*"));
  let best: { allow: boolean; length: number } | null = null;
  for (const rule of chosen.flatMap((g) => g.rules)) {
    const re = new RegExp(`^${rule.pattern.replace(/[.+?^{}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}`);
    if (!re.test(pathname)) continue;
    const length = rule.pattern.length;
    if (!best || length > best.length || (length === best.length && rule.allow)) best = { allow: rule.allow, length };
  }
  return best ? best.allow : true;
}

export type SitemapParse =
  | { ok: true; kind: "urlset" | "index"; locs: string[]; entriesWithoutLoc: number }
  | { ok: false; reason: string };

/**
 * `xml` without its comments (`<!-- … -->`), so an entry that was commented out is not read as a live one. A comment-like
 * text inside a CDATA section is data and stays. One pass with indexOf: no regular expression that can backtrack. A comment
 * or CDATA section that is never closed is left as it is (the file is then most likely cut off, which the caller reports).
 */
export function stripXmlComments(xml: string): string {
  let comment = xml.indexOf("<!--");
  if (comment < 0) return xml;
  let cdata = xml.indexOf("<![CDATA[");
  let out = "";
  let copied = 0;
  let scan = 0;
  for (;;) {
    if (comment >= 0 && comment < scan) comment = xml.indexOf("<!--", scan);
    if (cdata >= 0 && cdata < scan) cdata = xml.indexOf("<![CDATA[", scan);
    if (comment < 0) break;
    if (cdata >= 0 && cdata < comment) {
      const endCdata = xml.indexOf("]]>", cdata + 9);
      if (endCdata < 0) break;
      scan = endCdata + 3;
      continue;
    }
    const end = xml.indexOf("-->", comment + 4);
    if (end < 0) break;
    out += xml.slice(copied, comment);
    copied = end + 3;
    scan = copied;
  }
  return out + xml.slice(copied);
}

/**
 * The index of the next opening `<tag` of `text` at or after `from` whose name ends right there (`<url>`, `<url >`, `<url/>`),
 * or -1; so `<urlset>` is not a `<url>`.
 */
function nextOpen(text: string, tag: string, from: number): number {
  const open = `<${tag}`;
  for (let at = text.indexOf(open, from); at >= 0; at = text.indexOf(open, at + 1)) {
    const c = text.charCodeAt(at + open.length);
    if (c === 62 || c === 47 || c === 32 || c === 9 || c === 10 || c === 13) return at;
  }
  return -1;
}

/**
 * The inner text of every `<tag>…</tag>` of `text`, in order (a self-closing `<tag/>` gives ""), and whether the markup was
 * malformed: an opening tag that is never closed (the scan ends there, nothing after it is read) or an element opened inside
 * another one (the first was never closed, so the second entry was swallowed into it). Found with indexOf, one pass: a hostile
 * file (tens of thousands of unclosed tags) costs time in proportion to its size, which a lazy regular expression does not
 * (it is quadratic). A malformed file is not returned as a shorter list: the caller refuses it.
 */
function elementsOf(text: string, tag: string): { items: string[]; malformed: boolean } {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  const items: string[] = [];
  let pos = 0;
  for (;;) {
    const lt = nextOpen(text, tag, pos);
    if (lt < 0) break;
    const gt = text.indexOf(">", lt + open.length);
    if (gt < 0) return { items, malformed: true };
    if (text.charCodeAt(gt - 1) === 47) {
      items.push("");
      pos = gt + 1;
      continue;
    }
    const end = text.indexOf(close, gt + 1);
    if (end < 0) return { items, malformed: true };
    const inner = text.slice(gt + 1, end);
    if (nextOpen(inner, tag, 0) >= 0) return { items, malformed: true };
    items.push(inner);
    pos = end + close.length;
  }
  return { items, malformed: false };
}

/** The text of the first `<loc>…</loc>` in an entry, or "". */
function locOf(entry: string): string {
  const a = entry.indexOf("<loc>");
  if (a < 0) return "";
  const b = entry.indexOf("</loc>", a + 5);
  return b < 0 ? "" : entry.slice(a + 5, b);
}

/**
 * A sitemap file (<urlset>) or a sitemap index (<sitemapindex>). Anything else, or a file cut off before its closing tag,
 * is invalid. Comments are ignored; the scan is linear (see elementsOf).
 */
export function parseSitemapXml(xml: string): SitemapParse {
  const text = stripXmlComments(stripBom(xml));
  const root = /^\s*(?:<\?xml[\s\S]*?\?>\s*)?<(urlset|sitemapindex)\b/.exec(text);
  if (!root) return { ok: false, reason: "geen sitemap: het bestand begint niet met <urlset> of <sitemapindex>" };
  const kind = root[1] === "urlset" ? "urlset" : "index";
  if (!text.trimEnd().endsWith(`</${root[1]}>`)) return { ok: false, reason: `de sitemap is niet afgesloten met </${root[1]}> (afgekapt?)` };
  const locs: string[] = [];
  let entriesWithoutLoc = 0;
  const entryTag = kind === "urlset" ? "url" : "sitemap";
  const { items, malformed } = elementsOf(text, entryTag);
  if (malformed) return { ok: false, reason: `de sitemap is niet goed gevormd: een <${entryTag}> wordt niet afgesloten (afgekapt of kapot?)` };
  for (const inner of items) {
    const value = decodeXmlText(locOf(inner)).trim();
    if (value) locs.push(value);
    else entriesWithoutLoc++;
  }
  return { ok: true, kind, locs, entriesWithoutLoc };
}

export type SitemapRead = { ok: true; urls: string[]; files: number; notes: string[] } | { ok: false; reason: string };

/** The most child sitemaps of an index that are read. */
export const MAX_SITEMAP_FILES = 50;

/**
 * `<origin>/sitemap.xml` and, when it is an index, its child sitemaps (only those on this origin). A redirect, a status
 * other than 200 or invalid XML is a failure with a reason; a list that is silently incomplete is not returned.
 */
export async function readSitemap(o: Origin, get: HttpGet = httpGet): Promise<SitemapRead> {
  const root = `${o.origin}/sitemap.xml`;
  const fetchOne = async (url: string): Promise<{ ok: true; parse: Extract<SitemapParse, { ok: true }> } | { ok: false; reason: string }> => {
    let r: HttpResult;
    try {
      r = await get(url);
    } catch (err) {
      return { ok: false, reason: `${url} is niet te lezen: ${err instanceof Error ? err.message : String(err)}` };
    }
    if (r.status >= 300 && r.status < 400) {
      let to = r.location ?? "";
      try {
        to = new URL(to, url).href;
      } catch {
        // leave as given
      }
      return { ok: false, reason: `${url} verwijst door (HTTP ${r.status}) naar ${to || "een onbekend adres"}. Gebruik dat adres als --origin, of herstel de doorverwijzing: een indiening hoort bij het adres dat de sitemap zelf noemt.` };
    }
    if (r.status !== 200) return { ok: false, reason: `${url} antwoordt HTTP ${r.status}, niet 200.` };
    const parse = parseSitemapXml(r.text);
    if (!parse.ok) return { ok: false, reason: `${url}: ${parse.reason}.` };
    return { ok: true, parse };
  };

  const first = await fetchOne(root);
  if (!first.ok) return first;
  const notes: string[] = [];
  if (first.parse.entriesWithoutLoc > 0) notes.push(`${first.parse.entriesWithoutLoc} onderdeel/onderdelen van ${root} zonder <loc> overgeslagen`);
  if (first.parse.kind === "urlset") return { ok: true, urls: first.parse.locs, files: 1, notes };

  const urls: string[] = [];
  let files = 1;
  const children = first.parse.locs;
  if (children.length > MAX_SITEMAP_FILES) notes.push(`de index noemt ${children.length} sitemaps; alleen de eerste ${MAX_SITEMAP_FILES} zijn gelezen`);
  for (const child of children.slice(0, MAX_SITEMAP_FILES)) {
    let childOrigin: string;
    try {
      childOrigin = new URL(child).origin;
    } catch {
      notes.push("een sitemap in de index is geen geldig adres en is overgeslagen");
      continue;
    }
    if (childOrigin !== o.origin) {
      notes.push(`de sitemap ${child} staat op een ander adres dan ${o.origin} en is overgeslagen`);
      continue;
    }
    const got = await fetchOne(child);
    if (!got.ok) return got;
    if (got.parse.kind === "index") {
      notes.push(`${child} is zelf een index; geneste indexen worden niet gevolgd`);
      continue;
    }
    files++;
    // A loop, not urls.push(...locs): a spread of a few hundred thousand arguments overflows the call stack.
    for (const loc of got.parse.locs) urls.push(loc);
  }
  return { ok: true, urls, files, notes };
}

export type KeyFileCheck = { ok: true; contentType: string | null } | { ok: false; reason: string };

/** Is https://<host>/<key>.txt reachable (status 200, no redirect) and does it contain exactly the key? */
export async function checkKeyFile(o: Origin, key: string, get: HttpGet = httpGet): Promise<KeyFileCheck> {
  const url = keyFileUrl(o, key);
  let r: HttpResult;
  try {
    r = await get(url);
  } catch (err) {
    return { ok: false, reason: `het sleutelbestand ${url} is niet te lezen: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (r.status >= 300 && r.status < 400) return { ok: false, reason: `het sleutelbestand ${url} verwijst door (HTTP ${r.status}); het moet direct antwoorden, zonder doorverwijzing` };
  if (r.status !== 200) return { ok: false, reason: `het sleutelbestand ${url} antwoordt HTTP ${r.status}, niet 200` };
  const body = stripBom(r.text).trim();
  if (body !== key) return { ok: false, reason: `het sleutelbestand ${url} bevat niet de sleutel (het bevat ${body.length} tekens, de sleutel is ${key.length} tekens)` };
  return { ok: true, contentType: r.contentType };
}
