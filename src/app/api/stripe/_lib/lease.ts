/**
 * The webhook-event LEASE (table StripeEvent).
 *
 * A one-way "seen" flag fails in both directions: written first, a function
 * that dies after claiming (timeout, deploy, out of memory) makes every Stripe
 * retry answer "already processed" for work that never finished, so a paid
 * order is never fulfilled; written last, two simultaneous deliveries both run.
 *
 *   claim      INSERT the row (claimedAt = now, attempts = 1). The unique index on
 *              stripeEventId decides a race between two deliveries.
 *   complete   set completedAt, only after every side effect succeeded.
 *              A completed event is a no-op forever after.
 *   take over  an event that is NOT completed and whose claimedAt is older than
 *              STRIPE_EVENT_LEASE_MS can be claimed again (updateMany with the
 *              expected state in the WHERE, so only one taker wins).
 *   release    after a failed attempt claimedAt is moved to the epoch, so
 *              Stripe's next retry can take over at once instead of waiting
 *              out the lease.
 *
 * The lease is longer than the route's maxDuration (30 s), so a function that
 * is still running is never taken over; one that was killed is, after 2 minutes
 * at the latest.
 */
import { prisma } from "@/lib/prisma";

export const STRIPE_EVENT_LEASE_MS = 2 * 60 * 1000;

export type ClaimResult =
  | { state: "claimed"; claimedAt: Date; attempts: number }
  /** Already finished: acknowledge and do nothing. */
  | { state: "duplicate" }
  /** Another delivery holds a live lease: answer non-2xx so Stripe retries later. */
  | { state: "busy" };

export async function claimStripeEvent(eventId: string, type: string, now: Date = new Date()): Promise<ClaimResult> {
  // Look first so that the ordinary duplicate delivery does not make Prisma log
  // a unique-constraint error. The insert below still decides a real race.
  let existing = await prisma.stripeEvent.findUnique({ where: { stripeEventId: eventId } });
  if (!existing) {
    try {
      await prisma.stripeEvent.create({ data: { stripeEventId: eventId, type, claimedAt: now, attempts: 1 } });
      return { state: "claimed", claimedAt: now, attempts: 1 };
    } catch (err) {
      if ((err as { code?: string })?.code !== "P2002") throw err;
    }
    existing = await prisma.stripeEvent.findUnique({ where: { stripeEventId: eventId } });
  }
  if (!existing) return { state: "busy" }; // vanished between the insert and the read; let the retry sort it out
  if (existing.completedAt) return { state: "duplicate" };
  const cutoff = new Date(now.getTime() - STRIPE_EVENT_LEASE_MS);
  if (existing.claimedAt < cutoff) {
    const taken = await prisma.stripeEvent.updateMany({
      where: { stripeEventId: eventId, completedAt: null, claimedAt: { lt: cutoff } },
      data: { claimedAt: now, attempts: { increment: 1 } },
    });
    if (taken.count === 1) return { state: "claimed", claimedAt: now, attempts: existing.attempts + 1 };
  }
  return { state: "busy" };
}

export async function completeStripeEvent(eventId: string, now: Date = new Date()): Promise<void> {
  await prisma.stripeEvent.updateMany({ where: { stripeEventId: eventId, completedAt: null }, data: { completedAt: now, lastError: null } });
}

/** Give the lease back after a failed attempt. Only the holder of `claimedAt` may do it. */
export async function releaseStripeEvent(eventId: string, claimedAt: Date, error: unknown): Promise<void> {
  const message = (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, 500);
  await prisma.stripeEvent.updateMany({
    where: { stripeEventId: eventId, completedAt: null, claimedAt },
    data: { claimedAt: new Date(0), lastError: message },
  });
}

/**
 * Markers: "this already happened" flags kept in the same table, under ids that
 * cannot collide with Stripe's (evt_...). The schema has no column for them, and
 * a unique row is exactly the compare-and-set that two simultaneous callers need.
 *   mail:order-paid:<orderId>                     the payment confirmation was claimed (claimStripeEvent / completeStripeEvent)
 *   reconcile-rejected:<orderId>:<sessionId>      reconcile already told the owner about this payment
 */
export async function findStripeMarkers(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await prisma.stripeEvent.findMany({ where: { stripeEventId: { in: ids } }, select: { stripeEventId: true } });
  return new Set(rows.map((r) => r.stripeEventId));
}

/** Idempotent: a marker that already exists stays as it is. */
export async function putStripeMarker(id: string, type: string, now: Date = new Date()): Promise<void> {
  try {
    await prisma.stripeEvent.create({ data: { stripeEventId: id, type, claimedAt: now, completedAt: now, attempts: 1 } });
  } catch (err) {
    if ((err as { code?: string })?.code !== "P2002") throw err;
  }
}
