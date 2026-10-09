/**
 * The owner's money figures, computed in the database from what is stored.
 *
 * HONESTY RULES (decision D8)
 *   - A margin counts a cost price only when it is recorded as a QUOTE (a real supplier
 *     quote or invoice). Costs marked ESTIMATE are shown separately and labelled
 *     "schatting". Order.costEur is never summed anywhere: it is a snapshot with no
 *     provenance and, in the seed, generated from the selling price.
 *   - The cost used for an order is the part's CURRENT cost (OrderItem has no cost
 *     snapshot), so a later price change moves old margins. Refunds are not netted out of a
 *     margin; they are netted out of revenue.
 *   - The ledger (VAT per quarter, invoice export) reads Invoice and CreditNote only: revenue
 *     = sum(Invoice.totalEur) - sum(CreditNote.totalEur), VAT = sum(Invoice.vatEur) -
 *     sum(CreditNote.vatEur). Quarters and years are Europe/Amsterdam, the same clock the
 *     invoice numbering uses.
 *
 * ASSUMPTIONS in the per-SKU table are constants below, NOT facts. They are labelled as
 * assumptions on the page. Replace them with the real Stripe fee and the real carrier rate card.
 * (No new environment variable: decision D10.)
 */
import { prisma } from "@/lib/prisma";
import { PLANS, SHIPPING, VAT_RATE, shippingFor, type PlanId } from "@/lib/plans";
import { computeOrderMargin, costBasis, money, type CostBasis, type MarginFigure } from "@/lib/invoicing";

export const PAID_STATUSES = ["PAID", "SHIPPED", "DELIVERED"] as const;

export const ECONOMICS_ASSUMPTIONS = {
  /** Stripe iDEAL fee per payment, euro. An assumption taken from the investigators' model; check your Stripe tariff. */
  paymentFeeFixedEur: 0.29,
  /** Percentage fee on the amount paid (cards); 0 = iDEAL-only assumption. */
  paymentFeePercent: 0,
  /** What the carrier charges US per parcel, euro. Unsourced (the investigators used 5.20 and 6.50); replace with the rate card. */
  carrierCostEur: 6.5,
} as const;

// ─── Revenue (orders) ─────────────────────────────────────────────────

export type RevenueFigures = {
  /** Paid orders, VAT included, minus credit notes on them. */
  grossEur: number;
  vatEur: number;
  netEur: number;
  paidOrders: number;
};

export async function paidRevenue(): Promise<RevenueFigures> {
  const [o, c] = await Promise.all([
    prisma.order.aggregate({ where: { status: { in: [...PAID_STATUSES] } }, _sum: { totalEur: true, vatEur: true }, _count: true }),
    prisma.$queryRaw<{ gross: number; vat: number }[]>`
      SELECT COALESCE(SUM(c."totalEur"), 0)::float8 AS gross, COALESCE(SUM(c."vatEur"), 0)::float8 AS vat
        FROM "CreditNote" c
        JOIN "Invoice" i ON i."id" = c."invoiceId"
        JOIN "Order" o ON o."id" = i."orderId"
       WHERE o."status" IN ('PAID', 'SHIPPED', 'DELIVERED')`,
  ]);
  const gross = money((o._sum.totalEur ?? 0) - Number(c[0]?.gross ?? 0));
  const vat = money((o._sum.vatEur ?? 0) - Number(c[0]?.vat ?? 0));
  return { grossEur: gross, vatEur: vat, netEur: money(gross - vat), paidOrders: o._count };
}

/**
 * Margin over all paid orders, split by how trustworthy the cost is. Pages through the
 * orders in batches so memory stays flat; each order is computed with computeOrderMargin
 * (discount spread over its lines, only QUOTE lines in `confirmed`).
 */
