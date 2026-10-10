/**
 * VAT math, invoices, credit notes and the order lifecycle.
 *
 * Catalog prices are shown to consumers including 21% BTW, which is what NL
 * price-display rules require and what the terms already state. The VAT is
 * therefore *contained in* the total, not added on top: charging customers
 * more than the displayed price would be the wrong fix. What was missing was
 * the accounting — an order stored one number and no invoice existed at all,
 * while an invoice with a VAT specification is legally required and must be
 * kept for 7 years.
 *
 * CONTRACT (state is defined in ./order-status; every status transition below
 * is a conditional update, `updateMany` with the expected status in the WHERE
 * and a check for count === 0, so concurrent calls cannot both win)
 *
 * REPLAY SAFETY, exactly: cancelOrder, markOrderShipped, markOrderDelivered and
 * markOrderPaidByBankTransfer are idempotent on their own (the status is the
 * claim). A refund is not a status change, so a PARTIAL refund is idempotent
 * only when the caller supplies one of: `stripeRefundId` (Stripe's id; a replayed
 * webhook returns the same note), `idempotencyKey` (a key per form render; a
 * double submit returns the same note), or `expectedRefundedEur` (the
 * refundedEur the caller saw; a second submit finds it changed and is refused as
 * a conflict). A partial refund called twice with none of the three books two
 * credit notes, by design: two refunds of the same amount are legitimate.
 *
 *   Invoices
 *     issueInvoiceForOrder(orderId, tx?)      -> IssuedInvoice | null; throws CompanyNotReadyError in
 *                                                production while the company identity is incomplete
 *     getInvoiceForOrder(orderId)             -> IssuedInvoice | null
 *     splitVatInclusive, money, amsterdamYear helpers
 *     invoicingBlockedReason(opts?)           -> {missing} | null
 *   Credit notes (never edit or delete an invoice; see the sign convention below)
 *     issueCreditNote(invoiceId, {amountEur?, reason, stripeRefundId?, idempotencyKey?}, tx?) -> IssuedCreditNote; throws OrderDomainError
 *     setCreditNoteStripeRefund(creditNoteId, stripeRefundId)                -> boolean
 *     getCreditNotesForOrder(orderId)                                        -> IssuedCreditNote[]
 *   Lifecycle (results are {ok:true,...} | {ok:false, code, error}; they do not throw)
 *     cancelOrder(orderId, {reason, actor, onlyFrom?, stripeRefundId?, notifyCustomer?, customerReason?}) -> CancelOrderResult
 *     markOrderShipped(orderId, {carrier, trackingCode})                     -> ShipResult
 *     updateOrderTracking(orderId, {carrier, trackingCode, resendEmail?})    -> ShipResult
 *     markOrderDelivered(orderId)                                            -> DeliverResult
 *     recordRefund(orderId, {amountEur, stripeRefundId?, idempotencyKey?, expectedRefundedEur?, reason?, restock?, notifyCustomer?}) -> RecordRefundResult
 *     markOrderPaidByBankTransfer(orderId, {receivedAmountEur?}?)            -> MarkPaidResult; THROWS AmountMismatchError
 *                                                                              (OPENSTAAND -> PAID only; a wire for a CANCELLED order is refused, see D14 below)
 *     restockedByPart(orderId), restockedOfItems(items)                     -> Map<partId, units> put back on the shelf through refunds (OrderItem.restockedQty)
 *     checkRestock(db, order, restock)                                       -> Dutch refusal | null (shipped goods only, capped by ordered minus already restocked)
 *     applyRestock(t, order, restock)                                        -> units put back; the conditional update on OrderItem.restockedQty is the cap AND the lock
 *     stripLegacyRestock(linesJson)                                          legacy: notes issued before migration 20261009120000 carried the record on their lines
 *     isQuietCancellation(outcome, actor)                                    the one rule for "an abandoned order is not news" (no owner notice)
 *   Notices (never throw; call after the commit, from the path that won the claim)
 *     notifyOrderPlaced(orderId)              owner: new order
 *     notifyOrderPaid(orderId, "stripe" | "bank_transfer", {ownerNotice?}) customer mail + owner notice -> {emailSent}
 *   Margin (only QUOTE costs count; the rest is labelled "schatting")
 *     costBasis(part) -> QUOTE | ESTIMATE | UNKNOWN;  computeMargin(lines, vatRate?) -> {confirmed, estimated, unknownLines, label}
 *     computeOrderMargin({items, discountEur, vatRate?}) -> same; spreads the order discount over the lines first
 *   Company
 *     warnAboutUnrealCompany()                once per process, production only: tells the owner when readiness reports test values
 *   Guest access
 *     newAccessToken()                        for Order.accessToken on every new order
 *     orderAccessOk({accessToken}, token)     constant-time; only ONE of three ways in
 *     orderUrlFor({id, accessToken})          absolute /bestelling/<id>?t=<token>
 *   Errors: OrderDomainError(code), AmountMismatchError, CompanyNotReadyError
 *
 * CANCEL GUARD (`onlyFrom`). A caller that decided to cancel from a LIST (the
 * expiry sweep read "overdue and still OPENSTAAND", a Stripe event says "this
 * session expired") passes the statuses it based that decision on. The guard is
 * checked inside the transaction, and the claiming update's WHERE carries the
 * status that was read, so an order that was marked paid in between is NOT
 * cancelled: the call returns {ok:false, code:"conflict"}. Without the guard the
 * sweep cancelled an order the owner had marked paid a moment earlier, credited
 * it and owed the customer a refund for goods that were about to ship.
 *
 * LATE WIRES (decision D14, terms 7.1). A bank wire that arrives after the order
 * was cancelled is NOT revived: an unpaid order is cancelled together with a
 * credit note for its invoice, the units go back on the shelf and may be sold
 * to someone else, so the payment is paid back or the customer orders again.
 * markOrderPaidByBankTransfer refuses a CANCELLED order and says so.
 *
 * CREDIT NOTE SIGN CONVENTION: amounts on a credit note are positive
 * magnitudes (what is credited); the document prints them with a minus sign;
 * in the books they count negative. See the comment on IssuedCreditNote.
 */

import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { env, isDatabaseConfigured } from "./env";
import { COMPANY, VAT_RATE, companyReadiness } from "./plans";
import { logger } from "./logger";
import { canTransition, customerOrderUrl, holdsStock, orderRef, statusesThatCanGo, type OrderStatus } from "./order-status";
import { notifyOwner } from "./notify";
import { normaliseCarrier } from "./emails/tracking";
import { eurNl } from "./emails/money";

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
  /**
   * LEGACY, never printed and never written since migration
   * 20261009120000_order_item_restocked_qty: credit notes issued before it
   * recorded here which units of the refund went back on the shelf. The record
   * now lives on OrderItem.restockedQty (that migration backfilled it). Old
   * notes keep the annotation, because an issued document is immutable; the
   * data export strips it (stripLegacyRestock) and nothing else reads it.
   */
  restock?: RestockLine[];
};

export type RestockLine = { partId: string; quantity: number };

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
 * The year as it stands on the Dutch calendar.
 *
 * Between 00:00 and 01:00 CET on 1 January the server clock (UTC) is still in
 * the old year, so an invoice issued then would take a number from the
 * previous series and be filed in the wrong btw-aangifte. Lives here rather
 * than in monteur-invoicing because both series need it and they must not
 * disagree about which year it is.
 */
export function amsterdamYear(at: Date): number {
  try {
    const year = Number(
      new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam", year: "numeric" })
        .formatToParts(at)
        .find((p) => p.type === "year")?.value
    );
    return Number.isFinite(year) ? year : at.getUTCFullYear();
  } catch {
    // A runtime without the tz database: the UTC year is wrong for one hour a
    // year, which beats refusing to invoice at all.
    return at.getUTCFullYear();
  }
}

/** The subset of PrismaClient this module needs, so a caller can hand us its
 *  own interactive transaction instead of us opening a second one. */
type InvoiceTx = Pick<typeof prisma, "invoice" | "order" | "invoiceSequence">;

/**
 * Issue the invoice for a paid order. Idempotent: an order that already has an
 * invoice returns the existing one, so a replayed Stripe webhook never burns a
 * second number.
 *
 * Pass `tx` to join a transaction the caller already opened. Without it this
 * opens its own, which is right for the webhook but wrong for the GDPR
 * erasure: issuing outside that transaction created a permanent invoice
 * carrying the customer's name and address even when the erasure then rolled
 * back, while the caller was told nothing had happened.
 */
export async function issueInvoiceForOrder(orderId: string, tx?: InvoiceTx): Promise<IssuedInvoice | null> {
  if (!isDatabaseConfigured()) return null;
  const db = tx ?? prisma;

  try {
    const existing = await db.invoice.findUnique({ where: { orderId } });
    if (existing) return deserializeInvoice(existing);

    const order = await db.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { part: true } } },
    });
    if (!order) return null;

    // A partial company configuration must never produce an invoice: the seller
    // snapshot is permanent and the number series is gapless, so an invoice
    // with a placeholder btw-nummer or IBAN can only be undone with a credit
    // note. Outside production the development fallbacks are allowed, so demo
    // and CI keep working.
    const blocked = invoicingBlockedReason();
    if (blocked) throw new CompanyNotReadyError(blocked.missing);
    // Ready is not the same as real: the CI/sandbox numbers are well-formed. Say
    // so to the owner (once per process) instead of invoicing in silence.
    void warnAboutUnrealCompany();

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
    // Same Dutch-calendar year the monteur series uses. On the server's UTC
    // clock an invoice issued at 00:30 CET on 1 January took a number from the
    // previous year's series and landed in the wrong btw-aangifte — the
    // monteur series was corrected for this and the webshop series was not.
    const year = amsterdamYear(new Date());

    // Allocate the number and write the invoice in ONE transaction. Doing the
    // allocation first and the insert after meant a losing race consumed a
    // number and then failed on the unique orderId, leaving a permanent hole
    // in a series the Belastingdienst requires to be gapless. A caller's own
    // transaction serialises this just as well, so we reuse it when given one.
    const allocate = async (t: InvoiceTx) => {
      const already = await t.invoice.findUnique({ where: { orderId: order.id } });
      if (already) return already;
      const seqRow = await t.invoiceSequence.upsert({
        where: { year },
        update: { last: { increment: 1 } },
        create: { year, last: 1 },
      });
      return t.invoice.create({
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
    };
    const created = tx ? await allocate(tx) : await prisma.$transaction((t) => allocate(t));

    logger.info("[invoicing] invoice issued", { number: created.number, orderId });
    return deserializeInvoice(created);
  } catch (err) {
    // Inside a caller's transaction there is nothing to recover: that
    // transaction is already aborted, so every further query on it fails and
    // the caller has to decide what a failure means. Rethrow and let it.
    if (tx) {
      logger.error("[invoicing] could not issue invoice inside caller transaction", err);
      throw err instanceof Error ? err : new Error("invoice_failed");
    }
    // A concurrent writer may have won the race; return their invoice rather
    // than reporting failure.
    const raced = await prisma.invoice.findUnique({ where: { orderId } }).catch(() => null);
    if (raced) return deserializeInvoice(raced);
    logger.error("[invoicing] could not issue invoice", err);
    throw err instanceof Error ? err : new Error("invoice_failed");
  }
}

