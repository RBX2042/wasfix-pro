import { NextRequest, NextResponse, after } from "next/server";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { getCurrentUser, getPlanLimits } from "@/lib/auth";
import { env, isDatabaseConfigured } from "@/lib/env";
import { apiError, apiSuccess } from "@/lib/api-response";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { money, splitVatInclusive, issueInvoiceForOrder, newAccessToken, notifyOrderPlaced, warnAboutUnrealCompany, CompanyNotReadyError } from "@/lib/invoicing";
import { VAT_RATE, shippingFor, companyReadiness } from "@/lib/plans";
import { currentVisitorId, recordConversion, recordSignup } from "@/lib/referrals";
import { notifyError, notifyOwner } from "@/lib/notify";
import { customerOrderUrl } from "@/lib/order-status";
import { revalidateCatalog } from "@/lib/cache-tags";
import { CheckoutRequestSchema, IDEMPOTENCY_KEY_RE, fieldErrorsOf } from "@/lib/cart-schema";
import { cartTotals, cents } from "@/lib/cart-totals";
import { CatalogUnavailableError, evaluateCart, loadLiveParts, publicLine, type CartEvaluation, type LivePart } from "@/lib/cart-pricing";
import { discountedLineItems } from "@/lib/cart-stripe";
import { expireAbandonedStripeOrders, releaseExpiredBankTransferOrders } from "@/lib/cart-expiry";
import { CHECKOUT_UNAVAILABLE_MESSAGE, checkoutBlockedReason } from "@/lib/cart-gate";
import {
  BANK_TRANSFER_TERM_DAYS,
  CAP_HITS_BEFORE_OWNER_NOTICE,
  MAX_BANK_TRANSFER_ORDERS_PER_IP_PER_DAY,
  MAX_CHECKOUT_REQUESTS_PER_IP_PER_HOUR,
  MAX_LINES_PER_ORDER,
  MAX_OPEN_BANK_TRANSFER_VALUE_EUR,
  MAX_OPEN_GUEST_BANK_TRANSFER_VALUE_EUR,
  MAX_ORDERS_PER_IP_PER_HOUR,
  MAX_SWEEP_PER_CHECKOUT,
  MAX_UNITS_PER_ORDER,
  OPEN_BANK_TRANSFER_LIMITS,
  SHORTAGE_SWEEP_DEADLINE_MS,
} from "@/lib/cart-limits";

export const dynamic = "force-dynamic";
// The Stripe call alone may take 2 x 8 s (see src/lib/stripe.ts); the platform default would kill the
// request half way, after the order row exists.
export const maxDuration = 30;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Thrown inside the order transaction; each one maps to a precise answer. */
class CheckoutAbort extends Error {
  constructor(public readonly kind: "out_of_stock" | "cap_buyer_orders" | "cap_buyer_value" | "cap_global", message?: string) {
    super(message ?? kind);
    this.name = "CheckoutAbort";
  }
}

function runAfterResponse(fn: () => Promise<unknown>): void {
  // after() only exists inside a request; scripts that call the handler directly fall back to fire-and-forget.
  try {
    after(fn);
  } catch {
    void fn().catch(() => undefined);
  }
}

const isPrismaError = (err: unknown) => typeof err === "object" && err !== null && /^PrismaClient/.test(err.constructor?.name ?? "");

function unavailable(status = 503) {
  return NextResponse.json({ error: CHECKOUT_UNAVAILABLE_MESSAGE, code: "unavailable", timestamp: new Date().toISOString() }, { status });
}

/** The 409 the customer sees when what they were shown is no longer true. Nothing has been created. */
function cartChanged(evaluation: CartEvaluation, totals: ReturnType<typeof cartTotals> | null, previousTotalEur?: number, partsDiscount = 0) {
  return NextResponse.json(
    {
      error: "Je winkelmand is gewijzigd sinds je hem voor het laatst zag. Controleer de wijzigingen; er is niets besteld.",
      code: "cart_changed",
      changed: true,
      lines: evaluation.lines.map(publicLine),
      totals,
      partsDiscount,
      ...(previousTotalEur !== undefined ? { previousTotalEur } : {}),
      timestamp: new Date().toISOString(),
    },
    { status: 409 },
  );
}

