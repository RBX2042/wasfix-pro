/**
 * VAT math and invoice issuing.
 *
 * Catalog prices are shown to consumers including 21% BTW, which is what NL
 * price-display rules require and what the terms already state. The VAT is
 * therefore *contained in* the total, not added on top: charging customers
 * more than the displayed price would be the wrong fix. What was missing was
 * the accounting — an order stored one number and no invoice existed at all,
 * while an invoice with a VAT specification is legally required and must be
 * kept for 7 years.
 */

import { prisma } from "./prisma";
import { isDatabaseConfigured } from "./env";
import { COMPANY, VAT_RATE } from "./plans";
import { logger } from "./logger";

/** Round to whole cents, avoiding float drift like 12.340000000000002. */
export function money(value: number): number {
  return Math.round(value * 100) / 100;
}

export type VatBreakdown = {
  /** What the customer pays, VAT included. */
  totalEur: number;
  /** VAT contained in the total. */
  vatEur: number;
  /** Total minus VAT. */
  exVatEur: number;
  vatRate: number;
};

/** Split a VAT-inclusive amount into net and VAT. */
export function splitVatInclusive(totalInclVat: number, rate: number = VAT_RATE): VatBreakdown {
  const total = money(totalInclVat);
  const vat = money(total * (rate / (1 + rate)));
  return { totalEur: total, vatEur: vat, exVatEur: money(total - vat), vatRate: rate };
}

export type InvoiceLine = {
  sku: string;
  name: string;
  quantity: number;
  unitPriceEur: number;
  lineTotalEur: number;
};

export type InvoiceParty = {
  name: string;
  street?: string;
  postalCode?: string;
  city?: string;
  country?: string;
  email?: string;
  kvk?: string;
  vatNumber?: string;
  iban?: string;
};

export type IssuedInvoice = {
  number: string;
  issuedAt: Date;
  seller: InvoiceParty;
  buyer: InvoiceParty;
  lines: InvoiceLine[];
  subtotalEur: number;
  discountEur: number;
  shippingEur: number;
  vatRate: number;
  vatEur: number;
  totalEur: number;
};

function sellerParty(): InvoiceParty {
  return {
    name: COMPANY.name,
    street: COMPANY.street,
    postalCode: COMPANY.postalCode,
    city: COMPANY.city,
    country: COMPANY.country,
    email: COMPANY.email,
    kvk: COMPANY.kvk,
    vatNumber: COMPANY.vatNumber,
    iban: COMPANY.iban,
  };
}

function formatInvoiceNumber(year: number, seq: number): string {
  return `${year}-${String(seq).padStart(5, "0")}`;
}

/**
 * Issue the invoice for a paid order. Idempotent: an order that already has an
 * invoice returns the existing one, so a replayed Stripe webhook never burns a
 * second number.
 */
export async function issueInvoiceForOrder(orderId: string): Promise<IssuedInvoice | null> {
  if (!isDatabaseConfigured()) return null;

  try {
    const existing = await prisma.invoice.findUnique({ where: { orderId } });
    if (existing) return deserializeInvoice(existing);

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { part: true } } },
    });
    if (!order) return null;


    const address = safeJson<{ name?: string; street?: string; houseNumber?: string; postalCode?: string; city?: string; country?: string }>(
      order.shippingAddress,
    );

    const lines: InvoiceLine[] = order.items.map((it) => ({
      sku: it.part.sku,
      name: it.part.name,
      quantity: it.quantity,
      unitPriceEur: money(it.unitPrice),
      lineTotalEur: money(it.unitPrice * it.quantity),
    }));

    const buyer: InvoiceParty = {
      name: address?.name ?? order.email,
      street: [address?.street, address?.houseNumber].filter(Boolean).join(" ") || undefined,
      postalCode: address?.postalCode,
      city: address?.city,
      country: address?.country ?? "NL",
      email: order.email,
      vatNumber: order.vatNumber ?? undefined,
    };

    const seller = sellerParty();
    const year = new Date().getFullYear();

    // Allocate the number and write the invoice in ONE transaction. Doing the
    // allocation first and the insert after meant a losing race consumed a
    // number and then failed on the unique orderId, leaving a permanent hole
    // in a series the Belastingdienst requires to be gapless.
    const created = await prisma.$transaction(async (tx) => {
      const already = await tx.invoice.findUnique({ where: { orderId: order.id } });
      if (already) return already;
      const seqRow = await tx.invoiceSequence.upsert({
        where: { year },
        update: { last: { increment: 1 } },
        create: { year, last: 1 },
      });
      return tx.invoice.create({
      data: {
        number: formatInvoiceNumber(year, seqRow.last),
        year,
        orderId: order.id,
        subtotalEur: order.subtotalEur,
        discountEur: order.discountEur,
        shippingEur: order.shippingEur,
        vatRate: order.vatRate,
        vatEur: order.vatEur,
        totalEur: order.totalEur,
        sellerJson: JSON.stringify(seller),
        buyerJson: JSON.stringify(buyer),
        linesJson: JSON.stringify(lines),
      },
      });
    });

    logger.info("[invoicing] invoice issued", { number: created.number, orderId });
    return deserializeInvoice(created);
  } catch (err) {
    // A concurrent writer may have won the race; return their invoice rather
    // than reporting failure.
    const raced = await prisma.invoice.findUnique({ where: { orderId } }).catch(() => null);
    if (raced) return deserializeInvoice(raced);
    logger.error("[invoicing] could not issue invoice", err);
    throw err instanceof Error ? err : new Error("invoice_failed");
  }
}