// ─── Errors and shared types ──────────────────────────────────────────

export type OrderErrorCode =
  | "not_found"
  | "db_unavailable"
  | "not_cancellable"
  | "illegal_transition"
  | "conflict"
  | "invalid_input"
  | "wrong_payment_method"
  | "has_credit_note"
  | "out_of_stock"
  | "no_invoice"
  | "invalid_amount"
  | "exceeds_invoice"
  | "company_not_ready"
  | "db_error";

/** A refusal that is part of the domain (not a crash). Carries a stable code. */
export class OrderDomainError extends Error {
  readonly code: OrderErrorCode;
  constructor(code: OrderErrorCode, message: string) {
    super(message);
    this.name = "OrderDomainError";
    this.code = code;
  }
}

/**
 * Thrown by markOrderPaidByBankTransfer when a supplied amount differs from the
 * order total by even one cent. Nothing has been changed when this is thrown.
 */
export class AmountMismatchError extends OrderDomainError {
  readonly expectedEur: number;
  readonly receivedEur: number;
  constructor(expectedEur: number, receivedEur: number) {
    super(
      "invalid_amount",
      `Ontvangen bedrag ${eurNl(receivedEur)} komt niet overeen met het factuurbedrag ${eurNl(expectedEur)}.`,
    );
    this.name = "AmountMismatchError";
    this.expectedEur = expectedEur;
    this.receivedEur = receivedEur;
  }
}

/** Thrown instead of issuing an invoice while the company identity is incomplete in production. */
export class CompanyNotReadyError extends OrderDomainError {
  readonly missing: string[];
  constructor(missing: string[]) {
    super("company_not_ready", `Bedrijfsgegevens zijn niet compleet (${missing.join(", ")}); er wordt geen factuur uitgegeven.`);
    this.name = "CompanyNotReadyError";
    this.missing = missing;
  }
}

export type OrderOpFail = { ok: false; code: OrderErrorCode; error: string };

/** Who triggered a state change. Goes to the audit log and the owner notification. */
export type OrderActor = "admin" | "customer" | "system" | "stripe";

const centsOf = (eur: number) => Math.round(eur * 100);

/** Why invoicing is blocked right now, or null when it may proceed. Exported for tests and preflight. */
export function invoicingBlockedReason(
  opts: { isProduction?: boolean; readiness?: { ready: boolean; missing: string[] } } = {},
): { missing: string[] } | null {
  const isProduction = opts.isProduction ?? env.IS_PRODUCTION;
  if (!isProduction) return null;
  const readiness = opts.readiness ?? companyReadiness();
  return readiness.ready ? null : { missing: readiness.missing };
}

let warnedUnrealCompany = false;

/** For tests only. */
export function _resetCompanyWarningForTests(): void {
  warnedUnrealCompany = false;
}

/**
 * In production, tell the owner (log + notifyOwner, once per process) when the
 * company identity passes the format checks but contains a known test or
 * documentation number, or has no COMPANY_EMAIL. companyReadiness() reports
 * those as `warnings` rather than blocking, because CI builds production with
 * the test numbers; without this nothing read the warnings and a deploy that
 * kept them invoiced real customers with a test IBAN, silently. Never throws.
 */
export async function warnAboutUnrealCompany(): Promise<void> {
  try {
    if (!env.IS_PRODUCTION || warnedUnrealCompany) return;
    const { warnings } = companyReadiness();
    if (warnings.length === 0) return;
    warnedUnrealCompany = true;
    logger.warn("[invoicing] company identity looks like test or incomplete data", { warnings });
    await ping({
      event: "company.unreal_identity",
      level: "warn",
      title: "Bedrijfsgegevens zien er niet echt uit",
      lines: [...warnings, "Facturen en betaalinstructies gebruiken deze waarden. Controleer de COMPANY_* variabelen."],
    });
  } catch {
    // A warning must never break an invoice.
  }
}

// ─── Guest access token ───────────────────────────────────────────────

/** A fresh Order.accessToken: 48 hex characters from 24 random bytes. Never log it. */
export function newAccessToken(): string {
  return randomBytes(24).toString("hex");
}

/**
 * Does `token` open this order? Compares SHA-256 digests with timingSafeEqual,
 * so the comparison time does not depend on how many leading characters match
 * or on the token's length. An order without a token (a row that predates the
 * column) or an empty/missing presented token never matches.
 *
 * This is only one of three ways in. The page must also accept the signed-in
 * owner and an admin; this helper knows nothing about sessions.
 */
export function orderAccessOk(order: { accessToken?: string | null }, token: string | null | undefined): boolean {
  if (!order.accessToken || !token) return false;
  const a = createHash("sha256").update(order.accessToken).digest();
  const b = createHash("sha256").update(token).digest();
  return timingSafeEqual(a, b);
}

/** Absolute customer link for an order, with the guest token. See customerOrderUrl. */
export function orderUrlFor(order: { id: string; accessToken?: string | null }): string {
  return customerOrderUrl(order.id, order.accessToken);
}

// ─── Credit notes ─────────────────────────────────────────────────────

/**
 * CREDIT NOTE SIGN CONVENTION. Every amount on a credit note is a positive
 * magnitude: the amount that is credited. The printed document shows it with a
 * minus sign; in the books it counts negative:
 *
 *   revenue incl. VAT = sum(Invoice.totalEur)  - sum(CreditNote.totalEur)
 *   VAT payable       = sum(Invoice.vatEur)    - sum(CreditNote.vatEur)
 *
 * `totalEur` is gross (VAT included), `vatEur` the VAT contained in it and
 * `subtotalEur` the net amount (totalEur - vatEur). Once credit notes add up to
 * the invoice total they also add up to the invoice VAT to the cent: the note
 * that completes the credit takes the remaining VAT instead of rounding again.
 */
export type IssuedCreditNote = {
  id: string;
  /** "CN-2026-00001" */
  number: string;
  issuedAt: Date;
  invoiceId: string;
  invoiceNumber: string;
  reason: string;
  seller: InvoiceParty;
  buyer: InvoiceParty;
  lines: InvoiceLine[];
  subtotalEur: number;
  vatRate: number;
  vatEur: number;
  totalEur: number;
  stripeRefundId: string | null;
  /** True when this call found an existing note instead of creating one. */
  replayed: boolean;
};

export type CreditNoteInput = {
  /** Gross amount to credit, VAT included. Omitted = everything still uncredited. */
  amountEur?: number;
  /** Free text, stored on the note. */
  reason: string;
  /** Makes the call idempotent: the same refund id returns the same note. */
  stripeRefundId?: string | null;
  /** Same for a refund that has no Stripe id (bank transfer): the same key returns the same note. Max 100 characters. */
  idempotencyKey?: string | null;
};

/**
 * VAT and net amount of one credit note. Pure, so the arithmetic can be tested
 * exhaustively. A partial note takes the difference between the VAT of the
 * cumulative credited amount before and after it, so the VAT of consecutive
 * notes can never be negative (VAT of a running total only grows); the note
 * that completes the credit takes whatever VAT of the invoice is left, so all
 * notes add up to the invoice's VAT to the cent. Both are clamped to
 * [0, amount] as a last guard against an invoice whose stored VAT was not
 * computed by splitVatInclusive.
 */
export function creditNoteVat(p: {
  invoiceTotalCents: number;
  invoiceVatEur: number;
  priorCents: number;
  priorVatEur: number;
  amountCents: number;
  vatRate: number;
}): { vatEur: number; subtotalEur: number } {
  const amount = p.amountCents / 100;
  const completes = p.priorCents + p.amountCents === p.invoiceTotalCents;
  const raw = completes
    ? money(p.invoiceVatEur - p.priorVatEur)
    : money(
        splitVatInclusive((p.priorCents + p.amountCents) / 100, p.vatRate).vatEur - splitVatInclusive(p.priorCents / 100, p.vatRate).vatEur,
      );
  const vatEur = Math.min(Math.max(raw, 0), amount);
  return { vatEur, subtotalEur: money(amount - vatEur) };
}

type Tx = Prisma.TransactionClient;
/**
 * A transaction client and NOTHING else. `Prisma.TransactionClient` is an Omit
 * of the full client, so structurally the bare `prisma` satisfies it and a
 * `t: Tx` parameter does not stop a caller from passing it. The bare client
 * has `$transaction`; this type forbids that property, so `applyRestock(prisma,
 * ...)` does not compile while the `t` of `prisma.$transaction((t) => ...)`
 * (which has no `$transaction`) does.
 */
type TxOnly = Tx & { $transaction?: never };

function formatCreditNoteNumber(year: number, seq: number): string {
  return `CN-${year}-${String(seq).padStart(5, "0")}`;
}

/**
 * Next number in the year's credit-note series. One INSERT .. ON CONFLICT ..
 * RETURNING, so even the very first note of a year, requested by several
 * transactions at once, cannot collide; the row lock it takes is held until the
 * caller's transaction ends, which both serialises allocation and gives the
 * number back on rollback (gapless). Exported for tests; call issueCreditNote.
 */