/**
 * A cap was hit. The customer gets a precise message; the owner is told only
 * when it keeps happening (one anonymous caller probing the limits is exactly
 * what the caps are for, and a single refused customer is not worth a ping).
 *
 * "Keeps happening" is CAP_HITS_BEFORE_OWNER_NOTICE hits within an hour, and the notice is sent at
 * most once an hour per limit. Both counters go through rateLimit(): they are shared between server
 * instances only when Upstash is configured; without it every instance counts for itself, so the
 * owner hears about it later (or from each instance once), not never.
 */
async function capHit(scope: string, message: string, code: string) {
  logger.warn("[checkout] cap hit", { scope });
  const withinGrace = await rateLimit(`cap-hits:${scope}`, CAP_HITS_BEFORE_OWNER_NOTICE - 1, HOUR);
  if (!withinGrace && (await rateLimit(`cap-notice:${scope}`, 1, HOUR))) {
    runAfterResponse(() =>
      notifyOwner({
        event: "checkout.cap_hit",
        level: "warn",
        title: "Bestellimiet herhaaldelijk bereikt",
        lines: [`Limiet: ${scope}`, `Meer dan ${CAP_HITS_BEFORE_OWNER_NOTICE - 1} keer in het afgelopen uur.`, "Kijk bij Bestellingen of er openstaande reserveringen zijn die niet echt lijken."],
        url: "/admin/bestellingen",
      }),
    );
  }
  return NextResponse.json({ error: message, code, timestamp: new Date().toISOString() }, { status: 429 });
}

const keyHash = (key: string) => createHash("sha256").update(`checkout:${key}`).digest("hex");

type ReplayableOrder = {
  id: string;
  email: string;
  status: string;
  paymentMethod: string;
  accessToken: string | null;
  stripePaymentId: string | null;
  totalEur: number;
  subtotalEur: number;
  discountEur: number;
  shippingEur: number;
  vatEur: number;
  invoice: { number: string } | null;
  // What the replay check compares with the new request (see sameRequest).
  shippingAddress: string;
  phone: string | null;
  vatNumber: string | null;
  customerNote: string | null;
  items: { partId: string; quantity: number }[];
};

const REPLAY_SELECT = {
  id: true, email: true, status: true, paymentMethod: true, accessToken: true, stripePaymentId: true,
  totalEur: true, subtotalEur: true, discountEur: true, shippingEur: true, vatEur: true,
  shippingAddress: true, phone: true, vatNumber: true, customerNote: true,
  invoice: { select: { number: true } },
  items: { select: { partId: true, quantity: true } },
} as const;

type ParsedCheckout = Extract<ReturnType<typeof CheckoutRequestSchema.safeParse>, { success: true }>["data"];

/**
 * Is this request the one that made `order`? An Idempotency-Key only means "do not do this twice";
 * if a retry arrives with a different cart, address, name, phone, btw-nummer, note, payment method
 * or total, silently answering with the old order would send the parcel to the old address. The
 * order row already stores everything needed, so nothing extra is persisted: the new request is
 * normalised the same way (the schema) and compared field by field with what was stored.
 */
async function sameRequest(order: ReplayableOrder, req: ParsedCheckout): Promise<boolean> {
  if (order.paymentMethod !== (req.paymentMethod === "stripe" ? "STRIPE" : "BANK_TRANSFER")) return false;
  if ((order.phone ?? "") !== req.phone) return false;
  if ((order.vatNumber ?? null) !== (req.vatNumber ?? null)) return false;
  if ((order.customerNote ?? null) !== (req.customerNote ?? null)) return false;
  if (req.expected && cents(req.expected.totalEur) !== cents(order.totalEur)) return false;

  let stored: Record<string, unknown>;
  try {
    stored = JSON.parse(order.shippingAddress) as Record<string, unknown>;
  } catch {
    return false;
  }
  const sent: Record<string, unknown> = { name: req.name, ...req.address };
  for (const key of new Set([...Object.keys(stored), ...Object.keys(sent)])) {
    if (stored[key] !== sent[key]) return false;
  }

  // Lines: resolve the request's sku/partId references to part ids, merge duplicates, compare with the stored lines.
  const parts = await loadLiveParts(req.items);
  const want = new Map<string, number>();
  for (const it of req.items) {
    const part = (it.sku ? parts.find((p) => p.sku === it.sku) : undefined) ?? (it.partId ? parts.find((p) => p.id === it.partId) : undefined);
    if (!part) return false;
    want.set(part.id, (want.get(part.id) ?? 0) + it.quantity);
  }
  if (want.size !== order.items.length) return false;
  return order.items.every((l) => want.get(l.partId) === l.quantity);
}

