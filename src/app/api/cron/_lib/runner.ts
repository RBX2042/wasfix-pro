/**
 * The daily runner: the four scheduled jobs in ONE function invocation.
 *
 * WHY ONE SCHEDULE. vercel.json used to schedule four routes, one per job.
 * According to Vercel's documentation (not verifiable from here: no network)
 * the Hobby plan allows 2 cron jobs per project, each at most once a day, and
 * Pro allows 40. Four schedules would reject the deployment on a Hobby
 * project. One schedule (/api/cron/daily) that runs the four jobs in turn fits
 * every plan without knowing which one the owner has. The four routes stay for
 * a curl from an external scheduler, for a hand run, and for an owner on a plan
 * that allows a tighter rhythm.
 *
 * TIME. One invocation has maxDuration 60 s: the lowest limit of any plan (a
 * higher value than the plan allows fails the build). The runner works with
 * DAILY_BUDGET_MS of that and starts no job with less than MIN_JOB_MS left; the
 * job in flight and the response need the rest. Jobs that do not fit are
 * recorded as skipped, the owner is told ONCE which ones, and they are NOT
 * retried before the next day's run (nothing re-schedules inside a day; the
 * notice says so and names the curl that runs them now). The order of the list
 * is the priority: what matters most comes first.
 *
 * Each job gets a CAP (jobBudgetMs): what is left of the budget minus MIN_JOB_MS
 * for every job after it, never below MIN_JOB_MS. So the first of four jobs may
 * take 20 s, and a job that is quick leaves its share to the later ones. The
 * cap is handed to the job as ctx.remainingMs, and the runner gives up on a job
 * that is still running when its cap is spent: recorded as failed with error
 * "job_timed_out", logged, reported to the owner (naming the job), and the next
 * job starts. Without that cut-off a backlog day in the first job would run the
 * function into the platform's 60 s kill: no response, no notice, and the other
 * three jobs lost for the day. The abandoned job's promise is left to finish or
 * fail in the background (logged, never an unhandled rejection); the function
 * may be frozen by the platform once the response is out, so a job should fit
 * ITSELF inside its cap rather than rely on the cut-off. What each job does with
 * it: the orders job derives a deadline for each of its three steps from it
 * (jobs/orders.ts), the reconcile job shortens its Stripe scan to fit
 * (jobs/stripe-reconcile.ts); retention and stripe-subscriptions take no
 * deadline and are bounded by row counts only (batches of 2000 rows, at most
 * 100 Stripe cancellations), so for those two the cut-off is the only bound.
 *
 * ISOLATION. A job that throws is logged, reported to the owner with
 * notifyError (naming the job) and recorded as failed; the next job still
 * runs. runDailyJobs() itself never throws.
 *
 * RESULT. `ok` is true only when every job ran and succeeded. The route
 * answers 500 otherwise, so the platform's cron log shows the day as failed,
 * with the per-job detail in the body. A failed job's error text stays in the
 * log and in the owner message (scrubbed there), never in the response: a
 * Prisma or Stripe message can quote a connection string.
 *
 * runDailyJobs() depends only on its arguments: the job list, the budget, a
 * clock and the two owner notifications (defaults: notifyError and
 * notifyOwner), so scripts/qa-admin.ts runs it with fake jobs and a fake clock.
 */
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { notifyError, notifyOwner } from "@/lib/notify";
import { refuseUnlessCron, runCron } from "./auth";

/**
 * What every cron route exports as `maxDuration`. Next needs a literal in the
 * route file, so the routes repeat the number; scripts/qa-platform.ts checks
 * that none of them exceeds it.
 */
export const CRON_MAX_DURATION_S = 60;
/** The runner's share of the 60 s: the job in flight and the response get the rest. */
export const DAILY_BUDGET_MS = 50_000;
/** A job is not started with less than this left. */
export const MIN_JOB_MS = 10_000;

export type JobContext = {
  /**
   * How long this job may take. The daily runner gives up on it after that
   * (status "failed", error "job_timed_out"), so a job with its own time bound
   * should fit inside it. A standalone route hands the job the whole budget.
   */
  remainingMs: number;
};

