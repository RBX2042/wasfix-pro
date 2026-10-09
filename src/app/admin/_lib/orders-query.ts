/**
 * What the order desk shows: views with counts, search, pagination.
 *
 * WHY A SEPARATE MODULE. The previous page took `orderBy status asc, take 100`:
 * statuses sort alphabetically (CANCELLED first, PAID near the end), so once 100
 * orders existed a paid order that had to be shipped fell off the list and the
 * "N openstaande facturen" counter was computed from those same 100 rows. Here
 * every view is its own database query with its own count, and the module has no
 * Next.js imports so scripts/qa-admin.ts can run it against a real database.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { OrderStatus } from "@/lib/order-status";

export const ORDER_VIEWS = ["te-verzenden", "te-betalen", "onderweg", "afgerond", "terugbetaald", "geannuleerd", "stripe", "zonder-factuur", "alles"] as const;
export type OrderView = (typeof ORDER_VIEWS)[number];

export const VIEW_LABEL: Record<OrderView, string> = {
  "te-verzenden": "Te verzenden",
  "te-betalen": "Te betalen",
  onderweg: "Onderweg",
  afgerond: "Afgerond",
  terugbetaald: "Volledig terugbetaald",
  geannuleerd: "Geannuleerd",
  stripe: "Wacht op Stripe",
  "zonder-factuur": "Betaald zonder factuur",
  alles: "Alles",
};

/**
 * The views that are exactly one status. The others are defined in listOrders / orderCounts:
 * "onderweg" and "afgerond" leave out orders that are completely refunded, "terugbetaald" is those,
 * "zonder-factuur" is paid orders that never got an invoice, "alles" is everything.
 */
export const VIEW_STATUS = {
  "te-verzenden": "PAID",
  "te-betalen": "OPENSTAAND",
  geannuleerd: "CANCELLED",
  stripe: "PENDING",
} as const satisfies Partial<Record<OrderView, OrderStatus>>;

const PAID_STATES = ["PAID", "SHIPPED", "DELIVERED"] as const;

/**
 * A shipped or delivered order whose whole total has been credited back (a return that was refunded in
 * full). It is not "on its way" any more: it leaves "Onderweg" and "Afgerond" and shows in "Volledig
 * terugbetaald". Prisma cannot compare two columns, hence SQL; compared in whole cents like the domain does.
 */
const FULLY_REFUNDED_SQL = Prisma.sql`"status" IN ('SHIPPED', 'DELIVERED') AND "refundedEur" > 0 AND ROUND("refundedEur"::numeric * 100) >= ROUND("totalEur"::numeric * 100)`;

