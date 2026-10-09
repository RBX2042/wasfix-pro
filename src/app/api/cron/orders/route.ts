/**
 * Order housekeeping. Needs `Authorization: Bearer <CRON_SECRET>`.
 *
 * SCHEDULE: whatever vercel.json says (it is the source of truth; at the time of
 * writing one run per day). A run later than the deadline only means expired
 * orders are cancelled and reminders go out later: the first payment reminder is
 * sent at the first run AFTER the due date, which under a daily schedule is the
 * day after it (the mail is worded from "now versus the due date" for that reason).
 *
 * WHAT IT DOES, in this order, with the existing domain functions:
 *   1. Unpaid bank-transfer orders past due date + BANK_TRANSFER_GRACE_DAYS are
 *      cancelled through cancelOrder() (units back, credit note for the invoice,
 *      customer mailed, owner pinged), at most 25 per run, and only while they are
 *      still OPENSTAAND: one the owner marked paid in the meantime is counted as a
 *      conflict and left alone. This is what lets the sweep work with zero traffic.
 *   2. Stripe orders still PENDING after ABANDONED_STRIPE_ORDER_HOURS are settled
 *      THROUGH STRIPE (paid -> fulfilled, expired -> cancelled, unknown -> left and
 *      the owner is told), never cancelled on the clock alone.
 *   3. Payment reminders at the due date and shortly before the cancellation (one
 *      mail each, recorded; see ../_lib/reminders.ts).
 * Returns the counts as JSON. The owner gets ONE summary when anything was cancelled
 * or could not be.
 */
import { runCron } from "../_lib/auth";
import { releaseExpiredBankTransferOrders, expireAbandonedStripeOrders } from "@/lib/cart-expiry";
import { notifyOwner } from "@/lib/notify";
import { revalidateCatalog } from "@/lib/cache-tags";
import { sendPaymentReminders } from "../_lib/reminders";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function job() {
  const expiry = await releaseExpiredBankTransferOrders({ limit: 25 });
  const abandoned = await expireAbandonedStripeOrders();
  const reminders = await sendPaymentReminders();
  if (expiry.cancelled > 0) revalidateCatalog();
  if (expiry.cancelled > 0 || expiry.failed > 0 || expiry.conflicts > 0) {
    await notifyOwner({
      event: "cron.orders",
      level: expiry.failed > 0 ? "warn" : "info",
      title: `Onbetaalde bestellingen opgeruimd: ${expiry.cancelled}`,
      lines: [
        `${expiry.cancelled} geannuleerd, de voorraad is teruggezet en de klanten zijn gemaild.`,
        ...(expiry.failed > 0 ? [`${expiry.failed} konden niet worden geannuleerd: kijk in de log.`] : []),
        ...(expiry.conflicts > 0 ? [`${expiry.conflicts} stonden niet meer open (bijvoorbeeld net als betaald gemarkeerd) en zijn met rust gelaten.`] : []),
      ],
      url: "/admin/bestellingen?view=geannuleerd",
    });
  }
  return { expiry, abandonedStripe: abandoned, reminders };
}

export async function GET(req: Request) {
  return runCron(req, "orders", job);
}
export async function POST(req: Request) {
  return runCron(req, "orders", job);
}