export type CronJob = {
  /** Also the route directory under src/app/api/cron/ that runs this job alone. */
  name: string;
  run: (ctx: JobContext) => Promise<Record<string, unknown>>;
};

export type JobOutcome =
  | { job: string; status: "ok"; ms: number; result: Record<string, unknown> }
  | { job: string; status: "failed"; ms: number; error: "job_failed" | "job_timed_out" }
  | { job: string; status: "skipped"; reason: "budget_exhausted"; remainingMs: number };

/**
 * The cap for a job: what is left minus the minimum for every job after it,
 * never below the minimum (a job that is started gets at least MIN_JOB_MS).
 */
export function jobBudgetMs(remainingMs: number, laterJobs: number, minJobMs: number = MIN_JOB_MS): number {
  return Math.max(minJobMs, remainingMs - laterJobs * minJobMs);
}

export type DailyRunResult = {
  /** Every job ran and succeeded. */
  ok: boolean;
  ms: number;
  budgetMs: number;
  /** One entry per job, in the order of the list. */
  jobs: JobOutcome[];
  failed: string[];
  skipped: string[];
};

export type RunnerOptions = {
  budgetMs?: number;
  minJobMs?: number;
  /** The clock, in ms; Date.now unless a test supplies one. */
  now?: () => number;
  /** Tells the owner a job failed. Default: notifyError, naming the job. */
  notifyFailure?: (err: unknown, job: string) => Promise<unknown>;
  /** Tells the owner, once, which jobs did not fit. Default: notifyOwner. */
  notifySkipped?: (skipped: string[], info: { elapsedMs: number; budgetMs: number }) => Promise<unknown>;
  log?: {
    error: (msg: string, data?: unknown, opts?: { report?: boolean }) => void;
    warn: (msg: string, data?: unknown) => void;
  };
};

const NO_STORE = { "Cache-Control": "no-store" } as const;

function defaultNotifyFailure(err: unknown, job: string): Promise<unknown> {
  return notifyError(err, { where: `cron ${job}`, runner: "daily" });
}

function defaultNotifySkipped(skipped: string[], info: { elapsedMs: number; budgetMs: number }): Promise<unknown> {
  const base = env.APP_URL.replace(/\/+$/, "");
  return notifyOwner({
    event: "cron.daily",
    level: "warn",
    title: `Dagelijkse taken niet afgemaakt: ${skipped.length} overgeslagen`,
    lines: [
      `Na ${Math.round(info.elapsedMs / 1000)} s van de ${Math.round(info.budgetMs / 1000)} s was er geen tijd meer voor: ${skipped.join(", ")}.`,
      "Ze worden vandaag niet opnieuw geprobeerd; morgen draaien ze weer mee in de dagelijkse run.",
      `Nu alsnog draaien: curl -H "Authorization: Bearer $CRON_SECRET" ${base}/api/cron/${skipped[0]} (en zo voor elke overgeslagen taak).`,
    ],
  });
}

/** A notification must never turn a job failure into a runner failure. */
async function quietly(work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
  } catch {
    // notifyOwner and notifyError already swallow their own errors; this guards a test double.
  }
}

/**
 * Wait for `work` at most `ms`. A promise cannot be cancelled: after a timeout
 * the caller must still take care of `work` settling later (see runDailyJobs).
 */
