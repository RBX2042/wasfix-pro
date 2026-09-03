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

// ============ Database-first queries ============

/**
 * Once DATABASE_URL is configured, Postgres is the catalog: it is what /admin
 * writes to and what checkout charges from. A page served from the JSON then
 * advertises a price nobody is charged, stock nobody has ("Op voorraad — 42
 * stuks" while checkout answers "Onvoldoende voorraad (0 beschikbaar)"), and
 * 404s on a part the admin created ten seconds ago.
 *
 * So: every public surface should read through these db* functions. They fall
 * back to their static* sibling when there is no database or the query throws,
 * which is the only role src/data/*.json still has. A row the database does not
 * hold is NOT a fallback case — a part deleted in /admin has to stay gone.
 *
 * They are async where their static siblings are synchronous, so call sites
 * move over one by one; both families stay exported until that is finished.
 *
 * The JSON has a file order to fall back on, a table does not, so every query
 * here carries an explicit orderBy — without one Postgres is free to reshuffle
 * a listing between two renders of the same page.
 */
async function fromDb<T>(query: (db: PrismaClient) => Promise<T>, fallback: () => T): Promise<T> {
  if (!isDatabaseConfigured()) return fallback();
  try {
    // Imported lazily on purpose: catalog-stats.ts drags this module into the
    // browser bundle (WasFixHome is a client component) and Prisma cannot go
    // there — a top-level import would break the client build.
    const { prisma } = await import("@/lib/prisma");
    return await query(prisma);
  } catch (err) {
    logger.error("[static-db] catalog query failed — falling back to src/data", err);
    return fallback();
  }
}

