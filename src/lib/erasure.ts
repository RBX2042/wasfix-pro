/**
 * Erasure of one person's data (AVG art. 17), in ONE place.
 *
 * Two doors lead here and they must erase the same things:
 *   - POST /api/account/delete   the person presses the button in the dashboard;
 *   - the Clerk user.deleted webhook   the person deleted the account in Clerk's own profile UI.
 * The webhook used to anonymise the User row and delete three tables, while the dashboard route
 * also removed the monteur profile (KvK, IBAN, address), the CRM customers (names, phones, notes of
 * third parties), the e-mail, phone, address and working access link on every order, and the
 * reviews / RMA / newsletter rows. Same person, same law, different outcome (rehearsal R2-08).
 *
 * WHAT STAYS, and why (nothing else does):
 *   - Invoice and CreditNote rows. Their buyerJson / linesJson snapshots are the buyer's name and
 *     address that art. 35a Wet OB requires on an invoice, kept 7 years (art. 52 AWR). They are never
 *     edited (decision D4).
 *   - The Order row itself (amounts, lines, dates) as the booking record, but with e-mail, address,
 *     phone, note and access token removed once the order has an invoice, or when it will never get
 *     one (CANCELLED, abandoned PENDING).
 *   - An order that is PAID / SHIPPED / DELIVERED and still has NO invoice keeps its e-mail and
 *     address until the invoice exists, because the invoice is built from them. This exception used
 *     to cover every order without an invoice, including cancelled ones that never get one
 *     (rehearsal R2-07). Invoices are issued inside the erasure transaction first, so in practice
 *     this only remains for more than ERASURE_INVOICE_BATCH such orders.
 *   - Monteur invoices the person issued themselves (art. 52 AWR, MonteurInvoice pins its work order).
 *
 * Open orders (a paid parcel not yet shipped, a pending wire, a shipped parcel that can still be
 * refused, a delivery inside the 30-day return window) need the contact details to be fulfilled,
 * refunded or returned. The dashboard route REFUSES while any exists ("refuse"); the Clerk webhook
 * cannot refuse (the account is already gone at Clerk), so it erases everything else and LEAVES
 * those orders untouched ("keep"), tells the owner, and finishPendingErasures() redacts them once
 * they are no longer open.
 *
 * GUEST ORDERS ON THE SHARED HOLDER ROW (decision D16). A guest who typed the address of an account they
 * were not signed in as gets an order on the placeholder row GUEST_HOLDER_EMAIL, so it never shows up in
 * that account's dashboard. Those orders still carry the typed address, name, phone and a live access link,
 * and when the owner of the address erases their account those must not outlive the erasure just because
 * they hang on another row (they used to hang on the account itself and were redacted with it). So an
 * erasure ADOPTS every holder order whose e-mail matches the erased address onto the account first, and
 * from there they follow the same rules as the account's own orders: closed ones are redacted, open ones
 * wait for finishPendingErasures(). The adopted orders never BLOCK the erasure ("refuse" mode looks at the
 * account's own orders only): anybody can type anybody's address, and a stranger's open order must not be
 * able to hold someone else's art. 17 request up for weeks (the reason for D16 in the first place).
 *
 * The Stripe steps are not here: they differ in what a failure means (the dashboard route stops
 * before erasing, the webhook cannot) and stay in the two callers.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { logger } from "./logger";
import { issueInvoiceForOrder } from "./invoicing";
import { orderRef } from "./order-status";
import { supportEmail, supportHint } from "./support-contact";
import { GUEST_HOLDER_EMAIL } from "./checkout-user";

/** What replaces free text we cannot keep but whose row must survive. */
export const REDACTED = "Verwijderd op verzoek (AVG art. 17)";

/**
 * Order.shippingAddress is a JSON string: checkout writes JSON.stringify and every reader parses it
 * back (src/app/bestelling/[id]/page.tsx with an unguarded JSON.parse). A plain sentence in that
 * column throws a SyntaxError and 500s the order page, so the redaction keeps the JSON shape and
 * blanks the fields inside it.
 */
export const REDACTED_ADDRESS = JSON.stringify({
  redacted: true,
  name: REDACTED,
  street: "",
  houseNumber: "",
  postalCode: "",
  city: "",
  country: "NL",
});

/** Domain of the address an erased account is renamed to. Not a mailbox; it only keeps User.email unique. */
export const ANON_EMAIL_DOMAIN = "anon.wasfix.nl";
export const anonymizedEmailFor = (userId: string) => `deleted-${userId}@${ANON_EMAIL_DOMAIN}`;

