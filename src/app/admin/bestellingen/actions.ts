"use server";

/**
 * The order desk's mutations. Each one is a thin wrapper: admin check, zod
 * validation of the form, ONE call into the order domain (src/lib/invoicing.ts),
 * and cache invalidation. No state rule lives here; the domain functions decide
 * with conditional updates, so a double click or two admins at once cannot both win.
 *
 * Money out: for an order paid with card or iDEAL the Stripe refund is created
 * FIRST and its id is handed to the domain (cancelOrder / recordRefund), which is
 * what makes the later charge.refunded webhook a no-op. If Stripe refuses, the order
 * has not been touched and the form says so. For a bank-transfer order nothing
 * moves automatically: the domain issues the credit note and the message tells
 * the owner how much to wire back.
 */
import { refreshPath as revalidatePath } from "../_lib/revalidate";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { revalidateCatalog } from "@/lib/cache-tags";
import { notifyOwner } from "@/lib/notify";
import {
  AmountMismatchError,
  CompanyNotReadyError,
  cancelOrder,
  issueInvoiceForOrder,
  markOrderDelivered,
  markOrderPaidByBankTransfer,
  markOrderShipped,
  updateOrderTracking,
} from "@/lib/invoicing";
import { refundStripePayment } from "@/lib/stripe";
import { performRefund, readRestock } from "../_lib/refund";
import { CARRIERS, carrierLabel } from "@/lib/emails/tracking";
import { ORDER_STATUSES, ORDER_STATUS_LABEL, isOrderStatus, orderRef } from "@/lib/order-status";
import { eurNl } from "@/lib/emails/money";
import { resendOrderMail } from "../_lib/mail-resend";
import { parseMoney } from "@/lib/export-csv";
import { adminGuard, done, fail, type ActionState } from "../_lib/guard";

type Prev = ActionState | null;
/** A form field as a string; a missing one is "" so the schema answers with its own Dutch message. */
const str = (fd: FormData, key: string): string => { const v = fd.get(key); return typeof v === "string" ? v : ""; };

const OrderId = z.string().trim().min(1).max(40).regex(/^[a-z0-9]+$/i, "Ongeldige bestelling.");
const eur = eurNl;

function refresh(orderId: string, stockChanged: boolean) {
  revalidatePath("/admin/bestellingen");
  revalidatePath("/admin");
  revalidatePath(`/bestelling/${orderId}`);
  if (stockChanged) {
    revalidatePath("/admin/onderdelen");
    revalidateCatalog();
  }
}

const mailNote = (sent: boolean | null | undefined) =>
  sent === true ? " De klant is gemaild." : sent === false ? " De e-mail aan de klant kon NIET worden verstuurd; stuur het zelf na." : "";

// ─── Betaling ontvangen ───────────────────────────────────────────────

export async function markPaidAction(_prev: Prev, fd: FormData): Promise<ActionState> {
  const g = await adminGuard();
  if (!g.ok) return fail(g.error);
  const parsed = z
    .object({ orderId: OrderId, received: z.string().trim().min(1, "Vul het bedrag in dat op de bank is binnengekomen.").max(20) })
    .safeParse({ orderId: str(fd, "orderId"), received: str(fd, "received") });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Ongeldige invoer.");
  const amount = parseMoney(parsed.data.received);
  if (amount === null || amount <= 0) return fail("Dit is geen geldig bedrag. Gebruik bijvoorbeeld 34,45.");

  try {
    const res = await markOrderPaidByBankTransfer(parsed.data.orderId, { receivedAmountEur: amount });
    if (!res.ok) return fail(res.error);
    logger.info("[admin] order marked paid", { orderId: parsed.data.orderId, by: g.email });
    refresh(parsed.data.orderId, true);
    return done(res.alreadyPaid ? "Deze bestelling stond al als betaald." : `Betaling geboekt.${mailNote(res.emailSent ?? null)}`);
  } catch (err) {
    // The domain throws when the amount differs by even one cent. Show its sentence as is.
    if (err instanceof AmountMismatchError) return fail(err.message);
    logger.error("[admin] mark paid failed", err);
    return fail("Betaling markeren mislukt. Probeer het opnieuw.");
  }
}

// ─── Verzenden ────────────────────────────────────────────────────────

