/**
 * Tell the search engines that support IndexNow which pages exist (decision D24, "vraag alles aan bij index").
 *
 *   npx tsx scripts/seo-submit.ts [--origin https://<domein>]                    DRY RUN (the default): reads, prints, sends nothing
 *   npx tsx scripts/seo-submit.ts [--origin https://<domein>] --live             really submits
 *   npx tsx scripts/seo-submit.ts --origin https://<domein> --urls-file urls.txt  a hand-picked list (one URL per line, # = comment)
 *   npx tsx scripts/seo-submit.ts --ping-sitemap-only                            explains why there is no sitemap ping; sends nothing
 *
 * The origin is --origin, else NEXT_PUBLIC_APP_URL. The list is the sitemap's: <origin>/sitemap.xml (and, if it is an
 * index, its children). Each URL must be on the origin's host, without query or fragment, not under a private path, not
 * on a noindex family or file (the city pages, /qr/*, /leadmagnets/*, /offline.html: the same list next.config.ts sends a noindex
 * header for) and not a technical file (scripts/lib/indexnow.ts filterUrls); what is dropped
 * is counted and shown. The key is INDEXNOW_KEY, else the one public/<key>.txt whose content is its own name.
 *
 * HONEST LIMITS (read these before you run it)
 *   - Nothing has been submitted by this repository. It was written and tested where there is no network to any search
 *     engine and the site is not deployed; the tests use local fake servers. A run of YOURS, after go-live, is the first.
 *   - IndexNow reaches Bing, Yandex, Seznam, Naver, Yep and other participants. It does NOT reach Google. Google has no
 *     "index everything" interface for ordinary pages (its Indexing API is for job postings and livestreams only): verify
 *     the property in Search Console, submit https://<domein>/sitemap.xml there, and use URL Inspection by hand for a few key
 *     pages. Bing Webmaster Tools can import a verified Search Console property.
 *   - There is NO sitemap ping. Google's and Bing's sitemap ping endpoints were retired, so this script does not call them
 *     and --ping-sitemap-only only says so. Submit the sitemap in Search Console and Bing Webmaster Tools.
 *   - A 200/202 answer means "received", not "indexed", and nothing here says anything about ranking.
 *   - Tell the engines about what is new or changed. The tool remembers nothing; do not run it on a schedule.
 *
 * --live refuses (exit 1, nothing sent) unless: the origin is https, a public domain (not localhost, an IP address, a
 * reserved name or *.vercel.app) and has no port; a key is found; INDEXNOW_ENDPOINT, if set, is allowed; and the key file
 * is reachable at https://<host>/<key>.txt, answers 200 without a redirect and contains the key (it is fetched first).
 * The URL list is a separate matter: when it cannot be obtained, or holds no URL at all after filtering (an empty
 * sitemap, only foreign addresses), the exit code is 2, live or not, and nothing is sent. QA_INDEXNOW_ALLOW_LOCAL=1
 * (test-only) lifts the https, local-host and port rules so the suites can run against a fake server on 127.0.0.1;
 * QA_INDEXNOW_BACKOFF_MS (test-only) shortens the retry wait.
 *
 * A dry run does the same reading and then reports whether a live run would go ahead; it exits 0 when the list could
 * be read, whatever it says about live.
 *
 * Exit codes
 *   0  dry run finished (nothing sent), or live: every batch accepted
 *   1  not run: bad arguments, or --live refused by a rule above, or --ping-sitemap-only (nothing sent)
 *   2  the URL list could not be obtained: sitemap or --urls-file unreachable, redirected, invalid, or empty after filtering (nothing sent)
 *   3  live: at least one batch was not accepted (the others may have been)
 *
 * The key is public by design (the protocol serves it from the site) but is never printed: output shows its length, and
 * anything that would contain it (the key file address) is masked. A response body is shown only up to 300 characters.
 */
import fs from "node:fs";
import path from "node:path";
import {
  MAX_RETRIES,
  MAX_URLS_PER_BATCH,
  DROP_LABEL,
  buildBatches,
  checkKeyFile,
  filterUrls,
  httpGet,
  keyFileUrl,
  liveOriginProblems,
  makeMasker,
  parseOrigin,
  postBatch,
  readSitemap,
  resolveEndpoint,
  resolveKey,
  splitBatches,
  type DropReason,
  type HttpGet,
  type KeyFileCheck,
} from "./lib/indexnow";

