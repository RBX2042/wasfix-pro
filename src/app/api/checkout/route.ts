import { NextRequest } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { getCurrentUser, getPlanLimits } from "@/lib/auth";
import { env, isDatabaseConfigured } from "@/lib/env";
import { apiError, apiSuccess } from "@/lib/api-response";
import { rateLimit, getClientKey } from "@/lib/ratelimit";
// Aliased: `dbPart` is already this file's name for a resolved catalog row.
import { dbPart as catalogPart, dbPartById as catalogPartById } from "@/lib/static-db";
import { money, splitVatInclusive, issueInvoiceForOrder } from "@/lib/invoicing";
import { VAT_RATE, COMPANY, shippingFor } from "@/lib/plans";
import { currentVisitorId, recordConversion, recordSignup } from "@/lib/referrals";

const BANK_TRANSFER_TERM_DAYS = 14;
/** Extra days after the term before an unpaid invoice gives its stock back. */
const BANK_TRANSFER_GRACE_DAYS = 7;

type StripeLineItem = {
  price_data: {
    currency: string;
    product_data: { name: string; metadata: { sku: string } };
    unit_amount: number;
  };
  quantity: number;
};

/**
 * Stripe line items whose cents add up to `targetCents` exactly.
 *
 * One unit_amount per line cannot carry every discounted total: 5% off
 * 7 x € 28,50 leaves 3 cents that do not divide over the quantity, and the old
 * correction (add `round(residual / quantity)` to the last line) rounded those
 * 3 cents to 0 — Stripe charged € 189,49 while the order and the BTW invoice
 * recorded € 189,52. Over the catalog that missed on 510 of 1728 single-SKU
 * carts, sometimes charging the customer more than the price shown.
 *
 * So the remainder is spread cent by cent over individual units instead: the
 * units that carry one cent extra become their own line item at unit + 1.
 */