export async function shopMargin(): Promise<{ confirmed: MarginFigure; estimated: MarginFigure; unknownLines: number; orders: number }> {
  const sum = (a: MarginFigure, b: MarginFigure): MarginFigure => ({
    lines: a.lines + b.lines,
    revenueExVatEur: a.revenueExVatEur + b.revenueExVatEur,
    costEur: a.costEur + b.costEur,
    marginEur: 0,
    marginPct: null,
  });
  let confirmed: MarginFigure = { lines: 0, revenueExVatEur: 0, costEur: 0, marginEur: 0, marginPct: null };
  let estimated: MarginFigure = { ...confirmed };
  let unknownLines = 0;
  let orders = 0;
  let cursor: string | undefined;
  for (;;) {
    const batch = await prisma.order.findMany({
      where: { status: { in: [...PAID_STATUSES] } },
      orderBy: { id: "asc" },
      take: 500,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: { id: true, discountEur: true, vatRate: true, items: { select: { quantity: true, unitPrice: true, part: { select: { costEur: true, costSource: true } } } } },
    });
    if (batch.length === 0) break;
    for (const o of batch) {
      const m = computeOrderMargin({
        discountEur: o.discountEur,
        vatRate: o.vatRate,
        items: o.items.map((i) => ({ unitPriceEur: i.unitPrice, quantity: i.quantity, costEur: i.part.costEur, costSource: i.part.costSource })),
      });
      confirmed = sum(confirmed, m.confirmed);
      estimated = sum(estimated, m.estimated);
      unknownLines += m.unknownLines;
      orders++;
    }
    cursor = batch[batch.length - 1].id;
  }
  for (const f of [confirmed, estimated]) {
    f.revenueExVatEur = money(f.revenueExVatEur);
    f.costEur = money(f.costEur);
    f.marginEur = money(f.revenueExVatEur - f.costEur);
    f.marginPct = f.revenueExVatEur > 0 ? Math.round((f.marginEur / f.revenueExVatEur) * 1000) / 10 : null;
  }
  return { confirmed, estimated, unknownLines, orders };
}

/**
 * The last `n` Europe/Amsterdam calendar days ending today, oldest first, as YYYY-MM-DD. Counted on the DATE,
 * not by subtracting 24 hours: across a clock change a day has 23 or 25 hours and subtracting 24 h would skip
 * or repeat a label, which for the revenue chart means a day of revenue missing.
 */
export function amsterdamDays(n: number, now: Date = new Date()): string[] {
  const [y, m, d] = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Amsterdam" }).format(now).split("-").map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(new Date(Date.UTC(y, m - 1, d - i)).toISOString().slice(0, 10));
  return out;
}

/**
 * Paid orders that never got an invoice (the company details were incomplete when they were paid). They are in the
 * "Omzet" card, which counts paid orders, but NOT in the revenue chart, which reads the invoices: this is the
 * difference between the two, so the dashboard can say so instead of letting them disagree silently.
 */
export async function paidWithoutInvoice(): Promise<{ count: number; grossEur: number }> {
  const r = await prisma.order.aggregate({ where: { status: { in: [...PAID_STATUSES] }, invoice: { is: null } }, _sum: { totalEur: true }, _count: true });
  return { count: r._count, grossEur: money(r._sum.totalEur ?? 0) };
}

export type RevenueDay = {
  /** YYYY-MM-DD, Europe/Amsterdam. */
  day: string;
  /** Invoiced incl. VAT on this day for orders that are paid, minus the credit notes issued on this day for them. Can be negative on a refund day. */
  revenueEur: number;
  /** Invoices issued on this day for paid orders. */
  invoices: number;
  /** Credit notes issued on this day for paid orders. */
  creditNotes: number;
};

/**
 * The revenue chart's numbers, from the same two tables as the VAT ledger: Invoice minus CreditNote, by the
 * Europe/Amsterdam day of issue, for orders that count as paid (the same orders paidRevenue() counts). It
 * used to group paid orders by createdAt in server-local (UTC) days and ignore credit notes, so after any
 * refund the chart disagreed with the card next to it. Over a window that holds every invoice the series
 * adds up to paidRevenue().grossEur; scripts/qa-admin.ts checks exactly that. Zero-filled, oldest first.
 */