async function withinMs<T>(work: Promise<T>, ms: number): Promise<{ timedOut: false; value: T } | { timedOut: true }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work.then((value) => ({ timedOut: false as const, value })),
      new Promise<{ timedOut: true }>((resolve) => {
        timer = setTimeout(() => resolve({ timedOut: true }), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Run the jobs in order, each isolated, within the budget. Never throws. */
export async function runDailyJobs(jobs: readonly CronJob[], opts: RunnerOptions = {}): Promise<DailyRunResult> {
  const now = opts.now ?? Date.now;
  const budgetMs = opts.budgetMs ?? DAILY_BUDGET_MS;
  const minJobMs = opts.minJobMs ?? MIN_JOB_MS;
  const log = opts.log ?? logger;
  const notifyFailure = opts.notifyFailure ?? defaultNotifyFailure;
  const notifySkipped = opts.notifySkipped ?? defaultNotifySkipped;

  const started = now();
  const outcomes: JobOutcome[] = [];
  const failed: string[] = [];
  const skipped: string[] = [];

  for (const [i, job] of jobs.entries()) {
    const remainingMs = budgetMs - (now() - started);
    if (remainingMs < minJobMs) {
      skipped.push(job.name);
      outcomes.push({ job: job.name, status: "skipped", reason: "budget_exhausted", remainingMs: Math.max(0, remainingMs) });
      continue;
    }
    const capMs = jobBudgetMs(remainingMs, jobs.length - i - 1, minJobMs);
    const t0 = now();
    // The job's promise is created once, so a job that is abandoned after its cap can still be watched.
    let work: Promise<Record<string, unknown>>;
    try {
      work = job.run({ remainingMs: capMs });
    } catch (err) {
      // A job that throws synchronously (before its first await).
      work = Promise.reject(err);
    }
    try {
      const outcome = await withinMs(work, capMs);
      if (!outcome.timedOut) {
        outcomes.push({ job: job.name, status: "ok", ms: now() - t0, result: outcome.value });
        continue;
      }
      failed.push(job.name);
      outcomes.push({ job: job.name, status: "failed", ms: now() - t0, error: "job_timed_out" });
      const err = new Error(`[cron] ${job.name} is still running after its ${Math.round(capMs / 1000)} s and was given up on (job_timed_out); what it did not finish waits for tomorrow's run or a hand run of /api/cron/${job.name}`);
      log.error(`[cron] ${job.name} timed out (daily run)`, { capMs, elapsedMs: now() - t0 }, { report: false });
      // The promise cannot be cancelled: log how it ends, and never let it become an unhandled rejection.
      work.then(
        () => log.warn(`[cron] ${job.name} finished after the daily run gave up on it`),
        (late) => log.error(`[cron] ${job.name} failed after the daily run gave up on it`, late, { report: false }),
      );
      await quietly(() => notifyFailure(err, job.name));
    } catch (err) {
      failed.push(job.name);
      outcomes.push({ job: job.name, status: "failed", ms: now() - t0, error: "job_failed" });
      // report: false — the owner is told right below; the logger's sink would tell them a second time.
      log.error(`[cron] ${job.name} failed (daily run)`, err, { report: false });
      await quietly(() => notifyFailure(err, job.name));
    }
  }

  if (skipped.length > 0) {
    const elapsedMs = now() - started;
    log.warn(`[cron] daily run out of time after ${elapsedMs} ms of ${budgetMs} ms; skipped ${skipped.join(", ")} (not retried before tomorrow's run)`);
    await quietly(() => notifySkipped(skipped, { elapsedMs, budgetMs }));
  }

  return { ok: failed.length === 0 && skipped.length === 0, ms: now() - started, budgetMs, jobs: outcomes, failed, skipped };
}

/**
 * A standalone route: one job behind the guard, the same answer as before the
 * daily runner existed. The job gets the whole budget (and no cut-off: the
 * route is its own function, nothing runs after it).
 */
export function runCronJob(req: Request, job: CronJob): Promise<NextResponse> {
  return runCron(req, job.name, () => job.run({ remainingMs: DAILY_BUDGET_MS }));
}

/** The daily route: guard, run the list, 200 only when every job ran OK. */
export async function runDailyCron(req: Request, jobs: readonly CronJob[]): Promise<NextResponse> {
  const refused = refuseUnlessCron(req);
  if (refused) return refused;
  try {
    const { ok, ...detail } = await runDailyJobs(jobs);
    return NextResponse.json({ ok, job: "daily", ...detail }, { status: ok ? 200 : 500, headers: NO_STORE });
  } catch (err) {
    // Not reachable through a job (each is isolated above): only a bug in the runner itself lands here.
    logger.error("[cron] daily failed", err, { report: false });
    await notifyError(err, { where: "cron daily" });
    return NextResponse.json({ ok: false, job: "daily", error: "job_failed" }, { status: 500, headers: NO_STORE });
  }
}
