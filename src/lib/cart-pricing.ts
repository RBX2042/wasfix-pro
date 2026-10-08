/**
 * Live prices and stock for a cart, and the comparison with what the customer
 * was shown. Used by /api/checkout (which refuses to charge a different amount
 * than the one on screen) and by /api/cart/validate (which refreshes the cart
 * when /checkout opens).
 *
 * The price of a line ALWAYS comes from the live Part row read here. The
 * client's number is only ever compared with it, never used.
 */
import { prisma } from "./prisma";
import { env, isDatabaseConfigured } from "./env";
import { dbPart, dbPartById } from "./static-db";
import { cents } from "./cart-totals";
import { MAX_QTY_PER_LINE } from "./cart-limits";
import type { ExpectedCart } from "./cart-schema";

/** A part as checkout needs it. Internal: carries costEur, never send it to a client. */
export type LivePart = {
  id: string;
  sku: string;
  name: string;
  brand: string;
  imageUrl: string | null;
  priceEur: number;
  stock: number;
  isOriginal: boolean;
  costEur: number | null;
  /**
   * 'QUOTE' = the cost comes from a supplier quote; anything else is an estimate (decision D8).
   * Checkout snapshots a cost on the order only when every line is a QUOTE.
   */
  costSource: string | null;
};

export type CartRef = { sku?: string; partId?: string; quantity: number };

/** Thrown when production has no usable database: checkout must answer 503, never fall back to the JSON catalogue. */
export class CatalogUnavailableError extends Error {
  constructor() {
    super("catalog_unavailable");
    this.name = "CatalogUnavailableError";
  }
}

const SELECT = { id: true, sku: true, name: true, brand: true, imageUrl: true, priceEur: true, stock: true, isOriginal: true, costEur: true, costSource: true } as const;

/**
 * Read the live rows for the referenced parts in ONE query (price and stock
 * from the same snapshot). Rejects when the database cannot be read: the caller
 * answers 503. Without a configured database the static catalogue is used only
 * outside production (local development), never as a quiet stand-in for a
 * database that is down.
 */
export async function loadLiveParts(refs: Pick<CartRef, "sku" | "partId">[]): Promise<LivePart[]> {
  const skus = [...new Set(refs.map((r) => r.sku).filter((v): v is string => !!v))];
  const ids = [...new Set(refs.map((r) => r.partId).filter((v): v is string => !!v))];
  if (skus.length + ids.length === 0) return [];

  if (isDatabaseConfigured()) {
    return prisma.part.findMany({
      where: { OR: [...(skus.length ? [{ sku: { in: skus } }] : []), ...(ids.length ? [{ id: { in: ids } }] : [])] },
      select: SELECT,
    });
  }
  if (env.IS_PRODUCTION) throw new CatalogUnavailableError();

  const out = new Map<string, LivePart>();
  for (const sku of skus) {
    const p = await dbPart(sku);
    if (p) out.set(p.id, toLive(p));
  }
  for (const id of ids) {
    const p = await dbPartById(id);
    if (p) out.set(p.id, toLive(p));
  }
  return [...out.values()];
}

function toLive(p: { id: string; sku: string; name: string; brand: string; imageUrl?: string | null; priceEur: number; stock: number; isOriginal?: boolean; costEur?: number | null }): LivePart {
  // The static JSON catalogue (development without a database) has no provenance: its costs are estimates.
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    brand: p.brand,
    imageUrl: p.imageUrl ?? null,
    priceEur: p.priceEur,
    stock: p.stock,
    isOriginal: p.isOriginal ?? true,
    costEur: p.costEur ?? null,
    costSource: "ESTIMATE",
  };
}

/**
 * ok          as shown
 * reduced     fewer in stock than asked for; `quantity` is what can be had
 * sold_out    none in stock
 * removed     the part no longer exists (deleted or never existed)
 */
