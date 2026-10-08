"use client";
import * as React from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { toast } from "sonner";
import { MAX_LINES_PER_ORDER, MAX_QTY_PER_LINE, MAX_UNITS_PER_ORDER } from "@/lib/cart-limits";
import { formatEur } from "@/lib/utils";

export type CartItem = {
  partId: string;
  sku: string;
  name: string;
  brand: string;
  priceEur: number;
  imageUrl?: string | null;
  quantity: number;
  /**
   * Units in stock when the item was last seen, if known. Callers that add from a
   * page that knows the stock should pass it; /api/cart/validate fills it in for
   * everything else (when the drawer opens and when /checkout loads). Optional so
   * existing callers and old stored carts keep working.
   */
  stock?: number;
};

/** What the server says about one cart line (the public fields of /api/cart/validate). */
export type ServerCartLine = {
  sku: string | null;
  partId: string | null;
  name: string | null;
  brand: string | null;
  imageUrl: string | null;
  unitPriceEur: number | null;
  stock: number;
  quantity: number;
  requestedQuantity: number;
  status: "ok" | "reduced" | "sold_out" | "removed";
};

/** One thing that changed in the cart because the server knows better. */
export type CartNotice =
  | { kind: "price"; sku: string; name: string; from: number; to: number }
  | { kind: "reduced"; sku: string; name: string; from: number; to: number }
  | { kind: "sold_out"; sku: string; name: string }
  | { kind: "removed"; sku: string; name: string }
  /** Nothing about the lines changed but the total did (for example the member discount no longer applies). */
  | { kind: "total"; from: number; to: number };

export function describeCartNotice(n: CartNotice): string {
  switch (n.kind) {
    case "price":
      return `De prijs van ${n.name} is gewijzigd van ${formatEur(n.from)} naar ${formatEur(n.to)}.`;
    case "reduced":
      return `Van ${n.name} zijn nog maar ${n.to} stuks beschikbaar (je had ${n.from} in je winkelmand). Het aantal is aangepast.`;
    case "sold_out":
      return `${n.name} is uitverkocht en uit je winkelmand gehaald.`;
    case "removed":
      return `${n.name} is niet meer beschikbaar en uit je winkelmand gehaald.`;
    case "total":
      return `Het totaalbedrag is gewijzigd van ${formatEur(n.from)} naar ${formatEur(n.to)}.`;
  }
}

type CartState = {
  items: CartItem[];
  isOpen: boolean;
  /** Returns how many units were really added (0 when the cap was already reached). */
  add: (item: Omit<CartItem, "quantity">, qty?: number) => number;
  remove: (partId: string) => void;
  setQty: (partId: string, qty: number) => void;
  clear: () => void;
  setOpen: (open: boolean) => void;
  /** Replace prices, stock and quantities with the server's, dropping what can no longer be bought. */
  applyServerLines: (lines: ServerCartLine[]) => CartNotice[];
};

export type CartLimit = "stock" | "units" | "line";

/**
 * How many units of `item` this cart may hold, and which limit decides: the stock (when known), the
 * units left in the order-wide cap, or the per-part cap. `others` are the OTHER lines of the cart;
 * without it only the per-part and stock limits apply (the old behaviour of this function).
 */
export function cartCapFor(item: Pick<CartItem, "stock">, others: Pick<CartItem, "quantity">[] = []): { cap: number; limit: CartLimit } {
  const stockCap = typeof item.stock === "number" ? Math.max(0, item.stock) : Number.POSITIVE_INFINITY;
  const unitsCap = Math.max(0, MAX_UNITS_PER_ORDER - others.reduce((n, i) => n + i.quantity, 0));
  const cap = Math.min(MAX_QTY_PER_LINE, stockCap, unitsCap);
  // On a tie the most specific reason wins: "only 3 in stock" says more than "max 20".
  const limit: CartLimit = cap === stockCap ? "stock" : cap === unitsCap && unitsCap < MAX_QTY_PER_LINE ? "units" : "line";
  return { cap, limit };
}