export async function allocateCreditNoteSequence(t: Tx, year: number): Promise<number> {
  const rows = await t.$queryRaw<{ last: number }[]>`
    INSERT INTO "CreditNoteSequence" ("year", "last") VALUES (${year}, 1)
    ON CONFLICT ("year") DO UPDATE SET "last" = "CreditNoteSequence"."last" + 1
    RETURNING "last"`;
  return Number(rows[0].last);
}

type CreditNoteRow = {
  id: string;
  number: string;
  issuedAt: Date;
  invoiceId: string;
  reason: string;
  subtotalEur: number;
  vatRate: number;
  vatEur: number;
  totalEur: number;
  sellerJson: string;
  buyerJson: string;
  linesJson: string;
  stripeRefundId: string | null;
};

function deserializeCreditNote(row: CreditNoteRow, invoiceNumber: string, replayed: boolean): IssuedCreditNote {
  return {
    id: row.id,
    number: row.number,
    issuedAt: row.issuedAt,
    invoiceId: row.invoiceId,
    invoiceNumber,
    reason: row.reason,
    seller: safeJson<InvoiceParty>(row.sellerJson) ?? sellerParty(),
    buyer: safeJson<InvoiceParty>(row.buyerJson) ?? { name: "Onbekend" },
    lines: safeJson<InvoiceLine[]>(row.linesJson) ?? [],
    subtotalEur: row.subtotalEur,
    vatRate: row.vatRate,
    vatEur: row.vatEur,
    totalEur: row.totalEur,
    stripeRefundId: row.stripeRefundId,
    replayed,
  };
}

/**
 * Issue a credit note (creditfactuur) against an invoice. The invoice itself is
 * never touched.
 *
 * Gapless: the number comes from CreditNoteSequence, incremented with a single
 * INSERT .. ON CONFLICT .. RETURNING inside the same transaction that writes the
 * note, so a rollback gives the number back and two concurrent calls queue on the
 * sequence row instead of colliding. The year is the Europe/Amsterdam year.
 *
 * Serialised per invoice: the invoice row is locked (SELECT .. FOR UPDATE)
 * before the credited-so-far total is read, so two concurrent partial refunds
 * cannot both pass the "does not exceed the invoice" check.
 *
 * Idempotent with `stripeRefundId` or `idempotencyKey`: a replay returns the
 * existing note (replayed: true). Without either, `amountEur` omitted on an
 * invoice that is already fully credited returns the most recent note, but a call
 * with an explicit amount cannot tell a replay from a second partial credit and
 * books another note. cancelOrder is idempotent through the order status;
 * recordRefund needs one of the keys (or expectedRefundedEur) for a partial refund.
 *
 * Does NOT update Order.refundedEur or the order status: use cancelOrder or
 * recordRefund for that. Pass `tx` to join the caller's transaction (the usual
 * case); without it a transaction is opened.
 *
 * @throws OrderDomainError  not_found | exceeds_invoice | invalid_amount | conflict
 */
export async function issueCreditNote(invoiceId: string, input: CreditNoteInput, tx?: Tx): Promise<IssuedCreditNote> {
  if (!isDatabaseConfigured()) throw new OrderDomainError("db_unavailable", "Database niet beschikbaar.");
  const run = async (t: Tx): Promise<IssuedCreditNote> => {
    // Lock first, then read: see the doc comment.
    const locked = await t.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Invoice" WHERE "id" = ${invoiceId} FOR UPDATE`;
    if (locked.length === 0) throw new OrderDomainError("not_found", "Factuur niet gevonden.");
    const invoice = await t.invoice.findUniqueOrThrow({ where: { id: invoiceId } });

    if (input.idempotencyKey !== undefined && input.idempotencyKey !== null && (input.idempotencyKey.length === 0 || input.idempotencyKey.length > 100)) {
      throw new OrderDomainError("invalid_input", "De idempotentiesleutel moet 1 tot 100 tekens zijn.");
    }
    if (input.stripeRefundId) {
      const existing = await t.creditNote.findUnique({ where: { stripeRefundId: input.stripeRefundId } });
      if (existing) {
        if (existing.invoiceId !== invoiceId) {
          throw new OrderDomainError("conflict", "Deze Stripe-terugbetaling hoort bij een andere factuur.");
        }
        return deserializeCreditNote(existing, invoice.number, true);
      }
    }
    if (input.idempotencyKey) {
      const existing = await t.creditNote.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) {
        if (existing.invoiceId !== invoiceId) throw new OrderDomainError("conflict", "Deze sleutel is al voor een andere factuur gebruikt.");
        return deserializeCreditNote(existing, invoice.number, true);
      }
    }

    const prior = await t.creditNote.aggregate({ where: { invoiceId }, _sum: { totalEur: true, vatEur: true } });
    const priorCents = centsOf(prior._sum.totalEur ?? 0);
    const priorVat = prior._sum.vatEur ?? 0;
    const invoiceCents = centsOf(invoice.totalEur);
    const remainingCents = invoiceCents - priorCents;

    let amountCents: number;
    if (input.amountEur === undefined) {
      if (remainingCents <= 0) {
        const latest = await t.creditNote.findFirst({ where: { invoiceId }, orderBy: { issuedAt: "desc" } });
        if (latest) return deserializeCreditNote(latest, invoice.number, true);
        throw new OrderDomainError("invalid_amount", "De factuur heeft geen bedrag om te crediteren.");
      }
      amountCents = remainingCents;
    } else {
      amountCents = centsOf(input.amountEur);
      if (!Number.isFinite(input.amountEur) || amountCents <= 0) {
        throw new OrderDomainError("invalid_amount", "Het te crediteren bedrag moet groter zijn dan nul.");
      }
      if (amountCents > remainingCents) {
        throw new OrderDomainError(
          "exceeds_invoice",
          `Het te crediteren bedrag (${eurNl(amountCents / 100)}) is hoger dan wat nog te crediteren is (${eurNl(Math.max(remainingCents, 0) / 100)}).`,
        );
      }
    }

    const amount = amountCents / 100;
    const { vatEur, subtotalEur } = creditNoteVat({
      invoiceTotalCents: invoiceCents,
      invoiceVatEur: invoice.vatEur,
      priorCents,
      priorVatEur: priorVat,
      amountCents,
      vatRate: invoice.vatRate,
    });

    const fullInvoice = priorCents === 0 && amountCents === invoiceCents;
    // A note that credits the whole invoice repeats the invoice's lines, and
    // the invoice total also holds shipping and any discount: without those
    // two lines the printed lines add up to less than the total.
    const lines: InvoiceLine[] = fullInvoice
      ? [
          ...(safeJson<InvoiceLine[]>(invoice.linesJson) ?? []),
          ...(invoice.shippingEur > 0
            ? [{ sku: "", name: "Verzendkosten", quantity: 1, unitPriceEur: money(invoice.shippingEur), lineTotalEur: money(invoice.shippingEur) }]
            : []),
          ...(invoice.discountEur > 0
            ? [{ sku: "", name: "Korting", quantity: 1, unitPriceEur: money(-invoice.discountEur), lineTotalEur: money(-invoice.discountEur) }]
            : []),
        ]
      : [
          {
            sku: "",
            name: `${priorCents === 0 ? "Gedeeltelijke" : "Aanvullende"} creditering van factuur ${invoice.number}`,
            quantity: 1,
            unitPriceEur: amount,
            lineTotalEur: amount,
          },
        ];

    const year = amsterdamYear(new Date());
    const number = formatCreditNoteNumber(year, await allocateCreditNoteSequence(t, year));

    const created = await t.creditNote.create({
      data: {
        number,
        year,
        invoiceId,
        reason: input.reason.slice(0, 300),
        subtotalEur,
        vatRate: invoice.vatRate,
        vatEur,
        totalEur: amount,
        // The credit note names the same seller and buyer as the invoice it
        // corrects, as they were when that invoice was issued.
        sellerJson: invoice.sellerJson,
        buyerJson: invoice.buyerJson,
        linesJson: JSON.stringify(lines),
        stripeRefundId: input.stripeRefundId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
      },
    });
    logger.info("[invoicing] credit note issued", { number, invoice: invoice.number, totalEur: amount });
    return deserializeCreditNote(created, invoice.number, false);
  };
  return tx ? run(tx) : prisma.$transaction(run, { maxWait: 10_000, timeout: 20_000 });
}

/** Attach the Stripe refund id to a credit note that was issued before the refund existed. Only fills an empty id. */
export async function setCreditNoteStripeRefund(creditNoteId: string, stripeRefundId: string): Promise<boolean> {
  if (!isDatabaseConfigured()) return false;
  const res = await prisma.creditNote.updateMany({ where: { id: creditNoteId, stripeRefundId: null }, data: { stripeRefundId } });
  return res.count > 0;
}

/** Credit notes issued against an order's invoice, oldest first. */
export async function getCreditNotesForOrder(orderId: string): Promise<IssuedCreditNote[]> {
  if (!isDatabaseConfigured()) return [];
  try {
    const invoice = await prisma.invoice.findUnique({ where: { orderId }, include: { creditNotes: { orderBy: { issuedAt: "asc" } } } });
    return invoice ? invoice.creditNotes.map((c) => deserializeCreditNote(c, invoice.number, false)) : [];
  } catch {
    return [];
  }
}

// ─── Restock bookkeeping ──────────────────────────────────────────────
//
// Which units a refund put back on the shelf is counted on the order line,
// OrderItem.restockedQty, and nowhere else: the cap "ordered minus already
// restocked" is one conditional update on that column (applyRestock). Credit
// notes issued before migration 20261009120000_order_item_restocked_qty carried
// the record as a "restock" array on their first printed line instead; the
// migration backfilled the column from them, and the only code that still
// touches that annotation is stripLegacyRestock (the data export). The admin
// pages (retouren, bestellingen) size their restock inputs from the column.

/**
 * Units per part that refunds of this order already put back on the shelf: the
 * sum of OrderItem.restockedQty per part. Cancelling is not counted: it restocks
 * everything and ends the order.
 */
export async function restockedByPart(orderId: string, db: Pick<typeof prisma, "orderItem"> = prisma): Promise<Map<string, number>> {
  return restockedOfItems(await db.orderItem.findMany({ where: { orderId }, select: { partId: true, restockedQty: true } }));
}

