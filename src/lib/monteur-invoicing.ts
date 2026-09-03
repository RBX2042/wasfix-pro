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

export function profileGaps(profile: { companyName?: string | null; kvkNumber?: string | null; vatNumber?: string | null; street?: string | null; postalCode?: string | null; city?: string | null; vatRate?: number | null; invoiceFooter?: string | null } | null): string[] {
  if (!profile) return ["bedrijfsnaam", "KvK-nummer", "btw-nummer", "adres"];
  const missing: string[] = [];
  if (!profile.companyName?.trim()) missing.push("bedrijfsnaam");
  if (!profile.kvkNumber?.trim()) missing.push("KvK-nummer");
  // Art. 35a Wet OB: an invoice charging btw must carry the supplier's
  // btw-identificatienummer, otherwise a business customer cannot deduct that
  // btw. At 0% (kleineondernemersregeling) the reason for the exemption takes
  // its place; the footer is the only free text that reaches the invoice.
  const vatRate = profile.vatRate ?? 0.21;
  if (vatRate > 0) {
    if (!profile.vatNumber?.trim()) missing.push("btw-nummer");
  } else if (!profile.invoiceFooter?.trim()) {
    missing.push("reden van de btw-vrijstelling (voettekst op de factuur)");
  }
  if (!profile.street?.trim() || !profile.postalCode?.trim() || !profile.city?.trim()) missing.push("adres");
  return missing;
}

function formatNumber(year: number, seq: number): string {
  return `${year}-${String(seq).padStart(4, "0")}`;
}

type Clock = { year: number; month: number; day: number; hour: number; minute: number; second: number };

/**
 * The wall clock in Amsterdam at a given instant, or null on a runtime without
 * the tz database — there the formatter *constructor* throws, so the callers
 * below degrade to UTC instead of failing the invoice altogether.
 */
function amsterdamClock(at: Date): Clock | null {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Amsterdam",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(at);
    const value = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const clock: Clock = {
      year: value("year"), month: value("month"), day: value("day"),
      hour: value("hour"), minute: value("minute"), second: value("second"),
    };
    return Object.values(clock).every((n) => Number.isFinite(n)) ? clock : null;
  } catch {
    return null;
  }
}

/**
 * The year as it stands on the Dutch calendar. Between 00:00 and 01:00 CET on
 * 1 January the server clock (UTC) is still in the old year, which would file
 * the invoice in the previous number series and in the wrong btw-aangifte.
 */
function amsterdamYear(at: Date): number {
  return amsterdamClock(at)?.year ?? at.getUTCFullYear();
}

/** Amsterdam's offset from UTC at that instant: +1h in winter, +2h in summer. */
function amsterdamOffsetMs(at: Date): number {
  const clock = amsterdamClock(at);
  if (!clock) return 0;
  const wall = Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute, clock.second);
  return wall - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * A payment term is a number of calendar days, not of 24-hour blocks: across
 * the DST switch a fixed offset shifts the Dutch wall clock by an hour, which
 * prints the due date a day early in spring and a day late in autumn. Correct
 * for the offset difference so the term ends at the time of day it started.
 */
function addDaysInAmsterdam(at: Date, days: number): Date {
  const naive = new Date(at.getTime() + days * 24 * 60 * 60 * 1000);
  return new Date(naive.getTime() + (amsterdamOffsetMs(at) - amsterdamOffsetMs(naive)));
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
    // One instant for the number, the date and the term: the year on the
    // invoice must be the year its number was taken from.
    const issuedAt = new Date();
    const year = amsterdamYear(issuedAt);
    const dueAt = addDaysInAmsterdam(issuedAt, profile!.paymentTerms);

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
        issuedAt,
        dueAt,
        subtotalEur: vat.exVatEur,
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
    // Rows written before subtotalEur meant "net" stored the gross in that
    // column, and nothing distinguishes them. Total minus btw is the net on
    // every row, old and new, so derive it instead of trusting the column.
    subtotalEur: money(row.totalEur - row.vatEur),
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
