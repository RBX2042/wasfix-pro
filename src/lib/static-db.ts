/**
 * Static data fallback — used when DATABASE_URL is not configured.
 * Provides Prisma-shaped objects so pages can swap in without changing render code.
 */

import machinesRaw from "@/data/machines.json";
import partsRaw from "@/data/parts.json";
import errorCodesRaw from "@/data/error-codes.json";
import guidesRaw from "@/data/guides.json";
import partMachineRaw from "@/data/part-machine.json";
import errorCodePartsRaw from "@/data/errorcode-parts.json";
import errorCodeGuidesRaw from "@/data/errorcode-guides.json";
import guidePartsRaw from "@/data/guide-parts.json";

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
  createdAt: number; // SQLite stores epoch ms
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
  const severityOrder: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  result.sort((a, b) => (severityOrder[b.severity] ?? 0) - (severityOrder[a.severity] ?? 0) || a.code.localeCompare(b.code));

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
      result.sort((a, b) => b.createdAt - a.createdAt);
      break;
    default:
      result.sort((a, b) => b.views - a.views);
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
