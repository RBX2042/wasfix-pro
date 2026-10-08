import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { recordRefund } from "@/lib/invoicing";
import { notifyOwner } from "@/lib/notify";
import { orderRef } from "@/lib/order-status";
import { refundStripePayment } from "@/lib/stripe";
import { revalidateCatalog } from "@/lib/cache-tags";
import { refreshPath as revalidatePath } from "./revalidate";

export const eurText = (n: number) => `€ ${n.toFixed(2).replace(".", ",")}`;

const STALE_PAGE_ERROR = "Deze bestelling is intussen gewijzigd (er is al een andere terugbetaling geboekt). Er is niets teruggestort of geboekt. Ververs de pagina om de actuele stand te zien.";

export type RefundOutcome =
  | { ok: true; message: string; creditNoteNumber: string; replayed: boolean; refundedEur: number }
  | { ok: false; error: string };

/** Read the "restock_<partId>" number inputs of a form against the lines of the order. */
export function readRestock(fd: FormData, items: Array<{ partId: string; quantity: number }>): { restock: Array<{ partId: string; quantity: number }> } | { error: string } {
  const restock: Array<{ partId: string; quantity: number }> = [];
  for (const item of items) {
    const raw = String(fd.get(`restock_${item.partId}`) ?? "").trim();
    if (!raw) continue;
    const qty = Number(raw);
    if (!Number.isInteger(qty) || qty < 0 || qty > item.quantity) return { error: "Het aantal terug op voorraad is hoger dan het aantal in de bestelling." };
    if (qty > 0) restock.push({ partId: item.partId, quantity: qty });
  }
  return { restock };
}

/**
 * Pay (part of) an order back and book it: ONE place for the order desk and the
 * return screen. A card/iDEAL order is refunded at Stripe and the Stripe refund id
 * goes into the domain call, which makes the charge.refunded webhook a no-op. A
 * bank-transfer order is booked with the caller's idempotency key; the money is
 * wired back by the owner.
 *
 * ORDER OF CHECKS. Stripe moves money and cannot be undone, the books can still
 * refuse. So everything that can be known BEFORE calling Stripe is checked first:
 * the page the owner looked at (`expectedRefundedEur`) must still match the order.
 * Without that check a second, stale tab refunded at Stripe and was then refused
 * by the books, leaving a refund nobody had booked or been told about. One window
 * remains that this cannot close: another refund committed between the check and
 * the booking. That case is reported loudly (see the conflict branch below), not
 * hidden.
 *
 * `key` must be stable for one intended refund (a key generated when the form
 * rendered, or one derived from the RMA): a double submit then returns the first
 * credit note instead of booking a second. The same key is stored on the credit
 * note for Stripe orders too, so a replay is recognised before Stripe is called.
 */