const ShipSchema = z.object({
  orderId: OrderId,
  carrier: z.enum([...CARRIERS, "OTHER"] as const, { message: "Kies een vervoerder." }),
  carrierOther: z.string().trim().max(40).optional(),
  trackingCode: z.string().trim().min(3, "Vul de trackingcode in (minstens 3 tekens).").max(64, "De trackingcode is te lang."),
});

function shipInput(fd: FormData): { error: string } | { orderId: string; carrier: string; trackingCode: string } {
  const parsed = ShipSchema.safeParse({
    orderId: str(fd, "orderId"),
    carrier: str(fd, "carrier"),
    carrierOther: (str(fd, "carrierOther") || undefined),
    trackingCode: str(fd, "trackingCode"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Ongeldige invoer." };
  const d = parsed.data;
  if (d.carrier === "OTHER" && !d.carrierOther) return { error: "Vul de naam van de vervoerder in." };
  return { orderId: d.orderId, carrier: d.carrier === "OTHER" ? (d.carrierOther as string) : d.carrier, trackingCode: d.trackingCode };
}

export async function markShippedAction(_prev: Prev, fd: FormData): Promise<ActionState> {
  const g = await adminGuard();
  if (!g.ok) return fail(g.error);
  const input = shipInput(fd);
  if ("error" in input) return fail(input.error);
  const res = await markOrderShipped(input.orderId, { carrier: input.carrier, trackingCode: input.trackingCode });
  if (!res.ok) return fail(res.error);
  logger.info("[admin] order shipped", { orderId: input.orderId, by: g.email });
  refresh(input.orderId, false);
  return done(res.alreadyShipped ? "Deze bestelling was al als verzonden gemarkeerd." : `Als verzonden gemarkeerd (${carrierLabel(input.carrier)}).${mailNote(res.emailSent)}`);
}

export async function correctTrackingAction(_prev: Prev, fd: FormData): Promise<ActionState> {
  const g = await adminGuard();
  if (!g.ok) return fail(g.error);
  const input = shipInput(fd);
  if ("error" in input) return fail(input.error);
  const res = await updateOrderTracking(input.orderId, { carrier: input.carrier, trackingCode: input.trackingCode, resendEmail: fd.get("resend") === "on" });
  if (!res.ok) return fail(res.error);
  refresh(input.orderId, false);
  return done(`Trackinggegevens aangepast.${mailNote(res.emailSent)}`);
}

export async function markDeliveredAction(_prev: Prev, fd: FormData): Promise<ActionState> {
  const g = await adminGuard();
  if (!g.ok) return fail(g.error);
  const parsed = OrderId.safeParse(str(fd, "orderId"));
  if (!parsed.success) return fail("Ongeldige bestelling.");
  const res = await markOrderDelivered(parsed.data);
  if (!res.ok) return fail(res.error);
  refresh(parsed.data, false);
  return done(res.alreadyDelivered ? "Was al als afgeleverd gemarkeerd." : "Als afgeleverd gemarkeerd. De bedenktijd van de klant loopt vanaf nu.");
}

// ─── Annuleren ────────────────────────────────────────────────────────

export async function cancelOrderAction(_prev: Prev, fd: FormData): Promise<ActionState> {
  const g = await adminGuard();
  if (!g.ok) return fail(g.error);
  const parsed = z
    .object({
      orderId: OrderId,
      reason: z.string().trim().min(3, "Geef een reden op (minstens 3 tekens).").max(200),
      // The status the owner SAW when the page was rendered (hidden field of the form).
      expectedStatus: z.enum(ORDER_STATUSES).optional(),
    })
    .safeParse({ orderId: str(fd, "orderId"), reason: str(fd, "reason"), expectedStatus: str(fd, "expectedStatus") || undefined });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Ongeldige invoer.");
  if (fd.get("confirm") !== "on") return fail("Vink aan dat je deze bestelling wilt annuleren.");
  const { orderId, reason } = parsed.data;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { status: true, paymentMethod: true, stripePaymentIntentId: true, totalEur: true, refundedEur: true },
  });
  if (!order) return fail("Bestelling niet gevonden.");
  // What the owner decided on is what the page showed. If the order has moved on
  // (the expiry sweep, a payment, a second admin), cancelling it now would act on a
  // decision about a different order: refuse BEFORE any money moves at Stripe.
  const expected = parsed.data.expectedStatus ?? (isOrderStatus(order.status) ? order.status : undefined);
  if (parsed.data.expectedStatus && order.status !== parsed.data.expectedStatus && order.status !== "CANCELLED") {
    return fail(`Deze bestelling is intussen gewijzigd: de pagina toonde "${ORDER_STATUS_LABEL[parsed.data.expectedStatus]}", nu staat ze op "${isOrderStatus(order.status) ? ORDER_STATUS_LABEL[order.status] : order.status}". Er is niets geannuleerd en niets teruggestort. Ververs de pagina.`);
  }

  // A paid card/iDEAL order: the money goes back through Stripe first. The
  // idempotency key is per order, so a double click is one refund at Stripe.
  let stripeRefundId: string | undefined;
  let stripeNote = "";
  if (order.status === "PAID" && order.paymentMethod === "STRIPE") {
    const remaining = Math.round((order.totalEur - order.refundedEur) * 100) / 100;
    if (remaining > 0) {
      if (!order.stripePaymentIntentId) {
        stripeNote = ` Bij deze bestelling is geen Stripe-betaling vastgelegd: betaal ${eur(remaining)} zelf terug in het Stripe-dashboard.`;
      } else {
        const refund = await refundStripePayment({
          orderId,
          paymentIntentId: order.stripePaymentIntentId,
          amountEur: remaining,
          idempotencyKey: `cancel-${orderId}`,
        });
        if (!refund.ok) return fail(`${refund.error} De bestelling is niet geannuleerd.`);
        stripeRefundId = refund.refundId;
      }
    }
  }

  const res = await cancelOrder(orderId, { reason, customerReason: reason, actor: "admin", stripeRefundId, ...(expected ? { onlyFrom: [expected] } : {}) });
  if (!res.ok) {
    if (stripeRefundId) {
      // The money is back with the customer but the order did not cancel (it changed under us). Never leave that quiet.
      await notifyOwner({
        event: "order.cancel_after_refund_failed",
        level: "error",
        title: `Bestelling #${orderRef(orderId)}: terugbetaald maar niet geannuleerd`,
        lines: [`Stripe-terugbetaling ${stripeRefundId} is gemaakt, maar annuleren mislukte: ${res.error}`, "Controleer de bestelling."],
        url: "/admin/bestellingen",
      });
      return fail(`Stripe heeft het bedrag al teruggestort (${stripeRefundId}), maar annuleren mislukte: ${res.error} Controleer de bestelling.`);
    }
    return fail(res.error);
  }
  logger.info("[admin] order cancelled", { orderId, by: g.email, stripeRefund: !!stripeRefundId });
  refresh(orderId, res.restocked);
  if (res.alreadyCancelled) return done("Deze bestelling was al geannuleerd.");

  const parts = ["Bestelling geannuleerd."];
  if (res.restocked) parts.push("De voorraad is teruggezet.");
  if (res.creditNote) parts.push(`Creditnota ${res.creditNote.number} uitgegeven.`);
  if (stripeRefundId) parts.push(`${eur(order.totalEur - order.refundedEur)} is via Stripe teruggestort.`);
  else if (res.refundDueEur > 0) parts.push(`Betaal ${eur(res.refundDueEur)} per bank terug aan de klant; dit systeem verstuurt geen geld.`);
  parts.push(mailNote(res.emailSent).trim());
  return done(`${parts.filter(Boolean).join(" ")}${stripeNote}`);
}

// ─── Terugbetaling vastleggen ─────────────────────────────────────────

export async function recordRefundAction(_prev: Prev, fd: FormData): Promise<ActionState> {
  const g = await adminGuard();
  if (!g.ok) return fail(g.error);
  const parsed = z
    .object({
      orderId: OrderId,
      amount: z.string().trim().min(1, "Vul het terug te betalen bedrag in.").max(20),
      reason: z.string().trim().min(3, "Geef een reden op (minstens 3 tekens).").max(200),
      key: z.string().trim().min(8).max(60).regex(/^[\w-]+$/),
      expected: z.string().trim().max(20),
    })
    .safeParse({ orderId: str(fd, "orderId"), amount: str(fd, "amount"), reason: str(fd, "reason"), key: str(fd, "idempotencyKey"), expected: str(fd, "expectedRefundedEur") });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Ongeldige invoer.");
  const amount = parseMoney(parsed.data.amount);
  if (amount === null || amount <= 0) return fail("Dit is geen geldig bedrag. Gebruik bijvoorbeeld 12,50.");
  const expected = parsed.data.expected === "" ? undefined : Number(parsed.data.expected);
  if (expected !== undefined && !Number.isFinite(expected)) return fail("Ververs de pagina en probeer het opnieuw.");
  const { orderId, reason, key } = parsed.data;

  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { items: { select: { partId: true, quantity: true } } } });
  if (!order) return fail("Bestelling niet gevonden.");
  const restock = readRestock(fd, order.items);
  if ("error" in restock) return fail(restock.error);

  const res = await performRefund({ orderId, amountEur: amount, reason, key, expectedRefundedEur: expected, restock: restock.restock });
  if (!res.ok) return fail(res.error);
  logger.info("[admin] refund recorded", { orderId, by: g.email, credit: res.creditNoteNumber });
  return done(res.message);
}

