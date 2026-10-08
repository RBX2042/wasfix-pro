/**
 * Static data fallback — used when DATABASE_URL is not configured.
 * Provides Prisma-shaped objects so pages can swap in without changing render code.
 *
 * Two families of readers live here: the synchronous static* functions, which
 * only ever see src/data/*.json, and the asynchronous db* functions at the
 * bottom, which read Postgres and fall back to their static* sibling. Public
 * pages belong on the db* ones — see the note above that section.
 */

import machinesRaw from "@/data/machines.json";
import partsRaw from "@/data/parts.json";
import errorCodesRaw from "@/data/error-codes.json";
import guidesRaw from "@/data/guides.json";
import partMachineRaw from "@/data/part-machine.json";
import errorCodePartsRaw from "@/data/errorcode-parts.json";
import errorCodeGuidesRaw from "@/data/errorcode-guides.json";
import guidePartsRaw from "@/data/guide-parts.json";
import { isDatabaseConfigured } from "@/lib/env";
import { logger } from "@/lib/logger";
import { cachedCatalogRead } from "@/lib/cache-tags";
import { categoryGroup, categoryLabel, categoryPlural, FOLDED_CATEGORIES, PART_CATEGORY_INFO } from "@/lib/part-categories";
import type { Prisma, PrismaClient } from "@prisma/client";

type Machine = {
  id: string;
  brand: string;
  model: string;
  yearFrom: number | null;
  yearTo: number | null;
  imageUrl: string | null;
  description: string | null;
};

type Part = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  brand: string;
  category: string;
  priceEur: number;
  /** Purchase price ex VAT; drives margin reporting. */
  costEur?: number | null;
  stock: number;
  imageUrl: string | null;
  isOriginal: boolean;
  supplier: string | null;
};

type ErrorCode = {
  id: string;
  code: string;
  machineId: string;
  title: string;
  description: string;
  likelyCauses: string;
  severity: string;
  diyFriendly: boolean;
  /** "VERIFIED" when checked against a public source, else "REPORTED". */
  provenance: string;
  sourceUrl: string | null;
  sourceName: string | null;
};

type Guide = {
  id: string;
  title: string;
  slug: string;
  machineId: string | null;
  difficulty: string;
  timeMinutes: number;
  steps: string;
  tools: string;
  summary: string;
  warnings: string | null;
  isPremium: boolean;
  views: number;
  /** ISO 8601 timestamp. The seed used to mix epoch-ms numbers and ISO
   *  strings, which made date sorting silently wrong for six guides. */
  createdAt: string;
};

export const machines = machinesRaw as Machine[];
export const parts = partsRaw as Part[];
export const errorCodes = errorCodesRaw as ErrorCode[];
export const guides = guidesRaw as Guide[];
export const partMachine = partMachineRaw as Array<{ partId: string; machineId: string }>;
export const errorCodeParts = errorCodePartsRaw as Array<{ errorCodeId: string; partId: string }>;
export const errorCodeGuides = errorCodeGuidesRaw as Array<{ errorCodeId: string; guideId: string }>;
export const guideParts = guidePartsRaw as Array<{ guideId: string; partId: string }>;

// ============ Part queries ============

export function staticParts(opts?: {
  where?: { category?: string; brand?: string; q?: string; minStock?: number; categories?: string[]; skus?: string[] };
  orderBy?: "stock-desc" | "price-asc" | "stock-then-price";
  take?: number;
}): Part[] {
  let result = [...parts];
  const w = opts?.where;
  if (w?.minStock !== undefined) result = result.filter((p) => p.stock > w.minStock!);
  if (w?.category) result = result.filter((p) => p.category === w.category);
  if (w?.categories?.length) result = result.filter((p) => w.categories!.includes(p.category));
  if (w?.brand) result = result.filter((p) => p.brand === w.brand);
  if (w?.q) {
    const q = w.q.toLowerCase();
    result = result.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.description ?? "").toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q),
    );
  }
  if (w?.skus?.length) result = result.filter((p) => w.skus!.includes(p.sku));

  switch (opts?.orderBy) {
    case "stock-desc":
      result.sort((a, b) => b.stock - a.stock);
      break;
    case "price-asc":
      result.sort((a, b) => a.priceEur - b.priceEur);
      break;
    case "stock-then-price":
      result.sort((a, b) => b.stock - a.stock || a.priceEur - b.priceEur);
      break;
  }
  if (opts?.take) result = result.slice(0, opts.take);
  return result;
}

export function staticPart(sku: string): Part | null {
  return parts.find((p) => p.sku === sku) ?? null;
}

export function staticPartById(id: string): Part | null {
  return parts.find((p) => p.id === id) ?? null;
}

export function staticPartBrands(): string[] {
  return [...new Set(parts.map((p) => p.brand))].sort();
}

export type PartFull = Part & {
  machines: { machine: Machine }[];
  guides: { guide: Guide }[];
  errorCodes: { errorCode: ErrorCode & { machine: Machine } }[];
};

export function staticPartFull(sku: string): PartFull | null {
  const part = parts.find((p) => p.sku === sku);
  if (!part) return null;

  const machineIds = partMachine.filter((r) => r.partId === part.id).map((r) => r.machineId);
  const guideIds = guideParts.filter((r) => r.partId === part.id).map((r) => r.guideId);
  const ecIds = errorCodeParts.filter((r) => r.partId === part.id).map((r) => r.errorCodeId);

  return {
    ...part,
    machines: machineIds
      .map((mid) => machines.find((m) => m.id === mid))
      .filter((m): m is Machine => !!m)
      .map((machine) => ({ machine })),
    guides: guideIds
      .map((gid) => guides.find((g) => g.id === gid))
      .filter((g): g is Guide => !!g)
      .map((guide) => ({ guide })),
    errorCodes: ecIds
      .map((eid) => {
        const ec = errorCodes.find((e) => e.id === eid);
        if (!ec) return null;
        const machine = machines.find((m) => m.id === ec.machineId);
        if (!machine) return null;
        return { errorCode: { ...ec, machine } };
      })
      .filter((x): x is { errorCode: ErrorCode & { machine: Machine } } => x !== null),
  };
}

export function staticRelatedParts(category: string, excludeId: string, take = 4): Part[] {
  return parts
    .filter((p) => p.category === category && p.id !== excludeId && p.stock > 0)
    .slice(0, take);
}

// ============ Machine queries ============

export function staticMachines(opts?: { brand?: string }): Machine[] {
  let result = [...machines];
  if (opts?.brand) result = result.filter((m) => m.brand === opts.brand);
  result.sort((a, b) => a.brand.localeCompare(b.brand) || a.model.localeCompare(b.model));
  return result;
}

export function staticMachine(brand: string, model: string): Machine | null {
  return machines.find((m) => m.brand === brand && m.model === model) ?? null;
}

export function staticMachineBrands(): string[] {
  return [...new Set(machines.map((m) => m.brand))].sort();
}

export type MachineWithCounts = Machine & { _count: { errorCodes: number } };

export function staticMachinesByBrand(brand: string): MachineWithCounts[] {
  return machines
    .filter((m) => m.brand === brand)
    .map((m) => ({
      ...m,
      _count: { errorCodes: errorCodes.filter((ec) => ec.machineId === m.id).length },
    }))
    .sort((a, b) => a.model.localeCompare(b.model));
}