export async function revenuePerDay(days = 30, now: Date = new Date()): Promise<RevenueDay[]> {
  const since = new Date(now.getTime() - (days + 1) * 86_400_000);
  const [inv, cn] = await Promise.all([
    prisma.$queryRaw<{ day: string; gross: number; n: number }[]>`
      SELECT to_char((i."issuedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Amsterdam', 'YYYY-MM-DD') AS day,
             COALESCE(SUM(i."totalEur"), 0)::float8 AS gross, COUNT(*)::int AS n
        FROM "Invoice" i JOIN "Order" o ON o."id" = i."orderId"
       WHERE o."status" IN ('PAID', 'SHIPPED', 'DELIVERED') AND i."issuedAt" >= ${since}
       GROUP BY 1`,
    prisma.$queryRaw<{ day: string; gross: number; n: number }[]>`
      SELECT to_char((c."issuedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Amsterdam', 'YYYY-MM-DD') AS day,
             COALESCE(SUM(c."totalEur"), 0)::float8 AS gross, COUNT(*)::int AS n
        FROM "CreditNote" c JOIN "Invoice" i ON i."id" = c."invoiceId" JOIN "Order" o ON o."id" = i."orderId"
       WHERE o."status" IN ('PAID', 'SHIPPED', 'DELIVERED') AND c."issuedAt" >= ${since}
       GROUP BY 1`,
  ]);
  const invBy = new Map(inv.map((r) => [r.day, r]));
  const cnBy = new Map(cn.map((r) => [r.day, r]));
  return amsterdamDays(days, now).map((key) => ({
    day: key,
    revenueEur: money(Number(invBy.get(key)?.gross ?? 0) - Number(cnBy.get(key)?.gross ?? 0)),
    invoices: Number(invBy.get(key)?.n ?? 0),
    creditNotes: Number(cnBy.get(key)?.n ?? 0),
  }));
}

// ─── Is anyone buying? ────────────────────────────────────────────────

export type DayCount = { date: string; created: number; paid: number };

/** Orders created per day (Amsterdam days), last `days` days including today, zero-filled. */
export async function ordersPerDay(days = 14, now: Date = new Date()): Promise<DayCount[]> {
  const rows = await prisma.$queryRaw<{ day: string; created: number; paid: number }[]>`
    SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Amsterdam', 'YYYY-MM-DD') AS day,
           COUNT(*)::int AS created,
           COUNT(*) FILTER (WHERE "status" IN ('PAID', 'SHIPPED', 'DELIVERED'))::int AS paid
      FROM "Order"
     WHERE "createdAt" >= ${new Date(now.getTime() - (days + 1) * 86_400_000)}
     GROUP BY 1`;
  const byDay = new Map(rows.map((r) => [r.day, r]));
  return amsterdamDays(days, now).map((key) => {
    const r = byDay.get(key);
    return { date: key, created: r?.created ?? 0, paid: r?.paid ?? 0 };
  });
}

// ─── Who is a user? ───────────────────────────────────────────────────

/**
 * Accounts are people who signed up: they have a Clerk id. Checkout also creates a User row for every guest
 * so the order has an owner (decision D16: a guest order is attached to a real account only when the placer
 * is signed in as it). Counting those rows as "Gebruikers" inflated the number and listed guests, by name and
 * e-mail, as if they were leads. They are reported apart: `guests` = rows without an account that placed an order.
 */
export async function accountStats(): Promise<{ accounts: number; guests: number }> {
  const [accounts, guests] = await Promise.all([
    prisma.user.count({ where: { clerkId: { not: null } } }),
    prisma.user.count({ where: { clerkId: null, orders: { some: {} } } }),
  ]);
  return { accounts, guests };
}

// ─── Open work ────────────────────────────────────────────────────────

export type OpenCounts = { toShip: number; unpaidInvoices: number; overdueInvoices: number; openRma: number; pendingApplications: number; pendingReviews: number };