// ─── E-mail opnieuw sturen ────────────────────────────────────────────

/**
 * "Stuur betaalinstructies / bevestiging / betaling-ontvangen opnieuw". Only sends:
 * no status, stock or invoice changes (see resendOrderMail). Admin only, and at
 * most one send per order and kind per minute.
 */
export async function resendOrderMailAction(_prev: Prev, fd: FormData): Promise<ActionState> {
  const g = await adminGuard();
  if (!g.ok) return fail(g.error);
  const parsed = z
    .object({ orderId: OrderId, kind: z.enum(["bank-instructions", "order-paid", "payment-received"], { message: "Onbekend soort e-mail." }) })
    .safeParse({ orderId: str(fd, "orderId"), kind: str(fd, "kind") });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Ongeldige invoer.");
  const res = await resendOrderMail(parsed.data.orderId, parsed.data.kind);
  if (!res.ok) return fail(res.error);
  logger.info("[admin] order mail resent", { orderId: parsed.data.orderId, kind: parsed.data.kind, by: g.email });
  return done(res.message);
}

// ─── Factuur aanmaken ─────────────────────────────────────────────────

/**
 * A PAID order without an invoice (the company identity was incomplete when it
 * was paid). Without this the invoice only appeared when the customer opened the
 * invoice page, dated that day. Idempotent: an order that has an invoice keeps it.
 */