function bankTransferBody(order: Pick<ReplayableOrder, "id" | "accessToken" | "invoice" | "totalEur" | "vatEur">, emailSent: boolean | null, replayed: boolean) {
  const mailFlag = emailSent === true ? "&m=1" : "";
  return {
    orderId: order.id,
    paymentMethod: "bank_transfer" as const,
    // Relative: the browser follows it on whatever origin it is on. The e-mail links use APP_URL.
    redirectUrl: `/bestelling/${order.id}?t=${order.accessToken}&success=1${mailFlag}`,
    invoiceNumber: order.invoice?.number ?? null,
    emailSent,
    replayed,
    totals: { total: order.totalEur, vatEur: order.vatEur, exVatEur: money(order.totalEur - order.vatEur), vatRate: VAT_RATE },
  };
}

/**
 * Answer a repeated request for an order that already exists: the SAME order, no
 * second order, invoice or reservation. A Stripe order that is still open gets
 * its payment page again; one that is closed makes the client start over.
 */
async function replay(order: ReplayableOrder, req: ParsedCheckout): Promise<NextResponse> {
  if (order.email.toLowerCase() !== req.email || !(await sameRequest(order, req))) {
    return NextResponse.json({ error: "Deze bestelpoging hoort bij andere gegevens. Probeer het opnieuw.", code: "idempotency_conflict" }, { status: 409 });
  }
  if (order.paymentMethod === "BANK_TRANSFER" && order.status !== "CANCELLED") {
    return apiSuccess(bankTransferBody(order, null, true));
  }
  if (order.paymentMethod === "STRIPE") {
    if (order.status === "PAID" || order.status === "SHIPPED" || order.status === "DELIVERED") {
      return apiSuccess({ orderId: order.id, paymentMethod: "stripe", redirectUrl: `/bestelling/${order.id}?t=${order.accessToken}&success=1`, replayed: true });
    }
    const stripe = getStripe();
    if (order.status === "PENDING" && stripe && order.stripePaymentId) {
      try {
        const session = await stripe.checkout.sessions.retrieve(order.stripePaymentId);
        if (session.status === "open" && session.url) {
          return apiSuccess({ orderId: order.id, paymentMethod: "stripe", checkoutUrl: session.url, replayed: true });
        }
      } catch (err) {
        logger.warn("[checkout] could not re-open a Stripe session for a replayed request", err);
      }
    }
    if (order.status === "PENDING" && !order.stripePaymentId) {
      return NextResponse.json({ error: "Je bestelling wordt nog verwerkt. Even geduld.", code: "in_progress" }, { status: 409 });
    }
  }
  return NextResponse.json({ error: "Deze betaalpoging is niet meer geldig. Probeer het opnieuw.", code: "attempt_closed" }, { status: 409 });
}

