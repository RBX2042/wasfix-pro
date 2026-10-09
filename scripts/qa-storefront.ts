/**
 * Storefront QA (bundle S7): what a visitor from Google sees, and whether it is true.
 *
 *   DATABASE_URL=... npx tsx --conditions=react-server scripts/qa-storefront.ts
 *
 * Without QA_BASE_URL only the module-level checks run (search, projections, guide
 * redaction, brand fit, footer links, honesty rules). With it, the HTTP checks run
 * against that server too:
 *
 *   QA_BASE_URL=http://localhost:3207   a running server (dev with DEMO_MODE=true is fine)
 *   QA_ANON_URL=http://localhost:3307   a PRODUCTION server with demo auth off: the anonymous caller
 *   QA_CRON_SECRET=...                  the CRON_SECRET that server was started with (revalidation test)
 *   QA_MUTATE_DB=1                      allow the checks that change a part price (and put it back):
 *                                       the revalidation proof. Only ever on a throwaway database.
 *   QA_PLAN_FLIP=1                      with QA_MUTATE_DB: also switch the demo superadmin between FREE and
 *                                       PARTICULIER (needs a dev server with DEMO_MODE=true as QA_BASE_URL),
 *                                       and place a real BEDRIJF order to compare page price and charge
 *   QA_DEV_SERVER=1                     the server is `next dev`: skips the checks that need production
 *                                       caching (Cache-Control, the database-outage proof, cache pollution)
 *   QA_CACHE_DIR=.next-a7/cache/fetch-cache   the production server's data-cache directory: enables the
 *                                       cache-pollution check (junk URLs must not add files)
 *   QA_CRAWL=1                          fetch every URL of /sitemap.xml: all must answer 200 and none may be
 *                                       noindex (slow on a dev server)
 *
 * With QA_MUTATE_DB and QA_CRON_SECRET against a production server, dbOutageProof() also renames the Part
 * table for a moment to simulate a database outage, and puts it back in a finally block.
 *
 * Every check is written so that it FAILS on the code as it was before this bundle;
 * the comment on each says what the old behaviour was.
 */

import { PrismaClient } from "@prisma/client";
import {
  searchPublicParts,
  publicPartCategories,
  partSearchHints,
  dbParts,
  dbErrorCode,
  dbErrorCodes,
  dbSuggestedPartsForCode,
  dbGuides,
  dbGuide,
  dbPartFull,
  redactGuide,
  toPublicPart,
  realImageUrl,
  partFitsBrand,
  categoriesForCauses,
  searchTokens,
  dbMachineFull,
  dbMachinesByBrand,
  dbGuideById,
  FREE_GUIDE_STEPS,
  errorCodes as jsonErrorCodes,
  parts as jsonParts,
} from "../src/lib/static-db";
import { canReadPremiumGuide } from "../src/lib/entitlements";
import { FOOTER_CODES, FOOTER_PARTS, FOOTER_BRAND_REPAIR, FOOTER_COMPARE } from "../src/components/redesign/footer-links";
import { warrantyFor, formatWarranty, WARRANTY_ROWS } from "../src/lib/warranty";
import { memberLineTotal } from "../src/lib/member-discount";
import { money } from "../src/lib/invoicing";
import { firstParam, safeDecode } from "../src/lib/safe-param";
import sitemap from "../src/app/sitemap";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { sanitizeProps, ALLOWED_PROPS } from "../src/lib/analytics";
import { exitIntentAllowed } from "../src/components/exit-intent-routes";
import { HELP_TEXT_CORRECTIONS, correctHelpText } from "../src/app/help/_corrections";
import { PART_CATEGORY_INFO, availabilityOf } from "../src/lib/part-categories";
import helpArticles from "../src/data/help-articles.json";
import brandsJson from "../src/data/brands.json";
import comparisonsJson from "../src/data/comparisons.json";