/** Prisma hands back a Date where the rest of the app expects the ISO string. */
function toGuide(row: Omit<Guide, "createdAt"> & { createdAt: Date }): Guide {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

function toErrorCodeFull(
  row: ErrorCode & {
    machine: Machine;
    parts: { part: Part }[];
    guides: { guide: Omit<Guide, "createdAt"> & { createdAt: Date } }[];
  },
): ErrorCodeFull {
  return {
    ...row,
    parts: row.parts.map(({ part }) => ({ part })),
    guides: row.guides.map(({ guide }) => ({ guide: toGuide(guide) })),
  };
}

// ── Parts ────────────────────────────────────────────────────────

export async function dbParts(opts?: Parameters<typeof staticParts>[0]): Promise<Part[]> {
  return fromDb(async (db) => {
    const w = opts?.where;
    const and: Prisma.PartWhereInput[] = [];
    if (w?.minStock !== undefined) and.push({ stock: { gt: w.minStock } });
    if (w?.category) and.push({ category: w.category });
    if (w?.categories?.length) and.push({ category: { in: w.categories } });
    if (w?.brand) and.push({ brand: w.brand });
    if (w?.q) {
      and.push({
        OR: [
          { name: { contains: w.q, mode: "insensitive" } },
          { description: { contains: w.q, mode: "insensitive" } },
          { sku: { contains: w.q, mode: "insensitive" } },
        ],
      });
    }
    if (w?.skus?.length) and.push({ sku: { in: w.skus } });

    let orderBy: Prisma.PartOrderByWithRelationInput[];
    switch (opts?.orderBy) {
      case "stock-desc":
        orderBy = [{ stock: "desc" }];
        break;
      case "price-asc":
        orderBy = [{ priceEur: "asc" }];
        break;
      case "stock-then-price":
        orderBy = [{ stock: "desc" }, { priceEur: "asc" }];
        break;
      default:
        orderBy = [{ sku: "asc" }];
    }
    return db.part.findMany({ where: { AND: and }, orderBy, take: opts?.take });
  }, () => staticParts(opts));
}

export async function dbPart(sku: string): Promise<Part | null> {
  return fromDb((db) => db.part.findUnique({ where: { sku } }), () => staticPart(sku));
}

export async function dbPartById(id: string): Promise<Part | null> {
  return fromDb((db) => db.part.findUnique({ where: { id } }), () => staticPartById(id));
}

export async function dbPartBrands(): Promise<string[]> {
  return fromDb(async (db) => {
    const rows = await db.part.findMany({ distinct: ["brand"], select: { brand: true }, orderBy: { brand: "asc" } });
    return rows.map((r) => r.brand);
  }, staticPartBrands);
}

export async function dbPartFull(sku: string): Promise<PartFull | null> {
  return fromDb(async (db) => {
    const row = await db.part.findUnique({
      where: { sku },
      include: {
        machines: { include: { machine: true }, orderBy: { machine: { model: "asc" } } },
        guides: { include: { guide: true }, orderBy: { guide: { title: "asc" } } },
        errorCodes: { include: { errorCode: { include: { machine: true } } }, orderBy: { errorCode: { code: "asc" } } },
      },
    });
    if (!row) return null;
    return {
      ...row,
      machines: row.machines.map(({ machine }) => ({ machine })),
      guides: row.guides.map(({ guide }) => ({ guide: toGuide(guide) })),
      errorCodes: row.errorCodes.map(({ errorCode }) => ({ errorCode })),
    };
  }, () => staticPartFull(sku));
}

export async function dbRelatedParts(category: string, excludeId: string, take = 4): Promise<Part[]> {
  return fromDb(
    (db) =>
      db.part.findMany({
        where: { category, id: { not: excludeId }, stock: { gt: 0 } },
        orderBy: { sku: "asc" },
        take,
      }),
    () => staticRelatedParts(category, excludeId, take),
  );
}

// ── Machines ─────────────────────────────────────────────────────

export async function dbMachines(opts?: { brand?: string }): Promise<Machine[]> {
  return fromDb(
    (db) =>
      db.washingMachine.findMany({
        where: opts?.brand ? { brand: opts.brand } : {},
        orderBy: [{ brand: "asc" }, { model: "asc" }],
      }),
    () => staticMachines(opts),
  );
}

export async function dbMachine(brand: string, model: string): Promise<Machine | null> {
  return fromDb((db) => db.washingMachine.findFirst({ where: { brand, model } }), () => staticMachine(brand, model));
}

export async function dbMachineBrands(): Promise<string[]> {
  return fromDb(async (db) => {
    const rows = await db.washingMachine.findMany({ distinct: ["brand"], select: { brand: true }, orderBy: { brand: "asc" } });
    return rows.map((r) => r.brand);
  }, staticMachineBrands);
}

export async function dbMachinesByBrand(brand: string): Promise<MachineWithCounts[]> {
  return fromDb(
    (db) =>
      db.washingMachine.findMany({
        where: { brand },
        include: { _count: { select: { errorCodes: true } } },
        orderBy: { model: "asc" },
      }),
    () => staticMachinesByBrand(brand),
  );
}

export async function dbMachineFull(brand: string, model: string): Promise<MachineFull | null> {
  return fromDb(async (db) => {
    const row = await db.washingMachine.findFirst({
      where: { brand, model },
      include: {
        errorCodes: { orderBy: { code: "asc" } },
        repairGuides: { orderBy: { title: "asc" } },
        parts: { include: { part: true }, orderBy: { part: { sku: "asc" } } },
      },
    });
    if (!row) return null;
    return {
      ...row,
      repairGuides: row.repairGuides.map(toGuide),
      parts: row.parts.map(({ part }) => ({ part })),
    };
  }, () => staticMachineFull(brand, model));
}

// ── Error codes ──────────────────────────────────────────────────

export async function dbErrorCodes(opts?: Parameters<typeof staticErrorCodes>[0]): Promise<ErrorCodeWithMachine[]> {
  return fromDb(async (db) => {
    const w = opts?.where;
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
  }, () => staticErrorCodes(opts));
}

export async function dbErrorCode(brand: string, code: string): Promise<ErrorCodeFull | null> {
  return fromDb(async (db) => {
    const row = await db.errorCode.findFirst({
      where: { code, machine: { brand } },
      include: {
        machine: true,
        parts: { include: { part: true }, orderBy: { part: { sku: "asc" } } },
        guides: { include: { guide: true }, orderBy: { guide: { title: "asc" } } },
      },
    });
    return row ? toErrorCodeFull(row) : null;
  }, () => staticErrorCode(brand, code));
}

export async function dbErrorCodeByCode(code: string, brand?: string): Promise<ErrorCodeFull | null> {
  return fromDb(async (db) => {
    const row = await db.errorCode.findFirst({
      where: { code: { contains: code, mode: "insensitive" }, ...(brand ? { machine: { brand } } : {}) },
      include: {
        machine: true,
        parts: { include: { part: true }, orderBy: { part: { sku: "asc" } } },
        guides: { include: { guide: true }, orderBy: { guide: { title: "asc" } } },
      },
      orderBy: { code: "asc" },
    });
    return row ? toErrorCodeFull(row) : null;
  }, () => staticErrorCodeByCode(code, brand));
}

// ── Guides ───────────────────────────────────────────────────────

export async function dbGuides(opts?: Parameters<typeof staticGuides>[0]): Promise<Guide[]> {
  return fromDb(async (db) => {
    const w = opts?.where;
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
  }, () => staticGuides(opts));
}

export async function dbGuide(slug: string): Promise<(Guide & { parts: { part: Part }[] }) | null> {
  return fromDb(async (db) => {
    const row = await db.repairGuide.findUnique({
      where: { slug },
      include: { parts: { include: { part: true }, orderBy: { part: { sku: "asc" } } } },
    });
    if (!row) return null;
    return { ...toGuide(row), parts: row.parts.map(({ part }) => ({ part })) };
  }, () => staticGuide(slug));
}

// ── Stats ────────────────────────────────────────────────────────

export async function dbStats(): Promise<ReturnType<typeof staticStats>> {
  return fromDb(async (db) => {
    const [partsCount, guidesCount, machinesCount, errorCodesCount] = await Promise.all([
      db.part.count(),
      db.repairGuide.count(),
      db.washingMachine.count(),
      db.errorCode.count(),
    ]);
    return { partsCount, guidesCount, machinesCount, errorCodesCount };
  }, staticStats);
}