/** The statuses on which an invoice is due: the same list src/app/bestelling/[id]/factuur/page.tsx uses to issue a missing one. */
export const INVOICED_STATUSES = ["PAID", "SHIPPED", "DELIVERED"] as const;

/** At most this many missing invoices are issued inside one erasure (keeps the transaction short). */
export const ERASURE_INVOICE_BATCH = 50;

// An order that is not finished needs the contact details this erasure would blank: PAID must still
// be shipped, OPENSTAAND is waiting for a bank transfer, SHIPPED can still be refused at the door or
// returned, and a DELIVERED order stays refundable for the 30-day return window. A refund also needs
// the customer reachable. PENDING is a Stripe payment that may still arrive; one older than a
// Checkout session can live (24 h, plus a margin) is abandoned and does not block.
const PENDING_BLOCKS_FOR_MS = 25 * 60 * 60 * 1000;
export const RETURN_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const ORDER_STATE_TEXT: Record<string, string> = {
  PAID: "is betaald maar nog niet verzonden",
  OPENSTAAND: "wacht op je overschrijving",
  PENDING: "is nog niet afgerond bij de betaalpagina",
  SHIPPED: "is onderweg naar je toe",
  DELIVERED: "is bezorgd en valt nog binnen de retourtermijn",
};

export type BlockingOrder = { id: string; status: string; deliveredAt: Date | null; updatedAt: Date };
type OrderReader = Pick<typeof prisma, "order">;

/** The orders that still need this person reachable. Empty = erasure may proceed. */
export async function ordersBlockingErasure(db: OrderReader, userId: string, take = 10): Promise<BlockingOrder[]> {
  const returnWindowStart = new Date(Date.now() - RETURN_WINDOW_DAYS * DAY_MS);
  return db.order.findMany({
    where: {
      userId,
      OR: [
        { status: { in: ["PAID", "OPENSTAAND", "SHIPPED"] } },
        { status: "PENDING", createdAt: { gte: new Date(Date.now() - PENDING_BLOCKS_FOR_MS) } },
        // deliveredAt is null on rows delivered before the column existed; updatedAt is the best date left for those.
        { status: "DELIVERED", OR: [{ deliveredAt: { gte: returnWindowStart } }, { deliveredAt: null, updatedAt: { gte: returnWindowStart } }] },
      ],
    },
    select: { id: true, status: true, deliveredAt: true, updatedAt: true },
    orderBy: { createdAt: "asc" },
    take,
  });
}

/** The first day erasure is possible again, when the blocking orders have a known end. */
export function blockedUntil(orders: BlockingOrder[]): Date | null {
  if (orders.some((o) => o.status !== "DELIVERED")) return null; // an unfinished order has no date yet
  const ends = orders.map((o) => new Date((o.deliveredAt ?? o.updatedAt).getTime() + RETURN_WINDOW_DAYS * DAY_MS).getTime());
  return ends.length ? new Date(Math.max(...ends)) : null;
}

export class OpenOrdersError extends Error {
  constructor(readonly orders: BlockingOrder[]) {
    super("open_orders");
  }
}

export function openOrdersMessage(orders: BlockingOrder[]): string {
  const list = orders.map((o) => `#${orderRef(o.id)} ${ORDER_STATE_TEXT[o.status] ?? "loopt nog"}`).join("; ");
  const until = blockedUntil(orders);
  const when = until
    ? `Probeer het opnieuw na ${new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" }).format(until)}.`
    : "Wacht tot de bestelling is bezorgd (en de retourtermijn van 30 dagen voorbij is) of geannuleerd.";
  return `Je account kan nog niet worden verwijderd: bestelling ${list}. We hebben je e-mailadres en bezorgadres nodig om die te verzenden, terug te nemen of terug te betalen. ${when} Of ${supportHint(supportEmail())}, dan regelen we het samen. Er is niets gewist.`;
}

export const blockingOrdersBody = (orders: BlockingOrder[]) => ({ orders: orders.map((o) => ({ ref: orderRef(o.id), status: o.status })) });