/** Same, from order lines a page already loaded (select `partId` and `restockedQty`). */
export function restockedOfItems(items: ReadonlyArray<{ partId: string; restockedQty: number }>): Map<string, number> {
  const total = new Map<string, number>();
  for (const it of items) total.set(it.partId, (total.get(it.partId) ?? 0) + it.restockedQty);
  return total;
}

/**
 * The linesJson of a credit note without the legacy "restock" annotation (see
 * InvoiceLine.restock): what the customer was given, nothing of the shop's
 * stock bookkeeping. Returns the input unchanged when it is not a JSON array or
 * carries no annotation, so a document is never re-serialised for nothing.
 */
export function stripLegacyRestock(linesJson: string): string {
  const lines = safeJson<unknown>(linesJson);
  if (!Array.isArray(lines)) return linesJson;
  let stripped = false;
  const clean = lines.map((line) => {
    if (!line || typeof line !== "object" || !("restock" in line)) return line;
    stripped = true;
    return Object.fromEntries(Object.entries(line as Record<string, unknown>).filter(([key]) => key !== "restock"));
  });
  return stripped ? JSON.stringify(clean) : linesJson;
}

// ─── Order helpers ────────────────────────────────────────────────────

type OrderForMail = {
  id: string;
  email: string;
  accessToken: string | null;
  shippingAddress: string;
};

function addressOf(order: { shippingAddress: string }) {
  return safeJson<{ name?: string; postalCode?: string }>(order.shippingAddress) ?? {};
}

function customerNameOf(order: { shippingAddress: string }): string {
  return addressOf(order).name?.trim() || "klant";
}

const PAYMENT_LABEL: Record<string, string> = { STRIPE: "iDEAL/kaart", BANK_TRANSFER: "overschrijving" };

const fail = (code: OrderErrorCode, error: string): OrderOpFail => ({ ok: false, code, error });

function failFrom(err: unknown, what: string): OrderOpFail {
  if (err instanceof OrderDomainError) return fail(err.code, err.message);
  logger.error(`[invoicing] ${what} failed`, err);
  return fail("db_error", `${what} is mislukt. Probeer het opnieuw.`);
}

/** Notify the owner, never throwing and never including customer details. */
async function ping(input: Parameters<typeof notifyOwner>[0]): Promise<void> {
  await notifyOwner(input).catch(() => undefined);
}

// ─── Cancel ───────────────────────────────────────────────────────────

export type CancelOrderOptions = {
  /** Stored on the order (Order.cancelReason) and on the credit note. */
  reason: string;
  actor: OrderActor;
  /**
   * The statuses this cancellation was DECIDED on (see CANCEL GUARD in the header).
   * When the order is in any other state, nothing is cancelled and the result is
   * {ok:false, code:"conflict"}. An already CANCELLED order is still the usual
   * replay. Omit it only when the caller has no earlier decision to protect
   * (a refund that completes a PAID order passes through recordRefund, which
   * holds the order lock).
   */
  onlyFrom?: readonly OrderStatus[];
  /**
   * The Stripe refund that returned the money, when the order was paid by card
   * or iDEAL. Create the refund FIRST (idempotency key per order), then cancel
   * with its id: if the Stripe call fails the order simply is not cancelled.
   */
  stripeRefundId?: string | null;
  /** Mail the customer (default true). */
  notifyCustomer?: boolean;
  /** Shown to the customer in the mail instead of `reason` (which may be internal). */
  customerReason?: string | null;
};

export type CancelOrderResult =
  | {
      ok: true;
      /** True when the order was already cancelled: nothing was changed or sent. */
      alreadyCancelled: boolean;
      /** Units went back on the shelf in this call. */
      restocked: boolean;
      /** The credit note issued now, or the existing one on a replay. Null for a never-invoiced order. */
      creditNote: IssuedCreditNote | null;
      /** Money still owed to the customer after this cancellation (paid orders): refund it. */
      refundDueEur: number;
      /** Result of the customer mail; null when none was attempted. */
      emailSent: boolean | null;
    }
  | OrderOpFail;

type CancelOutcome = {
  alreadyCancelled: boolean;
  restocked: boolean;
  creditNote: IssuedCreditNote | null;
  refundDueEur: number;
  wasPaid: boolean;
  /** A paid order that could not be invoiced (company identity incomplete): the refund is owed without a credit note. */
  paidWithoutInvoice: boolean;
  /** The order had an invoice (or got one in this call). */
  hadInvoice: boolean;
  order: OrderForMail & { totalEur: number; itemCount: number; paymentMethod: string };
};

/**
 * Cancel inside a transaction. The conditional update on the CURRENT status is
 * the claim: of N concurrent callers exactly one gets count 1 and does the
 * restock and the credit note.
 */
async function cancelInTx(
  t: Tx,
  orderId: string,
  opts: CancelOrderOptions,
  creditAmountEur?: number,
  extra: { idempotencyKey?: string | null } = {},
): Promise<CancelOutcome> {
  const order = await t.order.findUnique({
    where: { id: orderId },
    include: { items: { select: { partId: true, quantity: true } }, invoice: { select: { id: true } } },
  });
  if (!order) throw new OrderDomainError("not_found", "Bestelling niet gevonden.");
  const summary = {
    id: order.id,
    email: order.email,
    accessToken: order.accessToken,
    shippingAddress: order.shippingAddress,
    totalEur: order.totalEur,
    itemCount: order.items.reduce((n, i) => n + i.quantity, 0),
    paymentMethod: order.paymentMethod,
  };

  const replay = async (): Promise<CancelOutcome> => {
    const note = order.invoice
      ? await t.creditNote.findFirst({ where: { invoiceId: order.invoice.id }, orderBy: { issuedAt: "desc" }, include: { invoice: { select: { number: true } } } })
      : null;
    return {
      alreadyCancelled: true,
      restocked: false,
      creditNote: note ? deserializeCreditNote(note, note.invoice.number, true) : null,
      refundDueEur: 0,
      wasPaid: false,
      paidWithoutInvoice: false,
      hadInvoice: !!order.invoice,
      order: summary,
    };
  };

  if (order.status === "CANCELLED") return replay();
  // The guard: the decision to cancel was taken on another status than the one
  // the order has now (typically PAID, marked by the owner a moment ago).
  if (opts.onlyFrom && !(opts.onlyFrom as readonly string[]).includes(order.status)) {
    throw new OrderDomainError(
      "conflict",
      `Bestelling is intussen gewijzigd (staat nu op ${order.status}) en is daarom niet geannuleerd. Ververs de pagina en kijk opnieuw.`,
    );
  }
  if (!canTransition(order.status, "CANCELLED")) {
    throw new OrderDomainError(
      "not_cancellable",
      order.status === "SHIPPED" || order.status === "DELIVERED"
        ? "Een verzonden bestelling kan niet meer worden geannuleerd. Gebruik een retour of terugbetaling."
        : `Bestelling staat op ${order.status} en kan niet worden geannuleerd.`,
    );
  }

  const previous = order.status as OrderStatus;
  // `previous` is the status that passed the guard above, so a PAID written
  // between that read and this update makes the count 0, never a cancellation.
  const claimed = await t.order.updateMany({
    where: { id: orderId, status: previous },
    data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: opts.reason.slice(0, 300) },
  });
  if (claimed.count === 0) {
    // Lost the race. If the winner cancelled, this is a replay; anything else is a conflict.
    const now = await t.order.findUnique({ where: { id: orderId }, select: { status: true } });
    if (now?.status === "CANCELLED") return replay();
    throw new OrderDomainError("conflict", "Bestelling is zojuist gewijzigd. Probeer het opnieuw.");
  }

  let restocked = false;
  if (holdsStock(previous)) {
    for (const item of order.items) {
      await t.part.update({ where: { id: item.partId }, data: { stock: { increment: item.quantity } } });
    }
    restocked = order.items.length > 0;
  }

  let creditNote: IssuedCreditNote | null = null;
  let refundDueEur = 0;
  let paidWithoutInvoice = false;
  let invoiceId = order.invoice?.id ?? null;
  if (!invoiceId && previous === "PAID") {
    // Paid but never invoiced (the invoice step failed or was blocked earlier).
    // The money was received, so it must be paid back and the sale must be on
    // the books with its credit note: issue the invoice now, as recordRefund
    // does, then credit it. Only a company identity that may not invoice
    // (production, incomplete) skips this; the refund is still owed, see below.
    if (!invoicingBlockedReason()) {
      const issued = await issueInvoiceForOrder(orderId, t);
      if (issued) invoiceId = (await t.invoice.findUniqueOrThrow({ where: { orderId }, select: { id: true } })).id;
    }
  }
  if (invoiceId) {
    // Everything still uncredited, unless the caller names an amount (a full
    // refund recorded through recordRefund passes exactly the remainder).
    const aggregate = await t.creditNote.aggregate({ where: { invoiceId }, _sum: { totalEur: true } });
    const invoice = await t.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { totalEur: true } });
    const remaining = money(invoice.totalEur - (aggregate._sum.totalEur ?? 0));
    if (remaining > 0) {
      creditNote = await issueCreditNote(
        invoiceId,
        {
          amountEur: creditAmountEur ?? remaining,
          reason: `Annulering: ${opts.reason}`,
          stripeRefundId: opts.stripeRefundId ?? null,
          idempotencyKey: extra.idempotencyKey ?? null,
        },
        t,
      );
      // Money only moves when it had been received.
      if (previous === "PAID") {
        refundDueEur = creditNote.totalEur;
        await t.order.update({ where: { id: orderId }, data: { refundedEur: { increment: creditNote.totalEur } } });
      }
    }
  } else if (previous === "PAID") {
    // No invoice and none may be issued: no credit note exists, but the
    // customer still paid. The refund obligation is what is left of the total.
    paidWithoutInvoice = true;
    refundDueEur = money(Math.max(order.totalEur - order.refundedEur, 0));
    if (refundDueEur > 0) await t.order.update({ where: { id: orderId }, data: { refundedEur: { increment: refundDueEur } } });
  }
  return { alreadyCancelled: false, restocked, creditNote, refundDueEur, wasPaid: previous === "PAID", paidWithoutInvoice, hadInvoice: invoiceId !== null, order: summary };
}