/** The most of one part this cart may hold: the page cap, the stock when it is known and, given the rest of the cart, the order-wide unit cap. */
export function maxQuantityFor(item: Pick<CartItem, "stock">, others: Pick<CartItem, "quantity">[] = []): number {
  return cartCapFor(item, others).cap;
}

export type AddOutcome = { added: number; next: number; limit: CartLimit | "lines" | null; message: string | null };

/**
 * What adding `qty` units of `sku` would do to this cart, as a pure function so it can be tested
 * without a browser. Neither this nor setQty() lets the cart grow past what the server will accept (MAX_QTY_PER_LINE per
 * part, MAX_UNITS_PER_ORDER and MAX_LINES_PER_ORDER per order, the stock when known), and the message
 * names the limit that actually bit. The old toast said "meer is niet beschikbaar" when the cause was
 * the per-part cap and the part had 77 in stock.
 */
export function planAdd(items: Pick<CartItem, "sku" | "quantity" | "stock">[], sku: string, stockHint: number | undefined, qty: number): AddOutcome {
  const existing = items.find((i) => i.sku === sku);
  const have = existing?.quantity ?? 0;
  if (!existing && items.length >= MAX_LINES_PER_ORDER) {
    return { added: 0, next: have, limit: "lines", message: `Maximaal ${MAX_LINES_PER_ORDER} verschillende onderdelen per bestelling.` };
  }
  const stock = stockHint ?? existing?.stock;
  const { cap, limit } = cartCapFor({ stock }, items.filter((i) => i.sku !== sku));
  const next = Math.max(have, Math.min(cap, have + qty));
  const added = next - have;
  if (added >= qty) return { added, next, limit: null, message: null };
  const none = added === 0;
  const message =
    limit === "stock"
      ? none
        ? `Je hebt al alle ${stock} op voorraad in je winkelmand.`
        : `Aantal beperkt tot ${next}: zo veel hebben we op voorraad.`
      : limit === "units"
        ? `Maximaal ${MAX_UNITS_PER_ORDER} stuks per bestelling.${none ? "" : ` Er zijn er ${added} toegevoegd.`}`
        : none
          ? `Je hebt al het maximum van ${MAX_QTY_PER_LINE} per onderdeel in je winkelmand.`
          : `Maximaal ${MAX_QTY_PER_LINE} per onderdeel per bestelling: er zijn er ${added} toegevoegd.`;
  return { added, next, limit, message };
}

