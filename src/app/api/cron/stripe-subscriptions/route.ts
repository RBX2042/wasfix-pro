/**
 * Subscription upkeep. Needs `Authorization: Bearer <CRON_SECRET>`.
 *
 * EXPECTED SCHEDULE: daily, e.g. "0 4 * * *" (bundle S6 writes vercel.json from this header).
 * This route is a BLOCKER for the Stripe bundle: without it the grace window for
 * lapsed subscriptions and the cancellation of subscriptions of erased accounts
 * never run. It only wires runSubscriptionMaintenance(); the logic lives in
 * src/app/api/stripe/_lib/subscriptions.ts.
 */
import { runCron } from "../_lib/auth";
import { getStripe } from "@/lib/stripe";
import { runSubscriptionMaintenance } from "@/app/api/stripe/_lib/subscriptions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const job = async () => ({ result: await runSubscriptionMaintenance(getStripe()) });

export async function GET(req: Request) {
  return runCron(req, "stripe-subscriptions", job);
}
export async function POST(req: Request) {
  return runCron(req, "stripe-subscriptions", job);
}