export async function openCounts(now: Date = new Date()): Promise<OpenCounts> {
  const [toShip, unpaidInvoices, overdueInvoices, openRma, pendingApplications, pendingReviews] = await Promise.all([
    prisma.order.count({ where: { status: "PAID" } }),
    prisma.order.count({ where: { status: "OPENSTAAND" } }),
    prisma.order.count({ where: { status: "OPENSTAAND", paymentMethod: "BANK_TRANSFER", dueAt: { lt: now } } }),
    prisma.rmaRequest.count({ where: { status: { in: ["RECEIVED", "APPROVED", "RETURN_RECEIVED"] } } }),
    prisma.monteurApplication.count({ where: { status: "PENDING" } }),
    prisma.review.count({ where: { status: "PENDING" } }),
  ]);
  return { toShip, unpaidInvoices, overdueInvoices, openRma, pendingApplications, pendingReviews };
}

// ─── VAT ledger ───────────────────────────────────────────────────────

export type QuarterRow = {
  quarter: number;
  invoices: number;
  invoicedNetEur: number;
  invoicedVatEur: number;
  invoicedGrossEur: number;
  creditNotes: number;
  creditedNetEur: number;
  creditedVatEur: number;
  creditedGrossEur: number;
  /** Invoiced minus credited. */
  netEur: number;
  vatPayableEur: number;
  grossEur: number;
};

const TZ_LOCAL = (col: string) => `((${col} AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Amsterdam')`;

/** One row per quarter of `year` (Europe/Amsterdam), from Invoice and CreditNote. */
export async function vatByQuarter(year: number): Promise<QuarterRow[]> {
  const inv = await prisma.$queryRawUnsafe<{ q: number; n: number; net: number; vat: number; gross: number }[]>(
    `SELECT EXTRACT(QUARTER FROM ${TZ_LOCAL('"issuedAt"')})::int AS q, COUNT(*)::int AS n,
            COALESCE(SUM("totalEur" - "vatEur"), 0)::float8 AS net, COALESCE(SUM("vatEur"), 0)::float8 AS vat, COALESCE(SUM("totalEur"), 0)::float8 AS gross
       FROM "Invoice" WHERE EXTRACT(YEAR FROM ${TZ_LOCAL('"issuedAt"')})::int = $1 GROUP BY 1`,
    year,
  );
  const cn = await prisma.$queryRawUnsafe<{ q: number; n: number; net: number; vat: number; gross: number }[]>(
    `SELECT EXTRACT(QUARTER FROM ${TZ_LOCAL('"issuedAt"')})::int AS q, COUNT(*)::int AS n,
            COALESCE(SUM("subtotalEur"), 0)::float8 AS net, COALESCE(SUM("vatEur"), 0)::float8 AS vat, COALESCE(SUM("totalEur"), 0)::float8 AS gross
       FROM "CreditNote" WHERE EXTRACT(YEAR FROM ${TZ_LOCAL('"issuedAt"')})::int = $1 GROUP BY 1`,
    year,
  );
  const rows: QuarterRow[] = [];
  for (let q = 1; q <= 4; q++) {
    const i = inv.find((r) => Number(r.q) === q);
    const c = cn.find((r) => Number(r.q) === q);
    const row: QuarterRow = {
      quarter: q,
      invoices: Number(i?.n ?? 0),
      invoicedNetEur: money(Number(i?.net ?? 0)),
      invoicedVatEur: money(Number(i?.vat ?? 0)),
      invoicedGrossEur: money(Number(i?.gross ?? 0)),
      creditNotes: Number(c?.n ?? 0),
      creditedNetEur: money(Number(c?.net ?? 0)),
      creditedVatEur: money(Number(c?.vat ?? 0)),
      creditedGrossEur: money(Number(c?.gross ?? 0)),
      netEur: 0,
      vatPayableEur: 0,
      grossEur: 0,
    };
    row.netEur = money(row.invoicedNetEur - row.creditedNetEur);
    row.vatPayableEur = money(row.invoicedVatEur - row.creditedVatEur);
    row.grossEur = money(row.invoicedGrossEur - row.creditedGrossEur);
    rows.push(row);
  }
  return rows;
}

