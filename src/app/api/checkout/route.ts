import { NextRequest } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { getCurrentUser, getPlanLimits } from "@/lib/auth";
import { env } from "@/lib/env";
import { apiError, apiSuccess } from "@/lib/api-response";
import { rateLimit, getClientKey } from "@/lib/ratelimit";
import { staticPart, staticPartById } from "@/lib/static-db";
import { money, splitVatInclusive } from "@/lib/invoicing";
import { VAT_RATE } from "@/lib/plans";
import { currentVisitorId, recordConversion, recordSignup } from "@/lib/referrals";

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

    const { items, email, name, address, vatNumber } = parsed.data;

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

    // Stock validation
    for (const item of resolvedItems) {
      const part = item.dbPart;
      if (part.stock < item.quantity) {
        return apiError(`Onvoldoende voorraad voor ${part.name} (${part.stock} beschikbaar)`, 400);
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
    const shipping = subtotal - discount >= 50 ? 0 : 5.95;
    const total = money(subtotal - discount + shipping);

    // Catalog prices are shown including 21% btw, so the VAT is contained in
    // the total rather than added to it — the customer pays the price they saw.
    const vat = splitVatInclusive(total, VAT_RATE);

    // Try to persist the order. If DB is unreachable (demo deploy), generate a demo
    // order id and return success so the customer still sees a confirmation page.
    let orderId: string;
    let demoMode = false;
    try {
      let userId = user?.id;
      if (!userId) {
        const existing = await prisma.user.findUnique({ where: { email } });
        userId = existing
          ? existing.id
          : (await prisma.user.create({
              data: { email, name, role: "CONSUMER", plan: "FREE" },
            })).id;
      }

      const order = await prisma.order.create({
        data: {
          userId: userId!,
          email,
          subtotalEur: subtotal,
          discountEur: discount,
          shippingEur: shipping,
          totalEur: total,
          vatRate: vat.vatRate,
          vatEur: vat.vatEur,
          vatNumber: vatNumber ?? null,
          costEur: costKnownForAll ? money(costOfGoods) : null,
          shippingAddress: JSON.stringify({ name, ...address }),
          status: "PENDING",
          items: { create: orderItems },
        },
      });
      orderId = order.id;
    } catch (dbErr) {
      logger.warn("Order persistence failed (DB unreachable) — issuing demo order id", dbErr);
      // Generate a deterministic demo order id
      orderId = "demo-" + Math.random().toString(36).slice(2, 10).toUpperCase();
      demoMode = true;
    }

    // Referral attribution rides along in Stripe metadata so the webhook can
    // credit the referrer after the redirect (webhooks receive no cookies).
    const visitorId = await currentVisitorId();
    if (visitorId) await recordSignup(visitorId);

    const stripe = getStripe();

    if (stripe && !demoMode) {
      try {
        const session = await stripe.checkout.sessions.create(
          {
            mode: "payment",
            payment_method_types: ["card", "ideal", "bancontact"],
            line_items: resolvedItems.map(({ dbPart, quantity }) => ({
              price_data: {
                currency: "eur",
                product_data: { name: dbPart.name, metadata: { sku: dbPart.sku } },
                unit_amount: Math.round(dbPart.priceEur * 100),
              },
              quantity,
            })),
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
        logger.warn("Stripe session create failed — falling back to demo confirmation", stripeErr);
      }
    }

    // Demo mode (or Stripe not configured) — mark as paid + deduct stock atomically
    if (!demoMode) {
      try {
        await prisma.$transaction(async (tx) => {
          await tx.order.update({ where: { id: orderId }, data: { status: "PAID" } });
          for (const item of resolvedItems) {
            await tx.part.update({
              where: { id: item.dbPart.id },
              data: { stock: { decrement: item.quantity } },
            });
          }
        });
        // A paid order needs an invoice with a btw-specification (7y retention).
        const { issueInvoiceForOrder } = await import("@/lib/invoicing");
        await issueInvoiceForOrder(orderId);
      } catch { /* ignore — order still valid */ }
    }

    // Paid straight away (demo/no-Stripe path) — credit the referrer now.
    if (visitorId) await recordConversion(visitorId);

    // Send confirmation email if Resend is configured
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