/**
 * An abandoned checkout is not news. A card or iDEAL order whose payment session
 * expired, or an unpaid order closed by the system, was never invoiced and never
 * paid: nothing is owed and nothing was lost, and at normal abandonment rates a
 * ping per order buries the alerts that matter. ONE place decides this, so the
 * webhook path (Stripe session expired) and the sweeps agree.
 */
export function isQuietCancellation(outcome: { wasPaid: boolean; hadInvoice: boolean }, actor: OrderActor): boolean {
  return !outcome.wasPaid && !outcome.hadInvoice && (actor === "stripe" || actor === "system");
}

async function afterCancel(outcome: CancelOutcome, opts: CancelOrderOptions): Promise<boolean | null> {
  if (outcome.alreadyCancelled) return null;
  const { order } = outcome;
  const owner = isQuietCancellation(outcome, opts.actor) ? Promise.resolve() : ping({
    event: "order.cancelled",
    level: "info",
    title: `Bestelling #${orderRef(order.id)} geannuleerd`,
    lines: [
      `Totaal ${eurNl(order.totalEur)} · ${order.itemCount} artikel(en)`,
      `Door: ${opts.actor}`,
      outcome.creditNote
        ? `Creditnota ${outcome.creditNote.number}`
        : outcome.paidWithoutInvoice
          ? "Geen factuur mogelijk (bedrijfsgegevens onvolledig), dus geen creditnota: betaal het bedrag handmatig terug"
          : "Geen factuur, dus geen creditnota",
      ...(outcome.refundDueEur > 0 && !opts.stripeRefundId ? [`Nog terug te betalen: ${eurNl(outcome.refundDueEur)}`] : []),
    ],
    url: "/admin/bestellingen",
  });
  let emailSent: boolean | null = null;
  if (opts.notifyCustomer !== false) {
    const { sendOrderCancelledEmail } = await import("./email");
    const mail = await sendOrderCancelledEmail(order.email, {
      orderId: order.id,
      name: customerNameOf(order),
      accessToken: order.accessToken,
      reason: opts.customerReason ?? null,
      wasPaid: outcome.wasPaid,
      creditNoteNumber: outcome.creditNote?.number ?? null,
      refundEur: outcome.wasPaid ? outcome.refundDueEur || null : null,
    });
    emailSent = mail.ok;
  }
  await owner;
  return emailSent;
}

/**
 * Cancel an order that has not shipped: PENDING, OPENSTAAND or PAID.
 *
 * In ONE transaction: the status flips to CANCELLED (the conditional update on
 * the current status is the lock), the units of a stock-holding order (OPENSTAAND,
 * PAID) go back on the shelf, and an invoiced order gets a credit note for what
 * is still uncredited. A PAID order's Order.refundedEur grows by that amount and
 * `refundDueEur` tells the caller how much to pay back.
 *
 * Idempotent: cancelling a cancelled order returns {alreadyCancelled: true} and
 * changes, restocks and sends nothing. Concurrent calls restock exactly once.
 * A SHIPPED or DELIVERED order is refused (not_cancellable): that is a return.
 *
 * After the commit the customer is mailed and the owner notified (best effort;
 * a failing mail does not undo the cancellation, see `emailSent`).
 */
export async function cancelOrder(orderId: string, opts: CancelOrderOptions): Promise<CancelOrderResult> {
  if (!isDatabaseConfigured()) return fail("db_unavailable", "Database niet beschikbaar.");
  try {
    const outcome = await prisma.$transaction((t) => cancelInTx(t, orderId, opts), { maxWait: 10_000, timeout: 20_000 });
    const emailSent = await afterCancel(outcome, opts);
    if (!outcome.alreadyCancelled) {
      logger.info("[invoicing] order cancelled", { orderId, actor: opts.actor, restocked: outcome.restocked, creditNote: outcome.creditNote?.number });
    }
    return {
      ok: true,
      alreadyCancelled: outcome.alreadyCancelled,
      restocked: outcome.restocked,
      creditNote: outcome.creditNote,
      refundDueEur: outcome.refundDueEur,
      emailSent,
    };
  } catch (err) {
    return failFrom(err, "Annuleren");
  }
}

// ─── Ship / deliver ───────────────────────────────────────────────────

const TRACKING_RE = /^[\w\-./]{3,64}$/;

function cleanTracking(carrier: string, trackingCode: string): { carrier: string; trackingCode: string } | null {
  const code = trackingCode.replace(/\s+/g, "");
  if (!TRACKING_RE.test(code)) return null;
  const known = normaliseCarrier(carrier);
  const label = carrier.trim().slice(0, 40);
  if (known === "OTHER" && !label) return null;
  return { carrier: known === "OTHER" ? label : known, trackingCode: code };
}

export type ShipResult =
  | { ok: true; alreadyShipped: boolean; emailSent: boolean | null }
  | OrderOpFail;

async function sendShippedMail(order: OrderForMail, carrier: string, trackingCode: string): Promise<boolean> {
  const { sendOrderShippedEmail } = await import("./email");
  const res = await sendOrderShippedEmail(order.email, {
    orderId: order.id,
    name: customerNameOf(order),
    accessToken: order.accessToken,
    carrier,
    trackingCode,
    postalCode: addressOf(order).postalCode ?? null,
  });
  return res.ok;
}

/**
 * PAID -> SHIPPED with carrier and tracking code. Conditional update, so two
 * clicks ship once. Replaying the same carrier and code is a no-op
 * ({alreadyShipped: true}, no second mail); a different code on an already
 * shipped order is refused (use updateOrderTracking).
 */
export async function markOrderShipped(orderId: string, input: { carrier: string; trackingCode: string }): Promise<ShipResult> {
  if (!isDatabaseConfigured()) return fail("db_unavailable", "Database niet beschikbaar.");
  const tracking = cleanTracking(input.carrier, input.trackingCode);
  if (!tracking) return fail("invalid_input", "Vul een vervoerder en een geldige trackingcode in (3 tot 64 tekens).");
  try {
    // statusesThatCanGo() reads the transition table, so what may ship is
    // decided in ./order-status and nowhere else.
    const claimed = await prisma.order.updateMany({
      where: { id: orderId, status: { in: statusesThatCanGo("SHIPPED") } },
      data: { status: "SHIPPED", shippedAt: new Date(), carrier: tracking.carrier, trackingCode: tracking.trackingCode },
    });
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, email: true, accessToken: true, shippingAddress: true, status: true, carrier: true, trackingCode: true },
    });
    if (!order) return fail("not_found", "Bestelling niet gevonden.");
    if (claimed.count === 0) {
      if ((order.status === "SHIPPED" || order.status === "DELIVERED") && order.carrier === tracking.carrier && order.trackingCode === tracking.trackingCode) {
        return { ok: true, alreadyShipped: true, emailSent: null };
      }
      if (order.status === "SHIPPED" || order.status === "DELIVERED") {
        return fail("conflict", "Deze bestelling is al verzonden met andere trackinggegevens. Pas de tracking aan in plaats van opnieuw te verzenden.");
      }
      return fail("illegal_transition", `Bestelling staat op ${order.status}; alleen een betaalde bestelling kan worden verzonden.`);
    }
    logger.info("[invoicing] order shipped", { orderId, carrier: tracking.carrier });
    const emailSent = await sendShippedMail(order, tracking.carrier, tracking.trackingCode);
    return { ok: true, alreadyShipped: false, emailSent };
  } catch (err) {
    return failFrom(err, "Verzenden");
  }
}

/** Correct the carrier or code of an order that is already SHIPPED. Optionally mails the corrected link. */
export async function updateOrderTracking(
  orderId: string,
  input: { carrier: string; trackingCode: string; resendEmail?: boolean },
): Promise<ShipResult> {
  if (!isDatabaseConfigured()) return fail("db_unavailable", "Database niet beschikbaar.");
  const tracking = cleanTracking(input.carrier, input.trackingCode);
  if (!tracking) return fail("invalid_input", "Vul een vervoerder en een geldige trackingcode in (3 tot 64 tekens).");
  try {
    const res = await prisma.order.updateMany({
      where: { id: orderId, status: { in: ["SHIPPED", "DELIVERED"] } },
      data: { carrier: tracking.carrier, trackingCode: tracking.trackingCode },
    });
    if (res.count === 0) return fail("illegal_transition", "Alleen een verzonden bestelling heeft trackinggegevens.");
    const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true, email: true, accessToken: true, shippingAddress: true } });
    const emailSent = input.resendEmail && order ? await sendShippedMail(order, tracking.carrier, tracking.trackingCode) : null;
    return { ok: true, alreadyShipped: true, emailSent };
  } catch (err) {
    return failFrom(err, "Tracking aanpassen");
  }
}

export type DeliverResult = { ok: true; alreadyDelivered: boolean } | OrderOpFail;

/** SHIPPED -> DELIVERED. Conditional update; replaying it is a no-op. */
export async function markOrderDelivered(orderId: string): Promise<DeliverResult> {
  if (!isDatabaseConfigured()) return fail("db_unavailable", "Database niet beschikbaar.");
  try {
    const claimed = await prisma.order.updateMany({ where: { id: orderId, status: { in: statusesThatCanGo("DELIVERED") } }, data: { status: "DELIVERED", deliveredAt: new Date() } });
    if (claimed.count > 0) {
      logger.info("[invoicing] order delivered", { orderId });
      return { ok: true, alreadyDelivered: false };
    }
    const order = await prisma.order.findUnique({ where: { id: orderId }, select: { status: true } });
    if (!order) return fail("not_found", "Bestelling niet gevonden.");
    if (order.status === "DELIVERED") return { ok: true, alreadyDelivered: true };
    return fail("illegal_transition", `Bestelling staat op ${order.status}; alleen een verzonden bestelling kan worden afgeleverd.`);
  } catch (err) {
    return failFrom(err, "Afleveren");
  }
}

// ─── Refund ───────────────────────────────────────────────────────────