export async function POST(req: NextRequest) {
  try {
    // ── 1. Can this deployment take an order at all? Fails closed. ──────────────────────────
    const blocked = checkoutBlockedReason();
    if (blocked) {
      // Field NAMES only: the log says what to fix, the customer is told nothing about the configuration.
      logger.error("[checkout] refused: deployment cannot take orders", { reason: blocked.code, missing: blocked.missing });
      runAfterResponse(() => notifyError(new Error(`checkout blocked: ${blocked.code} (${blocked.missing.join(", ")})`), { route: "/api/checkout" }));
      return unavailable();
    }
    if (env.IS_PRODUCTION && companyReadiness().warnings.length > 0) void warnAboutUnrealCompany();

    const ip = clientIp(req) || "anon";
    if (!(await rateLimit(`checkout-requests:${ip}`, MAX_CHECKOUT_REQUESTS_PER_IP_PER_HOUR, HOUR))) {
      return apiError("Te veel verzoeken. Probeer het over een uur opnieuw.", 429);
    }

    // ── 2. Parse and validate; every complaint names the field ──────────────────────────────
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return apiError("Ongeldige JSON", 400);

    const parsed = CheckoutRequestSchema.safeParse(body);
    if (!parsed.success) {
      const fieldErrors = fieldErrorsOf(parsed.error);
      const first = Object.values(fieldErrors)[0] ?? "Ongeldige bestelgegevens";
      return apiError(first, 400, { fieldErrors });
    }
    const { items, email, name, phone, customerNote, address, vatNumber, paymentMethod, expected } = parsed.data;

    const headerKey = req.headers.get("idempotency-key");
    if (headerKey && !IDEMPOTENCY_KEY_RE.test(headerKey)) return apiError("Ongeldige Idempotency-Key", 400);
    const rawKey = headerKey ?? parsed.data.idempotencyKey ?? null;
    const idemKey = rawKey ? keyHash(rawKey) : null;

    // ── 3. A repeated request returns the order it already made ────────────────────────────
    if (idemKey && isDatabaseConfigured()) {
      const existing = await prisma.order.findUnique({ where: { idempotencyKey: idemKey }, select: REPLAY_SELECT });
      if (existing) return await replay(existing, parsed.data);
    }

    // Reservations nobody paid for, and abandoned card attempts, are cleaned up AFTER the response:
    // cancelling one awaits a customer mail and an owner notice, which must not hold this customer.
    if (isDatabaseConfigured()) {
      runAfterResponse(async () => {
        await releaseExpiredBankTransferOrders({ limit: MAX_SWEEP_PER_CHECKOUT }).catch((err) => logger.warn("[checkout] expiry sweep failed", err));
        await expireAbandonedStripeOrders().catch((err) => logger.warn("[checkout] abandoned-order sweep failed", err));
      });
    }

    // The payment method is the customer's choice (decision D5): if it is not available, say so; never switch.
    const stripe = getStripe();
    if (paymentMethod === "stripe" && !stripe) {
      return NextResponse.json({ error: "Betalen met iDEAL of kaart is op dit moment niet beschikbaar. Kies betalen per bankoverschrijving.", code: "payment_method_unavailable" }, { status: 400 });
    }
    // ── 4. Who is ordering ─────────────────────────────────────────────────────────────────
    let user: Awaited<ReturnType<typeof getCurrentUser>> = null;
    try {
      user = await getCurrentUser();
    } catch { /* anonymous */ }

    // ── 5. Limits on what one caller may do ────────────────────────────────────────────────
    const units = items.reduce((n, i) => n + i.quantity, 0);
    if (items.length > MAX_LINES_PER_ORDER) {
      return apiError(`Maximaal ${MAX_LINES_PER_ORDER} verschillende onderdelen per bestelling.`, 400, { fieldErrors: { items: "Te veel onderdelen" } });
    }
    if (units > MAX_UNITS_PER_ORDER) {
      return apiError(`Maximaal ${MAX_UNITS_PER_ORDER} stuks per bestelling. Heb je er meer nodig? Neem contact met ons op.`, 400, { fieldErrors: { items: "Te veel stuks" } });
    }
    if (!(await rateLimit(`checkout-orders:${ip}`, MAX_ORDERS_PER_IP_PER_HOUR, HOUR))) {
      return apiError("Te veel bestelpogingen. Probeer het over een uur opnieuw.", 429);
    }

    // ── 6. Live prices and stock: the ONLY source of what is charged ───────────────────────
    // A database that cannot be read is a 503, never the JSON catalogue (loadLiveParts throws in production).
    let parts: LivePart[];
    let evaluation: CartEvaluation;
    try {
      parts = await loadLiveParts(items);
      evaluation = evaluateCart(items, parts, expected);
      if (isDatabaseConfigured()) {
        // Short of stock? Then an unpaid invoice from weeks ago may be what holds the missing units:
        // release (at most a few of) those first so a paying customer is not refused over them.
        // Only in this case does a request wait for a sweep, and only up to a deadline.
        const short = evaluation.lines.filter((l) => l.part && l.part.stock < l.requestedQuantity).map((l) => (l.part as LivePart).id);
        if (short.length > 0) {
          const released = await releaseExpiredBankTransferOrders({ limit: MAX_SWEEP_PER_CHECKOUT, partIds: short, deadlineMs: SHORTAGE_SWEEP_DEADLINE_MS }).catch((err) => {
            logger.warn("[checkout] shortage sweep failed", err);
            return null;
          });
          // `examined`, not `cancelled`: the background sweep of this very request may have cancelled the order a
          // moment earlier, which makes our own cancel a no-op even though the units are back on the shelf.
          if (released && released.examined > 0) {
            parts = await loadLiveParts(items);
            evaluation = evaluateCart(items, parts, expected);
          }
        }
      }
    } catch (err) {
      if (!(err instanceof CatalogUnavailableError)) logger.error("[checkout] could not read the catalogue", err);
      runAfterResponse(() => notifyError(err instanceof Error ? err : new Error("catalogue unreadable"), { route: "/api/checkout" }));
      return unavailable();
    }

    const orderable = evaluation.orderable;

    let subtotal = 0;
    let costOfGoods = 0;
    // Decision D8: a cost is only booked on the order when EVERY line is backed by a supplier quote.
    // An estimate snapshotted here would reappear as a "real" margin in the admin totals.
    let costAllQuoted = true;
    const orderItems = orderable.map(({ part, quantity }) => {
      const p = part as LivePart;
      subtotal += p.priceEur * quantity;
      if (p.costSource === "QUOTE" && typeof p.costEur === "number") costOfGoods += p.costEur * quantity;
      else costAllQuoted = false;
      return { partId: p.id, quantity, unitPrice: p.priceEur };
    });
    subtotal = money(subtotal);

    let discount = 0;
    if (user) {
      const limits = getPlanLimits(user.plan);
      discount = money(subtotal * limits.partsDiscount);
    }
    const shipping = shippingFor(subtotal, discount);
    const total = money(subtotal - discount + shipping);

    // Anything the customer was not shown (a price, a stock level, a part that is gone, a different
    // total) stops the order here: nothing is created, the client updates the cart and asks again.
    if (evaluation.changed || orderable.length === 0 || (expected && cents(expected.totalEur) !== cents(total))) {
      const partsDiscount = user ? getPlanLimits(user.plan).partsDiscount : 0;
      return cartChanged(evaluation, orderable.length ? cartTotals(subtotal, partsDiscount) : null, expected?.totalEur, partsDiscount);
    }

    // Catalog prices are shown including 21% btw, so the VAT is contained in
    // the total rather than added to it — the customer pays the price they saw.
    const vat = splitVatInclusive(total, VAT_RATE);
    const costEur = costAllQuoted && orderable.length > 0 ? money(costOfGoods) : null;
    const resolved = orderable.map((l) => ({ part: l.part as LivePart, quantity: l.quantity }));

    // ── 7. No database outside production: a labelled demo, nothing stored ─────────────────
    if (!isDatabaseConfigured()) {
      const demoId = "demo-" + Math.random().toString(36).slice(2, 10).toUpperCase();
      return apiSuccess({
        orderId: demoId,
        demo: true,
        paymentMethod,
        redirectUrl: `/bestelling/${demoId}?success=1`,
        totals: { total, vatEur: vat.vatEur, exVatEur: vat.exVatEur, vatRate: vat.vatRate },
      });
    }

    const visitorId = await currentVisitorId();
    if (visitorId) await recordSignup(visitorId);

    const userId = await resolveUserId(user?.id, email, name);
    const accessToken = newAccessToken();
    const common = {
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
      phone,
      customerNote: customerNote ?? null,
      accessToken,
      idempotencyKey: idemKey,
    } satisfies Partial<Prisma.OrderUncheckedCreateInput>;

    // ── 8a. Bank transfer: order, stock and invoice in ONE transaction ──────────────────────
    if (paymentMethod === "bank_transfer") {
      const member = !!user;
      const limits = member ? OPEN_BANK_TRANSFER_LIMITS.member : OPEN_BANK_TRANSFER_LIMITS.guest;
      const failCtx = { email, member, limits, idemKey, stripeOn: !!stripe, req: parsed.data, evaluate: () => reEvaluate(items, expected) };
      const capCtx = { member, userId, email, total, limits };

      // A first, lock-free look at the per-buyer and shop-wide limits, BEFORE the per-network counter is
      // bumped: a request that is refused for those reasons must not use up the network's daily allowance.
      // The transaction below checks the same numbers again under locks; this is the cheap early answer.
      const early = await bankTransferCapViolation(prisma, capCtx);
      if (early) return await orderFailure(new CheckoutAbort(early), failCtx);

      // Counted here, not after the commit: Upstash cannot take an increment back. A request that passes the
      // checks above and still fails inside the transaction (a unit sold out in that instant, a failing
      // invoice) therefore uses one place of the allowance. Refusals by the limits above do not.
      if (!(await rateLimit(`checkout-bank-ip:${ip}`, MAX_BANK_TRANSFER_ORDERS_PER_IP_PER_DAY, DAY))) {
        return capHit(
          "bank_transfer_per_ip",
          `Vanaf dit netwerk is vandaag het maximum van ${MAX_BANK_TRANSFER_ORDERS_PER_IP_PER_DAY} bestellingen op rekening bereikt. ${stripe ? "Betaal met iDEAL of kaart, of probeer het morgen opnieuw." : "Probeer het morgen opnieuw of neem contact met ons op."}`,
          "bank_transfer_limit_ip",
        );
      }

      const dueAt = new Date(Date.now() + BANK_TRANSFER_TERM_DAYS * 24 * 60 * 60 * 1000);
      let created;
      try {
        created = await prisma.$transaction(
          async (tx) => {
            // The caps are counted and the order is written under advisory locks, so ten parallel
            // requests cannot all see "0 open orders" and all pass. Locks are taken in a fixed order:
            // this buyer first, then the shop-wide one that every bank-transfer order takes.
            const buyerKey = member ? `user:${userId}` : `email:${email}`;
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"bt-buyer:" + buyerKey}, 0))`;
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"bt-global"}, 0))`;
            const violation = await bankTransferCapViolation(tx, capCtx);
            if (violation) throw new CheckoutAbort(violation);

            const order = await tx.order.create({
              data: { ...common, status: "OPENSTAAND", paymentMethod: "BANK_TRANSFER", dueAt, items: { create: orderItems } },
            });
            for (const item of resolved) {
              // Conditional decrement: the availability check ran before this transaction, so two buyers
              // of the last unit both passed it. `stock >= quantity` in the write is what serialises them.
              const claimed = await tx.part.updateMany({
                where: { id: item.part.id, stock: { gte: item.quantity } },
                data: { stock: { decrement: item.quantity } },
              });
              if (claimed.count === 0) throw new CheckoutAbort("out_of_stock", item.part.sku);
            }
            // Same transaction: if the invoice cannot be issued the order, the stock claim and the invoice
            // number all roll back together, so nothing is left half done and no number is burned.
            const invoice = await issueInvoiceForOrder(order.id, tx);
            if (!invoice) throw new Error("invoice_not_issued");
            return { order, invoice };
          },
          { maxWait: 8_000, timeout: 20_000 },
        );
      } catch (err) {
        return await orderFailure(err, failCtx);
      }

      revalidateCatalog();
      if (visitorId) await recordConversion(visitorId);
      runAfterResponse(() => notifyOrderPlaced(created.order.id));

      // Handed over to the mail provider or not: the confirmation page only says "we sent it" when this is true.
      const mail = await (await import("@/lib/email"))
        .sendBankTransferInstructions(email, {
          orderId: created.order.id,
          name,
          accessToken,
          invoiceNumber: created.invoice.number,
          totalEur: total,
          dueAt,
          iban: created.invoice.seller.iban ?? "",
          ibanName: created.invoice.seller.name,
        })
        .catch(() => ({ ok: false }));

      return apiSuccess(
        bankTransferBody({ ...created.order, invoice: { number: created.invoice.number } }, mail.ok === true, false),
      );
    }

    // ── 8b. Stripe: the order is created PENDING (it holds no stock; the webhook takes it on payment) ──
    let orderId: string;
    try {
      const order = await prisma.order.create({
        data: { ...common, status: "PENDING", paymentMethod: "STRIPE", items: { create: orderItems } },
      });
      orderId = order.id;
    } catch (err) {
      return await orderFailure(err, { email, member: !!user, limits: OPEN_BANK_TRANSFER_LIMITS.guest, idemKey, stripeOn: true, req: parsed.data, evaluate: () => reEvaluate(items, expected) });
    }

    try {
      // Stripe must charge exactly what the order and the invoice record (see cart-stripe.ts).
      const lineItems = discountedLineItems(
        resolved.map(({ part, quantity }) => ({ name: part.name, sku: part.sku, unitCents: Math.round(part.priceEur * 100), quantity })),
        Math.round((subtotal - discount) * 100),
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

      const session = await stripe!.checkout.sessions.create(
        {
          mode: "payment",
          // Netherlands only for now (decision D6): card and iDEAL.
          payment_method_types: ["card", "ideal"],
          locale: "nl",
          line_items: lineItems,
          customer_email: email,
          // The tokenised address: a guest who has just paid has no account, the token is their way back in.
          success_url: customerOrderUrl(orderId, accessToken, { success: "1" }),
          cancel_url: `${env.APP_URL}/checkout`,
          metadata: { orderId, ...(visitorId ? { refVisitorId: visitorId } : {}) },
        },
        { idempotencyKey: `checkout-${orderId}` },
      );

      await prisma.order.update({ where: { id: orderId }, data: { stripePaymentId: session.id } }).catch((err) => {
        // The webhook finds the order through metadata.orderId, so payment still works; the lookup by session id does not.
        logger.warn("[checkout] could not store the Stripe session id", { orderId, err });
      });
      // No "nieuwe bestelling" notice here: the order is PENDING and most attempts are never paid. The owner
      // hears about it when the payment arrives (the webhook's notifyOrderPaid).
      return apiSuccess({ checkoutUrl: session.url, orderId, paymentMethod: "stripe" });
    } catch (stripeErr) {
      // Decision D5: NO silent switch to bank transfer. The customer stays on the checkout with a clear
      // message, the order that was just created is removed again (it is PENDING: no stock, no invoice),
      // and the owner is told, because a Stripe failure is a configuration problem that costs every sale.
      const e = stripeErr as { type?: string; code?: string; statusCode?: number };
      logger.error("[checkout] Stripe session could not be created", { type: e.type, code: e.code, statusCode: e.statusCode });
      await prisma.order.deleteMany({ where: { id: orderId, status: "PENDING", invoice: { is: null } } }).catch(async (delErr) => {
        logger.error("[checkout] could not delete the order of a failed Stripe attempt", delErr);
        await prisma.order.updateMany({ where: { id: orderId, status: "PENDING" }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: "Stripe-sessie kon niet worden gemaakt" } }).catch(() => undefined);
      });
      runAfterResponse(() =>
        notifyOwner({
          event: "checkout.stripe_failed",
          level: "error",
          title: "Betalen met iDEAL/kaart lukt niet",
          lines: [`Stripe-fout: ${e.type ?? "onbekend"}${e.code ? ` / ${e.code}` : ""}`, "De klant is op de afrekenpagina gebleven; er is geen bestelling aangemaakt.", "Controleer de Stripe-sleutels en of iDEAL en kaart zijn geactiveerd."],
          url: "/admin",
        }),
      );
      return NextResponse.json(
        {
          error: "Betalen met iDEAL of kaart lukt nu niet. Er is niets afgeschreven en er is geen bestelling aangemaakt. Probeer het zo opnieuw, of kies betalen per bankoverschrijving.",
          code: "stripe_unavailable",
          timestamp: new Date().toISOString(),
        },
        { status: 503 },
      );
    }
  } catch (err) {
    logger.error("[checkout] unexpected error", err);
    runAfterResponse(() => notifyError(err instanceof Error ? err : new Error("checkout error"), { route: "/api/checkout" }));
    if (isPrismaError(err)) return unavailable();
    return apiError("Bestelling kon niet worden verwerkt", 500);
  }

  async function reEvaluate(items: { sku?: string; partId?: string; quantity: number }[], expected?: Parameters<typeof evaluateCart>[2]) {
    const fresh = await loadLiveParts(items);
    return evaluateCart(items, fresh, expected);
  }
}

