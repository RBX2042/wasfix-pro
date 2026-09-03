/**
 * Invoicing for monteurs: turning a finished work order into an invoice the
 * monteur sends to their own customer.
 *
 * The seller here is the monteur, not WasFix, so this uses their business
 * identity and their own gapless number series — mixing the two series would
 * make both useless for bookkeeping.
 *
 * Labour prices a monteur quotes are entered including btw, matching how they
 * quote to consumers; the split is computed rather than added on top.
 */

import { prisma } from "./prisma";
import { isDatabaseConfigured } from "./env";
import { money, splitVatInclusive, type InvoiceParty, type InvoiceLine } from "./invoicing";
import { logger } from "./logger";

export type MonteurInvoice = {
  number: string;
  issuedAt: Date;
  dueAt: Date | null;
  seller: InvoiceParty;
  buyer: InvoiceParty;
  lines: InvoiceLine[];
  subtotalEur: number;
  vatRate: number;
  vatEur: number;
  totalEur: number;
  footer?: string;
};

/** A monteur cannot invoice before we know who they are. */
export type ProfileGap = { ok: false; missing: string[] };

export function profileGaps(profile: { companyName?: string | null; kvkNumber?: string | null; street?: string | null; postalCode?: string | null; city?: string | null } | null): string[] {
  if (!profile) return ["bedrijfsnaam", "KvK-nummer", "adres"];
  const missing: string[] = [];
  if (!profile.companyName?.trim()) missing.push("bedrijfsnaam");
  if (!profile.kvkNumber?.trim()) missing.push("KvK-nummer");
  if (!profile.street?.trim() || !profile.postalCode?.trim() || !profile.city?.trim()) missing.push("adres");
  return missing;
}

function formatNumber(year: number, seq: number): string {
  return `${year}-${String(seq).padStart(4, "0")}`;
}

/**
 * Issue (or return) the invoice for a work order. Idempotent, so opening the
 * page twice never allocates a second number.
 */
export async function issueWorkOrderInvoice(
  ownerId: string,
  workOrderId: string,
): Promise<{ ok: true; invoice: MonteurInvoice } | { ok: false; error: string; missing?: string[] }> {
  if (!isDatabaseConfigured()) return { ok: false, error: "Facturen vereisen een database." };

  try {
    const existing = await prisma.monteurInvoice.findUnique({ where: { workOrderId } });
    if (existing && existing.ownerId === ownerId) return { ok: true, invoice: deserialize(existing) };

    // Scoped by ownerId so a guessed id cannot invoice someone else's job.
    const workOrder = await prisma.workOrder.findFirst({
      where: { id: workOrderId, ownerId },
      include: { customer: true },
    });
    if (!workOrder) return { ok: false, error: "Werkorder niet gevonden." };
    if (workOrder.priceEur == null || workOrder.priceEur <= 0) {
      return { ok: false, error: "Vul eerst een bedrag in op de werkorder." };
    }

    const profile = await prisma.monteurProfile.findUnique({ where: { userId: ownerId } });
    const missing = profileGaps(profile);
    if (missing.length > 0) {
      return { ok: false, error: "Je bedrijfsgegevens zijn nog niet compleet.", missing };
    }

    const seller: InvoiceParty = {
      name: profile!.companyName,
      street: profile!.street ?? undefined,
      postalCode: profile!.postalCode ?? undefined,
      city: profile!.city ?? undefined,
      country: "Nederland",
      email: profile!.email ?? undefined,
      kvk: profile!.kvkNumber ?? undefined,
      vatNumber: profile!.vatNumber ?? undefined,
      iban: profile!.iban ?? undefined,
    };

    const customer = workOrder.customer;
    const buyer: InvoiceParty = {
      name: customer?.name ?? "Particulier",
      street: customer?.street ?? undefined,
      postalCode: customer?.postalCode ?? undefined,
      city: customer?.city ?? undefined,
      country: "Nederland",
      email: customer?.email ?? undefined,
    };

    const description = [
      workOrder.machine ? `Reparatie ${workOrder.machine}` : "Reparatie wasmachine",
      workOrder.errorCode ? `(foutcode ${workOrder.errorCode})` : "",
    ].filter(Boolean).join(" ");

    const lines: InvoiceLine[] = [{
      sku: workOrder.reference,
      name: `${description} — ${workOrder.problem}`,
      quantity: 1,
      unitPriceEur: money(workOrder.priceEur),
      lineTotalEur: money(workOrder.priceEur),
    }];

    const vat = splitVatInclusive(workOrder.priceEur, profile!.vatRate);
    const year = new Date().getFullYear();
    const dueAt = new Date(Date.now() + profile!.paymentTerms * 24 * 60 * 60 * 1000);

    // Number and row are written together: opening the invoice page twice in
    // parallel must not consume a number without producing an invoice.
    const created = await prisma.$transaction(async (tx) => {
      const already = await tx.monteurInvoice.findUnique({ where: { workOrderId: workOrder.id } });
      if (already) return already;
      const seqRow = await tx.monteurInvoiceSequence.upsert({
        where: { ownerId_year: { ownerId, year } },
        update: { last: { increment: 1 } },
        create: { ownerId, year, last: 1 },
      });
      return tx.monteurInvoice.create({
      data: {
        ownerId,
        workOrderId: workOrder.id,
        number: formatNumber(year, seqRow.last),
        year,
        dueAt,
        subtotalEur: vat.totalEur,
        vatRate: vat.vatRate,
        vatEur: vat.vatEur,
        totalEur: vat.totalEur,
        sellerJson: JSON.stringify({ ...seller, footer: profile!.invoiceFooter ?? undefined }),
        buyerJson: JSON.stringify(buyer),
        linesJson: JSON.stringify(lines),
      },
      });
    });

    logger.info("[monteur-invoicing] invoice issued", { number: created.number, workOrderId, ownerId });
    return { ok: true, invoice: deserialize(created) };
  } catch (err) {
    const raced = await prisma.monteurInvoice.findUnique({ where: { workOrderId } }).catch(() => null);
    if (raced && raced.ownerId === ownerId) return { ok: true, invoice: deserialize(raced) };
    logger.error("[monteur-invoicing] could not issue invoice", err);
    return { ok: false, error: "Factuur kon niet worden aangemaakt." };
  }
}

export async function getWorkOrderInvoice(ownerId: string, workOrderId: string): Promise<MonteurInvoice | null> {
  if (!isDatabaseConfigured()) return null;
  try {
    const row = await prisma.monteurInvoice.findUnique({ where: { workOrderId } });
    return row && row.ownerId === ownerId ? deserialize(row) : null;
  } catch {
    return null;
  }
}

type Row = {
  number: string;
  issuedAt: Date;
  dueAt: Date | null;
  subtotalEur: number;
  vatRate: number;
  vatEur: number;
  totalEur: number;
  sellerJson: string;
  buyerJson: string;
  linesJson: string;
};

function deserialize(row: Row): MonteurInvoice {
  const seller = safeJson<InvoiceParty & { footer?: string }>(row.sellerJson) ?? { name: "Onbekend" };
  return {
    number: row.number,
    issuedAt: row.issuedAt,
    dueAt: row.dueAt,
    seller,
    buyer: safeJson<InvoiceParty>(row.buyerJson) ?? { name: "Onbekend" },
    lines: safeJson<InvoiceLine[]>(row.linesJson) ?? [],
    subtotalEur: row.subtotalEur,
    vatRate: row.vatRate,
    vatEur: row.vatEur,
    totalEur: row.totalEur,
    footer: seller.footer,
  };
}

function safeJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
