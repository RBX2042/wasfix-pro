import { NextRequest } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { getCurrentUser, getPlanLimits } from "@/lib/auth";
import { env } from "@/lib/env";
import { apiError, apiSuccess } from "@/lib/api-response";
import { rateLimit, getClientKey } from "@/lib/ratelimit";

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
    if (!rateLimit(`checkout:${clientKey}`, 10, 60 * 60 * 1000)) {
      return apiError("Te veel bestelpogingen. Probeer het over een uur opnieuw.", 429);
    }

    const body = await req.json().catch(() => null);
    if (!body) return apiError("Ongeldige JSON", 400);

    const parsed = CheckoutSchema.safeParse(body);
    if (!parsed.success) {
      return apiError("Ongeldige bestelgegevens", 400, parsed.error.flatten());
    }

    const { items, email, name, address } = parsed.data;
    const user = await getCurrentUser();

    // Resolve parts: try partId first, then SKU as fallback (for stale carts)
    const partIds = items.map((i) => i.partId).filter(Boolean) as string[];
    const skus = items.map((i) => i.sku).filter(Boolean) as string[];
    const dbParts = await prisma.part.findMany({
      where: { OR: [{ id: { in: partIds } }, { sku: { in: skus } }] },
    });
    if (dbParts.length === 0) {
      return apiError("Geen geldige onderdelen gevonden in winkelmand. Vernieuw de pagina.", 400);
    }

    // Map cart item -> resolved DB part (by id OR sku)
    const resolvedItems = items.map((cartItem) => {
      const part = dbParts.find((p) => p.id === cartItem.partId || p.sku === cartItem.sku);
      return part ? { dbPart: part, quantity: cartItem.quantity } : null;
    }).filter((x): x is { dbPart: typeof dbParts[number]; quantity: number } => x !== null);

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
    const orderItems = resolvedItems.map(({ dbPart, quantity }) => {
      const lineTotal = dbPart.priceEur * quantity;
      subtotal += lineTotal;
      return {
        partId: dbPart.id,
        quantity,
        unitPrice: dbPart.priceEur,
      };
    });

    // Apply subscription discount
    let discount = 0;
    if (user) {
      const limits = getPlanLimits(user.plan);
      discount = subtotal * limits.partsDiscount;
    }
    const shipping = subtotal - discount >= 50 ? 0 : 5.95;
    const total = subtotal - discount + shipping;

    // Find or create user
    let userId = user?.id;
    if (!userId) {
      const existing = await prisma.user.findUnique({ where: { email } });
      userId = existing
        ? existing.id
        : (await prisma.user.create({
            data: { email, name, role: "CONSUMER", plan: "FREE" },
          })).id;
    }

    // Create order in a transaction with stock deduction
    const order = await prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          userId: userId!,
          email,
          subtotalEur: subtotal,
          discountEur: discount,
          shippingEur: shipping,
          totalEur: total,
          shippingAddress: JSON.stringify({ name, ...address }),
          status: "PENDING",
          items: { create: orderItems },
        },
      });

      // Deduct stock atomically (only on demo/direct paid; with Stripe we deduct in webhook)
      return created;
    });

    const stripe = getStripe();

    if (stripe) {
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
          success_url: `${env.APP_URL}/bestelling/${order.id}?success=1`,
          cancel_url: `${env.APP_URL}/checkout`,
          metadata: { orderId: order.id, userId: userId! },
        },
        { idempotencyKey: `checkout-${order.id}` }
      );

      await prisma.order.update({
        where: { id: order.id },
        data: { stripePaymentId: session.id },
      });

      return apiSuccess({ checkoutUrl: session.url, orderId: order.id });
    }

    // Demo mode — mark as paid + deduct stock atomically
    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: { status: "PAID" },
      });
      for (const item of resolvedItems) {
        await tx.part.update({
          where: { id: item.dbPart.id },
          data: { stock: { decrement: item.quantity } },
        });
      }
    });

    // Send confirmation email if Resend is configured
    try {
      const { sendOrderConfirmation } = await import("@/lib/email");
      await sendOrderConfirmation(email, {
        orderId: order.id,
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

    return apiSuccess({ orderId: order.id, demo: true });
  } catch (err) {
    logger.error("Checkout error", err);
    return apiError("Bestelling kon niet worden verwerkt", 500);
  }
}
