/**
 * Retention: the data-minimisation promises of /privacy section 6 that the
 * application itself can keep, and nothing else.
 *
 * WHAT /privacy PROMISES AND WHAT THIS DOES
 *   "IP-adres (... verwijderd na 30 dagen zonder gebruik)"
 *       The only place an IP-derived value is stored is UsageCounter.key
 *       ("ip:" + a truncated SHA-256 of the address, see anonymousKey in
 *       entitlements.ts). Rows with such a key that have not been touched for
 *       IP_COUNTER_DAYS are DELETED. The free-diagnosis allowance is counted in a
 *       30-day window, so keeping the counter 30 idle days means an anonymous
 *       visitor cannot reset their allowance by waiting a week. The constant and
 *       the privacy text move together: change both or neither.
 *   "Diagnoses: 12 maanden gekoppeld aan account, daarna geanonimiseerd"
 *       Diagnosis rows older than DIAGNOSIS_MONTHS lose userId, sessionId and the
 *       free text the person typed (symptoms, messages). Brand, model and the
 *       structured result stay: they feed the "top foutcodes" statistic and
 *       carry no identity. Guest diagnoses (no userId) are treated the same,
 *       because their sessionId is also an identifier. The matching
 *       DiagnosisFeedback.sessionId of feedback older than the same cutoff is
 *       cleared too (same identifier); the feedback comment text is left alone.
 *       An anonymised row is recognised by sessionId being EXACTLY "anon-" plus
 *       the row's own id (a cuid nobody can predict), with no userId and no
 *       typed text. A prefix test ("anon-%") is wrong: /api/diagnose itself
 *       mints "anon-<timestamp>" for callers without a sessionId, and any caller
 *       may send one, so such rows would never have been anonymised.
 *   "Bestellingen en facturen: 7 jaar"
 *       Nothing is deleted. Orders, invoices and credit notes stay.
 *
 * NOT IMPLEMENTED (cannot be, from here): "Server-logs: 90 dagen" is a setting
 * of the hosting plan, and "Accountgegevens: ... + 30 dagen na opzegging (voor
 * herstel)" does not match the Clerk user.deleted handler, which anonymises at
 * once. Both are wording problems for the legal-copy owner.
 *
 * Also: orders of an account that was erased through the Clerk webhook and were still
 * open at that moment are redacted here once they are no longer open
 * (finishPendingErasures in src/lib/erasure.ts).
 *
 * Also: newsletter sign-ups that were never confirmed are deleted once their link has expired
 * (purgeUnconfirmedSubscribers in src/lib/newsletter.ts).
 *
 * Also removed here, because it is behaviour-neutral: UsageCounter rows whose
 * window ended more than 7 days ago. consumeUsage() treats an expired window as
 * unused, so the row is dead weight (the table otherwise only grows).
 * Payment-reminder markers use the same table with a far-future windowEnd and are
 * therefore never matched.
 */
import { prisma } from "./prisma";
import { logger } from "./logger";
import { finishPendingErasures } from "./erasure";
import { purgeUnconfirmedSubscribers } from "./newsletter";

export const IP_COUNTER_DAYS = 30;
export const DIAGNOSIS_MONTHS = 12;
const DAY = 86_400_000;

export type RetentionResult = {
  ipCountersDeleted: number;
  expiredCountersDeleted: number;
  diagnosesAnonymised: number;
  /** Accounts erased through the Clerk webhook whose still-open orders were finished and redacted in this run. */
  pendingErasures: { accounts: number; ordersRedacted: number; stillOpen: number };
  /** Newsletter sign-ups whose confirmation link expired without a click (src/lib/newsletter.ts). */
  unconfirmedSubscribersDeleted: number;
};

export async function runRetention(opts: { now?: Date; batch?: number } = {}): Promise<RetentionResult> {
  const now = opts.now ?? new Date();
  const batch = opts.batch ?? 2000;

  const ip = await prisma.usageCounter.deleteMany({
    where: { key: { startsWith: "ip:" }, updatedAt: { lt: new Date(now.getTime() - IP_COUNTER_DAYS * DAY) } },
  });
  const expired = await prisma.usageCounter.deleteMany({
    where: { windowEnd: { lt: new Date(now.getTime() - 7 * DAY) } },
  });

  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - DIAGNOSIS_MONTHS);
  // One statement per batch: the sessionId has to be derived per row, which updateMany cannot do.
  // The WHERE clause is "still carries something personal", so the loop ends when nothing is left
  // and a rerun changes nothing. The feedback rows are cleared first, by the ids the batch is about
  // to anonymise, because after the update the original sessionId is gone.
  let diagnosesAnonymised = 0;
  for (;;) {
    const ids = await prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Diagnosis"
       WHERE "createdAt" < ${cutoff}
         AND ("userId" IS NOT NULL OR "symptoms" <> '' OR "messages" <> '[]' OR "sessionId" <> 'anon-' || "id")
       LIMIT ${batch}`;
    if (ids.length === 0) break;
    const list = ids.map((r) => r.id);
    await prisma.$executeRaw`
      UPDATE "DiagnosisFeedback" SET "sessionId" = NULL
       WHERE "sessionId" IS NOT NULL
         AND "createdAt" < ${cutoff}
         AND "sessionId" IN (SELECT "sessionId" FROM "Diagnosis" WHERE "id" = ANY(${list}))`;
    const n = await prisma.$executeRaw`
      UPDATE "Diagnosis"
         SET "userId" = NULL,
             "sessionId" = 'anon-' || "id",
             "symptoms" = '',
             "messages" = '[]'
       WHERE "id" = ANY(${list})`;
    diagnosesAnonymised += n;
    if (ids.length < batch) break;
  }

  // Orders the Clerk user.deleted webhook had to leave untouched because they were still open
  // (src/lib/erasure.ts): redact them now that they may be finished. Idempotent.
  const pendingErasures = await finishPendingErasures().catch((err) => {
    logger.warn("[retention] pending erasures could not be finished", { err: err instanceof Error ? err.message : String(err) });
    return { accounts: 0, ordersRedacted: 0, stillOpen: 0 };
  });

  const unconfirmedSubscribersDeleted = await purgeUnconfirmedSubscribers(now).catch((err) => {
    logger.warn("[retention] unconfirmed newsletter sign-ups could not be purged", { err: err instanceof Error ? err.message : String(err) });
    return 0;
  });

  const result = { ipCountersDeleted: ip.count, expiredCountersDeleted: expired.count, diagnosesAnonymised, pendingErasures, unconfirmedSubscribersDeleted };
  logger.info("[retention] done", result);
  return result;
}