/** What is left standing after an erasure. The reply to the person is built from exactly this. */
export type ErasureOutcome = {
  /** Invoices of this person's orders (buyer name and address stay on them, art. 35a Wet OB). */
  retainedInvoices: number;
  /** Credit notes against those invoices (same reason, decision D4). */
  retainedCreditNotes: number;
  /** Invoices the person issued themselves as a monteur (art. 52 AWR). */
  retainedMonteurInvoices: number;
  /** Order rows that still exist (as booking records, with the contact details removed unless listed below). */
  orderRows: number;
  /** PAID / SHIPPED / DELIVERED orders without an invoice: e-mail and address stay until it exists. */
  ordersAwaitingInvoice: number;
  /** Open orders left untouched: contact details stay until they are finished. */
  ordersKeptOpen: number;
  /** Guest orders placed with this address (on the shared guest row) that were taken over by the erasure; see the file comment. */
  guestOrdersAdopted: number;
};

export type EraseOptions = {
  userId: string;
  /** The account's real e-mail, read BEFORE it is anonymised: several tables are keyed on it. */
  email: string;
  /**
   * "refuse": throw OpenOrdersError (nothing is erased) while an open order exists. The dashboard route.
   * "keep":   erase everything else and leave the open orders untouched. The Clerk webhook.
   */
  openOrders: "refuse" | "keep";
  /** Keep the Stripe ids on the User row (the Clerk webhook, when cancelling at Stripe failed: they are the handle for doing it by hand). */
  keepStripeIds?: boolean;
  /** Prisma interactive-transaction timeout. */
  timeoutMs?: number;
};

type Tx = Prisma.TransactionClient;

/**
 * Redact the contact details of this person's orders, except `keepIds`.
 *
 *   - phone, customer note and access token: on every order (the link ?t=... stops working);
 *   - e-mail and shipping address: on every order except one that still waits for its invoice.
 *
 * Returns how many orders still wait for an invoice.
 */
async function redactOrders(tx: Tx, userId: string, anonEmail: string, keepIds: string[]): Promise<number> {
  const scope: Prisma.OrderWhereInput = { userId, ...(keepIds.length ? { id: { notIn: keepIds } } : {}) };
  const awaitingInvoice: Prisma.OrderWhereInput = { status: { in: [...INVOICED_STATUSES] }, invoice: { is: null } };

  await tx.order.updateMany({
    where: { ...scope, NOT: awaitingInvoice },
    data: { email: anonEmail, shippingAddress: REDACTED_ADDRESS },
  });
  await tx.order.updateMany({
    where: scope,
    data: { phone: null, customerNote: null, accessToken: null },
  });
  return tx.order.count({ where: { ...scope, ...awaitingInvoice } });
}

/**
 * The erasure itself, in one transaction: it commits or nothing happened. Half-erased is the worst
 * outcome (data gone, identity and login still there, the person told it all went).
 * The caller handles Stripe before and the Clerk identity after.
 */