/**
 * Confirms a bank-transfer order has been paid (admin action, once the wire
 * arrives — there is no bank feed to detect this automatically). Idempotent:
 * an already-paid order is left as-is rather than double-decrementing stock
 * or re-sending a confirmation.
 *
 * The status transition IS the claim. findUnique + `if PAID return` + an
 * unconditional update was not: the expiry sweep in the checkout route
 * (releaseExpiredBankTransferOrders) cancels the order and puts its units back
 * on the shelf, and this then flipped CANCELLED -> PAID afterwards without
 * re-taking them — a shipped order against stock that may already be sold.
 *
 * A wire landing after the sweep is routine (14 days term + 7 days grace, paid
 * on day 22), so it is confirmed rather than refused — but the units have to be
 * taken off the shelf again first, with the same conditional decrement checkout
 * uses. If one is gone the whole confirmation is rolled back and reported, so
 * the money is reconciled by hand instead of a part being promised twice.
 */
export async function markOrderPaidByBankTransfer(orderId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: "Database niet beschikbaar." };
  try {
    return await prisma.$transaction(async (tx) => {
      const claimed = await tx.order.updateMany({
        where: { id: orderId, status: "OPENSTAAND", paymentMethod: "BANK_TRANSFER" },
        data: { status: "PAID", paidAt: new Date() },
      });
      if (claimed.count > 0) {
        // The order was still open, so its stock is still reserved from the
        // moment the invoice went out. Nothing to move.
        logger.info("[invoicing] bank-transfer order marked paid", { orderId });
        return { ok: true };
      }

      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: { status: true, paymentMethod: true, items: { select: { partId: true, quantity: true } } },
      });
      if (!order) return { ok: false, error: "Bestelling niet gevonden." };
      if (order.paymentMethod !== "BANK_TRANSFER") {
        return { ok: false, error: "Deze bestelling loopt niet via een factuur." };
      }
      if (order.status === "PAID") return { ok: true };
      if (order.status !== "CANCELLED") {
        return { ok: false, error: `Bestelling staat op ${order.status} en kan niet op betaald worden gezet.` };
      }

      const revived = await tx.order.updateMany({
        where: { id: orderId, status: "CANCELLED" },
        data: { status: "PAID", paidAt: new Date() },
      });
      if (revived.count === 0) {
        return { ok: false, error: "Bestelling is zojuist gewijzigd. Probeer het opnieuw." };
      }
      for (const item of order.items) {
        const retaken = await tx.part.updateMany({
          where: { id: item.partId, stock: { gte: item.quantity } },
          data: { stock: { decrement: item.quantity } },
        });
        // Throwing rolls the revival above back with it — either the order is
        // PAID with its stock, or it stays CANCELLED.
        if (retaken.count === 0) throw new Error(`out_of_stock:${item.partId}`);
      }
      logger.warn("[invoicing] late payment on a cancelled bank-transfer order — reinstated and stock re-taken", { orderId });
      return { ok: true };
    });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("out_of_stock:")) {
      logger.error("[invoicing] late payment on a cancelled order, but its stock is sold — not reinstated", {
        orderId,
        partId: err.message.slice("out_of_stock:".length),
      });
      return {
        ok: false,
        error: "De voorraad van deze geannuleerde bestelling is inmiddels verkocht. Boek de betaling handmatig af (creditnota of terugbetaling).",
      };
    }
    logger.error("[invoicing] could not mark order paid", err);
    return { ok: false, error: "Kon bestelling niet als betaald markeren." };
  }
}

export async function getInvoiceForOrder(orderId: string): Promise<IssuedInvoice | null> {
  if (!isDatabaseConfigured()) return null;
  try {
    const row = await prisma.invoice.findUnique({ where: { orderId } });
    return row ? deserializeInvoice(row) : null;
  } catch {
    return null;
  }
}

type InvoiceRow = {
  number: string;
  issuedAt: Date;
  subtotalEur: number;
  discountEur: number;
  shippingEur: number;
  vatRate: number;
  vatEur: number;
  totalEur: number;
  sellerJson: string;
  buyerJson: string;
  linesJson: string;
};

function deserializeInvoice(row: InvoiceRow): IssuedInvoice {
  return {
    number: row.number,
    issuedAt: row.issuedAt,
    seller: safeJson<InvoiceParty>(row.sellerJson) ?? sellerParty(),
    buyer: safeJson<InvoiceParty>(row.buyerJson) ?? { name: "Onbekend" },
    lines: safeJson<InvoiceLine[]>(row.linesJson) ?? [],
    subtotalEur: row.subtotalEur,
    discountEur: row.discountEur,
    shippingEur: row.shippingEur,
    vatRate: row.vatRate,
    vatEur: row.vatEur,
    totalEur: row.totalEur,
  };
}

function safeJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