export type RecordRefundInput = {
  /** Gross amount returned to the customer, VAT included. */
  amountEur: number;
  /** The Stripe refund id (re_...). Makes a replayed webhook a no-op. */
  stripeRefundId?: string | null;
  /**
   * For a refund that has no Stripe id (bank transfer): a key generated when
   * the admin form is rendered. A double submit then returns the first note
   * (replayed: true) instead of booking a second one. 1 to 100 characters.
   */
  idempotencyKey?: string | null;
  /**
   * The Order.refundedEur the caller saw when it built the request. Checked under
   * the order lock: if another refund was booked since, nothing is changed and
   * the result is {ok:false, code:"conflict"}.
   */
  expectedRefundedEur?: number;
  reason?: string;
  /**
   * Units that came back in good condition and go back on the shelf (returns).
   * Only for a SHIPPED or DELIVERED order, and capped CUMULATIVELY: what was
   * ordered minus what earlier refunds already put back, counted on
   * OrderItem.restockedQty and claimed with one conditional update per line
   * (applyRestock), so two refunds cannot together exceed what was ordered. An
   * order that has not shipped has no returned goods (its units never left);
   * cancelling it puts them all back, so a restock there would be counted
   * twice and is refused.
   */
  restock?: Array<{ partId: string; quantity: number }>;
  notifyCustomer?: boolean;
};

export type RecordRefundResult =
  | {
      ok: true;
      creditNote: IssuedCreditNote;
      /** Total refunded on the order so far. */
      refundedEur: number;
      /** The whole invoice is now credited. */
      fullyRefunded: boolean;
      /** A full refund of an unshipped PAID order cancels it (units back on the shelf). */
      cancelled: boolean;
      /** The same stripeRefundId or idempotency key was seen before: no second credit note. */
      replayed: boolean;
      emailSent: boolean | null;
      /**
       * Units this call put back on the shelf. On a replay it is non-zero when the
       * refund had been booked first without a restock (the Stripe webhook beats the
       * admin) and the admin ticked one: the admin's booking is the first to bring
       * an idempotency key, applies the restock once and leaves its key on the
       * note, so the same form submitted again finds its key and applies nothing.
       */
      restockedUnits: number;
    }
  | OrderOpFail;

/**
 * Check a restock request against the order: only goods that shipped can come
 * back, and never more than ordered minus what earlier refunds already put back.
 * Returns the Dutch refusal, or null. Exported so the admin can refuse BEFORE it
 * moves money at Stripe; recordRefund runs it again under the order lock.
 */
export async function checkRestock(
  db: Pick<typeof prisma, "orderItem">,
  order: { id: string; status: string; items: Array<{ partId: string; quantity: number }> },
  restock: ReadonlyArray<RestockLine> | undefined,
): Promise<string | null> {
  if (!restock || restock.length === 0) return null;
  if (order.status !== "SHIPPED" && order.status !== "DELIVERED") {
    return "Alleen onderdelen die zijn verzonden kunnen terugkomen. Bij een bestelling die nog niet is verzonden zijn ze nooit weggegaan: annuleer de bestelling, dan staat alles weer op voorraad.";
  }
  const already = await restockedByPart(order.id, db);
  const wanted = new Map<string, number>();
  for (const r of restock) {
    if (!Number.isInteger(r.quantity) || r.quantity <= 0) return "Herbevoorraden kan alleen in hele aantallen groter dan nul.";
    wanted.set(r.partId, (wanted.get(r.partId) ?? 0) + r.quantity);
  }
  for (const [partId, quantity] of wanted) {
    const ordered = order.items.filter((i) => i.partId === partId).reduce((n, i) => n + i.quantity, 0);
    if (ordered === 0) return "Herbevoorraden kan alleen onderdelen uit deze bestelling.";
    const left = ordered - (already.get(partId) ?? 0);
    if (quantity > left) {
      return left <= 0
        ? "Van dit onderdeel is al alles terug op voorraad gezet bij eerdere terugbetalingen."
        : `Van dit onderdeel kunnen nog maximaal ${left} stuk(s) terug op voorraad (besteld ${ordered}, eerder al ${ordered - left} teruggezet).`;
    }
  }
  return null;
}

const RESTOCK_RACE_LOST = "Van dit onderdeel is zojuist door een andere terugbetaling voorraad teruggezet; er kan niet meer terug dan besteld. Ververs de pagina en kijk opnieuw.";

/**
 * Put returned units back on the shelf, under the cap, inside the transaction
 * that books the refund. Per part the units are claimed on the order line with
 * ONE conditional update: `restockedQty <= quantity - units` in the WHERE and
 * the increment in the SET. Of two refunds that together would exceed what was
 * ordered exactly one gets count 1; the other gets count 0 and is refused,
 * whether it asked for more than is left or a concurrent refund took the units
 * first. The conditional update is the lock, as for every other transition in
 * this module; it does not depend on anything read before it. Then Part.stock
 * grows by the same units. Returns the units put back (0 for an empty request).
 * checkRestock runs first, so a request that is wrong on its face gets the
 * precise Dutch refusal and changes nothing; a caller that already ran it in
 * the SAME transaction (recordRefund does, before deciding whether the refund
 * is a cancellation) passes `{ checked: true }` so it is not read twice.
 *
 * Exported for the tests (the race is proved on it directly); recordRefund is
 * the caller, under the order lock. The first parameter is the TRANSACTION
 * client on purpose (TxOnly: the bare client does not compile here): a part
 * that spans two lines claims them one by one, and a conflict on the second
 * must roll the first claim back.
 *
 * @throws OrderDomainError  invalid_input (refused by checkRestock) | conflict (the claim lost)
 */
export async function applyRestock(
  t: TxOnly,
  order: { id: string; status: string; items: Array<{ partId: string; quantity: number }> },
  restock: ReadonlyArray<RestockLine>,
  opts: { checked?: boolean } = {},
): Promise<number> {
  const wanted = new Map<string, number>();
  for (const r of restock) if (r.quantity > 0) wanted.set(r.partId, (wanted.get(r.partId) ?? 0) + r.quantity);
  if (wanted.size === 0) return 0;
  if (!opts.checked) {
    const refusal = await checkRestock(t, order, restock);
    if (refusal) throw new OrderDomainError("invalid_input", refusal);
  }

  let units = 0;
  for (const [partId, quantity] of wanted) {
    // One line per part is the rule (the cart merges duplicate references); should an
    // order carry two, the units are claimed line by line in id order.
    const lines = await t.orderItem.findMany({ where: { orderId: order.id, partId }, orderBy: { id: "asc" }, select: { id: true, quantity: true, restockedQty: true } });
    let left = quantity;
    for (const line of lines) {
      if (left === 0) break;
      const take = Math.min(left, Math.max(0, line.quantity - line.restockedQty));
      if (take === 0) continue;
      const claimed = await t.orderItem.updateMany({
        where: { id: line.id, restockedQty: { lte: line.quantity - take } },
        data: { restockedQty: { increment: take } },
      });
      if (claimed.count === 0) throw new OrderDomainError("conflict", RESTOCK_RACE_LOST);
      left -= take;
    }
    if (left > 0) throw new OrderDomainError("conflict", RESTOCK_RACE_LOST);
    await t.part.update({ where: { id: partId }, data: { stock: { increment: quantity } } });
    units += quantity;
  }
  return units;
}

/**
 * Book a refund (partial or full) on a paid order: a credit note for the
 * amount, Order.refundedEur increased, in one transaction.
 *
 * Allowed on PAID, SHIPPED and DELIVERED. The amount may not exceed what is
 * still uncredited (exceeds_invoice). A refund that completes the credit on a
 * PAID (unshipped) order cancels it as cancelOrder would, units back on the
 * shelf, because the money is gone and the order must not be shipped. On a
 * SHIPPED/DELIVERED order the status stays; pass `restock` for returned goods.
 *
 * Idempotent on `stripeRefundId` or `idempotencyKey`; `expectedRefundedEur`
 * turns a double submit into a refused conflict. With none of them, a partial
 * refund called twice books two notes (see REPLAY SAFETY at the top). A refund id that arrives for an order that
 * cancelOrder already cancelled and credited is attached to that credit note
 * (replayed: true) rather than rejected: that is the normal order of events
 * when the Stripe refund follows the cancellation. This function does not call
 * Stripe: the caller creates the refund (or receives the webhook) and records it here.
 */
