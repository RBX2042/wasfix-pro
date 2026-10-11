/**
 * Order housekeeping, run alone. Needs `Authorization: Bearer <CRON_SECRET>`.
 *
 * NOT SCHEDULED by vercel.json: /api/cron/daily runs this job as its first step
 * (one schedule fits every plan, see ../_lib/runner.ts). This route stays for a
 * hand run, an external scheduler, or an hourly schedule on a plan that allows
 * one. What the job does is documented in ../_lib/jobs/orders.ts.
 */
import { runCronJob } from "../_lib/runner";
import { ordersJob } from "../_lib/jobs/orders";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  return runCronJob(req, ordersJob);
}
export async function POST(req: Request) {
  return runCronJob(req, ordersJob);
}