async function fullyRefundedIds(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT "id" FROM "Order" WHERE ${FULLY_REFUNDED_SQL} LIMIT 5000`);
  return rows.map((r) => r.id);
}

/** True when the order is completely refunded although it was shipped (same rule as FULLY_REFUNDED_SQL). */
export function isFullyRefunded(o: { status: string; totalEur: number; refundedEur: number }): boolean {
  return (o.status === "SHIPPED" || o.status === "DELIVERED") && o.refundedEur > 0 && Math.round(o.refundedEur * 100) >= Math.round(o.totalEur * 100);
}

export const PAGE_SIZE = 25;

export function isOrderView(v: unknown): v is OrderView {
  return typeof v === "string" && (ORDER_VIEWS as readonly string[]).includes(v);
}

export type SearchTerms = {
  invoiceNumbers: string[];
  amounts: number[];
  texts: string[];
};

/**
 * A bank statement line ("2026-00002 EUR 34,45 J. Jansen") is split into the parts
 * the desk can match on: an invoice number, an amount, and free text (name, order
 * number, e-mail, postcode, tracking code). "EUR" and the euro sign are noise.
 * An amount needs a decimal part ("34,45"): a bare "34" is far more likely a
 * house number or part of an order number than money.
 */
export function parseOrderSearch(q: string): SearchTerms {
  const terms: SearchTerms = { invoiceNumbers: [], amounts: [], texts: [] };
  for (const raw of q.trim().split(/\s+/)) {
    let tok = raw.replace(/^#/, "");
    if (!tok || /^(eur|euro|€)$/i.test(tok)) continue;
    tok = tok.replace(/^€/, "");
    if (/^\d{4}-\d{5}$/.test(tok)) terms.invoiceNumbers.push(tok);
    else if (/^\d+[.,]\d{2}$/.test(tok)) terms.amounts.push(Number(tok.replace(",", ".")));
    else if (tok.length >= 2) terms.texts.push(tok.slice(0, 80));
  }
  return terms;
}

function clauseFor(terms: SearchTerms): Prisma.OrderWhereInput[] {
  const clauses: Prisma.OrderWhereInput[] = [];
  for (const n of terms.invoiceNumbers) clauses.push({ invoice: { is: { number: n } } });
  for (const a of terms.amounts) clauses.push({ totalEur: { gte: a - 0.005, lt: a + 0.005 } });
  for (const t of terms.texts) {
    const or: Prisma.OrderWhereInput[] = [
      { email: { contains: t, mode: "insensitive" } },
      { shippingAddress: { contains: t, mode: "insensitive" } },
      { trackingCode: { contains: t, mode: "insensitive" } },
      { phone: { contains: t, mode: "insensitive" } },
      { invoice: { is: { number: { contains: t } } } },
    ];
    // Order ids are cuids: lower case. The short number people quote is the first 8 characters, upper case.
    if (t.length >= 4 && /^[a-z0-9]+$/i.test(t)) or.push({ id: { startsWith: t.toLowerCase() } });
    clauses.push({ OR: or });
  }
  return clauses;
}

export const ORDER_LIST_INCLUDE = {
  items: { include: { part: { select: { id: true, sku: true, name: true, stock: true } } } },
  invoice: { select: { number: true, issuedAt: true, totalEur: true, creditNotes: { select: { number: true, totalEur: true, issuedAt: true, linesJson: true }, orderBy: { issuedAt: "asc" } } } },
} satisfies Prisma.OrderInclude;

export type OrderRow = Prisma.OrderGetPayload<{ include: typeof ORDER_LIST_INCLUDE }>;

export type OrderListing = {
  rows: OrderRow[];
  total: number;
  page: number;
  pages: number;
  /**
   * view: a status tab. search: every term matched. search-loose: nothing matched all
   * terms, these match at least one (the amount may be short or the reference mistyped).
   */
  mode: "view" | "search" | "search-loose";
};

export async function listOrders(opts: { view?: OrderView; q?: string; page?: number } = {}): Promise<OrderListing> {
  const view = opts.view ?? "te-verzenden";
  // A NUL byte makes Postgres refuse the query (22021) and the page answered 500; other control characters are noise.
  const q = (opts.q ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 200);
  // ?page=99999999999999999999 became a skip beyond 64 bits and answered 500. Bad input means page 1;
  // a page beyond the last one is clamped to the last page below.
  const wanted = Number.isSafeInteger(opts.page) && (opts.page as number) >= 1 ? (opts.page as number) : 1;

  let where: Prisma.OrderWhereInput;
  let mode: OrderListing["mode"] = "view";
  let orderBy: Prisma.OrderOrderByWithRelationInput[];

  if (q) {
    // A search spans every status: the order behind a bank-statement line is
    // found no matter which tab the owner happened to be on.
    const terms = parseOrderSearch(q);
    const clauses = clauseFor(terms);
    mode = "search";
    where = clauses.length > 0 ? { AND: clauses } : { id: "__none__" };
    orderBy = [{ createdAt: "desc" }];
    if (clauses.length > 1 && (await prisma.order.count({ where })) === 0) {
      mode = "search-loose";
      where = { OR: clauses };
    }
  } else if (view === "alles") {
    where = {};
    orderBy = [{ createdAt: "desc" }];
  } else if (view === "onderweg" || view === "afgerond") {
    where = { status: view === "onderweg" ? "SHIPPED" : "DELIVERED", id: { notIn: await fullyRefundedIds() } };
    orderBy = [{ createdAt: "desc" }];
  } else if (view === "terugbetaald") {
    where = { id: { in: await fullyRefundedIds() } };
    orderBy = [{ createdAt: "desc" }];
  } else if (view === "zonder-factuur") {
    // Paid, but the invoice step was refused or failed (company details incomplete at the time). Oldest first.
    where = { status: { in: [...PAID_STATES] }, invoice: { is: null } };
    orderBy = [{ createdAt: "asc" }];
  } else {
    where = { status: VIEW_STATUS[view] };
    // Work first-in first-out; unpaid invoices by due date so the overdue ones lead.
    orderBy =
      view === "te-verzenden"
        ? [{ createdAt: "asc" }]
        : view === "te-betalen"
          ? [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }]
          : [{ createdAt: "desc" }];
  }

  const total = await prisma.order.count({ where });
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(wanted, pages);
  const rows = await prisma.order.findMany({ where, orderBy, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: ORDER_LIST_INCLUDE });
  return { rows, total, page, pages, mode };
}

export type OrderCounts = Record<OrderView, number> & {
  /** Unpaid bank-transfer invoices past their due date. */
  overdue: number;
  /** Paid orders that have waited more than two days for shipment. */
  shipLate: number;
};

export async function orderCounts(now: Date = new Date()): Promise<OrderCounts> {
  const [grouped, overdue, shipLate, refundedByStatus, withoutInvoice] = await Promise.all([
    prisma.order.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.order.count({ where: { status: "OPENSTAAND", paymentMethod: "BANK_TRANSFER", dueAt: { lt: now } } }),
    prisma.order.count({ where: { status: "PAID", createdAt: { lt: new Date(now.getTime() - 2 * 86_400_000) } } }),
    prisma.$queryRaw<{ status: string; n: number }[]>(Prisma.sql`SELECT "status", COUNT(*)::int AS n FROM "Order" WHERE ${FULLY_REFUNDED_SQL} GROUP BY "status"`),
    prisma.order.count({ where: { status: { in: [...PAID_STATES] }, invoice: { is: null } } }),
  ]);
  const byStatus = new Map(grouped.map((g) => [g.status, g._count._all]));
  const refunded = new Map(refundedByStatus.map((r) => [r.status, Number(r.n)]));
  const out = { overdue, shipLate, alles: grouped.reduce((s, g) => s + g._count._all, 0) } as OrderCounts;
  for (const [view, status] of Object.entries(VIEW_STATUS)) out[view as keyof typeof VIEW_STATUS] = byStatus.get(status) ?? 0;
  out.onderweg = (byStatus.get("SHIPPED") ?? 0) - (refunded.get("SHIPPED") ?? 0);
  out.afgerond = (byStatus.get("DELIVERED") ?? 0) - (refunded.get("DELIVERED") ?? 0);
  out.terugbetaald = (refunded.get("SHIPPED") ?? 0) + (refunded.get("DELIVERED") ?? 0);
  out["zonder-factuur"] = withoutInvoice;
  return out;
}

/** Units of a part that are sold and not shipped yet: OPENSTAAND and PAID orders. They are already off Part.stock. */
export async function reservedByPart(partIds?: string[]): Promise<Map<string, number>> {
  const grouped = await prisma.orderItem.groupBy({
    by: ["partId"],
    where: { order: { status: { in: ["OPENSTAAND", "PAID"] } }, ...(partIds ? { partId: { in: partIds } } : {}) },
    _sum: { quantity: true },
  });
  return new Map(grouped.map((g) => [g.partId, g._sum.quantity ?? 0]));
}

export type PickRow = {
  sku: string;
  name: string;
  /** Part.stock: what the shop can still SELL (units reserved for unshipped orders are already taken off). */
  stock: number;
  /** What should physically be on the shelf: stock plus the units reserved for orders that have not shipped. */
  onShelf: number;
  quantity: number;
  orders: Array<{ orderId: string; quantity: number }>;
};

/**
 * Everything the pick list needs: lines of the orders waiting to ship, summed per SKU.
 * Part.stock excludes the units of unshipped orders, so comparing it with the quantity to pick flagged
 * a shortage that did not exist (the units are on the shelf until they ship). The comparison that means
 * something is the number that should be on the shelf (onShelf) against the quantity to pick.
 */
export async function pickList(): Promise<{ skus: PickRow[]; orders: number }> {
  const orders = await prisma.order.findMany({
    where: { status: "PAID" },
    orderBy: { createdAt: "asc" },
    select: { id: true, items: { select: { quantity: true, partId: true, part: { select: { sku: true, name: true, stock: true } } } } },
  });
  const partIds = [...new Set(orders.flatMap((o) => o.items.map((i) => i.partId)))];
  const reserved = await reservedByPart(partIds);
  const bySku = new Map<string, PickRow>();
  for (const o of orders) {
    for (const it of o.items) {
      const row = bySku.get(it.part.sku) ?? { sku: it.part.sku, name: it.part.name, stock: it.part.stock, onShelf: it.part.stock + (reserved.get(it.partId) ?? 0), quantity: 0, orders: [] };
      row.quantity += it.quantity;
      row.orders.push({ orderId: o.id, quantity: it.quantity });
      bySku.set(it.part.sku, row);
    }
  }
  return { skus: [...bySku.values()].sort((a, b) => a.sku.localeCompare(b.sku)), orders: orders.length };
}