export async function recordRefund(orderId: string, input: RecordRefundInput): Promise<RecordRefundResult> {
  if (!isDatabaseConfigured()) return fail("db_unavailable", "Database niet beschikbaar.");
  try {
    const outcome = await prisma.$transaction(
      async (t) => {
        // Order lock first, invoice lock second (inside issueCreditNote): every
        // writer takes them in that order, so they cannot deadlock.
        const locked = await t.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
        if (locked.length === 0) throw new OrderDomainError("not_found", "Bestelling niet gevonden.");
        const order = await t.order.findUniqueOrThrow({
          where: { id: orderId },
          include: { items: { select: { partId: true, quantity: true } }, invoice: { select: { id: true, totalEur: true } } },
        });
        const mailBase: OrderForMail = { id: order.id, email: order.email, accessToken: order.accessToken, shippingAddress: order.shippingAddress };

        if (input.idempotencyKey !== undefined && input.idempotencyKey !== null && (input.idempotencyKey.length === 0 || input.idempotencyKey.length > 100)) {
          throw new OrderDomainError("invalid_input", "De idempotentiesleutel moet 1 tot 100 tekens zijn.");
        }
        const replayKey = input.stripeRefundId
          ? ({ stripeRefundId: input.stripeRefundId } as const)
          : input.idempotencyKey
            ? ({ idempotencyKey: input.idempotencyKey } as const)
            : null;
        if (replayKey) {
          const existing = await t.creditNote.findUnique({ where: replayKey, include: { invoice: { select: { number: true, orderId: true } } } });
          if (existing) {
            if (existing.invoice.orderId !== orderId) throw new OrderDomainError("conflict", "Deze terugbetaling hoort bij een andere bestelling.");
            // The Stripe webhook can book a refund BEFORE the admin's own booking of
            // the same refund id arrives; the admin's call is then answered as a
            // replay and the restock they ticked used to be dropped. The form's key
            // is the record that it was handled: a note the webhook booked carries
            // the Stripe refund id but no key, so the first booking that brings a key
            // claims the note (applies the ticked restock once, under the cap, and
            // stores the key); the same form submitted again (a double click, a
            // retry) finds its key on the note and restocks nothing more. A replay
            // that brings no key, or whose key already sits on another note, could
            // not be recognised next time, so it restocks nothing either.
            let restockedUnits = 0;
            let noteRow = existing;
            const wanted = (input.restock ?? []).filter((r) => r.quantity > 0);
            const keyClaimsNote =
              !!input.idempotencyKey && !existing.idempotencyKey && !(await t.creditNote.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true } }));
            if (keyClaimsNote) {
              if (wanted.length > 0) restockedUnits = await applyRestock(t, order, wanted);
              // Metadata only: no printed field of the credit note changes.
              noteRow = await t.creditNote.update({ where: { id: existing.id }, data: { idempotencyKey: input.idempotencyKey }, include: { invoice: { select: { number: true, orderId: true } } } });
            }
            return {
              creditNote: deserializeCreditNote(noteRow, existing.invoice.number, true),
              refundedEur: order.refundedEur,
              fullyRefunded: order.invoice ? centsOf(order.refundedEur) >= centsOf(order.invoice.totalEur) : false,
              cancelled: order.status === "CANCELLED",
              replayed: true,
              mailBase,
              partial: false,
              totalEur: order.totalEur,
              restockedUnits,
            };
          }
        }

        // Compare-and-set under the order lock taken above: of two concurrent
        // submits built from the same page, the second sees the first one's refund.
        if (input.expectedRefundedEur !== undefined && centsOf(order.refundedEur) !== centsOf(input.expectedRefundedEur)) {
          throw new OrderDomainError("conflict", "Er is intussen een andere terugbetaling geboekt op deze bestelling. Ververs de pagina en controleer het bedrag.");
        }

        if (order.status === "CANCELLED" && input.stripeRefundId) {
          // The usual order of events for a cancelled paid order: cancelOrder
          // already booked the credit note, THEN the refund was made at Stripe and
          // its webhook arrives here. Reconcile it onto the matching note instead
          // of failing: same amount, no refund id yet.
          const open = await t.creditNote.findFirst({
            where: { invoice: { orderId }, stripeRefundId: null },
            orderBy: { issuedAt: "desc" },
            include: { invoice: { select: { number: true } } },
          });
          if (open && centsOf(open.totalEur) === centsOf(input.amountEur)) {
            const linked = await t.creditNote.update({ where: { id: open.id }, data: { stripeRefundId: input.stripeRefundId } });
            return {
              creditNote: deserializeCreditNote(linked, open.invoice.number, true),
              refundedEur: order.refundedEur,
              fullyRefunded: true,
              cancelled: true,
              replayed: true,
              mailBase,
              partial: false,
              totalEur: order.totalEur,
              restockedUnits: 0,
            };
          }
        }
        if (order.status !== "PAID" && order.status !== "SHIPPED" && order.status !== "DELIVERED") {
          throw new OrderDomainError(
            "illegal_transition",
            order.status === "CANCELLED" ? "Deze bestelling is geannuleerd; de creditnota is daar al bij gemaakt." : "Alleen een betaalde bestelling kan worden terugbetaald.",
          );
        }
        if (!(input.amountEur > 0)) throw new OrderDomainError("invalid_amount", "Het terug te betalen bedrag moet groter zijn dan nul.");

        let invoiceId = order.invoice?.id;
        if (!invoiceId) {
          // Paid but never invoiced (the invoice step failed earlier): issue it now so there is something to credit.
          const issued = await issueInvoiceForOrder(orderId, t);
          if (!issued) throw new OrderDomainError("no_invoice", "Er is geen factuur om te crediteren.");
          invoiceId = (await t.invoice.findUniqueOrThrow({ where: { orderId }, select: { id: true } })).id;
        }
        const invoice = await t.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { totalEur: true } });
        const prior = await t.creditNote.aggregate({ where: { invoiceId }, _sum: { totalEur: true } });
        const remainingCents = centsOf(invoice.totalEur) - centsOf(prior._sum.totalEur ?? 0);
        const completes = centsOf(input.amountEur) === remainingCents;

        // Restock validation first, so a bad request changes nothing. Cumulative:
        // ordered minus what earlier refunds already put back (two refunds each
        // restocking the one unit of a one-unit order put +1 too many on the shelf).
        const restockRefusal = await checkRestock(t, order, input.restock);
        if (restockRefusal) throw new OrderDomainError("invalid_input", restockRefusal);

        if (completes && order.status === "PAID") {
          // Everything is being paid back before anything shipped: this IS a cancellation.
          const cancelOpts: CancelOrderOptions = { reason: input.reason ?? "Volledig terugbetaald", actor: "system", stripeRefundId: input.stripeRefundId ?? null, notifyCustomer: input.notifyCustomer };
          const c = await cancelInTx(t, orderId, cancelOpts, input.amountEur, { idempotencyKey: input.idempotencyKey });
          const note = c.creditNote!;
          return { creditNote: note, refundedEur: order.refundedEur + note.totalEur, fullyRefunded: true, cancelled: true, replayed: false, mailBase, partial: false, totalEur: order.totalEur, restockedUnits: 0 };
        }

        const note = await issueCreditNote(
          invoiceId,
          { amountEur: input.amountEur, reason: input.reason ?? "Terugbetaling", stripeRefundId: input.stripeRefundId ?? null, idempotencyKey: input.idempotencyKey ?? null },
          t,
        );
        const updated = await t.order.update({ where: { id: orderId }, data: { refundedEur: { increment: note.totalEur } }, select: { refundedEur: true } });
        // Same transaction as the note: the units are claimed on the order lines
        // (the cap) and put back on the shelf, or the whole refund rolls back.
        const restockedUnits = await applyRestock(t, order, input.restock ?? [], { checked: true });
        return {
          creditNote: note,
          refundedEur: money(updated.refundedEur),
          fullyRefunded: completes,
          cancelled: false,
          replayed: false,
          mailBase,
          partial: !completes,
          totalEur: order.totalEur,
          restockedUnits,
        };
      },
      { maxWait: 10_000, timeout: 20_000 },
    );

    let emailSent: boolean | null = null;
    if (!outcome.replayed) {
      logger.info("[invoicing] refund recorded", { orderId, creditNote: outcome.creditNote.number, totalEur: outcome.creditNote.totalEur });
      const owner = ping({
        event: "order.refunded",
        level: "info",
        title: `Terugbetaling bij bestelling #${orderRef(orderId)}`,
        lines: [`${eurNl(outcome.creditNote.totalEur)} van ${eurNl(outcome.totalEur)}`, `Creditnota ${outcome.creditNote.number}`, outcome.cancelled ? "De bestelling is daarmee geannuleerd" : outcome.fullyRefunded ? "Volledig terugbetaald" : "Gedeeltelijk"],
        url: "/admin/bestellingen",
      });
      if (input.notifyCustomer !== false) {
        const { sendRefundEmail } = await import("./email");
        const mail = await sendRefundEmail(outcome.mailBase.email, {
          orderId,
          name: customerNameOf(outcome.mailBase),
          accessToken: outcome.mailBase.accessToken,
          amountEur: outcome.creditNote.totalEur,
          creditNoteNumber: outcome.creditNote.number,
          partial: outcome.partial,
          // "Teruggestort" is only true once money moved: a Stripe refund exists.
          // Otherwise the owner still has to wire it (decision D3 of the rehearsal).
          via: input.stripeRefundId ? "stripe" : "bank",
        });
        emailSent = mail.ok;
      }
      await owner;
    }
    return {
      ok: true,
      creditNote: outcome.creditNote,
      refundedEur: outcome.refundedEur,
      fullyRefunded: outcome.fullyRefunded,
      cancelled: outcome.cancelled,
      replayed: outcome.replayed,
      emailSent,
      restockedUnits: outcome.restockedUnits,
    };
  } catch (err) {
    return failFrom(err, "Terugbetaling boeken");
  }
}

// ─── Owner and customer notices ───────────────────────────────────────

async function loadOrderNotice(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: { include: { part: { select: { name: true } } } }, invoice: { select: { number: true } } },
  });
  if (!order) return null;
  return {
    order,
    items: order.items.map((i) => ({ name: i.part.name, quantity: i.quantity, total: money(i.unitPrice * i.quantity) })),
    itemCount: order.items.reduce((n, i) => n + i.quantity, 0),
  };
}

/**
 * Tell the owner a new order exists (event "order.placed"). Call it after the
 * order is committed; it never throws and sends no customer details.
 */
export async function notifyOrderPlaced(orderId: string): Promise<void> {
  try {
    const n = await loadOrderNotice(orderId);
    if (!n) return;
    const waiting = n.order.status === "PENDING" || n.order.status === "OPENSTAAND";
    await ping({
      event: "order.placed",
      title: `Nieuwe bestelling #${orderRef(orderId)}`,
      lines: [`${eurNl(n.order.totalEur)} · ${n.itemCount} artikel(en)`, `Betaalwijze: ${PAYMENT_LABEL[n.order.paymentMethod] ?? n.order.paymentMethod}`, waiting ? "Wacht nog op betaling" : "Betaald"],
      url: "/admin/bestellingen",
    });
  } catch (err) {
    logger.warn("[invoicing] notifyOrderPlaced failed", err);
  }
}

/**
 * Payment arrived: mail the customer ("betaling ontvangen" for a bank transfer,
 * the order confirmation with the invoice link for Stripe) and tell the owner.
 * Call it once, from the code path that WON the status claim; it does not
 * guard against being called twice. Never throws.
 */