export async function issueInvoiceAction(_prev: Prev, fd: FormData): Promise<ActionState> {
  const g = await adminGuard();
  if (!g.ok) return fail(g.error);
  const parsed = OrderId.safeParse(str(fd, "orderId"));
  if (!parsed.success) return fail("Ongeldige bestelling.");
  const order = await prisma.order.findUnique({ where: { id: parsed.data }, select: { status: true, invoice: { select: { number: true } } } });
  if (!order) return fail("Bestelling niet gevonden.");
  if (order.invoice) return done(`Deze bestelling heeft al een factuur (${order.invoice.number}).`);
  if (order.status !== "PAID" && order.status !== "SHIPPED" && order.status !== "DELIVERED") {
    return fail("Alleen een betaalde bestelling krijgt een factuur op deze manier. Bij een bestelling op rekening staat de factuur er al.");
  }
  try {
    const invoice = await issueInvoiceForOrder(parsed.data);
    if (!invoice) return fail("De factuur kon niet worden aangemaakt. Probeer het opnieuw.");
    logger.info("[admin] invoice issued from the order desk", { orderId: parsed.data, number: invoice.number, by: g.email });
    refresh(parsed.data, false);
    return done(`Factuur ${invoice.number} aangemaakt. Let op: de factuurdatum is vandaag, niet de betaaldatum.`);
  } catch (err) {
    if (err instanceof CompanyNotReadyError) return fail(`Er kan nog geen factuur worden gemaakt: ${err.message} Stel de bedrijfsgegevens in en probeer het opnieuw.`);
    logger.error("[admin] could not issue invoice", err);
    return fail("De factuur kon niet worden aangemaakt. Probeer het opnieuw.");
  }
}
