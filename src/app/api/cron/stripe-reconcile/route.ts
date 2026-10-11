/**
 * Safety net for Stripe orders whose webhook never arrived, run alone. Needs
 * `Authorization: Bearer <CRON_SECRET>`.
 *
 * NOT SCHEDULED by vercel.json: /api/cron/daily runs this job as its last step
 * (see ../_lib/runner.ts). This route stays for a hand run, an external
 * scheduler, or a 15-minute schedule on a plan that allows one (NOT VERIFIED
 * which plans do; check before adding it to vercel.json, a schedule the plan
 * refuses can fail the deployment). The job is ../_lib/jobs/stripe-reconcile.ts.
 */
import { runCronJob } from "../_lib/runner";
import { stripeReconcileJob } from "../_lib/jobs/stripe-reconcile";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  return runCronJob(req, stripeReconcileJob);
}
export async function POST(req: Request) {
  return runCronJob(req, stripeReconcileJob);
}