export async function eraseUserData(opts: EraseOptions): Promise<ErasureOutcome> {
  const { userId, email } = opts;
  const anonEmail = anonymizedEmailFor(userId);

  return prisma.$transaction(
    async (tx) => {
      // Checked again inside the transaction: an order paid in the seconds since the caller looked
      // would otherwise lose the address it still has to be shipped to.
      const ownBlocking = await ordersBlockingErasure(tx, userId, opts.openOrders === "keep" ? 1000 : 10);
      if (ownBlocking.length > 0 && opts.openOrders === "refuse") throw new OpenOrdersError(ownBlocking);

      // Guest orders typed with this address (see the file comment). Taken over AFTER the refuse check on purpose.
      const holder = await tx.user.findUnique({ where: { email: GUEST_HOLDER_EMAIL }, select: { id: true } });
      const adopted = holder && email.trim()
        ? await tx.order.updateMany({ where: { userId: holder.id, email: { equals: email.trim(), mode: "insensitive" } }, data: { userId } })
        : { count: 0 };
      const blocking = adopted.count > 0 ? await ordersBlockingErasure(tx, userId, 1000) : ownBlocking;
      const keepIds = blocking.map((o) => o.id);

      // Issue the invoice first, redact after. issueInvoiceForOrder builds the buyer's name and address
      // purely from order.shippingAddress and order.email (src/lib/invoicing.ts), so blanking those
      // before the invoice exists would write an invoice without the details art. 35a Wet OB requires,
      // with no other copy left. It takes OUR transaction: if anything below fails the new invoice
      // rolls back too, instead of a fresh invoice with this person's name outliving a refused erasure.
      const toInvoice = await tx.order.findMany({
        where: { userId, invoice: { is: null }, status: { in: [...INVOICED_STATUSES] }, ...(keepIds.length ? { id: { notIn: keepIds } } : {}) },
        select: { id: true },
        take: ERASURE_INVOICE_BATCH,
      });
      for (const order of toInvoice) await issueInvoiceForOrder(order.id, tx);

      // Read before deleting: DiagnosisFeedback has no user column, so those rows are only reachable
      // through this account's diagnoses, and the referral rows are also reachable by code.
      const diagnoses = await tx.diagnosis.findMany({ where: { userId }, select: { id: true } });
      const account = await tx.user.findUnique({ where: { id: userId }, select: { referralCode: true } });

      // Monteur CRM: names, addresses, phone numbers and IBANs of this monteur and of their own
      // customers. None of that has a basis to outlive the account, except the invoices the monteur
      // issued themselves: they are the seller on those, art. 52 AWR makes them keep them 7 years,
      // and deleting them would tear a hole in a gapless series while MonteurInvoiceSequence stays
      // advanced. So only work orders without an invoice go; an invoiced one has to stay
      // (MonteurInvoice pins it with onDelete: Restrict) and is stripped of its free text instead.
      await tx.workOrder.deleteMany({ where: { ownerId: userId, invoice: { is: null } } });
      await tx.workOrder.updateMany({ where: { ownerId: userId, notes: { not: null } }, data: { notes: REDACTED } });
      await tx.customer.deleteMany({ where: { ownerId: userId } });

      // Data without a retention duty. Matched on diagnosisId only: Diagnosis.sessionId comes straight
      // from the request body, so a caller who plants a diagnosis carrying someone else's session id
      // would otherwise have this delete their feedback.
      await tx.diagnosisFeedback.deleteMany({ where: { diagnosisId: { in: diagnoses.map((d) => d.id) } } });
      await tx.diagnosis.deleteMany({ where: { userId } });
      await tx.savedMachine.deleteMany({ where: { userId } });
      await tx.apiKey.deleteMany({ where: { userId } });
      await tx.monteurProfile.deleteMany({ where: { userId } });
      await tx.monteurApplication.deleteMany({ where: { email } });
      await tx.newsletterSubscriber.deleteMany({ where: { email } });
      await tx.referral.deleteMany({
        where: account?.referralCode ? { OR: [{ referrerId: userId }, { code: account.referralCode }] } : { referrerId: userId },
      });
      await tx.review.updateMany({ where: { email }, data: { email: anonEmail, author: "Anoniem" } });
      // The RMA row stays attached to its order for the refund trail, but the reporter's name and
      // their free-text notes are not part of that trail.
      await tx.rmaRequest.updateMany({ where: { email }, data: { name: "Verwijderd account", email: anonEmail, notes: REDACTED } });

      const ordersAwaitingInvoice = await redactOrders(tx, userId, anonEmail, keepIds);

      // Last, so the e-mail-keyed cleanups above still matched the real address. stripeCustomerId goes
      // too: it is a live handle to a Stripe record with this person's name and address on it.
      await tx.user.update({
        where: { id: userId },
        data: {
          email: anonEmail,
          name: "Verwijderd account",
          clerkId: null,
          // The plan must not outlive the person.
          plan: "FREE",
          stripeSubStatus: null,
          stripeCurrentPeriodEnd: null,
          stripeCancelAtPeriodEnd: false,
          referralCode: null,
          ...(opts.keepStripeIds ? {} : { stripeSubId: null, stripeCustomerId: null }),
        },
      });

      // What is left standing decides what we may claim in the reply.
      const invoices = await tx.invoice.count({ where: { order: { userId } } });
      return {
        retainedInvoices: invoices,
        retainedCreditNotes: await tx.creditNote.count({ where: { invoice: { order: { userId } } } }),
        retainedMonteurInvoices: await tx.monteurInvoice.count({ where: { ownerId: userId } }),
        orderRows: await tx.order.count({ where: { userId } }),
        ordersAwaitingInvoice,
        ordersKeptOpen: keepIds.length,
        guestOrdersAdopted: adopted.count,
      } satisfies ErasureOutcome;
    },
    { timeout: opts.timeoutMs ?? 20_000 },
  );
}

/**
 * The reply to the data subject: every exception this account actually has, and only those.
 * Telling the person "everything is gone" while invoices and un-invoiced orders keep their details is
 * a false statement about an art. 17 request, and naming a retention that does not apply is just as wrong.
 */