export async function notifyOrderPaid(
  orderId: string,
  via: "stripe" | "bank_transfer",
  opts: { ownerNotice?: boolean } = {},
): Promise<{ emailSent: boolean | null }> {
  try {
    const n = await loadOrderNotice(orderId);
    if (!n) return { emailSent: null };
    const { order, items } = n;
    // `ownerNotice: false` is for a retry of a customer mail that failed: the owner
    // already heard "Betaling ontvangen" the first time.
    const owner = opts.ownerNotice === false ? Promise.resolve() : ping({
      event: "order.paid",
      title: `Betaling ontvangen #${orderRef(orderId)}`,
      lines: [`${eurNl(order.totalEur)} · ${n.itemCount} artikel(en)`, `Via ${via === "stripe" ? "iDEAL/kaart" : "overschrijving"}`, "Klaar om te verzenden"],
      url: "/admin/bestellingen",
    });
    const email = await import("./email");
    const common = { orderId, name: customerNameOf(order), accessToken: order.accessToken, invoiceNumber: order.invoice?.number ?? null };
    const res =
      via === "stripe"
        ? await email.sendStripeOrderConfirmation(order.email, { ...common, items, totalEur: order.totalEur })
        : await email.sendPaymentReceivedEmail(order.email, { ...common, totalEur: order.totalEur });
    await owner;
    return { emailSent: res.ok };
  } catch (err) {
    logger.warn("[invoicing] notifyOrderPaid failed", err);
    return { emailSent: false };
  }
}

// ─── Bank transfer ────────────────────────────────────────────────────

export type MarkPaidResult =
  | {
      ok: true;
      /** It was already PAID: nothing changed, nothing was sent. */
      alreadyPaid?: boolean;
      /** The "betaling ontvangen" mail was accepted by Resend. Absent when no mail was attempted. */
      emailSent?: boolean;
    }
  | { ok: false; error: string };

/**
 * Confirm a bank-transfer order as paid (admin action, once the wire arrives:
 * there is no bank feed). Idempotent: an already-paid order is left as-is, with
 * no second stock movement and no second mail.
 *
 * `opts.receivedAmountEur`: the amount that actually arrived. When given it must
 * equal the order total to the cent; otherwise AmountMismatchError is THROWN and
 * nothing has been changed. Short and over payments are reconciled by hand, never
 * silently accepted as "paid". Omit it only when the amount has been checked
 * elsewhere.
 *
 * The status transition IS the claim: one conditional update OPENSTAAND -> PAID.
 * Nothing else moves, because an OPENSTAAND order still holds its units from the
 * moment the invoice went out.
 *
 * A wire for an order that is already CANCELLED is refused (decision D14, terms
 * 7.1). The cancellation put the units back on the shelf and credited the
 * invoice with a credit note, so the order cannot become PAID again without
 * selling the same goods twice: the payment is paid back, or the customer
 * orders again. The refusal says exactly that.
 *
 * After a successful claim the customer gets the "betaling ontvangen" mail and
 * the owner is notified; `emailSent` reports whether Resend accepted the mail.
 *
 * @throws AmountMismatchError  only when receivedAmountEur is given and wrong
 */
export async function markOrderPaidByBankTransfer(orderId: string, opts?: { receivedAmountEur?: number }): Promise<MarkPaidResult> {
  if (!isDatabaseConfigured()) return { ok: false, error: "Database niet beschikbaar." };

  if (opts?.receivedAmountEur !== undefined) {
    let total: number | undefined;
    try {
      total = (await prisma.order.findUnique({ where: { id: orderId }, select: { totalEur: true } }))?.totalEur;
    } catch (err) {
      logger.error("[invoicing] could not read order total to check the received amount", err);
      return { ok: false, error: "Kon het bestelbedrag niet controleren. Probeer het opnieuw." };
    }
    if (total === undefined) return { ok: false, error: "Bestelling niet gevonden." };
    const received = opts.receivedAmountEur;
    if (!Number.isFinite(received) || centsOf(received) !== centsOf(total)) throw new AmountMismatchError(total, received);
  }

  try {
    const claimed = await prisma.order.updateMany({
      where: { id: orderId, status: "OPENSTAAND", paymentMethod: "BANK_TRANSFER" },
      data: { status: "PAID", paidAt: new Date() },
    });
    if (claimed.count > 0) {
      logger.info("[invoicing] bank-transfer order marked paid", { orderId });
      const { emailSent } = await notifyOrderPaid(orderId, "bank_transfer");
      return { ok: true, emailSent: emailSent ?? false };
    }

    const order = await prisma.order.findUnique({ where: { id: orderId }, select: { status: true, paymentMethod: true } });
    if (!order) return { ok: false, error: "Bestelling niet gevonden." };
    if (order.paymentMethod !== "BANK_TRANSFER") return { ok: false, error: "Deze bestelling loopt niet via een factuur." };
    if (order.status === "PAID" || order.status === "SHIPPED" || order.status === "DELIVERED") return { ok: true, alreadyPaid: true };
    if (order.status === "CANCELLED") {
      const credited = await prisma.creditNote.count({ where: { invoice: { orderId } } });
      return {
        ok: false,
        error: `Deze bestelling is geannuleerd${credited > 0 ? " en de factuur is gecrediteerd (creditnota)" : ""}, en de onderdelen zijn weer vrijgegeven. De betaling is niet gekoppeld: betaal het bedrag terug of laat de klant opnieuw bestellen.`,
      };
    }
    return { ok: false, error: `Bestelling staat op ${order.status} en kan niet op betaald worden gezet.` };
  } catch (err) {
    logger.error("[invoicing] could not mark order paid", err);
    return { ok: false, error: "Kon bestelling niet als betaald markeren." };
  }
}

// ─── Margin, honestly ─────────────────────────────────────────────────

/**
 * Where a part's cost price comes from. scripts/add-part-costs.mjs derives
 * every cost in the catalogue from the SELLING price, so a margin computed from
 * those numbers is a restatement of the price list, not a measurement. Only a
 * cost recorded as a QUOTE (a real supplier quote or invoice) may be presented
 * as a margin; everything else is labelled "schatting".
 */
export const MARGIN_ESTIMATE_LABEL = "schatting";
export type CostBasis = "QUOTE" | "ESTIMATE" | "UNKNOWN";

export function costBasis(part: { costEur?: number | null; costSource?: string | null }): CostBasis {
  if (typeof part.costEur !== "number") return "UNKNOWN";
  return part.costSource === "QUOTE" ? "QUOTE" : "ESTIMATE";
}

export type MarginLine = {
  /**
   * Unit selling price actually charged, VAT included, AFTER any discount.
   * OrderItem.unitPrice is the LIST price: the plan discount lives only in
   * Order.discountEur, so do not map OrderItem rows to this directly; use
   * computeOrderMargin, which spreads the discount over the lines first.
   */
  unitPriceEur: number;
  quantity: number;
  /** Unit cost excluding VAT. */
  costEur?: number | null;
  costSource?: string | null;
};

export type MarginFigure = {
  lines: number;
  /** Selling price excluding VAT. */
  revenueExVatEur: number;
  costEur: number;
  marginEur: number;
  /** Margin as a percentage of revenue ex VAT; null when there is no revenue. */
  marginPct: number | null;
};

export type MarginReport = {
  /** Built from QUOTE costs only: the only figure that may be shown without a label. */
  confirmed: MarginFigure;
  /** Built from ESTIMATE costs. Always show it with MARGIN_ESTIMATE_LABEL next to it. */
  estimated: MarginFigure;
  /** Lines with no cost at all: counted nowhere. */
  unknownLines: number;
  label: typeof MARGIN_ESTIMATE_LABEL;
};

function emptyFigure(): MarginFigure {
  return { lines: 0, revenueExVatEur: 0, costEur: 0, marginEur: 0, marginPct: null };
}

/**
 * Margin over a set of sold lines, split by how trustworthy the cost is.
 * `confirmed` counts QUOTE lines only; ESTIMATE lines go to `estimated` and
 * must be presented as "schatting". A caller that wants a single headline
 * number should show `confirmed` and say how many lines it rests on.
 */
export function computeMargin(lines: MarginLine[], vatRate: number = VAT_RATE): MarginReport {
  const confirmed = emptyFigure();
  const estimated = emptyFigure();
  let unknownLines = 0;
  for (const l of lines) {
    const basis = costBasis(l);
    if (basis === "UNKNOWN") {
      unknownLines++;
      continue;
    }
    const target = basis === "QUOTE" ? confirmed : estimated;
    target.lines++;
    target.revenueExVatEur += (l.unitPriceEur / (1 + vatRate)) * l.quantity;
    target.costEur += (l.costEur as number) * l.quantity;
  }
  for (const f of [confirmed, estimated]) {
    f.revenueExVatEur = money(f.revenueExVatEur);
    f.costEur = money(f.costEur);
    f.marginEur = money(f.revenueExVatEur - f.costEur);
    f.marginPct = f.revenueExVatEur > 0 ? Math.round((f.marginEur / f.revenueExVatEur) * 1000) / 10 : null;
  }
  return { confirmed, estimated, unknownLines, label: MARGIN_ESTIMATE_LABEL };
}

export type OrderMarginInput = {
  /** One entry per OrderItem. `unitPriceEur` is the list price as stored on OrderItem.unitPrice. */
  items: MarginLine[];
  /** Order.discountEur (VAT inclusive): the whole discount of the order, spread over the lines. */
  discountEur: number;
  vatRate?: number;
};

/**
 * Margin of ONE order from what is stored on it. The order discount is spread
 * over the lines in proportion to their list value (whole cents, largest
 * remainder, as the checkout does for Stripe) before the VAT is taken out, so a
 * Bedrijf order with 15% off is not reported at full-price revenue. Shipping is
 * left out: it is a pass-through whose cost is not recorded anywhere.
 */
export function computeOrderMargin(input: OrderMarginInput): MarginReport {
  const gross = input.items.map((i) => centsOf(i.unitPriceEur) * i.quantity);
  const grossTotal = gross.reduce((a, b) => a + b, 0);
  const discount = Math.min(Math.max(centsOf(input.discountEur), 0), grossTotal);
  const exact = gross.map((g) => (grossTotal > 0 ? (discount * g) / grossTotal : 0));
  const share = exact.map(Math.floor);
  let left = discount - share.reduce((a, b) => a + b, 0);
  // Largest remainder; ties go to the earlier line so the result is deterministic.
  const order = exact.map((e, i) => ({ i, frac: e - Math.floor(e) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    share[i] += 1;
    left -= 1;
  }
  return computeMargin(
    input.items.map((item, i) => ({
      ...item,
      unitPriceEur: item.quantity > 0 ? (gross[i] - share[i]) / 100 / item.quantity : 0,
    })),
    input.vatRate,
  );
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
