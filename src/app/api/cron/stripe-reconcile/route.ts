/**
 * Safety net for Stripe orders whose webhook never arrived. Needs
 * `Authorization: Bearer <CRON_SECRET>`.
 *
 * INTENDED SCHEDULE: every 15 minutes (cron expression with step 15 in the minute field); bundle S6
 * writes vercel.json from this header. NOT VERIFIED: whether the hosting plan allows a cron this
 * often (see the note in ../orders/route.ts); check before copying it. On a slower schedule the route
 * does the same work later: a customer who paid while the webhook was down stays PENDING until the
 * next run. A BLOCKER for the Stripe bundle: without any run, that customer stays PENDING forever. Wires
 * reconcilePendingStripeOrders() from src/app/api/stripe/_lib/reconcile.ts; it
 * only looks at orders older than RECONCILE_MIN_AGE_MS there and does nothing
 * without a Stripe client.
 */
import { runCron } from "../_lib/auth";
import { reconcilePendingStripeOrders } from "@/app/api/stripe/_lib/reconcile";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const job = async () => ({ result: await reconcilePendingStripeOrders() });

export async function GET(req: Request) {
  return runCron(req, "stripe-reconcile", job);
}
export async function POST(req: Request) {
  return runCron(req, "stripe-reconcile", job);
}