function discountedLineItems(
  items: { name: string; sku: string; unitCents: number; quantity: number }[],
  targetCents: number
): StripeLineItem[] {
  const line = (item: { name: string; sku: string }, unitCents: number, quantity: number): StripeLineItem => ({
    price_data: {
      currency: "eur",
      product_data: { name: item.name, metadata: { sku: item.sku } },
      unit_amount: unitCents,
    },
    quantity,
  });

  if (items.length === 0) return [];

  // Largest-remainder allocation of the discounted total over the lines, so
  // every line keeps its own share of the discount and the cents that do not
  // divide land somewhere instead of being dropped.
  const grossCents = items.reduce((sum, i) => sum + i.unitCents * i.quantity, 0);
  const exact = items.map((i) => (grossCents > 0 ? (i.unitCents * i.quantity * targetCents) / grossCents : 0));
  const lineCents = exact.map((v) => Math.floor(v));
  const byRemainder = exact
    .map((v, idx) => ({ idx, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  let residual = targetCents - lineCents.reduce((a, b) => a + b, 0);
  for (let n = 0; residual > 0; n++) {
    lineCents[byRemainder[n % byRemainder.length].idx] += 1;
    residual -= 1;
  }

  const lineItems: StripeLineItem[] = [];
  items.forEach((item, idx) => {
    const base = Math.floor(lineCents[idx] / item.quantity);
    const extra = lineCents[idx] - base * item.quantity;
    if (item.quantity - extra > 0) lineItems.push(line(item, base, item.quantity - extra));
    if (extra > 0) lineItems.push(line(item, base + 1, extra));
  });
  return lineItems;
}

/**
 * Give back the stock held by bank-transfer orders that were never paid.
 *
 * An OPENSTAAND order reserves its units the moment the invoice goes out, and
 * nothing released them again: an invoice nobody ever pays took those parts
 * off the shelf permanently. Runs just before the availability check so a
 * buyer is never refused stock that an expired order from weeks ago is still
 * holding. Best effort — a failure here must not block a paying customer.
 *
 * Cancelling leaves the issued invoice standing (the number series has to stay
 * gapless); the bookkeeping still needs a creditnota per cancelled order.
 */
async function releaseExpiredBankTransferOrders(): Promise<void> {
  const cutoff = new Date(Date.now() - BANK_TRANSFER_GRACE_DAYS * 24 * 60 * 60 * 1000);
  const expired = await prisma.order.findMany({
    where: { status: "OPENSTAAND", paymentMethod: "BANK_TRANSFER", dueAt: { lt: cutoff } },
    select: { id: true, items: { select: { partId: true, quantity: true } } },
    // Oldest reservations first: `take: 25` only frees a slice per request, and
    // without an order that slice is whatever Postgres scans first.
    orderBy: { dueAt: "asc" },
    take: 25,
  });
  for (const order of expired) {
    // Per order, so one poisoned row (a deleted part, a serialization failure)
    // cannot abort the sweep for everything behind it on every request.
    try {
      await prisma.$transaction(async (tx) => {
        // The status flip is the lock, and markOrderPaidByBankTransfer claims
        // the same row the same way: an admin confirming the wire at this very
        // moment wins it and we leave their stock alone. A confirmation that
        // arrives *after* this sweep re-takes the stock there instead of
        // shipping against units we just put back.
        const cancelled = await tx.order.updateMany({
          where: { id: order.id, status: "OPENSTAAND" },
          data: { status: "CANCELLED" },
        });
        if (cancelled.count === 0) return;
        for (const item of order.items) {
          await tx.part.update({ where: { id: item.partId }, data: { stock: { increment: item.quantity } } });
        }
        logger.warn("Bank-transfer order expired unpaid — stock released, creditnota required", { orderId: order.id });
      });
    } catch (err) {
      logger.error("Could not release an expired bank-transfer order", { orderId: order.id, err });
    }
  }
}

const CheckoutSchema = z.object({
  items: z
    .array(
      z.object({
        partId: z.string().min(1).optional(),
        sku: z.string().min(1).optional(),
        quantity: z.number().int().min(1).max(99),
      }).refine((d) => d.partId || d.sku, { message: "partId of sku is verplicht" })
    )
    .min(1)
    .max(20),
  email: z.string().email(),
  name: z.string().min(2).max(100),
  // Business buyers can supply their VAT number; it is printed on the invoice.
  vatNumber: z.string().trim().regex(/^[A-Z]{2}[A-Z0-9+*.]{2,13}$/i, "Ongeldig btw-nummer").optional(),
  // "stripe" = card/iDEAL/Bancontact via Stripe Checkout. "bank_transfer" =
  // pay by invoice, no Stripe keys required. Defaults to stripe, but the
  // checkout UI only offers it when Stripe is actually configured.
  paymentMethod: z.enum(["stripe", "bank_transfer"]).optional().default("stripe"),
  address: z.object({
    street: z.string().min(2).max(100),
    houseNumber: z.string().min(1).max(20),
    postalCode: z.string().regex(/^[1-9][0-9]{3}\s?[A-Za-z]{2}$/, "Ongeldige postcode (bv. 1234 AB)"),
    city: z.string().min(2).max(50),
    country: z.string().optional().default("NL"),
  }),
});

export async function POST(req: NextRequest) {
  try {
    // Rate limit: 10 orders/hour per IP+user
    const clientKey = getClientKey(req);
    if (!(await rateLimit(`checkout:${clientKey}`, 10, 60 * 60 * 1000))) {
      return apiError("Te veel bestelpogingen. Probeer het over een uur opnieuw.", 429);
    }

    const body = await req.json().catch(() => null);
    if (!body) return apiError("Ongeldige JSON", 400);

    const parsed = CheckoutSchema.safeParse(body);
    if (!parsed.success) {
      return apiError("Ongeldige bestelgegevens", 400, parsed.error.flatten());
    }

    const { items, email, name, address, vatNumber, paymentMethod } = parsed.data;

    // User lookup is optional — falls through to anonymous if DB unreachable
    let user: Awaited<ReturnType<typeof getCurrentUser>> = null;
    try {
      user = await getCurrentUser();
    } catch { /* ignore */ }

    // Resolve parts from the catalog — the database when one is configured,
    // src/data only when there is none. This is what the customer is charged
    // (`unitPrice` and `subtotal` below), so it has to be the same row /admin
    // edits and the product page shows. Reading it from the JSON meant a price
    // raised in /admin was displayed to the admin and charged to nobody, and a
    // part created there could not be bought at all.
    //
    // The fallback cannot quietly charge a stale price on a live deployment:
    // if a database is configured but unreachable, the stock check below fails
    // closed with a 503 before any order or payment is created.
    const resolvedItems = (
      await Promise.all(
        items.map(async (cartItem) => {
          const part =
            (cartItem.sku ? await catalogPart(cartItem.sku) : null) ??
            (cartItem.partId ? await catalogPartById(cartItem.partId) : null);
          return part ? { dbPart: part, quantity: cartItem.quantity } : null;
        }),
      )
    ).filter((x): x is { dbPart: NonNullable<Awaited<ReturnType<typeof catalogPart>>>; quantity: number } => x !== null);

    if (resolvedItems.length === 0) {
      return apiError("Geen geldige onderdelen gevonden in winkelmand. Vernieuw de pagina.", 400);
    }
    if (resolvedItems.length !== items.length) {
      return apiError("Sommige onderdelen zijn niet meer beschikbaar. Verwijder ze uit de winkelmand.", 400);
    }

    // Stock validation. The static catalog is a fixed file, so checking
    // against it always passes however much has already sold; with a database
    // the live figure decides.
    if (isDatabaseConfigured()) {
      try {
        // Reclaim expired reservations first — otherwise this check refuses a
        // paying customer over units an unpaid invoice is still holding.
        await releaseExpiredBankTransferOrders().catch((err) =>
          logger.warn("Could not release expired bank-transfer reservations", err)
        );
        const live = await prisma.part.findMany({
          where: { id: { in: resolvedItems.map((i) => i.dbPart.id) } },
          select: { id: true, name: true, stock: true },
        });
        const stockById = new Map(live.map((p) => [p.id, p]));
        for (const item of resolvedItems) {
          const current = stockById.get(item.dbPart.id);
          if (!current) return apiError(`${item.dbPart.name} is niet meer beschikbaar.`, 400);
          if (current.stock < item.quantity) {
            return apiError(`Onvoldoende voorraad voor ${current.name} (${current.stock} beschikbaar)`, 400);
          }
        }
      } catch (err) {
        logger.error("Stock check failed", err);
        return apiError("Voorraad kon niet worden gecontroleerd. Probeer het zo opnieuw.", 503);
      }
    } else {
      for (const item of resolvedItems) {
        const part = item.dbPart;
        if (part.stock < item.quantity) {
          return apiError(`Onvoldoende voorraad voor ${part.name} (${part.stock} beschikbaar)`, 400);
        }
      }
    }

    let subtotal = 0;
    let costOfGoods = 0;
    let costKnownForAll = true;
    const orderItems = resolvedItems.map(({ dbPart, quantity }) => {
      subtotal += dbPart.priceEur * quantity;
      const cost = (dbPart as { costEur?: number | null }).costEur;
      if (typeof cost === "number") costOfGoods += cost * quantity;
      else costKnownForAll = false;
      return {
        partId: dbPart.id,
        quantity,
        unitPrice: dbPart.priceEur,
      };
    });
    subtotal = money(subtotal);

    let discount = 0;
    if (user) {
      const limits = getPlanLimits(user.plan);
      discount = money(subtotal * limits.partsDiscount);
    }
    const shipping = shippingFor(subtotal, discount);
    const total = money(subtotal - discount + shipping);

    // Catalog prices are shown including 21% btw, so the VAT is contained in
    // the total rather than added to it — the customer pays the price they saw.
    const vat = splitVatInclusive(total, VAT_RATE);
    const costEur = costKnownForAll ? money(costOfGoods) : null;

    const stripe = getStripe();
    // Bank transfer whenever the customer picked it, or when Stripe isn't
    // configured at all (today's reality — no live keys yet). A *configured*
    // Stripe attempt that fails also falls back here, below, instead of
    // either silently claiming "paid" or dead-ending in a hard error.
    const wantsBankTransfer = paymentMethod === "bank_transfer" || !stripe;

    // EVERY paid order issues a BTW invoice (Stripe via the webhook, bank
    // transfer immediately), and an invoice carrying a made-up KvK/btw number
    // is not a valid invoice — art. 35a Wet OB. On the bank-transfer path the
    // customer is additionally asked to wire money to an IBAN that does not
    // exist. So this is checked once, for every payment method, before an
    // order is created.
    //
    // Deliberately NOT exempted by DEMO_MODE. This was previously gated on
    // `!env.DEMO_MODE`, which read the raw flag rather than isDemoMode() and
    // therefore did not fire in exactly the configuration BLOCKED.md
    // describes as live today (production + DEMO_MODE=true) — the one window
    // where real customers could receive a fake-IBAN invoice. A demo flag
    // must not be able to switch off a legal check; CI sets real-looking
    // COMPANY_* values instead, so it exercises this path rather than
    // bypassing it.
    if (env.IS_PRODUCTION && COMPANY.isPlaceholder) {
      logger.error("Checkout blocked — COMPANY fiscal identity is still a placeholder in production", {
        paymentMethod: wantsBankTransfer ? "bank_transfer" : "stripe",
      });
      return apiError(
        "Bestellen is tijdelijk niet mogelijk. Neem contact op via support@wasfix.nl.",
        503
      );
    }

    const visitorId = await currentVisitorId();
    if (visitorId) await recordSignup(visitorId);

    async function resolveUserId(): Promise<string> {
      if (user?.id) return user.id;
      // Upsert, not find-then-create: two guest checkouts with the same e-mail
      // arriving together both found nothing and both inserted, and the loser's
      // P2002 on User.email surfaced to the customer as a 503.
      //
      // The update rewrites the e-mail with the same value on purpose. Prisma
      // only compiles an upsert down to a single INSERT ... ON CONFLICT when
      // the update payload is non-empty; with `update: {}` it falls back to
      // select-then-insert and the race is right back (measured: 7 of 8
      // concurrent calls got P2002, versus 0 of 40 with this). Nothing else is
      // touched — a returning buyer's profile name stays theirs.
      const row = await prisma.user.upsert({
        where: { email },
        update: { email },
        create: { email, name, role: "CONSUMER", plan: "FREE" },
      });
      return row.id;
    }

    // Compensation for a failure *after* the order exists and its stock is
    // taken. Without it the customer gets an error while an order they were
    // told never happened keeps holding their parts, and their retry books a
    // second one on top.
    async function cancelOrderAndRestoreStock(id: string): Promise<void> {
      try {
        await prisma.$transaction(async (tx) => {
          const cancelled = await tx.order.updateMany({
            where: { id, status: { in: ["OPENSTAAND", "PENDING"] } },
            data: { status: "CANCELLED" },
          });
          if (cancelled.count === 0) return;
          for (const item of resolvedItems) {
            await tx.part.update({
              where: { id: item.dbPart.id },
              data: { stock: { increment: item.quantity } },
            });
          }
        });
      } catch (compErr) {
        logger.error("Could not roll back order after a failed checkout — stock stays reserved", { orderId: id, compErr });
      }
    }

    if (wantsBankTransfer) {
      const dueAt = new Date(Date.now() + BANK_TRANSFER_TERM_DAYS * 24 * 60 * 60 * 1000);
      let orderId: string;
      try {
        const userId = await resolveUserId();
        // The invoice commits the goods for up to 14 days, so stock is
        // reserved now — same as a paid order — to avoid overselling.
        const order = await prisma.$transaction(async (tx) => {
          const created = await tx.order.create({
            data: {
              userId,
              email,
              subtotalEur: subtotal,
              discountEur: discount,
              shippingEur: shipping,
              totalEur: total,
              vatRate: vat.vatRate,
              vatEur: vat.vatEur,
              vatNumber: vatNumber ?? null,
              costEur,
              shippingAddress: JSON.stringify({ name, ...address }),
              status: "OPENSTAAND",
              paymentMethod: "BANK_TRANSFER",
              dueAt,
              items: { create: orderItems },
            },
          });
          for (const item of resolvedItems) {
            // Conditional decrement: the availability check above ran before
            // this transaction, so two buyers of the last unit both passed it.
            // Making `stock >= quantity` part of the write predicate is what
            // actually serialises them — an unconditional decrement drove
            // stock negative and invoiced goods that do not exist.
            const claimed = await tx.part.updateMany({
              where: { id: item.dbPart.id, stock: { gte: item.quantity } },
              data: { stock: { decrement: item.quantity } },
            });
            if (claimed.count === 0) throw new Error(`out_of_stock:${item.dbPart.sku}`);
          }
          return created;
        });
        orderId = order.id;
      } catch (dbErr) {
        // A part sold out between the availability check and this write. The
        // transaction rolled back, so no order and no stock change survived.
        if (dbErr instanceof Error && dbErr.message.startsWith("out_of_stock:")) {
          return apiError("Een onderdeel raakte net uitverkocht. Er is niets afgeschreven.", 409);
        }
        // Same rule as the Stripe path below: only a deployment without a
        // database may fall back to a demo order. A configured database that
        // failed to write must not report success — that hides a customer
        // who thinks they'll receive a real invoice but never will.
        if (isDatabaseConfigured()) {
          logger.error("Order persistence failed while a database is configured", dbErr);
          return apiError("We konden je bestelling niet vastleggen. Er is niets afgeschreven — probeer het zo opnieuw.", 503);
        }
        logger.warn("No database configured — cannot issue a real invoice, falling back to demo confirmation", dbErr);
        return apiSuccess({
          orderId: "demo-" + Math.random().toString(36).slice(2, 10).toUpperCase(),
          demo: true,
          paymentMethod: "bank_transfer",
          totals: { total, vatEur: vat.vatEur, exVatEur: vat.exVatEur, vatRate: vat.vatRate },
        });
      }

      // issueInvoiceForOrder rethrows, and it sits outside the try above: an
      // invoice failure used to reach the outer handler as a 500, leaving an
      // OPENSTAAND order with decremented stock, no invoice and no order id
      // for a customer who was told the order failed.
      let invoice: Awaited<ReturnType<typeof issueInvoiceForOrder>>;
      try {
        invoice = await issueInvoiceForOrder(orderId);
      } catch (invErr) {
        logger.error("Invoice issuing failed for a bank-transfer order — rolling the order back", invErr);
        await cancelOrderAndRestoreStock(orderId);
        return apiError("We konden je factuur niet aanmaken. Er is niets afgeschreven — probeer het zo opnieuw.", 503);
      }
      if (visitorId) await recordConversion(visitorId);

      try {
        const { sendBankTransferInstructions } = await import("@/lib/email");
        if (invoice) {
          await sendBankTransferInstructions(email, {
            orderId,
            name,
            invoiceNumber: invoice.number,
            totalEur: total,
            dueAt,
            iban: COMPANY.iban,
            ibanName: COMPANY.name,
          });
        }
      } catch (mailErr) {
        logger.warn("Failed to send bank-transfer instructions email", mailErr);
      }

      return apiSuccess({
        orderId,
        paymentMethod: "bank_transfer",
        invoiceNumber: invoice?.number ?? null,
        iban: COMPANY.iban,
        ibanName: COMPANY.name,
        dueAt,
        totals: { total, vatEur: vat.vatEur, exVatEur: vat.exVatEur, vatRate: vat.vatRate },
      });
    }

    // ─── Stripe path (card/iDEAL/Bancontact) ──────────────────────────
    let orderId: string;
    let demoMode = false;
    try {
      const userId = await resolveUserId();
      const order = await prisma.order.create({
        data: {
          userId,
          email,
          subtotalEur: subtotal,
          discountEur: discount,
          shippingEur: shipping,
          totalEur: total,
          vatRate: vat.vatRate,
          vatEur: vat.vatEur,
          vatNumber: vatNumber ?? null,
          costEur,
          shippingAddress: JSON.stringify({ name, ...address }),
          status: "PENDING",
          paymentMethod: "STRIPE",
          items: { create: orderItems },
        },
      });
      orderId = order.id;
    } catch (dbErr) {
      // Only a deployment without a database may fall back to a demo order.
      // When a database IS configured and the write failed, telling the
      // customer "bedankt voor je bestelling" hides a lost order: no row, no
      // payment, no fulfilment.
      if (isDatabaseConfigured()) {
        logger.error("Order persistence failed while a database is configured", dbErr);
        return apiError("We konden je bestelling niet vastleggen. Er is niets afgeschreven — probeer het zo opnieuw.", 503);
      }
      logger.warn("No database configured — issuing demo order id", dbErr);
      orderId = "demo-" + Math.random().toString(36).slice(2, 10).toUpperCase();
      demoMode = true;
    }

    if (stripe && !demoMode) {
      try {
        // Stripe must charge exactly what the order and the invoice record.
        // Previously the session listed catalog prices only: the plan discount
        // was never given and shipping was never collected, so the card
        // settlement, Order.totalEur and the btw on the invoice were three
        // different numbers. The discount is spread across the line items so
        // the sum matches `total` to the cent.
        const lineItems = discountedLineItems(
          resolvedItems.map(({ dbPart, quantity }) => ({
            name: dbPart.name,
            sku: dbPart.sku,
            unitCents: Math.round(dbPart.priceEur * 100),
            quantity,
          })),
          Math.round((subtotal - discount) * 100)
        );
        if (shipping > 0) {
          lineItems.push({
            price_data: {
              currency: "eur",
              product_data: { name: "Verzendkosten", metadata: { sku: "SHIPPING" } },
              unit_amount: Math.round(shipping * 100),
            },
            quantity: 1,
          });
        }

        const session = await stripe.checkout.sessions.create(
          {
            mode: "payment",
            payment_method_types: ["card", "ideal", "bancontact"],
            line_items: lineItems,
            customer_email: email,
            success_url: `${env.APP_URL}/bestelling/${orderId}?success=1`,
            cancel_url: `${env.APP_URL}/checkout`,
            metadata: { orderId, ...(visitorId ? { refVisitorId: visitorId } : {}) },
          },
          { idempotencyKey: `checkout-${orderId}` }
        );

        await prisma.order.update({
          where: { id: orderId },
          data: { stripePaymentId: session.id },
        }).catch(() => {});

        return apiSuccess({ checkoutUrl: session.url, orderId });
      } catch (stripeErr) {
        // SECURITY: Stripe IS configured — this was a real checkout attempt,
        // not a demo. A failure here must never silently mark the order paid.
        // Offer the bank-transfer path instead of leaving the customer stuck.
        logger.error("Stripe session create failed on a live checkout attempt — offering bank transfer instead", stripeErr);

        // No placeholder re-check needed here: the entry guard above already
        // refused this request in production if the fiscal identity is not
        // real, so reaching this point means it is safe to invoice.

        const dueAt = new Date(Date.now() + BANK_TRANSFER_TERM_DAYS * 24 * 60 * 60 * 1000);
        // Same transaction, same conditional decrement as the bank-transfer
        // branch above. Swallowed per-part updates left stock and orders
        // disagreeing with nobody the wiser, and drove stock negative when a
        // part sold out between the availability check and this write.
        try {
          await prisma.$transaction(async (tx) => {
            await tx.order.update({
              where: { id: orderId },
              data: { status: "OPENSTAAND", paymentMethod: "BANK_TRANSFER", dueAt },
            });
            for (const item of resolvedItems) {
              const claimed = await tx.part.updateMany({
                where: { id: item.dbPart.id, stock: { gte: item.quantity } },
                data: { stock: { decrement: item.quantity } },
              });
              if (claimed.count === 0) throw new Error(`out_of_stock:${item.dbPart.sku}`);
            }
          });
        } catch (reserveErr) {
          // Nothing committed, so the order is still PENDING and unpaid —
          // cancel it rather than leaving a ghost the customer never sees.
          await prisma.order.updateMany({ where: { id: orderId, status: "PENDING" }, data: { status: "CANCELLED" } }).catch(() => {});
          if (reserveErr instanceof Error && reserveErr.message.startsWith("out_of_stock:")) {
            return apiError("Een onderdeel raakte net uitverkocht. Er is niets afgeschreven.", 409);
          }
          logger.error("Could not switch a failed Stripe order to bank transfer", reserveErr);
          return apiError("We konden je bestelling niet vastleggen. Er is niets afgeschreven — probeer het zo opnieuw.", 503);
        }

        let invoice: Awaited<ReturnType<typeof issueInvoiceForOrder>>;
        try {
          invoice = await issueInvoiceForOrder(orderId);
        } catch (invErr) {
          logger.error("Invoice issuing failed on the bank-transfer fallback — rolling the order back", invErr);
          await cancelOrderAndRestoreStock(orderId);
          return apiError("We konden je factuur niet aanmaken. Er is niets afgeschreven — probeer het zo opnieuw.", 503);
        }
        if (visitorId) await recordConversion(visitorId);

        try {
          const { sendBankTransferInstructions } = await import("@/lib/email");
          if (invoice) {
            await sendBankTransferInstructions(email, {
              orderId, name, invoiceNumber: invoice.number, totalEur: total, dueAt,
              iban: COMPANY.iban, ibanName: COMPANY.name,
            });
          }
        } catch (mailErr) {
          logger.warn("Failed to send bank-transfer instructions email", mailErr);
        }

        return apiSuccess({
          orderId,
          paymentMethod: "bank_transfer",
          invoiceNumber: invoice?.number ?? null,
          iban: COMPANY.iban,
          ibanName: COMPANY.name,
          dueAt,
          totals: { total, vatEur: vat.vatEur, exVatEur: vat.exVatEur, vatRate: vat.vatRate },
        });
      }
    }

    // No database at all (demoMode) — nothing was persisted, so there is
    // nothing to charge or invoice against. Report a demo success, same as
    // every other path in this codebase without a database.
    if (visitorId) await recordConversion(visitorId);

    try {
      const { sendOrderConfirmation } = await import("@/lib/email");
      await sendOrderConfirmation(email, {
        orderId,
        items: resolvedItems.map(({ dbPart, quantity }) => ({
          name: dbPart.name,
          quantity,
          total: dbPart.priceEur * quantity,
        })),
        total,
        name,
      });
    } catch (mailErr) {
      logger.warn("Failed to send confirmation email", mailErr);
    }

    return apiSuccess({
      orderId,
      demo: true,
      totals: { total, vatEur: vat.vatEur, exVatEur: vat.exVatEur, vatRate: vat.vatRate },
    });
  } catch (err) {
    logger.error("Checkout error", err);
    return apiError("Bestelling kon niet worden verwerkt", 500);
  }
}
