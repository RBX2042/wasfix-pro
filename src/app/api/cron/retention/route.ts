/**
 * Daily retention, run alone. Needs `Authorization: Bearer <CRON_SECRET>`.
 *
 * NOT SCHEDULED by vercel.json: /api/cron/daily runs this job as its second
 * step (see ../_lib/runner.ts). This route stays for a hand run or an external
 * scheduler. The job is ../_lib/jobs/retention.ts; it does exactly what
 * src/lib/retention.ts documents and nothing else.
 */
import { runCronJob } from "../_lib/runner";
import { retentionJob } from "../_lib/jobs/retention";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  return runCronJob(req, retentionJob);
}
export async function POST(req: Request) {
  return runCronJob(req, retentionJob);
}