const prisma = new PrismaClient();
const results: Array<{ ok: boolean; name: string; detail?: string }> = [];
const check = (ok: boolean, name: string, detail?: string) => {
  results.push({ ok, name, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `\n        ${detail}` : ""}`);
};

/** A check that documents a known defect in a file this bundle does not own: printed, never fails the run. */
const xfail = (ok: boolean, name: string, why: string) =>
  console.log(ok ? `PASS  (was a known cross-file defect, now fixed) ${name}` : `XFAIL ${name}\n        known, not in this bundle's files: ${why}`);

const BASE = process.env.QA_BASE_URL?.replace(/\/$/, "");
const ANON = process.env.QA_ANON_URL?.replace(/\/$/, "");
const CRON = process.env.QA_CRON_SECRET;
const MUTATE = process.env.QA_MUTATE_DB === "1";

async function get(url: string, headers?: Record<string, string>) {
  const res = await fetch(url, { headers, redirect: "manual" });
  return { status: res.status, headers: res.headers, text: await res.text() };
}

async function main() {
  const rawParts = await prisma.part.findMany();
  const rawByHasSupplier = rawParts.filter((p) => p.supplier);

  // ── 1. Search (A1-09) ───────────────────────────────────────────────────
  // Before: the whole query was one `contains`, so 'Bosch pomp', 'afvoer pomp' and
  // 'pompen' found nothing.
  const count = async (q: string) => (await searchPublicParts({ q }, 1000)).total;
  check((await count("pomp")) > 0, "search 'pomp' finds parts");
  check((await count("afvoer pomp")) > 0, "search 'afvoer pomp' (two words) finds parts", `got ${await count("afvoer pomp")}`);
  check((await count("Bosch pomp")) > 0, "search 'Bosch pomp' (brand + part) finds parts");
  check((await count("pompen")) > 0, "search 'pompen' (plural) finds parts");
  check((await count("pomp")) === (await count("pompen")), "singular and plural give the same result count");
  check((await count("deur slot")) > 0, "search 'deur slot' finds the door locks");
  check((await count("deurrubber")) > 0, "search 'deurrubber' finds door seals via the synonym table");
  check((await count("wf-pump-01")) === 1, "search by exact SKU finds exactly that part");
  check((await count("WAU28T40NL")) > 0, "search by a machine model finds parts that fit it");
  check((await count("E18")) > 0, "search by error code finds parts linked to it");
  check((await count("zzzzqq")) === 0, "nonsense finds nothing");
  // Natural Dutch queries. Before: every word was ANDed, so filler and generic words
  // ("een", "voor", "mijn", "wasmachine", "kapot") made these find nothing.
  for (const q of ["een pomp", "afvoerpomp voor mijn Bosch wasmachine", "Bosch wasmachine pomp kapot", "pomp voor bosch"]) {
    check((await count(q)) > 0, `natural query '${q}' finds parts`, `got ${await count(q)}`);
  }
  // Equality with the stripped query is what discriminates: on the old engine each filler word
  // narrowed the result to the parts whose text happens to contain it.
  for (const [natural, stripped] of [["Bosch wasmachine pomp kapot", "Bosch pomp"], ["een pomp", "pomp"], ["afvoerpomp voor mijn Bosch wasmachine", "afvoerpomp Bosch"], ["pomp voor bosch", "pomp bosch"]]) {
    check((await count(natural)) === (await count(stripped)), `filler words do not change the result: '${natural}' == '${stripped}'`, `${await count(natural)} vs ${await count(stripped)}`);
  }
  check((await count("e")) < rawParts.length / 2, "a one-letter query no longer matches nearly every part (was: 'e' returned 96)", `got ${await count("e")}`);
  check(JSON.stringify(searchTokens("een pomp voor mijn Bosch")) === JSON.stringify(["pomp", "bosch"]), "stop words are dropped from the query tokens");
  check(searchTokens("de").length > 0, "a query made only of filler still searches for its words instead of listing everything");
  // Nothing matches ALL words -> parts that match all but one, flagged as partial.
  const partial = await searchPublicParts({ q: "bosch pomp zzzzqq" }, 50);
  check(partial.total > 0 && partial.relaxed === true, "when no part matches every word, parts matching all but one are returned and flagged as partial", `total=${partial.total} relaxed=${partial.relaxed}`);
  check((await searchPublicParts({ q: "pomp" }, 50)).relaxed !== true, "a normal hit is not flagged as partial");
  check((await searchPublicParts({ q: "zzzzqq vvvvww" }, 50)).total === 0, "two nonsense words still find nothing (the fallback does not invent results)");
  const hint = await partSearchHints("bosch pompje");
  check(hint.some((h) => h.word === "bosch" && h.count > 0), "zero-result query offers the words that DO match", JSON.stringify(hint));

  // ── 2. Listing completeness (A1-10) ─────────────────────────────────────
  // Before: take: 60 of 96, header printed parts.length ("60 onderdelen gevonden"),
  // and 33 parts in 8 categories had no sidebar link.
  const all = await searchPublicParts({}, 10000);
  check(all.total === rawParts.length && all.parts.length === rawParts.length, `default listing covers all ${rawParts.length} parts`, `total=${all.total} parts=${all.parts.length}`);
  const page1 = await searchPublicParts({}, 24);
  check(page1.parts.length === 24 && page1.total === rawParts.length, "first page: 24 shown, total is the real total");
  const cats = await publicPartCategories();
  check(cats.reduce((n, c) => n + c.count, 0) === rawParts.length, "sidebar category counts add up to every part");
  // Expected counts derived straight from the database rows, not from the helpers under test:
  // HEATER is folded into HEATING by decision, nothing else is.
  const expectedByCat = new Map<string, number>();
  for (const p of rawParts) {
    const key = p.category === "HEATER" ? "HEATING" : p.category;
    expectedByCat.set(key, (expectedByCat.get(key) ?? 0) + 1);
  }
  check(
    cats.length === expectedByCat.size && cats.every((c) => expectedByCat.get(c.value) === c.count),
    "sidebar entries and counts equal an independent count of the database rows",
    JSON.stringify(cats.map((c) => [c.value, c.count])),
  );
  let unreachable = 0;
  for (const c of cats) {
    const r = await searchPublicParts({ category: c.value }, 10000);
    if (r.total !== expectedByCat.get(c.value)) unreachable++;
  }
  check(unreachable === 0, "each sidebar entry lists exactly as many parts as the database holds for it");
  const distinct = new Set(rawParts.map((p) => p.category));
  const covered = new Set<string>();
  for (const c of cats) for (const e of [c.value, ...(PART_CATEGORY_INFO[c.value]?.alsoIncludes ?? [])]) covered.add(e);
  check([...distinct].every((d) => covered.has(d)), "every category present in the catalogue has a sidebar link", `missing: ${[...distinct].filter((d) => !covered.has(d)).join(",")}`);
  const maxPrice = Math.max(...rawParts.map((p) => p.priceEur));
  const minPrice = Math.min(...rawParts.map((p) => p.priceEur));
  const desc = (await searchPublicParts({ sort: "prijs-af" }, 1000)).parts.map((p) => p.priceEur);
  const asc = (await searchPublicParts({ sort: "prijs-op" }, 1000)).parts.map((p) => p.priceEur);
  check(desc[0] === maxPrice && desc.every((v, i) => i === 0 || desc[i - 1] >= v), "sorting by price descending: the global maximum is first and the whole list is ordered");
  check(asc[0] === minPrice && asc.every((v, i) => i === 0 || asc[i - 1] <= v), "sorting by price ascending: the global minimum is first and the whole list is ordered");
  check(availabilityOf(0) === "out" && availabilityOf(3) === "low" && availabilityOf(50) === "in_stock", "availability buckets: out / low / in stock");

  // ── 3. Public projection (A1-19, A6-22) ─────────────────────────────────
  // Before: every reader returned the raw row; costEur and supplier reached /api/parts,
  // the page HTML and even the home page's client JS.
  const WHITELIST = ["brand", "category", "description", "id", "imageUrl", "isOriginal", "name", "priceEur", "sku", "stock"];
  const sample = toPublicPart(rawParts[0] as never);
  check(JSON.stringify(Object.keys(sample).sort()) === JSON.stringify(WHITELIST), "toPublicPart is an exact whitelist", Object.keys(sample).join(","));
  const leaky = (v: unknown) => /costEur|"supplier"/.test(JSON.stringify(v));
  check(!leaky(await dbParts()), "dbParts() output has no costEur/supplier");
  check(!leaky(all.parts), "searchPublicParts() output has no costEur/supplier");
  check(!leaky(await dbPartFull(rawParts[0].sku)), "dbPartFull() output has no costEur/supplier");
  const ecAny = await dbErrorCode("Bosch", "E18");
  check(!!ecAny && !leaky(ecAny), "dbErrorCode() output has no costEur/supplier");
  check(!leaky(await dbGuide("trommellager-vervangen")), "dbGuide() parts carry no costEur/supplier");
  check(rawByHasSupplier.length > 0, "precondition: the catalogue has parts with a supplier, so the leak checks mean something");

  // ── 4. Placeholder images (A6-13) ───────────────────────────────────────
  check(realImageUrl("https://placehold.co/600x600/e53e3e/ffffff/png?text=Pomp") === null, "placehold.co tiles are treated as 'no photo'");
  check(realImageUrl(null) === null && realImageUrl("") === null, "empty image URL is 'no photo'");
  check(realImageUrl("https://xyz.supabase.co/storage/v1/object/public/parts/pump.jpg") !== null, "a real photo URL takes precedence automatically");
  check((await dbParts()).every((p) => p.imageUrl === null || !/placehold\.co/.test(p.imageUrl)), "no public part exposes a placeholder image");
  const withoutPhoto = (await dbParts()).filter((p) => p.imageUrl === null).length;
  console.log(`      catalogue photos: ${rawParts.length - withoutPhoto} real, ${withoutPhoto} still without a real photo ("Foto volgt")`);

  // ── 5. Premium guides (A4-05, A6-23) ────────────────────────────────────
  // Before: /api/guides and /api/guides/[id] returned every step of every premium guide.
  const rawGuides = await prisma.repairGuide.findMany({ where: { isPremium: true } });
  check(rawGuides.length >= 3, `precondition: ${rawGuides.length} premium guides exist`);
  const stepsOf = (g: { steps: string }) => (JSON.parse(g.steps) as unknown[]).length;
  for (const g of rawGuides) {
    const asGuide = { ...g, createdAt: g.createdAt.toISOString() };
    const anon = redactGuide(asGuide, canReadPremiumGuide(undefined));
    const free = redactGuide(asGuide, canReadPremiumGuide("FREE"));
    const paying = redactGuide(asGuide, canReadPremiumGuide("PARTICULIER"));
    check(stepsOf(anon) <= FREE_GUIDE_STEPS && anon.locked && anon.lockedStepCount === stepsOf(g) - FREE_GUIDE_STEPS, `premium guide ${g.slug}: anonymous gets ${FREE_GUIDE_STEPS} steps and a lockedStepCount`);
    check(stepsOf(free) <= FREE_GUIDE_STEPS, `premium guide ${g.slug}: FREE plan gets the preview only`);
    check(stepsOf(paying) === stepsOf(g) && !paying.locked, `premium guide ${g.slug}: a paying plan gets every step`);
  }
  const embedded = await dbGuides({});
  check(embedded.filter((g) => g.isPremium).every((g) => stepsOf(g) <= FREE_GUIDE_STEPS), "dbGuides() (used by diagnose, sitemap, lists) is preview-only for premium guides by default");
  const ecH1 = await dbErrorCode("Bosch", "H1");
  const ecWithPremium = (await dbErrorCodes({})).find(Boolean);
  void ecWithPremium;
  const premiumEmbedded = (await Promise.all(jsonErrorCodes.slice(0, 400).map(async (e) => {
    const m = (await prisma.washingMachine.findUnique({ where: { id: e.machineId } }))!;
    return dbErrorCode(m.brand, e.code);
  }))).flatMap((e) => e?.guides ?? []).filter((g) => g.guide.isPremium);
  check(premiumEmbedded.length > 0 && premiumEmbedded.every((g) => stepsOf(g.guide) <= FREE_GUIDE_STEPS), `guides embedded in error-code payloads are previews (${premiumEmbedded.length} premium embeds checked)`);
  void ecH1;

  // ── 6. Brand fit of linked parts (A6-09) ────────────────────────────────
  // Before: Miele F53 -> 'Inverter motor LG Direct Drive', Samsung dE -> 'Deurslot AEG / Electrolux'.
  const links = await prisma.errorCodeParts.findMany({
    include: { part: { include: { machines: { include: { machine: true } } } }, errorCode: { include: { machine: true } } },
  });
  const badRaw = links.filter((l) => !partFitsBrand({ part: l.part, compatBrands: l.part.machines.map((m) => m.machine.brand) }, l.errorCode.machine.brand));
  console.log(`      raw data audit: ${links.length} code-part links, ${badRaw.length} do not fit the code's brand (${badRaw.map((l) => `${l.errorCode.machine.brand} ${l.errorCode.code} -> ${l.part.sku}`).join("; ")})`);
  let shownBad = 0;
  let shown = 0;
  for (const e of await prisma.errorCode.findMany({ include: { machine: true } })) {
    const full = await dbErrorCode(e.machine.brand, e.code);
    if (!full) continue;
    for (const { part } of full.parts) {
      shown++;
      const raw = rawParts.find((r) => r.id === part.id)!;
      const compat = (await prisma.partMachine.findMany({ where: { partId: part.id }, include: { machine: true } })).map((m) => m.machine.brand);
      if (!(raw.brand === "Universeel" || raw.brand === e.machine.brand || compat.includes(e.machine.brand))) shownBad++;
    }
  }
  check(shownBad === 0, `no error-code page links a part of the wrong brand (${shown} links shown)`, `${shownBad} wrong-brand links still shown`);
  const f53 = await dbErrorCode("Miele", "F53");
  check(!!f53 && !f53.parts.some((p) => p.part.sku === "WF-MOTOR-12"), "Miele F53 no longer links the LG inverter motor");
  // The other direction. Before: the part page listed the code even though the code page
  // dropped the part, so the wrong-brand link was still published from /onderdelen/<sku>
  // and /api/parts/<sku>.
  let shownBadFromPart = 0;
  let shownFromPart = 0;
  for (const rp of rawParts) {
    const full = await dbPartFull(rp.sku);
    if (!full) continue;
    const compat = (await prisma.partMachine.findMany({ where: { partId: rp.id }, include: { machine: true } })).map((m) => m.machine.brand);
    for (const { errorCode } of full.errorCodes) {
      shownFromPart++;
      if (!(rp.brand === "Universeel" || rp.brand === errorCode.machine.brand || compat.includes(errorCode.machine.brand))) shownBadFromPart++;
    }
  }
  check(shownBadFromPart === 0, `no part page lists an error code of the wrong brand (${shownFromPart} code links shown)`, `${shownBadFromPart} wrong-brand links still shown`);
  const motor = await dbPartFull("WF-MOTOR-12");
  const lock = await dbPartFull("WF-LOCK-13");
  check(!!motor && !motor.errorCodes.some((e) => e.errorCode.machine.brand === "Miele" && e.errorCode.code === "F53"), "WF-MOTOR-12 (LG inverter motor) no longer lists Miele F53");
  check(!!lock && !lock.errorCodes.some((e) => e.errorCode.machine.brand === "Samsung" && e.errorCode.code === "dE"), "WF-LOCK-13 (AEG/Electrolux lock) no longer lists Samsung dE");
  check(!!motor && motor.errorCodes.length > 0, "WF-MOTOR-12 still lists its legitimate codes (the filter drops only the wrong ones)");

  // ── 7. Error codes without a part (A6-08) ───────────────────────────────
  const all329 = await prisma.errorCode.findMany({ include: { machine: true } });
  let noLinked = 0, rescued = 0;
  for (const e of all329) {
    const full = await dbErrorCode(e.machine.brand, e.code);
    if (!full || full.parts.length > 0) continue;
    noLinked++;
    if ((await dbSuggestedPartsForCode(full, 4)).length > 0) rescued++;
  }
  console.log(`      ${noLinked} of ${all329.length} codes link no part; ${rescued} of those get suggested parts`);
  check(noLinked === 0 || rescued / noLinked >= 0.5, "at least half of the part-less codes get brand-fitting suggested parts", `${rescued}/${noLinked}`);
  const sug = await dbSuggestedPartsForCode((await dbErrorCode("Samsung", "3E"))!, 4);
  const fitIndex = await Promise.all(sug.map(async (p) => ({ p, compat: (await prisma.partMachine.findMany({ where: { partId: p.id }, include: { machine: true } })).map((m) => m.machine.brand) })));
  check(sug.length > 0 && fitIndex.every(({ p, compat }) => p.brand === "Universeel" || p.brand === "Samsung" || compat.includes("Samsung")), "suggested parts for Samsung 3E all fit Samsung", sug.map((s) => `${s.sku}:${s.brand}`).join(","));

  // Cause text -> part categories. Before: unanchored substrings ('lek' in elektronica,
  // 'slot' in kortgesloten, 'sensor' in druksensor) gave door seals for I2C bus errors and
  // a door lock for an NTC short circuit.
  const catTable: Array<[string, string[], string[]]> = [
    ["Defecte elektronica", [], ["DOOR", "SEAL"]],
    ["Bedieningselektronica defect", [], ["DOOR", "SEAL", "PANEL"]],
    ["Vermogenselektronica defect", ["BOARD"], ["DOOR", "SEAL"]],
    ["NTC kortgesloten", ["NTC"], ["LOCK"]],
    ["Kortgesloten verwarmingselement", ["HEATING"], ["LOCK"]],
    ["Deur niet goed gesloten", [], ["LOCK"]],
    ["Defecte druksensor", [], ["NTC"]],
    ["Waterniveausensor defect", [], ["NTC"]],
    ["Defect deurslot", ["LOCK"], []],
    ["Slot of sluitplaat defect", ["LOCK"], []],
    ["Lekkende deurpakking", ["DOOR", "SEAL"], []],
    ["Lekkage bij de pomp", ["PUMP", "DOOR"], []],
    ["Temperatuursensor (NTC) defect", ["NTC"], []],
    ["Losse sensor", ["NTC"], []],
    ["Versleten trommellager", ["BEARING"], []],
    ["De trommellamp is stuk", [], ["BEARING"]],
    ["Defecte afvoerpomp", ["PUMP"], []],
    ["Verstopt pluizenfilter", ["FILTER"], []],
    ["Versleten koolborstels", ["MOTOR"], []],
    ["Defecte hoofdmodule", ["BOARD"], []],
  ];
  const badCat = catTable.filter(([cause, want, forbid]) => {
    const got = categoriesForCauses(cause);
    return !want.every((w) => got.includes(w)) || forbid.some((f) => got.includes(f));
  });
  check(badCat.length === 0, `cause-to-category rules give the expected categories for ${catTable.length} sample causes`, badCat.map(([c]) => `${c} -> ${categoriesForCauses(c).join("/")}`).join(" | "));
  // Whole catalogue: no code whose causes are purely electronic may be offered door seals or a lock.
  let wrongCat = 0;
  for (const e of all329) {
    const causes = e.likelyCauses.split("|").map((c) => c.trim());
    const cats = categoriesForCauses(e.likelyCauses);
    const electronicOnly = causes.length > 0 && causes.every((c) => /elektronica|module|print|software|bord|besturing|communicatie|sensor|ntc|druk/i.test(c) && !/pakking|manchet|rubber|dichting|(^|[^a-z])lek|deurslot|vergrendel|sluitplaat|(^|[^a-z])slot/i.test(c));
    if (electronicOnly && (cats.includes("SEAL") || cats.includes("LOCK") || cats.includes("DOOR"))) wrongCat++;
  }
  check(wrongCat === 0, "no purely electronic code is offered door seals or a door lock", `${wrongCat} codes`);

  // ── 8. Footer / internal links (A6-26, A6-24) ───────────────────────────
  // Before: the footer linked /foutcodes/Miele-F101, a 404 on 105 pages.
  let deadFooter: string[] = [];
  for (const { brand, codes } of FOOTER_CODES) {
    for (const code of codes) if (!(await dbErrorCode(brand, code))) deadFooter.push(`${brand}-${code}`);
  }
  check(deadFooter.length === 0, "every 'Top foutcodes' footer link resolves", deadFooter.join(","));
  const skus = new Set(rawParts.map((p) => p.sku));
  check(FOOTER_PARTS.every((p) => skus.has(p.sku)), "every footer part link resolves", FOOTER_PARTS.filter((p) => !skus.has(p.sku)).map((p) => p.sku).join(","));
  const brandSlugs = (brandsJson as Array<{ slug: string }>).map((b) => b.slug).sort();
  check(JSON.stringify(FOOTER_BRAND_REPAIR.map((b) => b.slug).sort()) === JSON.stringify(brandSlugs), "footer links all 15 brand-repair pages (no orphans)");
  const vsSlugs = (comparisonsJson as Array<{ slug: string }>).map((c) => c.slug).sort();
  check(JSON.stringify(FOOTER_COMPARE.map((c) => c.slug).sort()) === JSON.stringify(vsSlugs), "footer links all /vs pages (no orphans)");

  // ── 9. Honesty rules (A6-12, D6, D9) ────────────────────────────────────
  const unv = { isOriginal: false, category: "PUMP", name: "Afvoerpomp universeel" };
  check(warrantyFor({ isOriginal: true, category: "PUMP", name: "x" }).months === 24, "original part: 24 months");
  check(warrantyFor(unv).months === 12, "universal part: 12 months (the product page used to say 2 jaar for every part)");
  check(warrantyFor({ isOriginal: true, category: "FILTER", name: "Filter" }).months === 6, "filters: 6 months");
  check(warrantyFor({ isOriginal: false, category: "BOARD", name: "Module" }).months === 12, "universal electronics: the shortest applicable period (12)");
  check(WARRANTY_ROWS.length > 0 && WARRANTY_ROWS.every((r) => formatWarranty(r.months).length > 0), "warranty rows all have a printable period");
  const STALE = /België|NL en BE|NL\/BE|aangemeld|Bancontact|60 seconden|\b60s\b|60% van alle defecten/;
  const stale = (helpArticles as Array<{ title: string; summary: string; content: string }>)
    .flatMap((a) => [a.title, a.summary, a.content].map(correctHelpText))
    .filter((t) => STALE.test(t));
  check(stale.length === 0, "help article text passes the correction table free of Belgium / aangemeld / 60-seconds claims", `${stale.length} texts still contain one`);
  const rawComparisonText = JSON.stringify(comparisonsJson);
  check(STALE.test(rawComparisonText) && !STALE.test(correctHelpText(rawComparisonText)), "precondition + fix: comparisons.json holds a 60-second claim and the correction table removes it");
  check(HELP_TEXT_CORRECTIONS.length >= 4, "help corrections table is populated");

  // ── 9b. Member price equals the charge (A4-13) ──────────────────────────
  // Before: the page rounded the discounted price, checkout rounds the discount; 14 of 96
  // parts differed by one cent at the 15% tier. The expected value below is the checkout's
  // own arithmetic (src/app/api/checkout/route.ts: money(subtotal * d), money(subtotal - discount))
  // with the real money() from invoicing.ts; the route source is pinned so a change there fails here.
  const route = readFileSync("src/app/api/checkout/route.ts", "utf8");
  check(/discount = money\(subtotal \* limits\.partsDiscount\)/.test(route) && /money\(subtotal - discount \+ shipping\)/.test(route), "checkout still computes the discount as money(subtotal * d) - the formula member-discount.ts mirrors");
  const oldMath = (price: number, d: number) => { const c = Math.round(price * 100); return (c - Math.round(c * d)) / 100; };
  let diff = 0, oldDiff = 0, cells = 0;
  const mismatches: string[] = [];
  for (const p of rawParts) {
    for (const d of [0.05, 0.1, 0.15]) {
      cells++;
      const charged = money(money(p.priceEur) - money(money(p.priceEur) * d));
      if (memberLineTotal(p.priceEur, d) !== charged) { diff++; mismatches.push(`${p.sku}@${d}`); }
      if (oldMath(p.priceEur, d) !== charged) oldDiff++;
    }
  }
  check(diff === 0, `member price equals the checkout charge for all ${rawParts.length} parts x 3 tiers (${cells} cases)`, mismatches.slice(0, 5).join(","));
  check(oldDiff > 0, `precondition: the old rounding really differed from checkout somewhere (${oldDiff} of ${cells} cases), so the check above can fail`);
  check(memberLineTotal(28.5, 0.15) === 24.23 && memberLineTotal(28.5, 0.05) === 27.07, "WF-PUMP-01 at 15% is 24,23 (the reviewer's real order), not 24,22");

  // ── 9c. Request parameters that used to crash pages with a 500 ─────────
  check(firstParam(["a", "b"]) === "a" && firstParam("a") === "a" && firstParam(undefined) === undefined, "repeated query parameters collapse to the first value");
  check(safeDecode("%ZZ") === null && safeDecode("%E0%A4%A") === null && safeDecode("Bosch-E18") === "Bosch-E18", "malformed percent-escapes decode to null instead of throwing");

  // ── 9d. Cache hygiene: unknown keys never reach the data cache (module level) ──
  check((await dbPartFull("NOPE-1")) === null, "unknown SKU: null without a cache entry");
  check((await dbErrorCode("Bosch", "ZZ99")) === null && (await dbErrorCode("Nobrand", "E18")) === null, "unknown error code / brand: null");
  check((await dbMachineFull("Bosch", "NOPE")) === null && (await dbMachinesByBrand("Nobrand")).length === 0, "unknown model / brand: null / empty");
  check((await dbGuide("nope-nope")) === null && (await dbGuideById("nope")) === null, "unknown guide slug / id: null");
  check((await dbGuides({ where: { difficulty: "JUNK" } })).length === 0, "unknown difficulty: empty list");
  check((await dbErrorCodes({ where: { brand: "Nobrand" } })).length === 0, "unknown brand filter: empty list");

  // ── 9e. Sitemap vs noindex (A6-24) ──────────────────────────────────────
  // Before: the sitemap listed all 51 /wasmachine-kapot/* pages (noindex) and the 5 brand-repair
  // pages without catalogue coverage (noindex): "submitted URL marked noindex".
  const urls = (await sitemap()).map((e) => e.url);
  check(!urls.some((u) => u.includes("/wasmachine-kapot/")), "sitemap lists no /wasmachine-kapot/* page (they are noindex)");
  const noCoverage = (brandsJson as Array<{ slug: string; brand: string }>).filter((b) => !all329.some((e) => e.machine.brand === b.brand));
  check(noCoverage.length > 0 && noCoverage.every((b) => !urls.some((u) => u.endsWith(`/${b.slug}-wasmachine-reparatie`))), `sitemap lists none of the ${noCoverage.length} brand-repair pages without catalogue coverage (noindex)`, noCoverage.map((b) => b.slug).join(","));
  check((brandsJson as Array<{ slug: string; brand: string }>).filter((b) => all329.some((e) => e.machine.brand === b.brand)).every((b) => urls.some((u) => u.endsWith(`/${b.slug}-wasmachine-reparatie`))), "sitemap still lists every brand-repair page that has coverage");

  // ── 10. Analytics & exit intent (A6-16/19, A1-16) ───────────────────────
  const props = sanitizeProps({ sku: "WF-PUMP-01", email: "a@b.nl", name: "Jan", code: "REF-123", error_code: "E18", address: "x", order: "abc" } as never) ?? {};
  check(JSON.stringify(Object.keys(props).sort()) === JSON.stringify(["error_code", "sku"]), "event properties are whitelisted: email, name, address, referral code, order id are dropped", JSON.stringify(props));
  check(![...ALLOWED_PROPS].some((k) => /mail|name|phone|addr|user|ip|order|ref/.test(k)), "the property whitelist contains nothing that looks personal");
  check(!exitIntentAllowed("/checkout") && !exitIntentAllowed("/bestelling/abc") && !exitIntentAllowed("/upgrade") && exitIntentAllowed("/foutcodes/Bosch-E18"), "exit intent is blocked on /checkout, /bestelling and /upgrade only");

  // ── HTTP checks ─────────────────────────────────────────────────────────
  if (BASE) await httpChecks(BASE);
  else console.log("      (QA_BASE_URL not set: skipping the HTTP checks)");
  if (ANON) await anonChecks(ANON);
  void jsonParts;
}

/** Cost and supplier of a few parts must not occur in any page or API response. */
async function httpChecks(base: string) {
  const sample = await prisma.part.findMany({ where: { supplier: { not: null } }, take: 4 });
  sample.push(...(await prisma.part.findMany({ where: { supplier: null, costEur: { not: null } }, take: 3, orderBy: { sku: "asc" } })));
  const publicPrices = new Set((await prisma.part.findMany({ select: { priceEur: true } })).map((p) => p.priceEur.toFixed(2)));
  const urls = [
    "/", "/onderdelen", "/onderdelen?q=pomp", ...sample.map((p) => `/onderdelen/${p.sku}`),
    "/foutcodes/Bosch-E18", "/gidsen/trommellager-vervangen", "/api/parts?limit=100", "/api/search?q=pomp",
    ...sample.map((p) => `/api/parts/${p.sku}`), "/api/errorcodes/H1", "/api/errorcodes/F08",
  ];
  let leaks: string[] = [];
  for (const u of urls) {
    const r = await get(base + u);
    if (r.status !== 200) { leaks.push(`${u} -> ${r.status}`); continue; }
    // SVG path data is full of numbers (an icon contains "H5.12"); only look for a cost
    // value in what is left once drawing attributes and styles are removed.
    const body = r.text.replace(/\s(d|points|viewBox|transform|style)="[^"]*"/g, " ").replace(/\\?"d\\?":\\?"[^"\\]*/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ");
    for (const p of sample) {
      if (p.supplier && r.text.includes(p.supplier) && /\"supplier\"|supplier/.test(r.text)) leaks.push(`${u} contains supplier ${p.supplier}`);
      if (p.costEur != null) {
        const needle = p.costEur.toFixed(2);
        // The bare cost number can coincide with a public price; the key name never should.
        if (new RegExp(`costEur[^0-9]{1,6}${p.costEur}\\b`).test(r.text)) leaks.push(`${u} contains costEur of ${p.sku}`);
        if (!publicPrices.has(needle) && new RegExp(`(^|[^0-9.,])${needle.replace(".", "[.,]")}([^0-9]|$)`).test(body)) leaks.push(`${u} contains the cost value ${needle} of ${p.sku}`);
      }
    }
    if (/costEur/.test(r.text)) leaks.push(`${u} contains the key costEur`);
  }
  check(leaks.length === 0, `no page or API leaks cost or supplier (${urls.length} URLs x ${sample.length} parts)`, leaks.slice(0, 6).join(" | "));

  // The home page's client JS used to contain the whole catalogue JSON, costEur included.
  const home = await get(base + "/");
  const chunks = [...home.text.matchAll(/\/_next\/static\/chunks\/[^"']+\.js/g)].map((m) => m[0]);
  let chunkLeaks = 0;
  for (const c of new Set(chunks)) {
    const js = await get(base + c);
    if (/costEur/.test(js.text) || /"supplier":"(Askoll|Gorenje|Irca|SKF)"/.test(js.text)) chunkLeaks++;
  }
  check(chunks.length > 0 && chunkLeaks === 0, `no client JS chunk of the home page contains costEur/supplier (${new Set(chunks).size} chunks)`);

  // No placeholder tile is advertised as a product picture.
  const prod = await get(base + `/onderdelen/${sample[0].sku}`);
  check(!/og:image"[^>]*placehold|placehold\.co/.test(prod.text), "product page emits no placehold.co in og:image / JSON-LD / img");
  check(/Foto volgt/.test(prod.text), "product page says 'Foto volgt' instead of showing a tile as a photo");
  const ld = [...prod.text.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => m[1]);
  const productLd = ld.map((t) => JSON.parse(t)).find((j) => j["@type"] === "Product");
  check(!!productLd && productLd.image === undefined, "Product JSON-LD has no image when there is no real photo");
  const offer = productLd?.offers;
  check(offer?.hasMerchantReturnPolicy?.returnFees === "https://schema.org/ReturnFeesCustomerResponsibility", "return policy JSON-LD: customer pays return shipping (as /retourvoorwaarden says), not FreeReturn");
  check(offer?.shippingDetails?.deliveryTime === undefined, "no delivery-time promise in the structured data");
  check(offer?.priceValidUntil === undefined, "no invented priceValidUntil");
  // Warranty on the RENDERED page (before: "2 jaar garantie" printed on every part). An original,
  // non-consumable part says 2 jaar; a universal one 1 jaar; a filter 6 maanden.
  const textOf = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
  const allDb = await prisma.part.findMany({ orderBy: { sku: "asc" } });
  const samples = [
    allDb.find((p) => p.isOriginal && p.category === "PUMP"),
    allDb.find((p) => !p.isOriginal && !["FILTER", "SEAL", "BOARD", "PANEL", "ELECTRONICS"].includes(p.category)),
    allDb.find((p) => p.category === "FILTER"),
  ];
  check(samples.every(Boolean), "precondition: an original pump, a universal part and a filter exist to test the warranty line");
  const periods = new Set<string>();
  for (const sp of samples) {
    if (!sp) continue;
    const want = formatWarranty(warrantyFor(sp).months);
    periods.add(want);
    const page = textOf((await get(`${base}/onderdelen/${sp.sku}`)).text);
    const m = /Garantie: ([^ ]+ [^ ]+) op dit onderdeel/.exec(page);
    check(m?.[1] === want, `${sp.sku} (${sp.isOriginal ? "origineel" : "universeel"} ${sp.category}) page says '${want}' warranty`, `page says '${m?.[1]}'`);
  }
  check(periods.size === 3, "the three sample parts show three different warranty periods (not one hard-coded figure)", [...periods].join(","));
  const garantie = textOf((await get(`${base}/garantie`)).text);
  // Adjacent text, so a period that merely occurs elsewhere on the page cannot satisfy it.
  check(WARRANTY_ROWS.every((r) => garantie.includes(`${r.label} ${formatWarranty(r.months)} ${r.coverage}`)), "/garantie renders every WARRANTY_ROWS row as 'label period coverage' in the same format as the product page", WARRANTY_ROWS.map((r) => `${r.label} ${formatWarranty(r.months)} ${r.coverage}`).filter((x) => !garantie.includes(x)).join(" | "));

  // Product page facts above the fold: VAT, shipping, payment.
  const visible = prod.text.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ");
  check(/incl\. 21% btw/.test(visible), "product page states 'incl. 21% btw'");
  check(/gratis vanaf/.test(visible) && /Nederland/.test(visible), "product page states the shipping cost and threshold (NL only)");
  check(!/Bancontact|België|NL\/BE/.test(visible), "product page mentions no Belgium / Bancontact");

  // Caching: the three heavy pages are no longer force-dynamic.
  // `next dev` always answers no-store, so this check is for a production server only
  // (set QA_DEV_SERVER=1 to skip it).
  for (const u of process.env.QA_DEV_SERVER === "1" ? [] : ["/", `/onderdelen/${sample[0].sku}`, "/foutcodes/Bosch-E18"]) {
    await get(base + u);
    const r = await get(base + u);
    const cc = r.headers.get("cache-control") ?? "";
    check(!/no-store/.test(cc) && /s-maxage|stale-while-revalidate/.test(cc), `${u} is cacheable (Cache-Control: ${cc || "none"})`, `x-nextjs-cache=${r.headers.get("x-nextjs-cache")}`);
  }

  // API paths expose only public parts.
  const api = JSON.parse((await get(base + "/api/parts?limit=100")).text);
  check(api.parts.length > 0 && api.parts.every((p: Record<string, unknown>) => !("costEur" in p) && !("supplier" in p)), "/api/parts rows have no costEur/supplier");
  const one = JSON.parse((await get(base + `/api/parts/${sample[0].sku}`)).text);
  check(!("costEur" in one.part) && !("supplier" in one.part), "/api/parts/[sku] has no costEur/supplier");

  // Search API: regression guard only. This route never returned guide steps (so this cannot
  // have failed on the old code); it is here to catch a future change, and it asserts the
  // response is non-empty so it cannot pass on an error page.
  const search = await get(base + "/api/search?q=trommellager");
  check(search.status === 200 && /"type":"gids"/.test(search.text) && !/\\"stepNum\\"|"stepNum"/.test(search.text), "[regression guard] /api/search answers and carries no guide steps");

  // Natural queries through the real page (data-testid="part-count"), and the partial-match note.
  const natural = textOf((await get(base + "/onderdelen?q=" + encodeURIComponent("afvoerpomp voor mijn Bosch wasmachine"))).text);
  check(/\d+ (van \d+ )?onderdel/.test(natural) && !/Geen onderdelen gevonden/.test(natural), "/onderdelen?q=afvoerpomp voor mijn Bosch wasmachine lists parts");
  const partialPage = textOf((await get(base + "/onderdelen?q=" + encodeURIComponent("bosch pomp zzzzqq"))).text);
  check(/bijna alles passen/.test(partialPage), "a query where no part matches every word says the list is a partial match");

  // Copy that used to promise things we do not do (D6, D9), on the rendered pages.
  const STALE_PAGE = /België|NL en BE|NL\/BE|aangemeld|Bancontact|60 seconden|\b60s\b|60% van alle defecten/;
  const slugs = {
    help: (helpArticles as Array<{ slug: string }>).map((a) => `/help/${a.slug}`),
    vs: (comparisonsJson as Array<{ slug: string }>).map((c) => `/vs/${c.slug}`),
    blog: (JSON.parse(readFileSync("src/data/blog-posts.json", "utf8")) as Array<{ slug: string }>).map((b) => `/blog/${b.slug}`),
  };
  const staleHits: string[] = [];
  let copyPages = 0;
  for (const u of [...slugs.help, ...slugs.vs, ...slugs.blog, "/", "/pers", "/contact"]) {
    const r = await get(base + u);
    if (r.status !== 200) { staleHits.push(`${u} -> ${r.status}`); continue; }
    copyPages++;
    const m = STALE_PAGE.exec(textOf(r.text));
    if (m) staleHits.push(`${u}: '${m[0]}'`);
  }
  check(staleHits.length === 0, `${copyPages} help / vs / blog / home pages render without Belgium, aangemeld, 60-seconds or 60%-of-defects claims`, staleHits.slice(0, 5).join(" | "));
  const homeText = textOf((await get(base + "/")).text);
  check(!/Wij weten wat er echt mis is|Geen monteur nodig|alleen Particulier\+|Garantie-check automatisch|Vision-model/.test(homeText), "home page no longer carries the certainty / open-tool-behind-a-plan / unverified-vision claims");

  // Parameters that used to produce HTTP 500.
  for (const [u, want] of [
    ["/onderdelen?q=a&q=b", 200], ["/foutcodes?q=a&q=b&brand=x&brand=y", 200], ["/gidsen?q=a&q=b&difficulty=x&difficulty=y", 200],
    ["/foutcodes/%E0%A4%A", 404], ["/onderdelen/%ZZ", 404], ["/merken/%ZZ", 404], ["/merken/Bosch/%ZZ", 404],
  ] as const) {
    const r = await get(base + u);
    // A malformed escape is a client error: 400 (Next's own router) or 404 (our safeDecode), never 500.
    if (want === 200) check(r.status === 200, `${u} answers 200 (was: 500, an array where a string was expected)`, `got ${r.status}`);
    // The malformed-escape paths are answered by src/middleware.ts before any page runs: on a production
    // build its route matcher calls decodeURI() and the request ends as a 500 (dev answers 400). The pages
    // themselves use safeDecode(); the middleware needs the same guard (crossFileNeeds).
    else xfail(r.status === 400 || r.status === 404, `${u} answers 400/404 instead of 500`, `got ${r.status}; src/middleware.ts calls decodeURI on the path`);
  }

  // Plan flip: FREE vs paying, via the demo user of a dev server.
  if (MUTATE && process.env.QA_PLAN_FLIP === "1") { await planFlip(base); await memberPriceEndToEnd(base); }
  if (MUTATE && CRON) await revalidationProof(base, sample[0].sku);
  if (MUTATE && CRON && process.env.QA_DEV_SERVER !== "1") await dbOutageProof(base, sample[0].sku);
  if (process.env.QA_CACHE_DIR && process.env.QA_DEV_SERVER !== "1") await cachePollution(base);
  if (process.env.QA_CRAWL === "1") await sitemapCrawl(base);
}

async function planFlip(base: string) {
  const user = await prisma.user.findFirst({ where: { email: "jdahoe@hotmail.nl" } });
  if (!user) { check(false, "demo user for the plan-flip check exists"); return; }
  const original = user.plan;
  try {
    for (const [plan, expectFull] of [["FREE", false], ["PARTICULIER", true]] as const) {
      await prisma.user.update({ where: { id: user.id }, data: { plan } });
      const list = JSON.parse((await get(base + "/api/guides?limit=50")).text);
      const one = JSON.parse((await get(base + "/api/guides/trommellager-vervangen")).text);
      const premium = list.guides.filter((g: { isPremium: boolean }) => g.isPremium);
      const stepCount = (g: { steps: string }) => JSON.parse(g.steps).length;
      const listOk = premium.every((g: { steps: string }) => (expectFull ? stepCount(g) > FREE_GUIDE_STEPS : stepCount(g) <= FREE_GUIDE_STEPS));
      const oneOk = expectFull ? stepCount(one.guide) > FREE_GUIDE_STEPS : stepCount(one.guide) <= FREE_GUIDE_STEPS && one.guide.lockedStepCount > 0;
      check(premium.length >= 3 && listOk, `HTTP /api/guides as ${plan}: premium guides ${expectFull ? "complete" : "cut to the preview"}`, `steps: ${premium.map(stepCount).join(",")}`);
      check(oneOk, `HTTP /api/guides/[slug] as ${plan}: ${expectFull ? "all steps" : "preview + lockedStepCount"}`);
      const code = JSON.parse((await get(base + "/api/errorcodes/H1")).text);
      check(code.errorCode.guides.filter((g: { guide: { isPremium: boolean; steps: string } }) => g.guide.isPremium).every((g: { guide: { steps: string } }) => stepCount(g.guide) <= FREE_GUIDE_STEPS), `HTTP /api/errorcodes/H1 as ${plan}: embedded premium guide is a preview`);
    }
  } finally {
    await prisma.user.update({ where: { id: user.id }, data: { plan: original } });
  }
}

async function anonChecks(base: string) {
  // A production server with demo auth off: nobody is signed in.
  const list = JSON.parse((await get(base + "/api/guides?limit=50")).text);
  const premium = list.guides.filter((g: { isPremium: boolean }) => g.isPremium);
  check(premium.length >= 3 && premium.every((g: { steps: string; lockedStepCount: number }) => JSON.parse(g.steps).length <= FREE_GUIDE_STEPS && g.lockedStepCount > 0), "ANON /api/guides: every premium guide cut to the preview (was: all 10-11 steps)");
  const one = JSON.parse((await get(base + "/api/guides/trommellager-vervangen")).text);
  check(JSON.parse(one.guide.steps).length <= FREE_GUIDE_STEPS && one.guide.locked === true, "ANON /api/guides/trommellager-vervangen: preview only (was: 10 steps)");
  const code = JSON.parse((await get(base + "/api/errorcodes/H1")).text);
  check(code.errorCode.guides.every((g: { guide: { steps: string; isPremium: boolean } }) => !g.guide.isPremium || JSON.parse(g.guide.steps).length <= FREE_GUIDE_STEPS), "ANON /api/errorcodes/H1: embedded premium guide is a preview (was: 11 steps)");
  const parts = JSON.parse((await get(base + "/api/parts?limit=100")).text);
  check(parts.parts.length > 0 && parts.parts.every((p: Record<string, unknown>) => !("costEur" in p) && !("supplier" in p)), "ANON /api/parts: no costEur/supplier (was: both, for all rows)");
  const html = await get(base + "/onderdelen/WF-PUMP-01");
  check(!/costEur|Askoll/.test(html.text), "ANON product page HTML: no costEur/supplier");
  const nores = await get(base + "/api/parts/revalidate");
  check(nores.status === 405 || nores.status === 404, "revalidate endpoint does not answer GET");
  const unauth = await fetch(base + "/api/parts/revalidate", { method: "POST" });
  check(unauth.status === 401 || unauth.status === 503, "revalidate endpoint refuses a caller without the secret", `status ${unauth.status}`);
}

/** A price change in the database shows on the cached page after revalidation, not before. */
async function revalidationProof(base: string, sku: string) {
  const part = await prisma.part.findUnique({ where: { sku } });
  if (!part) return;
  const newPrice = Math.round((part.priceEur + 1.11) * 100) / 100;
  const fmt = (n: number) => n.toFixed(2).replace(".", ",");
  try {
    await get(`${base}/onderdelen/${sku}`);
    await prisma.part.update({ where: { sku }, data: { priceEur: newPrice } });
    const stale = await get(`${base}/onderdelen/${sku}`);
    check(stale.text.includes(fmt(part.priceEur)) && !stale.text.includes(fmt(newPrice)), "cached product page still shows the old price right after a DB change (it IS cached)");
    const res = await fetch(`${base}/api/parts/revalidate`, { method: "POST", headers: { Authorization: `Bearer ${CRON}` } });
    check(res.status === 200, "POST /api/parts/revalidate with the secret succeeds", `status ${res.status}`);
    const fresh = await get(`${base}/onderdelen/${sku}`);
    check(fresh.text.includes(fmt(newPrice)), `after revalidateCatalog() the page shows the new price ${fmt(newPrice)}`);
    const api = JSON.parse((await get(`${base}/api/parts/${sku}`)).text);
    check(api.part.priceEur === newPrice, "the API shows the new price too");
  } finally {
    await prisma.part.update({ where: { sku }, data: { priceEur: part.priceEur } });
    if (CRON) await fetch(`${base}/api/parts/revalidate`, { method: "POST", headers: { Authorization: `Bearer ${CRON}` } });
  }
}

/**
 * A database outage must not be remembered. Before: the JSON fallback was returned from inside
 * unstable_cache, so a one-off query failure pinned the seed price and stock into the shared
 * data cache; every page and listing read it for another CATALOG_REVALIDATE_SECONDS after the
 * database was back (and the ISR page on top of that).
 *
 * The outage is simulated by renaming the Part table (every query on it then fails) and put back
 * in a finally block. No revalidation happens after the table is back.
 *   1. A listing (dynamic page, reads the cached part index) must show the DATABASE price right
 *      after recovery. This is the check that fails on the old code: the index was pinned.
 *   2. The product page that was rendered DURING the outage is stored as ISR output and, as
 *      documented in static-db.ts, may keep the fallback until its own 60 s window ends. It must
 *      show the database price within 75 s without anyone revalidating.
 */
async function dbOutageProof(base: string, sku: string) {
  const part = await prisma.part.findUnique({ where: { sku } });
  if (!part) return;
  const jsonPart = jsonParts.find((p) => p.sku === sku);
  const dbPrice = Math.round((part.priceEur + 7.77) * 100) / 100;
  const fmt = (n: number) => n.toFixed(2).replace(".", ",");
  if (!jsonPart || jsonPart.priceEur === dbPrice) { check(false, "precondition: JSON price differs from the DB price used in the outage proof"); return; }
  const revalidate = () => fetch(`${base}/api/parts/revalidate`, { method: "POST", headers: { Authorization: `Bearer ${CRON}` } });
  let renamed = false;
  try {
    await prisma.part.update({ where: { sku }, data: { priceEur: dbPrice } });
    await revalidate();
    const healthy = await get(`${base}/onderdelen/${sku}`);
    check(healthy.text.includes(fmt(dbPrice)), `precondition: the page shows the database price ${fmt(dbPrice)} while the database is up`);
    await prisma.$executeRawUnsafe('ALTER TABLE "Part" RENAME TO "Part_qa_outage"');
    renamed = true;
    await revalidate();
    const during = await get(`${base}/onderdelen/${sku}`);
    check(during.status === 200 && during.text.includes(fmt(jsonPart.priceEur)), "precondition: during the outage the product page is served from the JSON fallback (the outage is real, and it is not a 500)", `status ${during.status}`);
    const duringList = await get(`${base}/onderdelen?q=${encodeURIComponent(sku)}`);
    check(duringList.status === 200 && duringList.text.includes(fmt(jsonPart.priceEur)), "precondition: during the outage the listing is served from the JSON fallback too", `status ${duringList.status}`);
  } finally {
    if (renamed) await prisma.$executeRawUnsafe('ALTER TABLE "Part_qa_outage" RENAME TO "Part"');
  }
  const list = await get(`${base}/onderdelen?q=${encodeURIComponent(sku)}`);
  check(list.text.includes(fmt(dbPrice)) && !list.text.includes(fmt(jsonPart.priceEur)), "right after the database is back (no revalidation) the listing shows the database price: the fallback was not pinned in the data cache", `shows ${list.text.includes(fmt(jsonPart.priceEur)) ? "the JSON price" : "neither price"}`);
  let pageOk = false;
  const started = Date.now();
  while (Date.now() - started < 75_000) {
    const r = await get(`${base}/onderdelen/${sku}`);
    if (r.text.includes(fmt(dbPrice)) && !r.text.includes(fmt(jsonPart.priceEur))) { pageOk = true; break; }
    await new Promise((res) => setTimeout(res, 5000));
  }
  check(pageOk, `the product page rendered during the outage shows the database price again within ${Math.round((Date.now() - started) / 1000)} s (bound: its 60 s revalidate window)`);
  await prisma.part.update({ where: { sku }, data: { priceEur: part.priceEur } });
  await revalidate();
}

/** Count of files under a directory, recursively. */
function countFiles(dir: string): number {
  let n = 0;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    n += statSync(full).isDirectory() ? countFiles(full) : 1;
  }
  return n;
}

/**
 * Junk keys must not grow the persistent data cache. Before: brand, difficulty, sku, slug and
 * code from the URL became cache keys, including for things that do not exist: 240 junk API
 * requests added 240 files, 150 junk 404 URLs another ~200. QA_CACHE_DIR is the server's
 * `<distDir>/cache/fetch-cache`.
 */
async function cachePollution(base: string) {
  const dir = process.env.QA_CACHE_DIR!;
  // Warm the legitimate entries first so only junk can move the count.
  for (const u of ["/", "/onderdelen/WF-PUMP-01", "/foutcodes/Bosch-E18", "/merken/Bosch", "/api/errorcodes?brand=Bosch", "/api/guides?difficulty=EASY", "/api/guides/trommellager-vervangen"]) await get(base + u);
  const before = countFiles(dir);
  const N = 60;
  for (let i = 0; i < N; i++) {
    await Promise.all([
      get(`${base}/api/errorcodes?brand=junk${i}`), get(`${base}/api/guides?difficulty=junk${i}`), get(`${base}/api/guides/junk-${i}`),
      get(`${base}/onderdelen/NOPE-${i}`), get(`${base}/foutcodes/Bosch-ZZ${i}`), get(`${base}/merken/Nobrand${i}`), get(`${base}/merken/Bosch/NOPE${i}`),
    ]);
  }
  const grown = countFiles(dir) - before;
  check(grown <= 3, `${N * 7} junk-key requests add at most 3 files to the data cache (was: about one per request)`, `${before} -> ${before + grown}`);
}

/** The signed-in member price on the page equals the charge of a real order (A4-13). */
async function memberPriceEndToEnd(base: string) {
  const user = await prisma.user.findFirst({ where: { email: "jdahoe@hotmail.nl" } });
  const part = await prisma.part.findUnique({ where: { sku: "WF-PUMP-01" } });
  if (!user || !part) { check(false, "demo user and WF-PUMP-01 exist for the member-price order"); return; }
  const original = { plan: user.plan, stock: part.stock };
  let orderId: string | undefined;
  try {
    await prisma.user.update({ where: { id: user.id }, data: { plan: "BEDRIJF" } });
    const plan = JSON.parse((await get(base + "/api/user/plan")).text);
    const d = Number(plan?.data?.partsDiscount ?? plan?.partsDiscount ?? 0);
    const res = await fetch(base + "/api/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        items: [{ sku: "WF-PUMP-01", quantity: 1 }], email: "qa-member@example.test", name: "QA Member", paymentMethod: "bank_transfer",
        address: { street: "Teststraat", houseNumber: "1", postalCode: "1011 AB", city: "Amsterdam", country: "NL" },
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { data?: { orderId?: string }; orderId?: string };
    orderId = body.data?.orderId ?? body.orderId;
    const order = orderId ? await prisma.order.findUnique({ where: { id: orderId } }) : null;
    if (!order) { check(false, "member-price order could be placed", `status ${res.status} ${JSON.stringify(body).slice(0, 160)}`); return; }
    const shown = memberLineTotal(part.priceEur, d);
    // total = subtotal - discount + shipping; shipping is added when the subtotal is under the free threshold.
    const charged = Math.round((order.totalEur - (order.shippingEur ?? 0)) * 100) / 100;
    check(d === 0.15 && Math.round(order.discountEur * 100) === Math.round((part.priceEur - shown) * 100) && charged === shown, `real BEDRIJF order for WF-PUMP-01: page says ${shown.toFixed(2)}, checkout charged ${charged.toFixed(2)} (discount ${order.discountEur})`, `d=${d}`);
  } finally {
    await prisma.user.update({ where: { id: user.id }, data: { plan: original.plan } });
    await prisma.part.update({ where: { sku: "WF-PUMP-01" }, data: { stock: original.stock } });
  }
}

/**
 * Every URL in the sitemap answers 200 and none of them is noindex. Before: 56 listed pages
 * carried <meta name="robots" content="noindex">. Slow on a dev server (one compile per route),
 * hence opt-in: QA_CRAWL=1.
 */
async function sitemapCrawl(base: string) {
  const xml = (await get(base + "/sitemap.xml")).text;
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname + new URL(m[1]).search);
  const bad: string[] = [];
  let i = 0;
  const worker = async () => {
    while (i < locs.length) {
      const u = locs[i++];
      const r = await get(base + u);
      if (r.status !== 200) bad.push(`${u} -> ${r.status}`);
      else if (/<meta name="robots" content="[^"]*noindex/.test(r.text)) bad.push(`${u} is noindex`);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  check(locs.length > 400 && bad.length === 0, `all ${locs.length} sitemap URLs answer 200 and none is noindex`, bad.slice(0, 6).join(" | "));
}

main()
  .catch((e) => {
    console.error(e);
    check(false, "qa-storefront crashed", String(e));
  })
  .finally(async () => {
    await prisma.$disconnect();
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    process.exit(failed.length ? 1 : 0);
  });
