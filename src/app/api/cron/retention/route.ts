/**
 * Daily retention. Needs `Authorization: Bearer <CRON_SECRET>`.
 *
 * EXPECTED SCHEDULE: daily, e.g. "30 3 * * *" (bundle S6 writes vercel.json from this header).
 * Does exactly what src/lib/retention.ts documents and nothing else.
 */
import { runCron } from "../_lib/auth";
import { runRetention } from "@/lib/retention";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  return runCron(req, "retention", async () => ({ ...(await runRetention()) }));
}
export async function POST(req: Request) {
  return runCron(req, "retention", async () => ({ ...(await runRetention()) }));
}