/** Why this cart cannot be ordered as it stands (an old stored cart can exceed limits the server enforces), or null. */
export function cartOverLimit(items: Pick<CartItem, "quantity">[]): string | null {
  if (items.length > MAX_LINES_PER_ORDER) return `Je winkelmand heeft meer dan ${MAX_LINES_PER_ORDER} verschillende onderdelen. Verwijder er een paar om te bestellen, of neem contact met ons op.`;
  const units = items.reduce((n, i) => n + i.quantity, 0);
  if (units > MAX_UNITS_PER_ORDER) return `Je winkelmand heeft ${units} stuks; per bestelling kunnen we maximaal ${MAX_UNITS_PER_ORDER} stuks leveren. Haal er een paar uit, of neem contact met ons op.`;
  return null;
}

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      isOpen: false,
      add: (item, qty = 1) => {
        const plan = planAdd(get().items, item.sku, item.stock, qty);
        if (plan.message) toast.info(plan.message);
        if (plan.added === 0) return 0;
        const existing = get().items.find((i) => i.sku === item.sku);
        const stock = item.stock ?? existing?.stock;
        // The drawer is NOT opened here: opening a modal on every add interrupted browsing
        // and, with several adds in a row, hid the page. The header badge shows the count and
        // the callers toast "toegevoegd".
        set((s) => ({
          items: existing
            ? s.items.map((i) =>
                i.sku === item.sku
                  ? { ...i, quantity: plan.next, partId: item.partId, priceEur: item.priceEur, ...(stock !== undefined ? { stock } : {}) }
                  : i,
              )
            : [...s.items, { ...item, quantity: plan.next, ...(stock !== undefined ? { stock } : {}) }],
        }));
        return plan.added;
      },
      remove: (partId) => set((s) => ({ items: s.items.filter((i) => i.partId !== partId && i.sku !== partId) })),
      setQty: (partId, qty) =>
        set((s) => ({
          items:
            qty <= 0
              ? s.items.filter((i) => i.partId !== partId && i.sku !== partId)
              : s.items.map((i) =>
                  i.partId === partId || i.sku === partId
                    ? { ...i, quantity: Math.min(qty, maxQuantityFor(i, s.items.filter((o) => o !== i))) }
                    : i,
                ),
        })),
      clear: () => set({ items: [] }),
      setOpen: (isOpen) => set({ isOpen }),
      applyServerLines: (lines) => {
        const notices: CartNotice[] = [];
        const next: CartItem[] = [];
        for (const item of get().items) {
          const line = lines.find((l) => (l.sku && l.sku === item.sku) || (l.partId && l.partId === item.partId));
          if (!line) {
            next.push(item);
            continue;
          }
          if (line.status === "removed") {
            notices.push({ kind: "removed", sku: item.sku, name: item.name });
            continue;
          }
          if (line.status === "sold_out" || line.quantity <= 0 || line.unitPriceEur === null) {
            notices.push({ kind: "sold_out", sku: item.sku, name: item.name });
            continue;
          }
          if (Math.round(line.unitPriceEur * 100) !== Math.round(item.priceEur * 100)) {
            notices.push({ kind: "price", sku: item.sku, name: line.name ?? item.name, from: item.priceEur, to: line.unitPriceEur });
          }
          if (line.quantity < item.quantity) {
            notices.push({ kind: "reduced", sku: item.sku, name: line.name ?? item.name, from: item.quantity, to: line.quantity });
          }
          next.push({
            ...item,
            partId: line.partId ?? item.partId,
            name: line.name ?? item.name,
            brand: line.brand ?? item.brand,
            imageUrl: line.imageUrl ?? item.imageUrl,
            priceEur: line.unitPriceEur,
            stock: line.stock,
            quantity: Math.min(item.quantity, line.quantity),
          });
        }
        set({ items: next });
        return notices;
      },
    }),
    {
      name: "wasfix-cart",
      // Bump version when cart logic changes; old persisted carts get reset
      version: 2,
      migrate: () => ({ items: [], isOpen: false }),
      // Persist the items only. Persisting isOpen too meant that after "In
      // winkelmand" a full page load of /checkout (which is exactly what Stripe's
      // cancel_url does) reopened the drawer with its dark overlay over the form.
      partialize: (s) => ({ items: s.items }),
      // Old stored states still carry isOpen: never restore it.
      merge: (persisted, current) => ({
        ...current,
        items: (persisted as { items?: CartItem[] } | undefined)?.items ?? current.items,
      }),
    }
  )
);

let lastRefresh = 0;
let inFlight: Promise<CartNotice[] | null> | null = null;

/**
 * Ask the server for the live price and stock of everything in the cart and
 * apply the answer. Returns what changed, or null when nothing was asked
 * (empty cart, asked a moment ago) or the server could not answer: a failed
 * refresh leaves the cart as it was, and checkout re-checks anyway.
 */
export function refreshCartFromServer(opts: { force?: boolean } = {}): Promise<CartNotice[] | null> {
  if (inFlight) return inFlight;
  const { items, applyServerLines } = useCart.getState();
  if (items.length === 0) return Promise.resolve(null);
  if (!opts.force && Date.now() - lastRefresh < 20_000) return Promise.resolve(null);
  lastRefresh = Date.now();
  inFlight = (async () => {
    try {
      const res = await fetch("/api/cart/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: items.map((i) => ({ sku: i.sku, partId: i.partId, quantity: i.quantity })) }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { lines?: ServerCartLine[] };
      if (!Array.isArray(data.lines)) return null;
      return applyServerLines(data.lines);
    } catch {
      return null;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function cartTotal(items: CartItem[]): number {
  return items.reduce((sum, i) => sum + i.priceEur * i.quantity, 0);
}

export function cartCount(items: CartItem[]): number {
  return items.reduce((sum, i) => sum + i.quantity, 0);
}
