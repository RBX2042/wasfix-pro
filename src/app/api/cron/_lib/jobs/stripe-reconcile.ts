/**
 * Safety net for Stripe orders whose webhook never arrived (the job behind
 * /api/cron/stripe-reconcile and the last step of /api/cron/daily).
 *
 * Meant for a tighter rhythm than daily (every 15 minutes would be ideal; the
 * daily run is the plan-agnostic floor, see ../runner.ts). On a slower schedule
 * the job does the same work later: a customer who paid while the webhook was
 * down stays PENDING until the next run. Wires reconcilePendingStripeOrders()
 * from src/app/api/stripe/_lib/reconcile.ts; it only looks at orders older
 * than RECONCILE_MIN_AGE_MS there and does nothing without a Stripe client.
 *
 * TIME. The scan is bounded to RECONCILE_BUDGET_MS (reconcile.ts's own default,
 * imported, so the standalone route behaves as before), or to what the daily
 * run has left minus a reserve for the response, whichever is smaller. The last
 * job of the day must not push the function past its 60 s.
 */
import { reconcilePendingStripeOrders, RECONCILE_DEFAULT_BUDGET_MS } from "@/app/api/stripe/_lib/reconcile";
import type { CronJob } from "../runner";

export const RECONCILE_BUDGET_MS = RECONCILE_DEFAULT_BUDGET_MS;
/** Left over after the scan for the Stripe call in flight and the response. */
const RESERVE_MS = 2_000;
const FLOOR_MS = 1_000;

/** How long the Stripe scan may take given what the run has left. */
export function reconcileBudgetMs(remainingMs: number): number {
  return Math.max(FLOOR_MS, Math.min(RECONCILE_BUDGET_MS, remainingMs - RESERVE_MS));
}

export const stripeReconcileJob: CronJob = {
  name: "stripe-reconcile",
  async run({ remainingMs }) {
    return { result: await reconcilePendingStripeOrders({ budgetMs: reconcileBudgetMs(remainingMs) }) };
  },
};
