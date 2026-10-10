/**
 * Daily retention (the job behind /api/cron/retention and the second step of /api/cron/daily).
 * Does exactly what src/lib/retention.ts documents and nothing else.
 */
import { runRetention } from "@/lib/retention";
import type { CronJob } from "../runner";

export const retentionJob: CronJob = {
  name: "retention",
  async run() {
    return { ...(await runRetention()) };
  },
};