export type LedgerRow = {
  kind: "FACTUUR" | "CREDITNOTA";
  number: string;
  date: string; // YYYY-MM-DD, Europe/Amsterdam
  orderRef: string;
  netEur: number;
  vatEur: number;
  totalEur: number;
  status: string;
  refersTo: string;
};

/** Invoices and credit notes between two Amsterdam dates (inclusive). Credit notes carry NEGATIVE amounts. */
export async function ledgerRows(fromDate: string, toDate: string): Promise<LedgerRow[]> {
  const invoices = await prisma.$queryRawUnsafe<{ number: string; d: string; orderId: string; status: string; net: number; vat: number; total: number }[]>(
    `SELECT i."number", to_char(${TZ_LOCAL('i."issuedAt"')}, 'YYYY-MM-DD') AS d, i."orderId", o."status",
            (i."totalEur" - i."vatEur")::float8 AS net, i."vatEur"::float8 AS vat, i."totalEur"::float8 AS total
       FROM "Invoice" i JOIN "Order" o ON o."id" = i."orderId"
      WHERE ${TZ_LOCAL('i."issuedAt"')}::date BETWEEN $1::date AND $2::date
      ORDER BY i."issuedAt", i."number"`,
    fromDate,
    toDate,
  );
  const notes = await prisma.$queryRawUnsafe<{ number: string; d: string; orderId: string; inv: string; net: number; vat: number; total: number }[]>(
    `SELECT c."number", to_char(${TZ_LOCAL('c."issuedAt"')}, 'YYYY-MM-DD') AS d, i."orderId", i."number" AS inv,
            c."subtotalEur"::float8 AS net, c."vatEur"::float8 AS vat, c."totalEur"::float8 AS total
       FROM "CreditNote" c JOIN "Invoice" i ON i."id" = c."invoiceId"
      WHERE ${TZ_LOCAL('c."issuedAt"')}::date BETWEEN $1::date AND $2::date
      ORDER BY c."issuedAt", c."number"`,
    fromDate,
    toDate,
  );
  const { ORDER_STATUS_LABEL, isOrderStatus, orderRef } = await import("@/lib/order-status");
  const rows: LedgerRow[] = [
    ...invoices.map((r) => ({
      kind: "FACTUUR" as const,
      number: r.number,
      date: r.d,
      orderRef: orderRef(r.orderId),
      netEur: money(r.net),
      vatEur: money(r.vat),
      totalEur: money(r.total),
      status: isOrderStatus(r.status) ? ORDER_STATUS_LABEL[r.status] : r.status,
      refersTo: "",
    })),
    ...notes.map((r) => ({
      kind: "CREDITNOTA" as const,
      number: r.number,
      date: r.d,
      orderRef: orderRef(r.orderId),
      netEur: -money(r.net),
      vatEur: -money(r.vat),
      totalEur: -money(r.total),
      status: "Creditnota",
      refersTo: r.inv,
    })),
  ];
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number));
}

