/**
 * Order housekeeping (the job behind /api/cron/orders and the first step of /api/cron/daily).
 *
 * SCHEDULE: whatever vercel.json says (it is the source of truth; at the time of
 * writing one daily run through /api/cron/daily). A run later than the deadline
 * only means expired orders are cancelled and reminders go out later: the first
 * payment reminder is sent at the first run AFTER the due date, which under a
 * daily schedule is the day after it (the mail is worded from "now versus the
 * due date" for that reason).
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
 *      mail each, recorded; see ../reminders.ts).
 * Returns the counts. The owner gets ONE summary when anything was cancelled,
 * could not be, or did not fit in the time.
 *
 * TIME. The job gets ctx.remainingMs from the runner (20 s as the first of the
 * four daily jobs, the whole 50 s budget on the standalone route) and must fit
 * inside it: each cancellation awaits a customer mail (10 s timeout) and an
 * owner notice (3 s per channel), and each reminder a mail, so 25 cancellations
 * or 50 reminders on a backlog day take far longer than a minute when the mail
 * provider is slow. The time, minus a reserve for the summary and the result, is
 * split: the bank-transfer sweep may take half of it, the abandoned-order sweep
 * at most ABANDONED_SWEEP_MS (its usual 15 s) and at most two thirds of what is
 * then left, the reminders get the rest; these are caps, so a quick step leaves
 * its time to the next one, and no step gets less than ORDERS_STEP_FLOOR_MS. The sweep's
 * deadline is the one src/lib/cart-expiry.ts offers (it returns what is done so
 * far; the cancellation in flight completes in the background), the other two
 * stop before their next order. What did not fit is reported as `truncated`
 * and waits for the next run (or a hand run of /api/cron/orders): the sweep
 * takes the oldest orders first and the reminders are claimed per order, so a
 * cut-off loses nothing, it only delays. A daily run that is cut short every day
 * is a backlog the owner must know about, hence the line in the summary.
 */
import { releaseExpiredBankTransferOrders, expireAbandonedStripeOrders } from "@/lib/cart-expiry";
import { env } from "@/lib/env";
import { notifyOwner } from "@/lib/notify";
import { revalidateCatalog } from "@/lib/cache-tags";
import { sendPaymentReminders } from "../reminders";
import type { CronJob, JobContext } from "../runner";

/**
 * Kept back from the job's time for the owner summary and the result. The summary is awaited, and notifyOwner gives
 * every channel 3 s (src/lib/notify.ts, DEFAULT_TIMEOUT_MS, in parallel), so the reserve covers one dead channel with
 * a margin: otherwise a day on which the three steps use their whole share plus a 3 s notify time-out would be recorded
 * by the runner as job_timed_out although every step finished (review finding).
 */
export const ORDERS_RESERVE_MS = 4_000;
/** No step runs with less than this, so even a tiny budget does something. */
export const ORDERS_STEP_FLOOR_MS = 1_000;
/** The abandoned-order sweep never gets more than this: the same 15 s cart-expiry.ts applies when nothing is passed. */
export const ABANDONED_SWEEP_MS = 15_000;
const SWEEP_SHARE = 1 / 2;
const ABANDONED_SHARE = 2 / 3;
export const EXPIRY_LIMIT = 25;

/** The three steps, replaceable so scripts/qa-admin.ts can watch which deadline each one gets. */
export type OrdersJobDeps = {
  releaseExpired: typeof releaseExpiredBankTransferOrders;
  expireAbandoned: typeof expireAbandonedStripeOrders;
  sendReminders: typeof sendPaymentReminders;
  notify: typeof notifyOwner;
  now: () => number;
};

const defaultDeps: OrdersJobDeps = {
  releaseExpired: releaseExpiredBankTransferOrders,
  expireAbandoned: expireAbandonedStripeOrders,
  sendReminders: sendPaymentReminders,
  notify: notifyOwner,
  now: Date.now,
};

export function makeOrdersJob(overrides: Partial<OrdersJobDeps> = {}): CronJob {
  const deps = { ...defaultDeps, ...overrides };
  return {
    name: "orders",
    async run({ remainingMs }: JobContext) {
      const deadline = deps.now() + Math.max(ORDERS_STEP_FLOOR_MS, remainingMs - ORDERS_RESERVE_MS);
      const left = () => Math.max(ORDERS_STEP_FLOOR_MS, deadline - deps.now());
      const share = (fraction: number) => Math.max(ORDERS_STEP_FLOOR_MS, Math.floor(left() * fraction));

      const expiry = await deps.releaseExpired({ limit: EXPIRY_LIMIT, deadlineMs: share(SWEEP_SHARE) });
      const abandoned = await deps.expireAbandoned({ deadlineMs: Math.min(ABANDONED_SWEEP_MS, share(ABANDONED_SHARE)) });
      const reminders = await deps.sendReminders({ deadlineMs: left() });
      // The sweep reports no cut-off of its own: an examined order that is neither cancelled, failed nor a
      // conflict was not reached before the deadline (or, rarely, was already cancelled by someone else).
      const sweepTruncated = expiry.examined > expiry.cancelled + expiry.failed + expiry.conflicts;
      const truncated = sweepTruncated || reminders.truncated;

      if (expiry.cancelled > 0) revalidateCatalog();
      if (expiry.cancelled > 0 || expiry.failed > 0 || expiry.conflicts > 0 || truncated) {
        const base = env.APP_URL.replace(/\/+$/, "");
        await deps.notify({
          event: "cron.orders",
          level: expiry.failed > 0 || truncated ? "warn" : "info",
          title: `Onbetaalde bestellingen opgeruimd: ${expiry.cancelled}`,
          lines: [
            `${expiry.cancelled} geannuleerd, de voorraad is teruggezet en de klanten zijn gemaild.`,
            ...(expiry.failed > 0 ? [`${expiry.failed} konden niet worden geannuleerd: kijk in de log.`] : []),
            ...(expiry.conflicts > 0 ? [`${expiry.conflicts} stonden niet meer open (bijvoorbeeld net als betaald gemarkeerd) en zijn met rust gelaten.`] : []),
            ...(truncated
              ? [
                  `Niet alles paste in de ${Math.round(remainingMs / 1000)} s van deze run (${sweepTruncated ? "annuleringen" : ""}${sweepTruncated && reminders.truncated ? " en " : ""}${reminders.truncated ? "herinneringen" : ""} bleven over). De rest komt bij de volgende run aan de beurt, of nu: curl -H "Authorization: Bearer $CRON_SECRET" ${base}/api/cron/orders`,
                ]
              : []),
          ],
          url: "/admin/bestellingen?view=geannuleerd",
        });
      }
      return { expiry, abandonedStripe: abandoned, reminders, truncated };
    },
  };
}

export const ordersJob: CronJob = makeOrdersJob();