export type MachineFull = Machine & {
  errorCodes: ErrorCode[];
  repairGuides: Guide[];
  parts: { part: Part }[];
};

export function staticMachineFull(brand: string, model: string): MachineFull | null {
  const m = machines.find((x) => x.brand === brand && x.model === model);
  if (!m) return null;
  const ecs = errorCodes.filter((ec) => ec.machineId === m.id);
  const partIds = partMachine.filter((r) => r.machineId === m.id).map((r) => r.partId);
  return {
    ...m,
    errorCodes: ecs,
    repairGuides: guides.filter((g) => g.machineId === m.id),
    parts: partIds
      .map((pid) => parts.find((p) => p.id === pid))
      .filter((p): p is Part => !!p)
      .map((part) => ({ part })),
  };
}

// ============ ErrorCode queries ============

// Shared with the database path below, which cannot get this order from SQL.
const SEVERITY_ORDER: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };

export type ErrorCodeWithMachine = ErrorCode & { machine: Machine };
export type ErrorCodeFull = ErrorCodeWithMachine & {
  parts: { part: Part }[];
  guides: { guide: Guide }[];
};

export function staticErrorCodes(opts?: {
  where?: { code?: string; brand?: string; q?: string };
  take?: number;
}): ErrorCodeWithMachine[] {
  let result = errorCodes
    .map((ec) => {
      const machine = machines.find((m) => m.id === ec.machineId);
      return machine ? { ...ec, machine } : null;
    })
    .filter((x): x is ErrorCodeWithMachine => x !== null);

  const w = opts?.where;
  if (w?.code) result = result.filter((ec) => ec.code.toLowerCase().includes(w.code!.toLowerCase()));
  if (w?.brand) result = result.filter((ec) => ec.machine.brand === w.brand);
  if (w?.q) {
    const q = w.q.toLowerCase();
    result = result.filter(
      (ec) =>
        ec.code.toLowerCase().includes(q) ||
        ec.title.toLowerCase().includes(q) ||
        ec.description.toLowerCase().includes(q),
    );
  }

  // Default order: severity desc, code asc
  result.sort((a, b) => (SEVERITY_ORDER[b.severity] ?? 0) - (SEVERITY_ORDER[a.severity] ?? 0) || a.code.localeCompare(b.code));

  if (opts?.take) result = result.slice(0, opts.take);
  return result;
}

export function staticErrorCode(brand: string, code: string): ErrorCodeFull | null {
  const ec = errorCodes.find((e) => {
    const m = machines.find((m) => m.id === e.machineId);
    return m?.brand === brand && e.code === code;
  });
  if (!ec) return null;
  const machine = machines.find((m) => m.id === ec.machineId);
  if (!machine) return null;
  return enrichErrorCode(ec, machine);
}

export function staticErrorCodeByCode(code: string, brand?: string): ErrorCodeFull | null {
  const matching = errorCodes.filter((e) => e.code.toLowerCase().includes(code.toLowerCase()));
  for (const ec of matching) {
    const machine = machines.find((m) => m.id === ec.machineId);
    if (!machine) continue;
    if (brand && machine.brand !== brand) continue;
    return enrichErrorCode(ec, machine);
  }
  return null;
}

function enrichErrorCode(ec: ErrorCode, machine: Machine): ErrorCodeFull {
  const relatedPartIds = errorCodeParts.filter((r) => r.errorCodeId === ec.id).map((r) => r.partId);
  const relatedGuideIds = errorCodeGuides.filter((r) => r.errorCodeId === ec.id).map((r) => r.guideId);
  return {
    ...ec,
    machine,
    parts: relatedPartIds
      .map((pid) => parts.find((p) => p.id === pid))
      .filter((p): p is Part => !!p)
      .map((part) => ({ part })),
    guides: relatedGuideIds
      .map((gid) => guides.find((g) => g.id === gid))
      .filter((g): g is Guide => !!g)
      .map((guide) => ({ guide })),
  };
}

// ============ Guide queries ============

export function staticGuides(opts?: {
  where?: { difficulty?: string; q?: string; slugs?: string[]; isPremium?: boolean };
  take?: number;
  orderBy?: "views-desc" | "created-desc";
}): Guide[] {
  let result = [...guides];
  const w = opts?.where;
  if (w?.difficulty) result = result.filter((g) => g.difficulty === w.difficulty);
  if (w?.isPremium !== undefined) result = result.filter((g) => g.isPremium === w.isPremium);
  if (w?.q) {
    const q = w.q.toLowerCase();
    result = result.filter((g) => g.title.toLowerCase().includes(q) || g.summary.toLowerCase().includes(q));
  }
  if (w?.slugs?.length) result = result.filter((g) => w.slugs!.includes(g.slug));

  switch (opts?.orderBy) {
    case "views-desc":
      result.sort((a, b) => b.views - a.views);
      break;
    case "created-desc":
      result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      break;
    default:
      // Views tie at zero on a fresh catalogue, so fall back to newest first
      // rather than leaving the order to whatever the JSON happened to hold.
      result.sort((a, b) => b.views - a.views || b.createdAt.localeCompare(a.createdAt));
  }
  if (opts?.take) result = result.slice(0, opts.take);
  return result;
}

export function staticGuide(slug: string): (Guide & { parts: { part: Part }[] }) | null {
  const g = guides.find((g) => g.slug === slug);
  if (!g) return null;
  const partIds = guideParts.filter((r) => r.guideId === g.id).map((r) => r.partId);
  return {
    ...g,
    parts: partIds
      .map((pid) => parts.find((p) => p.id === pid))
      .filter((p): p is Part => !!p)
      .map((part) => ({ part })),
  };
}

// ============ Stats ============

export function staticStats() {
  return {
    partsCount: parts.length,
    guidesCount: guides.length,
    machinesCount: machines.length,
    errorCodesCount: errorCodes.length,
  };
}

// ============ Public projections ============

/**
 * What the outside world may see of a part.
 *
 * costEur (our purchase price) and supplier used to travel with every Part:
 * GET /api/parts returned them for all 96 rows, and because the product page
 * handed the whole row to a client component, Next serialised them into the
 * HTML of every part page and every /onderdelen listing. Anyone could read the
 * margin table. Everything that leaves the server - JSON responses, props of
 * client components, JSON-LD - goes through toPublicPart(), which is an
 * explicit whitelist: a field added to the Part model later stays private until
 * somebody adds it here on purpose.
 */
export type PublicPart = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  brand: string;
  category: string;
  priceEur: number;
  stock: number;
  /** A real photo URL, or null. Placeholder tiles are never exposed, see realImageUrl(). */
  imageUrl: string | null;
  isOriginal: boolean;
};

const PLACEHOLDER_IMAGE_HOSTS = ["placehold.co", "via.placeholder.com", "placeholder.com", "dummyimage.com", "placekitten.com"];

/**
 * The image URL if it is a real photo, otherwise null.
 *
 * All 96 seed parts point at placehold.co text tiles ("Pomp" on a coloured
 * square). Showing those as product photos, or emitting them as og:image and
 * JSON-LD image, tells shoppers and Google there is a photo when there is not.
 * Treating them as "no photo" lets the UI show an honest "Foto volgt" state,
 * and the moment the owner puts a real URL in Part.imageUrl it takes over
 * everywhere with no code change.
 */
