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

/**
 * Allocate the next gapless invoice number for the year, inside a transaction
 * so two concurrent orders can never receive the same number.
 */
async function nextInvoiceNumber(year: number): Promise<{ number: string; seq: number }> {
  const seq = await prisma.$transaction(async (tx) => {
    const row = await tx.invoiceSequence.upsert({
      where: { year },
      update: { last: { increment: 1 } },
      create: { year, last: 1 },
    });
    return row.last;
  });
  return { number: `${year}-${String(seq).padStart(5, "0")}`, seq };
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

    const { number } = await nextInvoiceNumber(new Date().getFullYear());
    const seller = sellerParty();

    const created = await prisma.invoice.create({
      data: {
        number,
        year: new Date().getFullYear(),
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

    logger.info("[invoicing] invoice issued", { number, orderId });
    return deserializeInvoice(created);
  } catch (err) {
    logger.error("[invoicing] could not issue invoice", err);
    return null;
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
