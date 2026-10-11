/**
 * Subscription upkeep, run alone. Needs `Authorization: Bearer <CRON_SECRET>`.
 *
 * NOT SCHEDULED by vercel.json: /api/cron/daily runs this job as its third
 * step (see ../_lib/runner.ts). This route stays for a hand run or an external
 * scheduler. The job is ../_lib/jobs/stripe-subscriptions.ts; the logic lives
 * in src/app/api/stripe/_lib/subscriptions.ts.
 */
import { runCronJob } from "../_lib/runner";
import { stripeSubscriptionsJob } from "../_lib/jobs/stripe-subscriptions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  return runCronJob(req, stripeSubscriptionsJob);
}
export async function POST(req: Request) {
  return runCronJob(req, stripeSubscriptionsJob);
}