export function realImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url, "https://local.invalid").hostname.toLowerCase();
    if (PLACEHOLDER_IMAGE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return null;
  } catch {
    return null;
  }
  return url;
}

export function toPublicPart(p: {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  brand: string;
  category: string;
  priceEur: number;
  stock: number;
  imageUrl: string | null;
  isOriginal: boolean;
}): PublicPart {
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    description: p.description,
    brand: p.brand,
    category: p.category,
    priceEur: p.priceEur,
    stock: p.stock,
    imageUrl: realImageUrl(p.imageUrl),
    isOriginal: p.isOriginal,
  };
}

// ── Guides: the premium paywall must hold outside the page too ─────────────

/** Steps every visitor may read of a premium guide. The guide page uses the same number. */
export const FREE_GUIDE_STEPS = 2;

export type RedactedGuide = Guide & {
  /** True when steps were cut because the viewer's plan has no premium guides. */
  locked: boolean;
  /** How many steps were withheld (0 when not locked). */
  lockedStepCount: number;
};

/**
 * Cut a premium guide down to its free preview unless the viewer may read it.
 *
 * The /gidsen page locked premium guides after step 2, but /api/guides,
 * /api/guides/[id] and the error-code and diagnose payloads returned every
 * step of all three premium guides to anyone with curl - the thing the
 * Particulier plan sells, for free. This is the single function every
 * serialiser applies, so the answer to "who sees which steps" lives in one
 * place. Non-premium guides pass through untouched.
 */
export function redactGuide(guide: Guide, canReadPremium: boolean): RedactedGuide {
  if (!guide.isPremium || canReadPremium) return { ...guide, locked: false, lockedStepCount: 0 };
  let steps: unknown[] = [];
  try {
    const parsed = JSON.parse(guide.steps);
    if (Array.isArray(parsed)) steps = parsed;
  } catch {
    // Unparseable steps are withheld entirely rather than leaked as raw text.
  }
  const kept = steps.slice(0, FREE_GUIDE_STEPS);
  return {
    ...guide,
    steps: JSON.stringify(kept),
    locked: true,
    lockedStepCount: Math.max(0, steps.length - kept.length),
  };
}

// ============ Database-first queries ============


/**
 * Once DATABASE_URL is configured, Postgres is the catalog: it is what /admin
 * writes to and what checkout charges from. A page served from the JSON then
 * advertises a price nobody is charged, stock nobody has ("Op voorraad — 42
 * stuks" while checkout answers "Onvoldoende voorraad (0 beschikbaar)"), and
 * 404s on a part the admin created ten seconds ago.
 *
 * So: every public surface reads through these db* functions. They fall back to
 * their static* sibling when there is no database or the query throws, which is
 * the only role src/data/*.json still has. A row the database does not hold is
 * NOT a fallback case — a part deleted in /admin stays gone for the rest of
 * that database's life. Caveat, because the invariant is not airtight: the seed
 * re-creates any JSON row the database is missing, so a part withdrawn in
 * /admin comes back at the next content deploy. Closing that needs a tombstone
 * the seed can skip; until then "gone" means "gone until the next seed run".
 *
 * The static* family stays exported for that fallback, and for the places
 * that genuinely cannot await: catalog-stats.ts and the admin/monteur pages,
 * which already read Prisma directly because they need to know whether a
 * database is there at all. Nothing else may read a customer-facing price,
 * stock or existence from them. NO CLIENT COMPONENT MAY IMPORT THIS MODULE (or
 * catalog-stats): it carries the whole catalogue JSON, costEur and supplier
 * included, and anything a client bundle imports ships to every browser. The
 * homepage client component used to do exactly that and received the purchase
 * price of every part inside its JS chunk.
 *
 * The JSON has a file order to fall back on, a table does not, so every query
 * here carries an explicit orderBy — without one Postgres is free to reshuffle
 * a listing between two renders of the same page.
 */
async function fromDb<T>(query: (db: PrismaClient) => Promise<T>, fallback: () => T | Promise<T>): Promise<T> {
  if (!isDatabaseConfigured()) return fallback();
  try {
    // Imported lazily so a plain `import` of this module never opens a
    // database connection.
    const { prisma } = await import("@/lib/prisma");
    return await query(prisma);
  } catch (err) {
    logger.error("[static-db] catalog query failed — falling back to src/data", err);
    return fallback();
  }
}

/**
 * A cached catalogue read that can never cache the JSON fallback.
 *
 * `fromDb` swallows a failed query and returns src/data, which is right for one
 * request but wrong inside unstable_cache: the cache stores whatever the
 * function returns, so one transient database error pinned the JSON prices and
 * stock (the seed says stock 2-201, a production database says 0) into the
 * shared data cache for CATALOG_REVALIDATE_SECONDS after the database was back.
 * Here the cached function throws on a database error - unstable_cache stores
 * nothing when its function throws - and the fallback runs OUTSIDE the cache,
 * for this one request only.
 *
 * What this does NOT do: a page that was rendered from the fallback is still stored
 * as ISR output and lives until its own revalidate window (60 s) ends. Next 15 does not
 * let a page opt out of that at runtime (unstable_noStore() there throws "Page changed
 * from static to dynamic at runtime" and turns the page into a 500, which the outage
 * proof in scripts/qa-storefront.ts caught), so the bound after an outage is the
 * revalidate window of the pages rendered during it, not "immediately".
 */
async function catalogRead<T>(
  key: string[],
  query: (db: PrismaClient) => Promise<T>,
  fallback: () => T | Promise<T>,
): Promise<T> {
  if (!isDatabaseConfigured()) return fallback();
  try {
    return await cachedCatalogRead(key, async () => {
      const { prisma } = await import("@/lib/prisma");
      return query(prisma);
    });
  } catch (err) {
    logger.error("[static-db] catalog query failed - serving src/data for this request only, nothing cached", err);
    return fallback();
  }
}