/** First and last day of a quarter (or the whole year when quarter is 0), as YYYY-MM-DD. */
export function periodDates(year: number, quarter: number): { from: string; to: string } {
  if (quarter < 1 || quarter > 4) return { from: `${year}-01-01`, to: `${year}-12-31` };
  const startMonth = (quarter - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  const lastDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
  const mm = (m: number) => String(m).padStart(2, "0");
  return { from: `${year}-${mm(startMonth)}-01`, to: `${year}-${mm(endMonth)}-${String(lastDay).padStart(2, "0")}` };
}

// ─── Subscriptions ────────────────────────────────────────────────────

export type SubscriptionStats = {
  active: number;
  trialing: number;
  pastDue: number;
  /** Monthly recurring revenue excl. VAT from ACTIVE subscriptions, computed from plans.ts prices. */
  mrrExVatEur: number;
  byPlan: Array<{ plan: PlanId; active: number; trialing: number; pastDue: number }>;
};

/** Monthly price excl. VAT: consumer plans are advertised incl. VAT, business plans excl. (see planPriceSuffix). */
export function planMonthlyExVat(plan: PlanId): number {
  const p = PLANS[plan];
  const price = p.priceCents / 100;
  return money(p.audience === "consumer" ? price / (1 + VAT_RATE) : price);
}

export async function subscriptionStats(): Promise<SubscriptionStats> {
  const groups = await prisma.user.groupBy({ by: ["plan", "stripeSubStatus"], where: { stripeSubStatus: { not: null } }, _count: { _all: true } });
  const byPlan = new Map<PlanId, { plan: PlanId; active: number; trialing: number; pastDue: number }>();
  let active = 0, trialing = 0, pastDue = 0, mrr = 0;
  for (const g of groups) {
    if (!(g.plan in PLANS) || g.plan === "FREE") continue;
    const plan = g.plan as PlanId;
    const row = byPlan.get(plan) ?? { plan, active: 0, trialing: 0, pastDue: 0 };
    const n = g._count._all;
    if (g.stripeSubStatus === "active") {
      row.active += n;
      active += n;
      mrr += n * planMonthlyExVat(plan);
    } else if (g.stripeSubStatus === "trialing") {
      row.trialing += n;
      trialing += n;
    } else if (g.stripeSubStatus === "past_due") {
      row.pastDue += n;
      pastDue += n;
    }
    byPlan.set(plan, row);
  }
  return { active, trialing, pastDue, mrrExVatEur: money(mrr), byPlan: [...byPlan.values()] };
}

// ─── Per-SKU contribution ─────────────────────────────────────────────

export type SkuContribution = {
  sku: string;
  name: string;
  priceExVatEur: number;
  costEur: number | null;
  basis: CostBasis;
  paymentFeeEur: number;
  /** Shipping paid by the customer (ex VAT) minus the carrier cost, for a one-unit order. */
  shippingNetEur: number;
  /** null when the cost is unknown. */
  contributionEur: number | null;
  negative: boolean;
};

/**
 * Contribution of selling ONE unit of a part as the only item of an order, after the
 * plan discount `discount` (0 for a normal customer, 0.15 for the Bedrijf plan):
 *   price ex VAT - cost - payment fee + shipping paid by the customer ex VAT - carrier cost.
 * Free shipping applies when the discounted price reaches SHIPPING.freeFromEur.
 */
export function skuContribution(
  part: { sku: string; name: string; priceEur: number; costEur: number | null; costSource: string | null },
  discount = 0,
  a: { paymentFeeFixedEur: number; paymentFeePercent: number; carrierCostEur: number } = ECONOMICS_ASSUMPTIONS,
): SkuContribution {
  const gross = money(part.priceEur * (1 - discount));
  const ship = shippingFor(gross);
  const paid = gross + ship;
  const priceEx = gross / (1 + VAT_RATE);
  const shipEx = ship / (1 + VAT_RATE);
  const fee = a.paymentFeeFixedEur + (a.paymentFeePercent / 100) * paid;
  const shippingNet = shipEx - a.carrierCostEur;
  const basis = costBasis(part);
  const contribution = part.costEur === null ? null : money(priceEx - part.costEur - fee + shippingNet);
  return {
    sku: part.sku,
    name: part.name,
    priceExVatEur: money(priceEx),
    costEur: part.costEur,
    basis,
    paymentFeeEur: money(fee),
    shippingNetEur: money(shippingNet),
    contributionEur: contribution,
    negative: contribution !== null && contribution < 0,
  };
}

export async function skuContributionTable(): Promise<Array<{ base: SkuContribution; atMaxDiscount: SkuContribution }>> {
  const parts = await prisma.part.findMany({ select: { sku: true, name: true, priceEur: true, costEur: true, costSource: true }, orderBy: { sku: "asc" } });
  const maxDiscount = Math.max(...Object.values(PLANS).map((p) => p.partsDiscount));
  return parts.map((p) => ({ base: skuContribution(p), atMaxDiscount: skuContribution(p, maxDiscount) }));
}

export { SHIPPING };