export function retentionNotes(o: ErasureOutcome): string[] {
  const notes: string[] = [];
  if (o.retainedInvoices > 0) {
    notes.push(
      o.retainedCreditNotes > 0
        ? "de facturen en creditfacturen van je bestellingen bewaren we 7 jaar (fiscale bewaarplicht) en daarop blijven je naam en adres staan, omdat art. 35a Wet OB die op een factuur verplicht."
        : "de facturen van je bestellingen bewaren we 7 jaar (fiscale bewaarplicht) en daarop blijven je naam en adres staan, omdat art. 35a Wet OB die op een factuur verplicht.",
    );
  }
  if (o.orderRows > 0) {
    notes.push(
      "De bestellingen zelf (onderdelen, bedragen, datums) blijven als administratie staan, losgekoppeld van je e-mailadres, telefoonnummer en bezorgadres; de bestellink die je kreeg werkt niet meer.",
    );
  }
  if (o.retainedMonteurInvoices > 0) {
    notes.push(
      (o.retainedMonteurInvoices === 1
        ? "De factuur die je zelf als monteur hebt verstuurd blijft staan, met de werkorder waaruit hij is opgemaakt:"
        : `De ${o.retainedMonteurInvoices} facturen die je zelf als monteur hebt verstuurd blijven staan, met de werkorders waaruit ze zijn opgemaakt:`) +
        " jij bent daarop de verkoper en art. 52 AWR verplicht je die 7 jaar te bewaren. Je klantenbestand en je werkorders zonder factuur zijn wel gewist.",
    );
  }
  if (o.ordersAwaitingInvoice > 0) {
    notes.push(
      (o.ordersAwaitingInvoice === 1 ? "Bij één betaalde bestelling is nog geen factuur aangemaakt;" : `Bij ${o.ordersAwaitingInvoice} betaalde bestellingen is nog geen factuur aangemaakt;`) +
        ` daar blijven je e-mailadres en bezorgadres staan tot die factuur er is, omdat we hem anders niet met de wettelijk verplichte gegevens kunnen uitschrijven. Wil je daar iets over weten, ${supportHint(supportEmail())}.`,
    );
  }
  if (o.ordersKeptOpen > 0) {
    notes.push(
      (o.ordersKeptOpen === 1 ? "Eén bestelling loopt nog;" : `${o.ordersKeptOpen} bestellingen lopen nog;`) +
        " daarvan blijven je e-mailadres, telefoonnummer en bezorgadres bewaard tot ze zijn afgerond, omdat we ze anders niet kunnen verzenden, terugnemen of terugbetalen. Daarna worden ze gewist.",
    );
  }
  return notes;
}

/**
 * Finish what the Clerk webhook had to leave: open orders of an already-erased account that are no
 * longer open. Safe to call repeatedly (it only touches orders that still carry contact details).
 * Call it from the daily retention run.
 */
export async function finishPendingErasures(opts: { limit?: number } = {}): Promise<{ accounts: number; ordersRedacted: number; stillOpen: number }> {
  const owners = await prisma.order.findMany({
    where: {
      user: { email: { endsWith: `@${ANON_EMAIL_DOMAIN}` }, clerkId: null, name: "Verwijderd account" },
      NOT: { email: { endsWith: `@${ANON_EMAIL_DOMAIN}` } },
    },
    select: { userId: true },
    distinct: ["userId"],
    take: opts.limit ?? 50,
  });
  let accounts = 0;
  let ordersRedacted = 0;
  let stillOpen = 0;
  for (const { userId } of owners) {
    try {
      const done = await prisma.$transaction(
        async (tx) => {
          const blocking = await ordersBlockingErasure(tx, userId, 1000);
          const keepIds = blocking.map((o) => o.id);
          const toInvoice = await tx.order.findMany({
            where: { userId, invoice: { is: null }, status: { in: [...INVOICED_STATUSES] }, ...(keepIds.length ? { id: { notIn: keepIds } } : {}) },
            select: { id: true },
            take: ERASURE_INVOICE_BATCH,
          });
          for (const order of toInvoice) await issueInvoiceForOrder(order.id, tx);
          const before = await tx.order.count({ where: { userId, NOT: { email: { endsWith: `@${ANON_EMAIL_DOMAIN}` } } } });
          await redactOrders(tx, userId, anonymizedEmailFor(userId), keepIds);
          const after = await tx.order.count({ where: { userId, NOT: { email: { endsWith: `@${ANON_EMAIL_DOMAIN}` } } } });
          return { redacted: before - after, open: keepIds.length };
        },
        { timeout: 20_000 },
      );
      accounts += 1;
      ordersRedacted += done.redacted;
      stillOpen += done.open;
    } catch (err) {
      logger.warn("[gdpr] pending erasure could not be finished for one account", { err: err instanceof Error ? err.message : String(err) });
    }
  }
  return { accounts, ordersRedacted, stillOpen };
}
