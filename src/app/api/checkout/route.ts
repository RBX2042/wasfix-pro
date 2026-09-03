import { NextRequest } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { getCurrentUser, getPlanLimits } from "@/lib/auth";
import { env, isDatabaseConfigured } from "@/lib/env";
import { apiError, apiSuccess } from "@/lib/api-response";
import { rateLimit, getClientKey } from "@/lib/ratelimit";
import { staticPart, staticPartById } from "@/lib/static-db";
import { money, splitVatInclusive, issueInvoiceForOrder } from "@/lib/invoicing";
import { VAT_RATE, COMPANY, shippingFor } from "@/lib/plans";
import { currentVisitorId, recordConversion, recordSignup } from "@/lib/referrals";

const BANK_TRANSFER_TERM_DAYS = 14;

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

    // Resolve parts from static catalog (no DB dependency)
    const resolvedItems = items
      .map((cartItem) => {
        const part = (cartItem.sku ? staticPart(cartItem.sku) : null) ?? (cartItem.partId ? staticPartById(cartItem.partId) : null);
        return part ? { dbPart: part, quantity: cartItem.quantity } : null;
      })
      .filter((x): x is { dbPart: NonNullable<ReturnType<typeof staticPart>>; quantity: number } => x !== null);

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

    // A bank-transfer order is a real invoice with WasFix's real IBAN on it.
    // Refuse to issue one to a real customer against placeholder company/
    // fiscal details — they cannot pay a fake IBAN, and a fake KvK/btw
    // number is not a valid invoice. Demo mode is exempt: it's explicitly
    // opted into (see lib/demo-mode.ts) precisely for investor demos and
    // CI, where "issuing" a fake invoice against fake data is expected —
    // same as every other payment path in this file already fakes success
    // in demo mode.
    if (wantsBankTransfer && env.IS_PRODUCTION && !env.DEMO_MODE && COMPANY.isPlaceholder) {
      logger.error("Bank-transfer checkout blocked — COMPANY fiscal identity is still a placeholder in production");
      return apiError(
        "Betalen op factuur is nog niet beschikbaar. Neem contact op via support@wasfix.nl.",
        503
      );
    }

    const visitorId = await currentVisitorId();
    if (visitorId) await recordSignup(visitorId);

    async function resolveUserId(): Promise<string> {
      if (user?.id) return user.id;
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) return existing.id;
      const created = await prisma.user.create({ data: { email, name, role: "CONSUMER", plan: "FREE" } });
      return created.id;
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
            await tx.part.update({ where: { id: item.dbPart.id }, data: { stock: { decrement: item.quantity } } });
          }
          return created;
        });
        orderId = order.id;
      } catch (dbErr) {
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

      const invoice = await issueInvoiceForOrder(orderId);
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
        const discountRatio = subtotal > 0 ? discount / subtotal : 0;
        const lineItems = resolvedItems.map(({ dbPart, quantity }) => ({
          price_data: {
            currency: "eur",
            product_data: { name: dbPart.name, metadata: { sku: dbPart.sku } },
            unit_amount: Math.round(dbPart.priceEur * (1 - discountRatio) * 100),
          },
          quantity,
        }));
        // Rounding per line can drift a cent or two from the stored total;
        // correct it on the last line so the charge reconciles exactly.
        const lineSum = lineItems.reduce((sum, li) => sum + li.price_data.unit_amount * li.quantity, 0);
        const targetSum = Math.round((subtotal - discount) * 100);
        if (lineItems.length > 0 && lineSum !== targetSum) {
          const last = lineItems[lineItems.length - 1];
          last.price_data.unit_amount += Math.round((targetSum - lineSum) / last.quantity);
        }
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

        if (env.IS_PRODUCTION && !env.DEMO_MODE && COMPANY.isPlaceholder) {
          return apiError("Betaling kon niet worden gestart. Probeer het later opnieuw of neem contact op.", 502);
        }

        const dueAt = new Date(Date.now() + BANK_TRANSFER_TERM_DAYS * 24 * 60 * 60 * 1000);
        await prisma.order.update({
          where: { id: orderId },
          data: { status: "OPENSTAAND", paymentMethod: "BANK_TRANSFER", dueAt },
        }).catch(() => {});
        for (const item of resolvedItems) {
          await prisma.part.update({ where: { id: item.dbPart.id }, data: { stock: { decrement: item.quantity } } }).catch(() => {});
        }
        const invoice = await issueInvoiceForOrder(orderId);
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