/**
 * Find or create the account row an order hangs on.
 *
 * Case-insensitive on purpose: the same person typing Mixed.Case@Example.NL, then
 * mixed.case@example.nl produced separate User rows, and a Clerk account (which
 * lower-cases) never matched the first. New rows are always created lower-case.
 */
async function resolveUserId(signedInId: string | undefined, email: string, name: string): Promise<string> {
  if (signedInId) return signedInId;
  const existing = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true } });
  if (existing) return existing.id;
  // Upsert, not find-then-create: two guest checkouts with the same e-mail arriving together both found
  // nothing and both inserted. The update rewrites the e-mail with the same value on purpose: Prisma only
  // compiles an upsert to a single INSERT ... ON CONFLICT when the update payload is non-empty.
  const row = await prisma.user.upsert({
    where: { email },
    update: { email },
    create: { email, name, role: "CONSUMER", plan: "FREE" },
  });
  return row.id;
}

type CapContext = {
  member: boolean;
  userId: string;
  email: string;
  total: number;
  limits: { orders: number; valueEur: number };
};

/**
 * The limits on unpaid bank-transfer reservations, as one function so the lock-free early look and the
 * check inside the transaction cannot drift apart. `db` is the client or the transaction.
 *
 *  - per buyer: open orders and open value (a signed-in account by account, a guest by typed address);
 *  - shop-wide: the value of ALL open bank-transfer orders, whoever holds them, against the ceiling
 *    for this kind of buyer (see cart-limits.ts for why it counts everyone).
 */
