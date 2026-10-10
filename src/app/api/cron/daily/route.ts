/**
 * THE scheduled route: the only path in vercel.json. Needs
 * `Authorization: Bearer <CRON_SECRET>`.
 *
 * Runs the four jobs of ../_lib/daily-jobs.ts in order, each isolated, within a
 * 50 s budget of this function's 60 s (../_lib/runner.ts explains the plan
 * limits and the trade-off). Answers 200 only when every job ran and succeeded,
 * else 500 with the per-job detail, so the platform's cron log shows the day as
 * failed. The four single-job routes next to this one stay for hand runs.
 */
import { runDailyCron } from "../_lib/runner";
import { DAILY_JOBS } from "../_lib/daily-jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  return runDailyCron(req, DAILY_JOBS);
}
export async function POST(req: Request) {
  return runDailyCron(req, DAILY_JOBS);
}