/** Prisma hands back a Date where the rest of the app expects the ISO string. */
function toGuide(row: Omit<Guide, "createdAt"> & { createdAt: Date }): Guide {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

/**
 * Guides as embedded in lists, error codes, parts and machines: premium guides
 * arrive already cut to the free preview. Only dbGuide()/dbGuideById() and
 * dbGuides({ full: true }) return every step, and their callers must apply
 * redactGuide() for the viewer. Secure by default: a new endpoint that simply
 * embeds "the guides of this thing" cannot leak the paid steps.
 */
function previewGuide(g: Guide): RedactedGuide {
  return redactGuide(g, false);
}

// ── Part index: one cached read behind every storefront part query ──────────

type PartIndexEntry = {
  part: PublicPart;
  /** Brands of the machines this part is registered to fit. */
  compatBrands: string[];
  /** "Bosch WAK28060" style strings, for searching by machine model. */
  models: string[];
  /** Error codes this part is linked to ("E18"), for searching by code. */
  codes: string[];
};

function staticPartIndex(): PartIndexEntry[] {
  const machineById = new Map(machines.map((m) => [m.id, m]));
  const codeById = new Map(errorCodes.map((e) => [e.id, e]));
  return [...parts]
    .sort((a, b) => a.sku.localeCompare(b.sku))
    .map((p) => {
      const ms = partMachine.filter((r) => r.partId === p.id).map((r) => machineById.get(r.machineId)).filter((m): m is Machine => !!m);
      const cs = errorCodeParts.filter((r) => r.partId === p.id).map((r) => codeById.get(r.errorCodeId)).filter((c): c is ErrorCode => !!c);
      return {
        part: toPublicPart(p),
        compatBrands: [...new Set(ms.map((m) => m.brand))],
        models: ms.map((m) => `${m.brand} ${m.model}`),
        codes: [...new Set(cs.map((c) => c.code))],
      };
    });
}

/**
 * Every part with the facts needed to search it and to judge fit, cached under
 * CATALOG_TAG. The query SELECTs only public columns - costEur and supplier are
 * never even read here, so no later mistake can leak them from this index.
 */
async function loadPartIndex(): Promise<PartIndexEntry[]> {
  return catalogRead(
      ["part-index"],
      async (db) => {
        const rows = await db.part.findMany({
          orderBy: { sku: "asc" },
          select: {
            id: true, sku: true, name: true, description: true, brand: true, category: true,
            priceEur: true, stock: true, imageUrl: true, isOriginal: true,
            machines: { select: { machine: { select: { brand: true, model: true } } } },
            errorCodes: { select: { errorCode: { select: { code: true } } } },
          },
        });
        return rows.map((r) => ({
          part: toPublicPart(r),
          compatBrands: [...new Set(r.machines.map((m) => m.machine.brand))],
          models: r.machines.map((m) => `${m.machine.brand} ${m.machine.model}`),
          codes: [...new Set(r.errorCodes.map((c) => c.errorCode.code))],
        }));
      },
      staticPartIndex,
  );
}

// ── Search ───────────────────────────────────────────────────────────────

function fold(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/**
 * Words people type that the catalogue spells differently. Deliberately tiny and
 * deterministic: a synonym table, not a thesaurus. Each value is an alternative
 * that is tried in addition to the typed word.
 */
const SEARCH_SYNONYMS: Record<string, string[]> = {
  rubber: ["pakking"],
  manchet: ["pakking"],
  deurrubber: ["pakking", "deurpakking"],
  afvoerpomp: ["pomp"],
  laugpomp: ["pomp"],
  lagers: ["lager"],
  carbon: ["koolborstel"],
  koolborstels: ["koolborstel"],
  verwarming: ["heating", "heater", "verwarmingselement"],
  thermostaat: ["ntc", "temperatuursensor"],
  moederbord: ["board", "module", "print"],
  printplaat: ["board", "module", "print"],
};

/** "pompen" -> "pomp", "filters" -> "filter": trailing -en / -s, never below 4 letters. */
export function stemToken(token: string): string {
  if (token.length > 5 && token.endsWith("en")) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}

/**
 * Words that carry no information about WHICH part someone wants: Dutch filler
 * ("een", "voor", "mijn") and shop-generic words ("wasmachine", "kapot"). With
 * every token ANDed, "afvoerpomp voor mijn Bosch wasmachine" found nothing
 * because "wasmachine" is in the description of only 15 of 96 parts, and
 * "een pomp" found nothing at all.
 */
const SEARCH_STOP_WORDS: ReadonlySet<string> = new Set([
  "een", "de", "het", "en", "of", "voor", "van", "met", "mijn", "m'n", "op", "in", "aan", "bij", "om", "te", "is", "er",
  "ik", "heb", "hebben", "nodig", "zoek", "zoeken", "naar", "nieuwe", "nieuw", "goedkope", "goedkoop",
  "wasmachine", "wasmachines", "wasmachiene", "machine", "kapot", "defect", "stuk", "onderdeel", "onderdelen", "reparatie",
]);

/**
 * Lower-cased, accent-folded words of a query, without filler.
 * "Bosch afvoer-pomp" -> bosch, afvoer, pomp. "een pomp voor mijn Bosch" -> pomp, bosch.
 * One-letter tokens are dropped (they match nearly every part: "e" returned 96).
 * A query made only of filler keeps its two-plus-letter words, so it still
 * searches for something instead of silently showing everything.
 */
export function searchTokens(q: string): string[] {
  const all = fold(q).split(/[^a-z0-9]+/).filter((t) => t.length > 1 || /^[0-9]$/.test(t));
  const meaningful = all.filter((t) => !SEARCH_STOP_WORDS.has(t));
  return (meaningful.length > 0 ? meaningful : all).slice(0, 8);
}

function tokenVariants(token: string): string[] {
  const stem = stemToken(token);
  return [...new Set([token, stem, ...(SEARCH_SYNONYMS[token] ?? []), ...(SEARCH_SYNONYMS[stem] ?? [])])];
}

function entryFields(e: PartIndexEntry) {
  const cats = categoryGroup(e.part.category);
  return {
    sku: fold(e.part.sku),
    name: fold(e.part.name),
    brand: fold(e.part.brand),
    category: fold([...cats, ...cats.map(categoryLabel), ...cats.map(categoryPlural)].join(" ")),
    description: fold(e.part.description ?? ""),
    models: fold(e.models.join(" ")),
    codes: fold(e.codes.join(" ")),
  };
}

/**
 * Score of a part for a tokenised query, or 0 when any token matches nothing.
 * Tokens are ANDed ("Bosch pomp" needs both), each over name, SKU, brand,
 * category, description, the models the part fits and the error codes it is
 * linked to. The old search put the whole query through one `contains`, so
 * "Bosch pomp", "afvoer pomp" and "pompen" all found nothing.
 */
function scoreEntry(e: PartIndexEntry, tokens: string[]): number {
  return scoreEntryDetailed(e, tokens, true).total;
}

/**
 * Per-token scoring. With `requireAll` the result is 0 as soon as one token
 * matches nothing (AND); without it, `matched` counts the tokens that hit and
 * `total` sums their scores, which the "nearly everything matched" fallback uses.
 */
function scoreEntryDetailed(e: PartIndexEntry, tokens: string[], requireAll: boolean): { total: number; matched: number } {
  const f = entryFields(e);
  let total = 0;
  let matched = 0;
  for (const token of tokens) {
    const variants = tokenVariants(token);
    let best = 0;
    for (const v of variants) {
      if (f.sku === v) best = Math.max(best, 100);
      else if (f.sku.includes(v)) best = Math.max(best, 60);
      if (f.name.includes(v)) best = Math.max(best, 50);
      if (f.brand.includes(v)) best = Math.max(best, 40);
      if (f.category.includes(v)) best = Math.max(best, 30);
      if (f.codes.split(" ").some((c) => c === v)) best = Math.max(best, 30);
      if (f.description.includes(v)) best = Math.max(best, 15);
      if (f.models.includes(v)) best = Math.max(best, 10);
    }
    if (best === 0) {
      if (requireAll) return { total: 0, matched };
      continue;
    }
    matched++;
    total += best;
  }
  return { total, matched };
}

export type PartSort = "aanbevolen" | "prijs-op" | "prijs-af";

export type PartQuery = {
  q?: string;
  /** A sidebar category code; its folded siblings (HEATER under HEATING) are included. */
  category?: string;
  brand?: string;
  sort?: PartSort;
};

function filterIndex(
  index: PartIndexEntry[],
  query: PartQuery,
  opts?: { relax?: boolean },
): { hits: PartIndexEntry[]; relaxed: boolean } {
  const tokens = query.q ? searchTokens(query.q) : [];
  // Text was typed but nothing searchable is left in it ("e", "-"): no hits, rather
  // than silently listing the whole catalogue as if the query had matched.
  if (query.q && query.q.trim() && tokens.length === 0) return { hits: [], relaxed: false };
  const cats = query.category ? categoryGroup(query.category) : null;
  const scored: Array<{ e: PartIndexEntry; score: number }> = [];
  const candidates = index.filter(
    (e) => !(cats && !cats.includes(e.part.category)) && !(query.brand && e.part.brand !== query.brand),
  );
  for (const e of candidates) {
    const score = tokens.length ? scoreEntry(e, tokens) : 1;
    if (score > 0) scored.push({ e, score });
  }
  // Nothing matches ALL words: offer the parts that match all but one, ranked,
  // rather than "Geen onderdelen gevonden" for a query like "Bosch pomp slang".
  // Only for 2+ words (with one word there is nothing to drop), and the caller
  // is told, so the page can say the result is partial.
  let relaxed = false;
  if (scored.length === 0 && opts?.relax && tokens.length >= 2) {
    for (const e of candidates) {
      const d = scoreEntryDetailed(e, tokens, false);
      if (d.matched >= tokens.length - 1 && d.total > 0) scored.push({ e, score: d.total });
    }
    relaxed = scored.length > 0;
  }
  const sort = query.sort ?? "aanbevolen";
  scored.sort((a, b) => {
    if (sort === "prijs-op") return a.e.part.priceEur - b.e.part.priceEur || a.e.part.sku.localeCompare(b.e.part.sku);
    if (sort === "prijs-af") return b.e.part.priceEur - a.e.part.priceEur || a.e.part.sku.localeCompare(b.e.part.sku);
    // Relevance first when searching; in-stock before sold-out; then a stable order.
    const inStock = Number(b.e.part.stock > 0) - Number(a.e.part.stock > 0);
    return b.score - a.score || inStock || a.e.part.sku.localeCompare(b.e.part.sku);
  });
  return { hits: scored.map((s) => s.e), relaxed };
}

export type PartListing = {
  parts: PublicPart[];
  total: number;
  /** True when no part matched every word and these match all but one. */
  relaxed?: boolean;
};

/**
 * The storefront listing: filter, search and sort over ALL parts, then take the
 * first `limit`. `total` is the number of matches, so "n van total" is always
 * true; the old page took 60 and printed "60 onderdelen gevonden" over 96.
 */
export async function searchPublicParts(query: PartQuery, limit = 24): Promise<PartListing> {
  const index = await loadPartIndex();
  const { hits, relaxed } = filterIndex(index, query, { relax: true });
  return { parts: hits.slice(0, Math.max(0, limit)).map((e) => e.part), total: hits.length, relaxed };
}

/**
 * For an empty result: which single words of the query DO match something.
 * "bosch pompje" finds nothing, but "bosch" finds 20 - say so, with links.
 */
export async function partSearchHints(q: string): Promise<Array<{ word: string; count: number }>> {
  const tokens = searchTokens(q);
  if (tokens.length < 2) return [];
  const index = await loadPartIndex();
  return tokens
    .map((word) => ({ word, count: index.filter((e) => scoreEntry(e, [word]) > 0).length }))
    .filter((h) => h.count > 0)
    .sort((a, b) => b.count - a.count);
}

export type PartCategoryFacet = { value: string; label: string; count: number };

/**
 * Sidebar categories generated from what is really in the catalogue, so a
 * category with parts always has a link (33 parts in 8 categories had none).
 * Codes folded into another entry (HEATER into HEATING) are counted there.
 */
export async function publicPartCategories(): Promise<PartCategoryFacet[]> {
  const index = await loadPartIndex();
  const counts = new Map<string, number>();
  for (const e of index) {
    const c = e.part.category;
    const owner = FOLDED_CATEGORIES.has(c)
      ? Object.entries(PART_CATEGORY_INFO).find(([, i]) => i.alsoIncludes?.includes(c))?.[0] ?? c
      : c;
    counts.set(owner, (counts.get(owner) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, label: categoryPlural(value), count }))
    .sort((a, b) => a.label.localeCompare(b.label, "nl"));
}

/** Brands with part counts, for the sidebar. */
export async function publicPartBrandFacets(): Promise<Array<{ brand: string; count: number }>> {
  const index = await loadPartIndex();
  const counts = new Map<string, number>();
  for (const e of index) counts.set(e.part.brand, (counts.get(e.part.brand) ?? 0) + 1);
  return [...counts.entries()].map(([brand, count]) => ({ brand, count })).sort((a, b) => a.brand.localeCompare(b.brand, "nl"));
}

// ── Parts ────────────────────────────────────────────────────────

/**
 * Public parts for diagnose, APIs and strips. Returns the PublicPart
 * projection: this used to hand back the raw row, costEur and supplier
 * included, to /api/parts, /api/diagnose and every page that fed a client
 * component. Code that needs the purchase price (checkout, admin) reads the
 * live row through dbPart()/dbPartById() below or Prisma.
 */
export async function dbParts(opts?: Parameters<typeof staticParts>[0]): Promise<PublicPart[]> {
  const index = await loadPartIndex();
  const w = opts?.where;
  let { hits } = filterIndex(index, { q: w?.q, brand: w?.brand, category: w?.category });
  if (w?.categories?.length) hits = hits.filter((e) => w.categories!.includes(e.part.category));
  if (w?.minStock !== undefined) hits = hits.filter((e) => e.part.stock > w.minStock!);
  if (w?.skus?.length) hits = hits.filter((e) => w.skus!.includes(e.part.sku));
  let out = hits.map((e) => e.part);
  // filterIndex already ordered by relevance / stock / sku; an explicit orderBy overrides it.
  switch (opts?.orderBy) {
    case "stock-desc": out = [...out].sort((a, b) => b.stock - a.stock || a.sku.localeCompare(b.sku)); break;
    case "price-asc": out = [...out].sort((a, b) => a.priceEur - b.priceEur || a.sku.localeCompare(b.sku)); break;
    case "stock-then-price": out = [...out].sort((a, b) => b.stock - a.stock || a.priceEur - b.priceEur || a.sku.localeCompare(b.sku)); break;
    default: if (!w?.q) out = [...out].sort((a, b) => a.sku.localeCompare(b.sku));
  }
  return opts?.take ? out.slice(0, opts.take) : out;
}

/**
 * INTERNAL: the live, uncached row including costEur and supplier. Checkout
 * prices from it, so it must never be cached and its result must never reach a
 * response or a client component. Use dbPublicPart() for anything customer-facing.
 */
export async function dbPart(sku: string): Promise<Part | null> {
  return fromDb((db) => db.part.findUnique({ where: { sku } }), () => staticPart(sku));
}

/** INTERNAL: see dbPart(). */
export async function dbPartById(id: string): Promise<Part | null> {
  return fromDb((db) => db.part.findUnique({ where: { id } }), () => staticPartById(id));
}

/** The customer-facing view of one part (cached, no cost/supplier). */
export async function dbPublicPart(sku: string): Promise<PublicPart | null> {
  const index = await loadPartIndex();
  return index.find((e) => e.part.sku === sku)?.part ?? null;
}

export async function dbPartBrands(): Promise<string[]> {
  return catalogRead(["part-brands"], async (db) => {
    const rows = await db.part.findMany({ distinct: ["brand"], select: { brand: true }, orderBy: { brand: "asc" } });
    return rows.map((r) => r.brand);
  }, staticPartBrands);
}

export type PublicPartFull = PublicPart & {
  machines: { machine: Machine }[];
  guides: { guide: RedactedGuide }[];
  errorCodes: { errorCode: ErrorCode & { machine: Machine } }[];
};

/**
 * A part page is a public surface for the error codes it lists, so it obeys the
 * same brand rule as the code pages (partFitsBrand): "Inverter motor LG" must
 * not list "Miele F53" any more than the Miele F53 page may list the motor.
 */
function codesFittingPart<T extends { errorCode: { machine: { brand: string } } }>(
  part: Pick<PublicPart, "brand">,
  machineBrands: string[],
  links: T[],
): T[] {
  const compatBrands = [...new Set(machineBrands)];
  return links.filter((l) => partFitsBrand({ part, compatBrands }, l.errorCode.machine.brand));
}

export async function dbPartFull(sku: string): Promise<PublicPartFull | null> {
  // Unknown SKUs never reach the cache: the key is user-controlled, so caching
  // misses would let anyone add entries to the data cache by requesting junk.
  const index = await loadPartIndex();
  if (!index.some((e) => e.part.sku === sku)) return null;
  return catalogRead<PublicPartFull | null>(
    ["part-full", sku],
    async (db) => {
      const row = await db.part.findUnique({
        where: { sku },
        select: {
          id: true, sku: true, name: true, description: true, brand: true, category: true,
          priceEur: true, stock: true, imageUrl: true, isOriginal: true,
          machines: { select: { machine: true }, orderBy: { machine: { model: "asc" } } },
          guides: { select: { guide: true }, orderBy: { guide: { title: "asc" } } },
          errorCodes: { select: { errorCode: { include: { machine: true } } }, orderBy: { errorCode: { code: "asc" } } },
        },
      });
      if (!row) return null;
      return {
        ...toPublicPart(row),
        machines: row.machines.map(({ machine }) => ({ machine })),
        guides: row.guides.map(({ guide }) => ({ guide: previewGuide(toGuide(guide)) })),
        errorCodes: codesFittingPart(row, row.machines.map((m) => m.machine.brand), row.errorCodes.map(({ errorCode }) => ({ errorCode }))),
      };
    },
    () => {
      const f = staticPartFull(sku);
      return f
        ? {
            ...toPublicPart(f),
            machines: f.machines,
            guides: f.guides.map(({ guide }) => ({ guide: previewGuide(guide) })),
            errorCodes: codesFittingPart(f, f.machines.map((m) => m.machine.brand), f.errorCodes),
          }
        : null;
    },
  );
}

export async function dbRelatedParts(category: string, excludeId: string, take = 4): Promise<PublicPart[]> {
  const index = await loadPartIndex();
  return index
    .map((e) => e.part)
    .filter((p) => p.category === category && p.id !== excludeId && p.stock > 0)
    .slice(0, take);
}

// ── Machines ─────────────────────────────────────────────────────

/**
 * Brand and model arrive from the URL. They are checked against the cached full
 * listings before they are used in a cache key, so the number of entries the
 * data cache can hold is bounded by the catalogue, not by what a visitor types.
 */
async function isKnownMachineBrand(brand: string): Promise<boolean> {
  return (await dbMachineBrands()).includes(brand);
}

export async function dbMachines(opts?: { brand?: string }): Promise<Machine[]> {
  if (opts?.brand && !(await isKnownMachineBrand(opts.brand))) return [];
  return catalogRead(
    ["machines", opts?.brand ?? ""],
    (db) =>
      db.washingMachine.findMany({
        where: opts?.brand ? { brand: opts.brand } : {},
        orderBy: [{ brand: "asc" }, { model: "asc" }],
      }),
    () => staticMachines(opts),
  );
}

export async function dbMachine(brand: string, model: string): Promise<Machine | null> {
  // Served from the one cached listing: no per-URL cache entry, no extra query.
  return (await dbMachines()).find((m) => m.brand === brand && m.model === model) ?? null;
}

export async function dbMachineBrands(): Promise<string[]> {
  return catalogRead(
    ["machine-brands"],
    async (db) => {
      const rows = await db.washingMachine.findMany({ distinct: ["brand"], select: { brand: true }, orderBy: { brand: "asc" } });
      return rows.map((r) => r.brand);
    },
    staticMachineBrands,
  );
}

export async function dbMachinesByBrand(brand: string): Promise<MachineWithCounts[]> {
  if (!(await isKnownMachineBrand(brand))) return [];
  return catalogRead(
    ["machines-by-brand", brand],
    (db) =>
      db.washingMachine.findMany({
        where: { brand },
        include: { _count: { select: { errorCodes: true } } },
        orderBy: { model: "asc" },
      }),
    () => staticMachinesByBrand(brand),
  );
}

export type PublicMachineFull = Machine & {
  errorCodes: ErrorCode[];
  repairGuides: RedactedGuide[];
  parts: { part: PublicPart }[];
};

export async function dbMachineFull(brand: string, model: string): Promise<PublicMachineFull | null> {
  if (!(await dbMachine(brand, model))) return null;
  const index = await loadPartIndex();
  const publicById = new Map(index.map((e) => [e.part.id, e.part]));
  return catalogRead<PublicMachineFull | null>(
    ["machine-full", brand, model],
    async (db) => {
      const row = await db.washingMachine.findFirst({
        where: { brand, model },
        include: {
          errorCodes: { orderBy: { code: "asc" } },
          repairGuides: { orderBy: { title: "asc" } },
          parts: { select: { partId: true }, orderBy: { part: { sku: "asc" } } },
        },
      });
      if (!row) return null;
      const { parts: links, ...rest } = row;
      return {
        ...rest,
        repairGuides: row.repairGuides.map((g) => previewGuide(toGuide(g))),
        parts: links.map((l) => publicById.get(l.partId)).filter((p): p is PublicPart => !!p).map((part) => ({ part })),
      };
    },
    () => {
      const f = staticMachineFull(brand, model);
      return f
        ? {
            ...f,
            repairGuides: f.repairGuides.map(previewGuide),
            parts: f.parts.map(({ part }) => ({ part: toPublicPart(part) })),
          }
        : null;
    },
  );
}

// ── Error codes ──────────────────────────────────────────────────

export type PublicErrorCodeFull = ErrorCodeWithMachine & {
  parts: { part: PublicPart }[];
  guides: { guide: RedactedGuide }[];
};

/**
 * Does this part belong on a code of this brand? A brand-specific part counts
 * only if it is registered to fit a machine of that brand (or is itself that
 * brand's). Two of the 72 code-part links broke this - Miele F53 pointed at an
 * "Inverter motor LG Direct Drive", Samsung dE at a "Deurslot AEG / Electrolux"
 * - and were shown as "Aanbevolen onderdelen" to people who then returned the
 * wrong part. Universal parts fit everything. src/data cannot be edited from
 * here, so the link is dropped at read time in BOTH directions (code page and
 * part page, see codesFittingPart); scripts/qa-storefront.ts fails if any link
 * that is still shown breaks the rule.
 */
export function partFitsBrand(e: { part: Pick<PublicPart, "brand">; compatBrands: string[] }, brand: string): boolean {
  return e.part.brand === "Universeel" || e.part.brand === brand || e.compatBrands.includes(brand);
}

async function toPublicErrorCodeFull(
  ec: ErrorCodeWithMachine,
  partIds: string[],
  guideRows: Guide[],
): Promise<PublicErrorCodeFull> {
  const index = await loadPartIndex();
  const byId = new Map(index.map((e) => [e.part.id, e]));
  const linked = partIds
    .map((id) => byId.get(id))
    .filter((e): e is PartIndexEntry => !!e && partFitsBrand(e, ec.machine.brand))
    .map((e) => ({ part: e.part }));
  return { ...ec, parts: linked, guides: guideRows.map((guide) => ({ guide: previewGuide(guide) })) };
}

export async function dbErrorCodes(opts?: Parameters<typeof staticErrorCodes>[0]): Promise<ErrorCodeWithMachine[]> {
  const w = opts?.where;
  const query = async (db: PrismaClient) => {
    const and: Prisma.ErrorCodeWhereInput[] = [];
    if (w?.code) and.push({ code: { contains: w.code, mode: "insensitive" } });
    if (w?.brand) and.push({ machine: { brand: w.brand } });
    if (w?.q) {
      and.push({
        OR: [
          { code: { contains: w.q, mode: "insensitive" } },
          { title: { contains: w.q, mode: "insensitive" } },
          { description: { contains: w.q, mode: "insensitive" } },
        ],
      });
    }

    const rows = await db.errorCode.findMany({ where: { AND: and }, include: { machine: true } });
    // Severity is a plain string column, so HIGH → LOW cannot come out of SQL.
    rows.sort((a, b) => (SEVERITY_ORDER[b.severity] ?? 0) - (SEVERITY_ORDER[a.severity] ?? 0) || a.code.localeCompare(b.code));
    return opts?.take ? rows.slice(0, opts.take) : rows;
  };
  // Free-text queries are user-chosen strings: caching them would let anyone
  // fill the cache with junk keys, so only the fixed listings are cached.
  if (w?.q || w?.code) return fromDb(query, () => staticErrorCodes(opts));
  // A brand from the URL that the catalogue does not have: empty, uncached.
  if (w?.brand && !(await isKnownMachineBrand(w.brand))) return [];
  return catalogRead(["error-codes", w?.brand ?? "", String(opts?.take ?? 0)], query, () => staticErrorCodes(opts));
}

export async function dbErrorCode(brand: string, code: string): Promise<PublicErrorCodeFull | null> {
  // Only (brand, code) pairs the catalogue lists get a cache entry.
  const listed = await dbErrorCodes({});
  if (!listed.some((e) => e.code === code && e.machine.brand === brand)) return null;
  return catalogRead<PublicErrorCodeFull | null>(
    ["error-code", brand, code],
    async (db) => {
      const row = await db.errorCode.findFirst({
        where: { code, machine: { brand } },
        include: {
          machine: true,
          parts: { select: { partId: true }, orderBy: { part: { sku: "asc" } } },
          guides: { include: { guide: true }, orderBy: { guide: { title: "asc" } } },
        },
      });
      if (!row) return null;
      const { parts: pl, guides: gl, ...ec } = row;
      return toPublicErrorCodeFull(ec, pl.map((p) => p.partId), gl.map((g) => toGuide(g.guide)));
    },
    () => {
      const f = staticErrorCode(brand, code);
      return f ? toPublicErrorCodeFull(f, f.parts.map((p) => p.part.id), f.guides.map((g) => g.guide)) : null;
    },
  );
}

export async function dbErrorCodeByCode(code: string, brand?: string): Promise<PublicErrorCodeFull | null> {
  return fromDb(async (db) => {
    const row = await db.errorCode.findFirst({
      where: { code: { contains: code, mode: "insensitive" }, ...(brand ? { machine: { brand } } : {}) },
      include: {
        machine: true,
        parts: { select: { partId: true }, orderBy: { part: { sku: "asc" } } },
        guides: { include: { guide: true }, orderBy: { guide: { title: "asc" } } },
      },
      orderBy: { code: "asc" },
    });
    if (!row) return null;
    const { parts: pl, guides: gl, ...ec } = row;
    return toPublicErrorCodeFull(ec, pl.map((p) => p.partId), gl.map((g) => toGuide(g.guide)));
  }, () => {
    const f = staticErrorCodeByCode(code, brand);
    return f ? toPublicErrorCodeFull(f, f.parts.map((p) => p.part.id), f.guides.map((g) => g.guide)) : null;
  });
}

/**
 * Which part categories a cause text points at, most likely first. Keyword
 * matching on the Dutch cause strings ("Defecte afvoerpomp", "Verstopt
 * filter"), deliberately plain: it only decides which categories to LOOK in.
 *
 * Dutch compounds put the telling word at the END ("afvoerpomp"), so most
 * stems are matched anywhere in the word. The ones that are also a piece of
 * an unrelated word are anchored to a word start or guarded, each for a real
 * case in the catalogue: "lek" is inside "elektronica", "slot" inside
 * "kortgesloten"/"gesloten", "sensor" inside "druksensor" (a pressure sensor
 * is not a temperature sensor, and the shop has no pressure-sensor category, so
 * it gets no suggestion rather than a wrong one), "as" inside "was".
 */
const CAUSE_CATEGORY_RULES: Array<[RegExp, string[]]> = [
  [/pomp/i, ["PUMP"]],
  [/filter|pluis|verstop/i, ["FILTER"]],
  [/slang|afvoerslang|inlaatslang|knik/i, ["HOSE"]],
  [/deurslot|vergrendel|sluitplaat|deurhaak|(?<![a-z])slot/i, ["LOCK"]],
  [/pakking|manchet|rubber|dichting|(?<![a-z])lek/i, ["DOOR", "SEAL"]],
  [/ntc|temperatuur|thermo|voeler|(?<![a-z])sensor/i, ["NTC"]],
  [/verwarm|element|kalk|boiler/i, ["HEATING", "HEATER"]],
  [/lager|trommel(?!lamp|verlicht)|(?<![a-z])as(?![a-z])/i, ["BEARING"]],
  [/koolborstel|motor|tacho|aandrijving/i, ["MOTOR"]],
  [/snaar|riem/i, ["BELT"]],
  [/ventiel|inlaat|aquastop|waterdruk|toevoer|kraan/i, ["VALVE"]],
  [/demper|trilling|onbalans|schok/i, ["DAMPER"]],
  [/module|print|elektronica|besturing|software|bord/i, ["BOARD", "ELECTRONICS"]],
  [/paneel|display|(?<![a-z])knop|bediening(?!selektro)/i, ["PANEL", "KNOB"]],
];

export function categoriesForCauses(likelyCauses: string): string[] {
  const out: string[] = [];
  for (const cause of likelyCauses.split("|").map((c) => c.trim()).filter(Boolean)) {
    for (const [re, cats] of CAUSE_CATEGORY_RULES) {
      if (re.test(cause)) for (const c of cats) if (!out.includes(c)) out.push(c);
    }
  }
  return out;
}

/**
 * Parts that MIGHT be needed for an error code that has no linked part: parts
 * from the categories its causes point at, that fit the code's brand (or are
 * universal). 282 of 329 code pages had no part at all, so a visitor arriving
 * from Google had nowhere to go. These are suggestions, not a diagnosis - the
 * page labels them "mogelijk nodig". In-stock and brand-specific parts first.
 */
export async function dbSuggestedPartsForCode(
  ec: { likelyCauses: string; machine: { brand: string } },
  take = 4,
): Promise<PublicPart[]> {
  const cats = categoriesForCauses(ec.likelyCauses);
  if (cats.length === 0) return [];
  const index = await loadPartIndex();
  const fits = index.filter((e) => partFitsBrand(e, ec.machine.brand));
  const picked: PublicPart[] = [];
  // One part per category in cause order first, so the first cause is not drowned out.
  for (let round = 0; round < take && picked.length < take; round++) {
    for (const cat of cats) {
      const pool = fits
        .filter((e) => e.part.category === cat && !picked.some((p) => p.id === e.part.id))
        .sort((a, b) =>
          Number(b.part.stock > 0) - Number(a.part.stock > 0) ||
          Number(b.part.brand === ec.machine.brand) - Number(a.part.brand === ec.machine.brand) ||
          a.part.sku.localeCompare(b.part.sku),
        );
      if (pool[0]) picked.push(pool[0].part);
      if (picked.length >= take) break;
    }
    if (round >= 1) break;
  }
  return picked.slice(0, take);
}

// ── Guides ───────────────────────────────────────────────────────

/**
 * Guides for lists and embedding. Premium guides come back cut to the free
 * preview unless `full` is set; a caller that sets `full` MUST pass each guide
 * through redactGuide() for the viewer before it leaves the server.
 */
export async function dbGuides(
  opts?: Parameters<typeof staticGuides>[0] & { full?: boolean },
): Promise<Guide[]> {
  const w = opts?.where;
  const query = async (db: PrismaClient) => {
    const and: Prisma.RepairGuideWhereInput[] = [];
    if (w?.difficulty) and.push({ difficulty: w.difficulty });
    if (w?.isPremium !== undefined) and.push({ isPremium: w.isPremium });
    if (w?.q) {
      and.push({
        OR: [
          { title: { contains: w.q, mode: "insensitive" } },
          { summary: { contains: w.q, mode: "insensitive" } },
        ],
      });
    }
    if (w?.slugs?.length) and.push({ slug: { in: w.slugs } });

    let orderBy: Prisma.RepairGuideOrderByWithRelationInput[];
    switch (opts?.orderBy) {
      case "views-desc":
        orderBy = [{ views: "desc" }];
        break;
      case "created-desc":
        orderBy = [{ createdAt: "desc" }];
        break;
      default:
        orderBy = [{ views: "desc" }, { createdAt: "desc" }];
    }
    const rows = await db.repairGuide.findMany({ where: { AND: and }, orderBy, take: opts?.take });
    return rows.map(toGuide);
  };
  let rows: Guide[];
  if (w?.q) {
    // Free text: never a cache key.
    rows = await fromDb(query, () => staticGuides(opts));
  } else {
    // Difficulty and slugs can come from the URL; narrow them to values the
    // catalogue has before they become part of a cache key.
    const known = w?.difficulty || w?.slugs?.length ? await dbGuides({ full: true }) : [];
    if (w?.difficulty && !known.some((g) => g.difficulty === w.difficulty)) return [];
    const slugs = w?.slugs?.length ? w.slugs.filter((s) => known.some((g) => g.slug === s)) : undefined;
    if (w?.slugs?.length && !slugs?.length) return [];
    const narrowed = slugs ? { ...opts, where: { ...w, slugs } } : opts;
    rows = await catalogRead(
      ["guides", w?.difficulty ?? "", String(w?.isPremium ?? ""), (slugs ?? []).join(","), opts?.orderBy ?? "", String(opts?.take ?? 0)],
      query,
      () => staticGuides(narrowed),
    );
  }
  return opts?.full ? rows : rows.map(previewGuide);
}

type GuideWithParts = Guide & { parts: { part: PublicPart }[] };

/** One guide with EVERY step. The caller decides who sees them (redactGuide). */
export async function dbGuide(slug: string): Promise<GuideWithParts | null> {
  if (!(await dbGuides({ full: true })).some((g) => g.slug === slug)) return null;
  const index = await loadPartIndex();
  const publicById = new Map(index.map((e) => [e.part.id, e.part]));
  return catalogRead<GuideWithParts | null>(
    ["guide", slug],
    async (db) => {
      const row = await db.repairGuide.findUnique({
        where: { slug },
        include: { parts: { select: { partId: true }, orderBy: { part: { sku: "asc" } } } },
      });
      if (!row) return null;
      const { parts: links, ...g } = row;
      return {
        ...toGuide(g),
        parts: links.map((l) => publicById.get(l.partId)).filter((p): p is PublicPart => !!p).map((part) => ({ part })),
      };
    },
    () => {
      const f = staticGuide(slug);
      return f ? { ...f, parts: f.parts.map(({ part }) => ({ part: toPublicPart(part) })) } : null;
    },
  );
}

/** /api/guides/[id] accepts either a slug or an id, so it needs both lookups. */
export async function dbGuideById(id: string): Promise<GuideWithParts | null> {
  if (!(await dbGuides({ full: true })).some((g) => g.id === id)) return null;
  const index = await loadPartIndex();
  const publicById = new Map(index.map((e) => [e.part.id, e.part]));
  return catalogRead<GuideWithParts | null>(
    ["guide-by-id", id],
    async (db) => {
      const row = await db.repairGuide.findUnique({
        where: { id },
        include: { parts: { select: { partId: true }, orderBy: { part: { sku: "asc" } } } },
      });
      if (!row) return null;
      const { parts: links, ...g } = row;
      return {
        ...toGuide(g),
        parts: links.map((l) => publicById.get(l.partId)).filter((p): p is PublicPart => !!p).map((part) => ({ part })),
      };
    },
    () => {
      const f = staticGuide(guides.find((g) => g.id === id)?.slug ?? "");
      return f ? { ...f, parts: f.parts.map(({ part }) => ({ part: toPublicPart(part) })) } : null;
    },
  );
}

// ── Stats ────────────────────────────────────────────────────────

export async function dbStats(): Promise<ReturnType<typeof staticStats>> {
  return catalogRead(
    ["stats"],
    async (db) => {
      const [partsCount, guidesCount, machinesCount, errorCodesCount] = await Promise.all([
        db.part.count(),
        db.repairGuide.count(),
        db.washingMachine.count(),
        db.errorCode.count(),
      ]);
      return { partsCount, guidesCount, machinesCount, errorCodesCount };
    },
    staticStats,
  );
}