async function bankTransferCapViolation(db: Pick<Prisma.TransactionClient, "order">, c: CapContext): Promise<CheckoutAbort["kind"] | null> {
  const mine = await db.order.aggregate({
    where: {
      status: "OPENSTAAND",
      paymentMethod: "BANK_TRANSFER",
      ...(c.member ? { userId: c.userId } : { email: { equals: c.email, mode: "insensitive" as const } }),
    },
    _count: { _all: true },
    _sum: { totalEur: true },
  });
  if (mine._count._all >= c.limits.orders) return "cap_buyer_orders";
  if (money((mine._sum.totalEur ?? 0) + c.total) > c.limits.valueEur) return "cap_buyer_value";
  const everyone = await db.order.aggregate({ where: { status: "OPENSTAAND", paymentMethod: "BANK_TRANSFER" }, _sum: { totalEur: true } });
  const ceiling = c.member ? MAX_OPEN_BANK_TRANSFER_VALUE_EUR : MAX_OPEN_GUEST_BANK_TRANSFER_VALUE_EUR;
  if (money((everyone._sum.totalEur ?? 0) + c.total) > ceiling) return "cap_global";
  return null;
}

/** Map what went wrong while writing the order to the answer the customer should see. */
async function orderFailure(
  err: unknown,
  ctx: {
    email: string;
    member: boolean;
    limits: { orders: number; valueEur: number };
    idemKey: string | null;
    /** Is iDEAL / kaart on? Until it is, bank transfer is the only method and a refusal must not point at another one. */
    stripeOn: boolean;
    req: ParsedCheckout;
    evaluate: () => Promise<CartEvaluation>;
  },
): Promise<NextResponse> {
  if (err instanceof CheckoutAbort) {
    switch (err.kind) {
      case "out_of_stock": {
        // Sold out between the check and the write; the transaction rolled back, nothing was created.
        const evaluation = await ctx.evaluate().catch(() => null);
        if (evaluation) return cartChanged(evaluation, null);
        return NextResponse.json({ error: "Een onderdeel raakte net uitverkocht. Er is niets besteld.", code: "cart_changed", changed: true }, { status: 409 });
      }
      case "cap_buyer_orders":
        return capHit(
          "bank_transfer_open_orders",
          `Je hebt al ${ctx.limits.orders} openstaande bestellingen op rekening. Betaal die eerst${ctx.stripeOn ? ", of kies voor iDEAL of kaart" : ""}.${ctx.member ? "" : " Met een account mag je er meer tegelijk open hebben."}${ctx.stripeOn ? "" : " Of neem contact met ons op."}`,
          "bank_transfer_limit_orders",
        );
      case "cap_buyer_value":
        return capHit(
          "bank_transfer_open_value",
          `Het totaal van je openstaande bestellingen op rekening mag niet boven € ${ctx.limits.valueEur} uitkomen. ${ctx.stripeOn ? `Betaal met iDEAL of kaart${ctx.member ? "" : ", of maak een account aan"}.` : `Betaal eerst een openstaande bestelling${ctx.member ? "" : ", maak een account aan"} of neem contact met ons op.`}`,
          "bank_transfer_limit_value",
        );
      case "cap_global":
        return capHit(
          "bank_transfer_global",
          `Betalen op rekening is op dit moment tijdelijk niet beschikbaar. ${ctx.stripeOn ? "Betaal met iDEAL of kaart." : "Probeer het later opnieuw of neem contact met ons op."}`,
          "bank_transfer_unavailable",
        );
    }
  }
  // A parallel request with the same Idempotency-Key won the race: answer with its order.
  const target = (err as { meta?: { target?: unknown } })?.meta?.target;
  if ((err as { code?: string })?.code === "P2002" && ctx.idemKey && String(target).includes("idempotencyKey")) {
    const existing = await prisma.order.findUnique({ where: { idempotencyKey: ctx.idemKey }, select: REPLAY_SELECT });
    if (existing) return replay(existing, ctx.req);
  }
  if (err instanceof CompanyNotReadyError) {
    logger.error("[checkout] invoice refused: company identity incomplete", { missing: err.missing });
    runAfterResponse(() => notifyError(err, { route: "/api/checkout" }));
    return unavailable();
  }
  logger.error("[checkout] order could not be stored", err);
  runAfterResponse(() => notifyError(err instanceof Error ? err : new Error("order not stored"), { route: "/api/checkout" }));
  return NextResponse.json(
    { error: "We konden je bestelling niet vastleggen. Er is niets besteld en niets afgeschreven. Probeer het zo opnieuw.", code: "not_stored", timestamp: new Date().toISOString() },
    { status: 503 },
  );
}