export type LineStatus = "ok" | "reduced" | "sold_out" | "removed";

export type EvaluatedLine = {
  /** Null for a removed line whose part could not be resolved. */
  part: LivePart | null;
  /** The reference the client used, to find it again in its cart. */
  ref: { sku?: string; partId?: string };
  requestedQuantity: number;
  /** What can actually be ordered: min(requested, stock, per-line cap). 0 when removed or sold out. */
  quantity: number;
  status: LineStatus;
  /** The price shown to the customer when it differs from the live price. */
  previousUnitPriceEur?: number;
};

export type CartEvaluation = {
  lines: EvaluatedLine[];
  /** True when anything the customer saw is no longer true. */
  changed: boolean;
  /** The lines that will be ordered if the customer accepts: status ok or reduced, quantity > 0. */
  orderable: EvaluatedLine[];
};

/**
 * Compare the requested cart with the live rows (pure: no I/O).
 *
 * Duplicate references to one part are merged first, so a caller cannot dodge
 * the per-line cap by listing a SKU twice.
 */
export function evaluateCart(requested: CartRef[], parts: LivePart[], expected?: ExpectedCart): CartEvaluation {
  const bySku = new Map(parts.map((p) => [p.sku, p]));
  const byId = new Map(parts.map((p) => [p.id, p]));

  const merged = new Map<string, { part: LivePart | null; ref: { sku?: string; partId?: string }; quantity: number }>();
  for (const r of requested) {
    const part = (r.sku ? bySku.get(r.sku) : undefined) ?? (r.partId ? byId.get(r.partId) : undefined) ?? null;
    const key = part ? part.id : `?${r.sku ?? ""}|${r.partId ?? ""}`;
    const prev = merged.get(key);
    if (prev) prev.quantity += r.quantity;
    else merged.set(key, { part, ref: { sku: r.sku, partId: r.partId }, quantity: r.quantity });
  }

  const shownPrice = new Map((expected?.lines ?? []).map((l) => [l.sku, l.unitPriceEur]));
  let changed = false;
  const lines: EvaluatedLine[] = [];
  for (const m of merged.values()) {
    if (!m.part) {
      changed = true;
      lines.push({ part: null, ref: m.ref, requestedQuantity: m.quantity, quantity: 0, status: "removed" });
      continue;
    }
    const allowed = Math.max(0, Math.min(m.quantity, m.part.stock, MAX_QTY_PER_LINE));
    const status: LineStatus = m.part.stock <= 0 ? "sold_out" : m.quantity > allowed ? "reduced" : "ok";
    const shown = shownPrice.get(m.part.sku);
    const priceChanged = shown !== undefined && cents(shown) !== cents(m.part.priceEur);
    if (status !== "ok" || priceChanged) changed = true;
    lines.push({
      part: m.part,
      ref: m.ref,
      requestedQuantity: m.quantity,
      quantity: allowed,
      status,
      ...(priceChanged ? { previousUnitPriceEur: shown } : {}),
    });
  }
  return { lines, changed, orderable: lines.filter((l) => l.part && l.quantity > 0) };
}

/** The public face of an evaluated line: the fields a customer may see, never the cost. */
export function publicLine(l: EvaluatedLine) {
  return {
    sku: l.part?.sku ?? l.ref.sku ?? null,
    partId: l.part?.id ?? l.ref.partId ?? null,
    name: l.part?.name ?? null,
    brand: l.part?.brand ?? null,
    imageUrl: l.part?.imageUrl ?? null,
    unitPriceEur: l.part?.priceEur ?? null,
    stock: l.part?.stock ?? 0,
    quantity: l.quantity,
    requestedQuantity: l.requestedQuantity,
    status: l.status,
    ...(l.previousUnitPriceEur !== undefined ? { previousUnitPriceEur: l.previousUnitPriceEur } : {}),
  };
}
export type PublicCartLine = ReturnType<typeof publicLine>;
