/**
 * Subscription upkeep (the job behind /api/cron/stripe-subscriptions and the third step of /api/cron/daily).
 *
 * Without a daily run the grace window for lapsed subscriptions and the
 * cancellation of subscriptions of erased accounts never happen. This only
 * wires runSubscriptionMaintenance(); the logic lives in
 * src/app/api/stripe/_lib/subscriptions.ts.
 */
import { getStripe } from "@/lib/stripe";
import { runSubscriptionMaintenance } from "@/app/api/stripe/_lib/subscriptions";
import type { CronJob } from "../runner";

export const stripeSubscriptionsJob: CronJob = {
  name: "stripe-subscriptions",
  async run() {
    return { result: await runSubscriptionMaintenance(getStripe()) };
  },
};
