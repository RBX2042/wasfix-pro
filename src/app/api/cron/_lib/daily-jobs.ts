/**
 * The jobs /api/cron/daily runs, IN THIS ORDER (the order is the priority when
 * the time budget runs out, see runner.ts):
 *
 *   1. orders                expired bank transfers, abandoned Stripe orders, payment reminders
 *   2. retention             what src/lib/retention.ts documents
 *   3. stripe-subscriptions  lapsed subscriptions, subscriptions of erased accounts
 *   4. stripe-reconcile      PENDING Stripe orders whose webhook never arrived
 *
 * Every job's name is also the directory of the route that runs it alone
 * (src/app/api/cron/<name>/route.ts); scripts/qa-platform.ts checks that the
 * two sets agree, so a job added here needs its route and vice versa.
 */
import { ordersJob } from "./jobs/orders";
import { retentionJob } from "./jobs/retention";
import { stripeSubscriptionsJob } from "./jobs/stripe-subscriptions";
import { stripeReconcileJob } from "./jobs/stripe-reconcile";
import type { CronJob } from "./runner";

export const DAILY_JOBS: readonly CronJob[] = [ordersJob, retentionJob, stripeSubscriptionsJob, stripeReconcileJob];
