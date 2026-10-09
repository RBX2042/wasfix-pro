/**
 * Which account row a checkout order hangs on (decision D16). Lives here, not in the route file,
 * because a Next.js route module may only export handlers and route config.
 */
import { prisma } from "./prisma";

/**
 * The row guest orders hang on when the typed e-mail address belongs to a real account the placer is
 * NOT signed in as. Order.userId is required by the schema, so a guest order needs SOME row; this one
 * is a shared placeholder nobody can sign in as: it has no Clerk id, and the reserved .invalid top-level
 * domain guarantees the address can never be a mailbox (it also does not end in the domain that erased
 * accounts get, see src/lib/erasure.ts). The customer's own address is on the ORDER (Order.email), which is
 * what mails, the per-address caps and the guest link use, so nothing is lost by it.
 */
export const GUEST_HOLDER_EMAIL = "gastbestellingen@guest.invalid";

/**
 * True for the shared placeholder row. Code that reasons about "this customer's other orders" by userId (the referral
 * check for a first paid order, src/lib/referrals.ts) must not treat the holder as one person: its orders belong to
 * unrelated strangers, matched by Order.email only.
 */
export function isGuestHolderEmail(email: string | null | undefined): boolean {
  return (email ?? "").trim().toLowerCase() === GUEST_HOLDER_EMAIL;
}

/**
 * Find or create the account row an order hangs on (decision D16).
 *
 * An order is attached to an account only when the placer IS signed in as that account (signedInId).
 * A guest who types the e-mail address of an existing REAL account (one with a Clerk id) used to get
 * the order pinned on that account by address alone, with no proof of ownership: the stranger's order
 * showed up in the owner's dashboard and blocked their account erasure for up to 21 days (rehearsal
 * R2-12). Now it becomes a guest order on the placeholder row, reachable by its token.
 *
 * Rows without a Clerk id are guest rows created by an earlier checkout; they keep today's behaviour
 * (reused by address, claimed by the verified owner at their first sign-in, src/lib/auth.ts).
 *
 * Case-insensitive on purpose: the same person typing Mixed.Case@Example.NL, then
 * mixed.case@example.nl produced separate User rows, and a Clerk account (which
 * lower-cases) never matched the first. New rows are always created lower-case.
 */
export async function resolveUserId(signedInId: string | undefined, email: string, name: string): Promise<string> {
  if (signedInId) return signedInId;
  const existing = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true, clerkId: true } });
  if (existing && !existing.clerkId) return existing.id;
  if (existing) {
    const holder = await prisma.user.upsert({
      where: { email: GUEST_HOLDER_EMAIL },
      update: { email: GUEST_HOLDER_EMAIL },
      create: { email: GUEST_HOLDER_EMAIL, name: "Gastbestellingen", role: "CONSUMER", plan: "FREE" },
      select: { id: true },
    });
    return holder.id;
  }
  // Upsert, not find-then-create: two guest checkouts with the same e-mail arriving together both found
  // nothing and both inserted. The update rewrites the e-mail with the same value on purpose: Prisma only
  // compiles an upsert to a single INSERT ... ON CONFLICT when the update payload is non-empty.
  const row = await prisma.user.upsert({
    where: { email },
    update: { email },
    create: { email, name, role: "CONSUMER", plan: "FREE" },
  });
  return row.id;
}