export type Env = Record<string, string | undefined>;
export type Io = { out: (line: string) => void; err: (line: string) => void };
export type RunOptions = {
  /** Where the key file is looked for (default: ../public). */
  publicDir?: string;
  /** How the site is read (default: httpGet). */
  get?: HttpGet;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

const DEFAULT_PUBLIC_DIR = path.resolve(__dirname, "..", "public");

const USAGE = [
  "Gebruik: npx tsx scripts/seo-submit.ts [--origin https://<domein>] [--live] [--urls-file <pad>] [--ping-sitemap-only]",
  "  zonder --live is het een droogloop: er wordt niets verstuurd.",
  "  --origin        het adres van de site (anders NEXT_PUBLIC_APP_URL)",
  "  --live          echt versturen naar IndexNow (alleen voor een https-domein met sleutelbestand)",
  "  --urls-file     een eigen lijst (een URL per regel) in plaats van de sitemap",
  "  --ping-sitemap-only  legt uit waarom er geen sitemap-ping is; verstuurt niets",
  "Afsluitcodes: 0 klaar, 1 niet uitgevoerd/geweigerd, 2 lijst niet te lezen, 3 een batch is mislukt.",
];

type Args = { origin?: string; urlsFile?: string; live: boolean; pingSitemapOnly: boolean; help: boolean };

function parseArgs(argv: string[]): { ok: true; args: Args } | { ok: false; reason: string } {
  const args: Args = { live: false, pingSitemapOnly: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    let flag = argv[i];
    let inline: string | undefined;
    const eq = flag.startsWith("--") ? flag.indexOf("=") : -1;
    if (eq > 0) {
      inline = flag.slice(eq + 1);
      flag = flag.slice(0, eq);
    }
    const value = (): string | null => (inline !== undefined ? inline : i + 1 < argv.length && !argv[i + 1].startsWith("--") ? argv[++i] : null);
    switch (flag) {
      case "--origin": {
        const v = value();
        if (v === null) return { ok: false, reason: "--origin heeft een waarde nodig (https://<domein>)." };
        args.origin = v;
        break;
      }
      case "--urls-file": {
        const v = value();
        if (!v) return { ok: false, reason: "--urls-file heeft een bestandspad nodig." };
        args.urlsFile = v;
        break;
      }
      case "--live":
      case "--ping-sitemap-only":
      case "--help":
      case "-h":
        if (inline !== undefined) return { ok: false, reason: `${flag} heeft geen waarde.` };
        if (flag === "--live") args.live = true;
        else if (flag === "--ping-sitemap-only") args.pingSitemapOnly = true;
        else args.help = true;
        break;
      default:
        return { ok: false, reason: `Onbekend argument: ${argv[i]}` };
    }
  }
  return { ok: true, args };
}

/** Lines of a --urls-file: blank lines and lines starting with # are ignored. */
function readUrlsFile(file: string): { ok: true; urls: string[] } | { ok: false; reason: string } {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return { ok: false, reason: `${file} is geen bestand.` };
    if (stat.size > 20 * 1024 * 1024) return { ok: false, reason: `${file} is groter dan 20 MB.` };
    const urls = fs
      .readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l !== "" && !l.startsWith("#"));
    return { ok: true, urls };
  } catch (e) {
    return { ok: false, reason: `${file} is niet te lezen: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * The whole command, with its inputs injected (the suites call it in-process; main() below calls it with the real
 * environment). Returns the exit code.
 */
export async function run(argv: string[], env: Env, io: Io, opts: RunOptions = {}): Promise<number> {
  let mask = makeMasker(null);
  const out = (line = "") => io.out(mask(line));
  const err = (line: string) => io.err(mask(line));
  const get = opts.get ?? httpGet;

  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    err(parsed.reason);
    USAGE.forEach((l) => err(l));
    return 1;
  }
  const args = parsed.args;
  if (args.help) {
    USAGE.forEach((l) => out(l));
    return 0;
  }

  if (args.pingSitemapOnly) {
    err("Geen sitemap-ping: het bestaat niet meer. Het ping-adres van Google is stopgezet en dat van Bing is uitgefaseerd, dus dit script roept ze niet aan.");
    err("Er is niets verstuurd. Wat wel werkt, en door jou met de hand moet gebeuren:");
    err("  1. Google Search Console: verifieer het domein en dien <domein>/sitemap.xml in onder Sitemaps.");
    err("  2. Bing Webmaster Tools: importeer de site uit Search Console (of verifieer) en dien dezelfde sitemap in.");
    err("  3. IndexNow voor de URL's zelf: npx tsx scripts/seo-submit.ts (droogloop), daarna --live. Google doet daar niet aan mee.");
    return 1;
  }

  const po = parseOrigin(args.origin ?? env.NEXT_PUBLIC_APP_URL);
  if (!po.ok) {
    err(po.reason);
    return 1;
  }
  const origin = po.value;
  const live = args.live;
  const allowLocal = env.QA_INDEXNOW_ALLOW_LOCAL === "1";

  out(`IndexNow voor ${origin.origin}`);
  out(live ? "Modus: LIVE (er wordt echt verstuurd)" : "Modus: DROOGLOOP (er wordt niets verstuurd; --live om echt te versturen)");
  if (allowLocal) out("TESTMODUS: QA_INDEXNOW_ALLOW_LOCAL=1 staat aan. Dat is alleen voor de testsuites; gebruik het niet voor een echte indiening.");

  // ── rules that need no network ────────────────────────────────────────────
  const problems: string[] = [...liveOriginProblems(origin, { allowLocal })];
  const keyRes = resolveKey(env.INDEXNOW_KEY, opts.publicDir ?? DEFAULT_PUBLIC_DIR);
  if (keyRes.ok) {
    mask = makeMasker(keyRes.key);
    out(`Sleutel: aanwezig (${keyRes.key.length} tekens, uit ${keyRes.source === "env" ? "INDEXNOW_KEY" : "public/"}; de sleutel is openbaar maar wordt niet getoond)`);
  } else {
    problems.push(keyRes.reason);
  }
  const ep = resolveEndpoint(env.INDEXNOW_ENDPOINT);
  if (!ep.ok) problems.push(ep.reason);

  const refuse = (list: string[]): number => {
    err("GEWEIGERD: er is niets verstuurd. Reden(en):");
    list.forEach((p) => err(`  - ${p}`));
    return 1;
  };
  if (live && problems.length > 0) return refuse(problems);

  // ── the key file (fetched first: a live run does not go on without it) ─────
  let keyFile: KeyFileCheck | null = null;
  if (keyRes.ok) {
    keyFile = await checkKeyFile(origin, keyRes.key, get);
    if (keyFile.ok) out(`Sleutelbestand: ${keyFileUrl(origin, keyRes.key)} bereikbaar en bevat de sleutel${keyFile.contentType ? ` (${keyFile.contentType.split(";")[0]})` : ""}`);
    else if (live) return refuse([`${keyFile.reason}. Zet public/<sleutel>.txt op de site (deploy) en probeer opnieuw.`]);
    else out(`Sleutelbestand: NIET in orde: ${keyFile.reason}`);
  }

  // ── the list ──────────────────────────────────────────────────────────────
  let raw: string[];
  if (args.urlsFile) {
    const f = readUrlsFile(args.urlsFile);
    if (!f.ok) {
      err(f.reason);
      return 2;
    }
    raw = f.urls;
    out(`Bron: ${args.urlsFile} (${raw.length} regel(s))`);
  } else {
    const sm = await readSitemap(origin, get);
    if (!sm.ok) {
      err(`Sitemap niet bruikbaar: ${sm.reason}`);
      return 2;
    }
    raw = sm.urls;
    out(`Bron: ${origin.origin}/sitemap.xml (${sm.files} bestand(en), ${raw.length} adres(sen) gelezen)`);
    sm.notes.forEach((n) => out(`  let op: ${n}`));
  }

  const filtered = filterUrls(raw, origin);
  out(`Ter indiening: ${filtered.kept.length}. Overgeslagen: ${filtered.dropped.length}.`);
  for (const reason of Object.keys(filtered.counts) as DropReason[]) {
    const examples = filtered.dropped
      .filter((d) => d.reason === reason)
      .slice(0, 3)
      .map((d) => d.url.slice(0, 100));
    out(`  overgeslagen (${filtered.counts[reason]}x): ${DROP_LABEL[reason]}, bijvoorbeeld ${examples.join(" | ")}`);
  }
  if (filtered.kept.length === 0) {
    err("Geen enkele URL om in te dienen na het filteren: er is niets te versturen.");
    return 2;
  }
  const sample = (title: string, items: string[]) => {
    out(title);
    items.forEach((u) => out(`  ${u}`));
  };
  if (filtered.kept.length <= 10) sample(`Alle ${filtered.kept.length} URL's:`, filtered.kept);
  else {
    sample("Eerste 5:", filtered.kept.slice(0, 5));
    sample("Laatste 5:", filtered.kept.slice(-5));
  }
  const plan = splitBatches(filtered.kept);
  out(`Batchplan: ${plan.length} verzoek(en), hoogstens ${MAX_URLS_PER_BATCH} URL's per verzoek: ${plan.map((b, i) => `${i + 1}) ${b.length}`).join(", ")}`);
  if (keyRes.ok) out(`Per verzoek: host=${origin.hostname}, keyLocation=${keyFileUrl(origin, keyRes.key)}, urlList=<de URL's van de batch>`);

  // ── dry run ends here ─────────────────────────────────────────────────────
  if (!live) {
    const wouldRefuse = [...problems, ...(keyFile && !keyFile.ok ? [keyFile.reason] : [])];
    out("");
    out("DROOGLOOP KLAAR: er is niets verstuurd.");
    if (wouldRefuse.length === 0) out("Een live indiening zou door de controles van dit script nu DOORGAAN (met --live). Of een zoekmachine de melding aanneemt, blijkt pas bij de echte indiening.");
    else {
      out("Een live indiening zou nu WEIGEREN, om deze reden(en):");
      wouldRefuse.forEach((p) => out(`  - ${p}`));
    }
    out("Dit meldt alleen IndexNow-deelnemers (Bing, Yandex, Seznam, Naver, Yep, ...). Google doet niet mee: dien de sitemap in via Search Console (README, Indexeren).");
    return 0;
  }

  // ── live ──────────────────────────────────────────────────────────────────
  if (!keyRes.ok || !ep.ok) return refuse(problems); // unreachable: problems were checked above; keeps the types honest
  const batches = buildBatches(origin, keyRes.key, filtered.kept);
  const backoff = Number(env.QA_INDEXNOW_BACKOFF_MS);
  const baseDelayMs = env.QA_INDEXNOW_BACKOFF_MS !== undefined && Number.isFinite(backoff) && backoff >= 0 ? backoff : undefined;
  const endpointHost = new URL(ep.endpoint).host;
  out(`Versturen naar ${endpointHost}${ep.custom ? " (afwijkend eindpunt, INDEXNOW_ENDPOINT)" : ""}: ${batches.length} verzoek(en), tot ${MAX_RETRIES} nieuwe pogingen bij 429 of een serverfout.`);
  let accepted = 0;
  let failed = 0;
  for (let i = 0; i < batches.length; i++) {
    const b = batches[i];
    const res = await postBatch(ep.endpoint, b, { fetchImpl: opts.fetchImpl, sleep: opts.sleep, baseDelayMs, log: (l) => out(`  ${l}`) });
    const head = `Batch ${i + 1}/${batches.length}: ${b.urlList.length} URL's naar ${endpointHost} -> `;
    if (res.ok && res.info) {
      accepted++;
      out(`${head}${res.info.message}${res.attempts > 1 ? ` (na ${res.attempts} pogingen)` : ""}`);
    } else {
      failed++;
      const why = res.info ? res.info.message : `geen antwoord${res.error ? ` (${res.error})` : ""}`;
      err(`${head}MISLUKT: ${why}${res.attempts > 1 ? ` Opgegeven na ${res.attempts} pogingen.` : ""}${res.body ? ` Antwoord van de zoekmachine: ${res.body}` : ""}`);
    }
  }
  out("");
  out(`Klaar: ${accepted} van ${batches.length} verzoek(en) aangenomen${failed ? `, ${failed} MISLUKT` : ""}.`);
  out("Aangenomen betekent ontvangen, niet geïndexeerd; er is niets gezegd over ranking. Dit gaat naar IndexNow-deelnemers, niet naar Google (Search Console, README Indexeren).");
  return failed > 0 ? 3 : 0;
}

async function main(): Promise<void> {
  const code = await run(
    process.argv.slice(2),
    {
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
      INDEXNOW_KEY: process.env.INDEXNOW_KEY,
      INDEXNOW_ENDPOINT: process.env.INDEXNOW_ENDPOINT,
      QA_INDEXNOW_ALLOW_LOCAL: process.env.QA_INDEXNOW_ALLOW_LOCAL,
      QA_INDEXNOW_BACKOFF_MS: process.env.QA_INDEXNOW_BACKOFF_MS,
    },
    { out: (l) => console.log(l), err: (l) => console.error(l) },
  );
  process.exitCode = code;
}

if (process.argv[1] && /seo-submit\.[cm]?[tj]s$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error("seo-submit crashed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