export async function performRefund(input: {
  orderId: string;
  amountEur: number;
  reason: string;
  key: string;
  expectedRefundedEur?: number;
  restock: Array<{ partId: string; quantity: number }>;
  notifyCustomer?: boolean;
}): Promise<RefundOutcome> {
  const order = await prisma.order.findUnique({
    where: { id: input.orderId },
    select: { paymentMethod: true, stripePaymentIntentId: true, refundedEur: true, status: true, totalEur: true, invoice: { select: { id: true, totalEur: true } } },
  });
  if (!order) return { ok: false, error: "Bestelling niet gevonden." };

  // Rules the booking enforces anyway, checked BEFORE Stripe is called: once Stripe has refunded, a refusal
  // here would leave money moved and nothing booked (a cancelled order, or an amount above what is left).
  const bookKeyEarly = `admin-refund-${input.key}`.slice(0, 100);
  const priorNote = await prisma.creditNote.findUnique({ where: { idempotencyKey: bookKeyEarly }, select: { invoice: { select: { orderId: true } } } });
  // A key that already produced a credit note on THIS order is a replay: it is answered from the stored note, not re-checked.
  const isReplay = priorNote?.invoice.orderId === input.orderId;
  if (!isReplay) {
    if (order.status !== "PAID" && order.status !== "SHIPPED" && order.status !== "DELIVERED") {
      return { ok: false, error: "Alleen een betaalde bestelling kan worden terugbetaald (deze is geannuleerd of nog niet betaald). Er is niets teruggestort." };
    }
    const credited = order.invoice ? ((await prisma.creditNote.aggregate({ where: { invoiceId: order.invoice.id }, _sum: { totalEur: true } }))._sum.totalEur ?? 0) : 0;
    const leftCents = Math.round((order.invoice?.totalEur ?? order.totalEur) * 100) - Math.round(credited * 100);
    const askedCents = Math.round(input.amountEur * 100);
    if (!Number.isFinite(input.amountEur) || askedCents <= 0) return { ok: false, error: "Het terug te betalen bedrag moet groter zijn dan nul." };
    if (askedCents > leftCents) return { ok: false, error: `Het bedrag is hoger dan wat nog terug te betalen is (${eurText(Math.max(leftCents, 0) / 100)}). Er is niets teruggestort.` };
  }

  const bookKey = bookKeyEarly;

  if (input.expectedRefundedEur !== undefined && Math.round(order.refundedEur * 100) !== Math.round(input.expectedRefundedEur * 100)) {
    // A double submit of a refund that WAS booked also lands here (the order moved on because of it):
    // that is a replay, not a conflict, so it goes on to the booking, which answers it from the stored note.
    if (!isReplay) return { ok: false, error: STALE_PAGE_ERROR };
  }

  let stripeRefundId: string | undefined;
  if (order.paymentMethod === "STRIPE" && order.stripePaymentIntentId) {
    const refund = await refundStripePayment({
      orderId: input.orderId,
      paymentIntentId: order.stripePaymentIntentId,
      amountEur: input.amountEur,
      idempotencyKey: `refund-${input.orderId}-${input.key}`.slice(0, 255),
    });
    // A refusal by Stripe happens before anything is booked, so nothing has moved.
    if (!refund.ok) return { ok: false, error: `${refund.error} Er is niets geboekt.` };
    stripeRefundId = refund.refundId;
  }

  const res = await recordRefund(input.orderId, {
    amountEur: input.amountEur,
    reason: input.reason,
    stripeRefundId,
    idempotencyKey: bookKey,
    expectedRefundedEur: input.expectedRefundedEur,
    restock: input.restock.length > 0 ? input.restock : undefined,
    notifyCustomer: input.notifyCustomer,
  });
  if (!res.ok) {
    if (stripeRefundId) {
      // Money has already left via Stripe; do not let this look like "nothing happened".
      await notifyOwner({
        event: "refund.unbooked",
        level: "error",
        title: `Stripe-terugbetaling niet geboekt bij bestelling #${orderRef(input.orderId)}`,
        lines: [`Stripe-refund ${stripeRefundId}: ${eurText(input.amountEur)}`, `Reden: ${res.error}`, "Controleer de bestelling en of er een creditnota voor staat; maak er anders zelf een."],
        url: "/admin/bestellingen",
      });
      logger.error("[admin] Stripe refund created but not booked", { orderId: input.orderId, stripeRefundId, code: res.code });
      if (res.code === "conflict") {
        return { ok: false, error: `LET OP: Stripe heeft ${eurText(input.amountEur)} al teruggestort (${stripeRefundId}), maar de bestelling is op hetzelfde moment gewijzigd en dit bedrag is niet geboekt. Probeer het NIET opnieuw. Ververs de pagina en controleer of er een creditnota voor staat; de eigenaar is op de hoogte gesteld.` };
      }
      return { ok: false, error: `Stripe heeft ${eurText(input.amountEur)} al teruggestort (${stripeRefundId}), maar boeken mislukte: ${res.error} Probeer het opnieuw: dezelfde terugbetaling wordt dan alleen geboekt.` };
    }
    if (res.code === "conflict") return { ok: false, error: STALE_PAGE_ERROR };
    return { ok: false, error: res.error };
  }

  revalidatePath("/admin/bestellingen");
  revalidatePath("/admin/retouren");
  revalidatePath("/admin");
  revalidatePath(`/bestelling/${input.orderId}`);
  if (input.restock.length > 0 || res.cancelled) {
    revalidatePath("/admin/onderdelen");
    revalidateCatalog();
  }

  const mail = res.emailSent === true ? " De klant is gemaild." : res.emailSent === false ? " De e-mail aan de klant kon NIET worden verstuurd; stuur het zelf na." : "";
  if (res.replayed) {
    return { ok: true, message: `Deze terugbetaling was al geboekt (${res.creditNote.number}).`, creditNoteNumber: res.creditNote.number, replayed: true, refundedEur: res.refundedEur };
  }
  const how = stripeRefundId
    ? `${eurText(input.amountEur)} is via Stripe teruggestort.`
    : order.paymentMethod === "STRIPE"
      ? `Betaal ${eurText(input.amountEur)} zelf terug in het Stripe-dashboard: bij deze bestelling is geen Stripe-betaling vastgelegd.`
      : `Betaal ${eurText(input.amountEur)} per bank terug aan de klant; dit systeem verstuurt geen geld.`;
  return {
    ok: true,
    message: `Creditnota ${res.creditNote.number} uitgegeven. ${how}${res.cancelled ? " De bestelling is volledig terugbetaald en geannuleerd." : ""}${mail}`,
    creditNoteNumber: res.creditNote.number,
    replayed: false,
    refundedEur: res.refundedEur,
  };
}
