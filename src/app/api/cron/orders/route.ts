/**
 * Hourly order housekeeping. Needs `Authorization: Bearer <CRON_SECRET>`.
 *
 * INTENDED SCHEDULE: hourly ("0 * * * *"); bundle S6 writes vercel.json from this header.
 * NOT VERIFIED: whether the hosting plan allows a cron this often (vercel.com could
 * not be read from here, and one reviewer believed a Vercel Hobby plan only allows
 * daily crons, which would make a deploy with an hourly entry fail). Check the plan
 * before copying this into vercel.json. Run once a day, or from an external
 * scheduler that sends the same Bearer header, the route does the same work,
 * only later: expired orders are cancelled up to a day after their deadline and a
 * reminder is sent at the first run after it is due.
 *
 * WHAT IT DOES, in this order, with the existing domain functions:
 *   1. Unpaid bank-transfer orders past due date + BANK_TRANSFER_GRACE_DAYS are
 *      cancelled through cancelOrder() (units back, credit note for the invoice,
 *      customer mailed, owner pinged), at most 25 per run. This is what lets the
 *      sweep work with zero traffic: until now it only ran inside a checkout.
 *   2. Stripe orders still PENDING after ABANDONED_STRIPE_ORDER_HOURS are closed.
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
  if (expiry.cancelled > 0 || expiry.failed > 0) {
    await notifyOwner({
      event: "cron.orders",
      level: expiry.failed > 0 ? "warn" : "info",
      title: `Onbetaalde bestellingen opgeruimd: ${expiry.cancelled}`,
      lines: [
        `${expiry.cancelled} geannuleerd, de voorraad is teruggezet en de klanten zijn gemaild.`,
        ...(expiry.failed > 0 ? [`${expiry.failed} konden niet worden geannuleerd: kijk in de log.`] : []),
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
