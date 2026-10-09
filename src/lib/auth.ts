import { cache } from "react";
import type { PrismaClient, User } from "@prisma/client";
import { isDemoMode } from "./demo-mode";
import { env, isClerkConfigured, isDatabaseConfigured } from "./env";
import { getPlan } from "./plans";
import { prisma } from "./prisma";
import { logger } from "./logger";
import { effectivePlan } from "./subscription";

export type DemoUser = {
  id: string;
  /** "" for an account whose e-mail address Clerk has not verified (see PLACEHOLDER_EMAIL_SUFFIX). */
  email: string;
  name: string;
  role: string;
  /**
   * The plan this account is entitled to RIGHT NOW (effectivePlan): a past_due
   * subscription beyond the grace window and a cancelled one read as FREE here,
   * so every gate that reads user.plan follows the subscription's real state.
   */
  plan: string;
  /** Stripe's status mirror (trialing, active, past_due, ...); null when the plan is not managed by Stripe. */
  subscriptionStatus?: string | null;
  /** The plan stored on the row, i.e. what the customer last paid for. Differs from `plan` only after a lapse. */
  storedPlan?: string;
  currentPeriodEnd?: Date | null;
  cancelAtPeriodEnd?: boolean;
  trialUsedAt?: Date | null;
  /** False when Clerk has not verified the address, so no e-mail-keyed data may be attached to this account. */
  emailVerified?: boolean;
};

// Demo mode only: the seeded superadmin every visitor resolves to. It is read
// by getCurrentUser() behind isDemoMode(), which is false in production.
export const SUPERADMIN_EMAIL = "jdahoe@hotmail.nl";

// Static demo user — used when DB is unreachable so the demo still works.
const STATIC_DEMO_USER: DemoUser = {
  id: "jdahoe-superadmin",
  email: SUPERADMIN_EMAIL,
  name: "Jimmy Dahoe",
  role: "ADMIN",
  plan: "BEDRIJF",
};

// ─── Sign-in: Clerk identity -> our User row ─────────────────────────────────

/** What we need to know about the signed-in person, as the identity provider reports it. */
export type ClerkIdentity = {
  clerkId: string;
  /** The PRIMARY address (trim/lowercase is applied here, not by the reader). null when the account has none. */
  email: string | null;
  /** Clerk's verdict that the person proved they own `email`. Anything but a plain yes is false. */
  emailVerified: boolean;
  name: string | null;
};
export type IdentityReader = () => Promise<ClerkIdentity | null>;

/**
 * The only function in this module that talks to Clerk. Behind this signature so
 * the sign-in rules (syncSignedInUser) can be exercised with any identity,
 * verified or not, without a Clerk instance.
 */
async function readClerkIdentity(): Promise<ClerkIdentity | null> {
  // Without Clerk keys the middleware never runs Clerk (src/middleware.ts), and auth() throws
  // on every call. Nobody can be signed in then, so the answer is "nobody" without a
  // per-request exception and a warning line for each page view.
  if (!isClerkConfigured()) return null;
  const { auth, currentUser } = await import("@clerk/nextjs/server");
  const { userId } = await auth();
  if (!userId) return null;
  const cu = await currentUser();
  if (!cu) return null;
  const primary = cu.emailAddresses.find((e) => e.id === cu.primaryEmailAddressId) ?? null;
  // Without a primary address nothing may be treated as verified: the "first"
  // address is not the one the person chose to sign in with.
  const chosen = primary ?? cu.emailAddresses[0] ?? null;
  return {
    clerkId: userId,
    email: chosen?.emailAddress ?? null,
    emailVerified: !!primary && primary.verification?.status === "verified",
    name: `${cu.firstName ?? ""} ${cu.lastName ?? ""}`.trim() || null,
  };
}

/** The parts of a Clerk user object (webhook payload) the sign-in rules need. */
export type ClerkWebhookUser = {
  id?: string;
  email_addresses?: Array<{ id: string; email_address: string; verification?: { status?: string | null } | null }>;
  primary_email_address_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
};

/**
 * The same identity readClerkIdentity builds for a signed-in request, built from
 * a webhook payload, so a webhook and a sign-in can never disagree about what
 * counts as verified: only the PRIMARY address, and only with status "verified".
 * Without a primary address nothing is verified (the first address is not the one
 * the person chose). Returns null when the payload has no user id.
 */
export function identityFromClerkPayload(data: ClerkWebhookUser): ClerkIdentity | null {
  if (!data.id) return null;
  const primary = data.email_addresses?.find((e) => e.id === data.primary_email_address_id) ?? null;
  const chosen = primary ?? data.email_addresses?.[0] ?? null;
  return {
    clerkId: data.id,
    email: chosen?.email_address ?? null,
    emailVerified: !!primary && primary.verification?.status === "verified",
    name: `${data.first_name ?? ""} ${data.last_name ?? ""}`.trim() || null,
  };
}

let identityReader: IdentityReader = readClerkIdentity;
/** Test seam: replaces the Clerk call. Pass null to restore it. */
export function _setIdentityReaderForTests(reader: IdentityReader | null): void {
  identityReader = reader ?? readClerkIdentity;
}

export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

/** ADMIN_EMAILS: comma/semicolon/space separated, case-insensitive. Entries that are not addresses are ignored. */
export function parseAdminEmails(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split(/[\s,;]+/)
    .map(normalizeEmail)
    .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
}

/**
 * Rows for people whose address Clerk has NOT verified carry this address
 * instead of the one they typed. An unverified address proves nothing: if it
 * were stored, guest checkout (which attaches orders to the user row with that
 * e-mail) would hand a stranger's order history to whoever registered the
 * address first. `.invalid` is reserved (RFC 2606) and can never be a mailbox.
 */
export const PLACEHOLDER_EMAIL_SUFFIX = "@unverified.wasfix.invalid";
const placeholderEmail = (clerkId: string) => `${clerkId.toLowerCase()}${PLACEHOLDER_EMAIL_SUFFIX}`;
export const isPlaceholderEmail = (email: string) => email.endsWith(PLACEHOLDER_EMAIL_SUFFIX);

const isUniqueViolation = (err: unknown) => (err as { code?: string } | null)?.code === "P2002";

export type SyncDeps = {
  db?: PrismaClient;
  /** Defaults to ADMIN_EMAILS from the environment. */
  adminEmails?: string[];
};

/**
 * Map a signed-in Clerk identity to its User row, creating, claiming or
 * promoting as the rules below allow (decision D7).
 *
 *  - Found by clerkId: nothing is written unless something changed (the hot
 *    path is one SELECT). The stored e-mail follows Clerk only for a VERIFIED
 *    address that no other row holds.
 *  - Not found, address VERIFIED and an existing row with that address has no
 *    Clerk account: that row is claimed (guest order history, a row the owner
 *    promoted with scripts/make-admin.ts). An address Clerk has not verified
 *    never claims anything and is never stored.
 *  - A verified, primary address listed in ADMIN_EMAILS makes the row ADMIN,
 *    logged at warn level with the user id (never the address).
 */
export async function syncSignedInUser(identity: ClerkIdentity, deps: SyncDeps = {}): Promise<User> {
  const db = deps.db ?? prisma;
  const admins = deps.adminEmails ?? parseAdminEmails(env.ADMIN_EMAILS);
  const email = normalizeEmail(identity.email);
  const trusted = identity.emailVerified && email !== "";
  const name = identity.name?.trim() || null;

  let row = await db.user.findUnique({ where: { clerkId: identity.clerkId } });

  if (row) {
    const changes: { name?: string; email?: string } = {};
    if (name && name !== row.name) changes.name = name;
    if (trusted && email !== row.email) {
      const holder = await db.user.findUnique({ where: { email } });
      if (!holder) {
        changes.email = email;
      } else if (holder.id !== row.id && holder.clerkId === null && isPlaceholderEmail(row.email)) {
        // The person verified the address after signing up with it unverified:
        // the existing row that holds it is theirs now. The placeholder row
        // lets go of the Clerk account first (clerkId is unique).
        const moved = await db.$transaction(async (tx) => {
          const freed = await tx.user.updateMany({
            where: { id: row!.id, clerkId: identity.clerkId },
            data: { clerkId: null, email: `superseded-${row!.id}${PLACEHOLDER_EMAIL_SUFFIX}` },
          });
          if (freed.count === 0) return null;
          const claimed = await tx.user.updateMany({ where: { id: holder.id, clerkId: null }, data: { clerkId: identity.clerkId, ...(name ? { name } : {}) } });
          if (claimed.count === 0) throw new Error("claim_lost");
          return tx.user.findUnique({ where: { id: holder.id } });
        }).catch((err) => {
          logger.warn("[auth] could not move the account to the row that holds the verified address", { userId: row!.id, err: String(err) });
          return null;
        });
        if (moved) {
          row = moved;
          delete changes.name;
        }
      } else {
        // Someone else's row holds this address; keep the placeholder/old address.
        logger.warn("[auth] verified address is held by another account — not changed", { userId: row.id });
      }
    }
    if (changes.name !== undefined || changes.email !== undefined) {
      row = await db.user.update({ where: { id: row.id }, data: changes });
    }
  } else {
    row = await claimOrCreate(db, identity, { email, trusted, name });
  }

  if (trusted && admins.includes(email) && row.role !== "ADMIN") {
    // Conditional, so two simultaneous first requests log one promotion.
    const promoted = await db.user.updateMany({ where: { id: row.id, role: { not: "ADMIN" } }, data: { role: "ADMIN" } });
    if (promoted.count > 0) {
      logger.warn("[auth] ADMIN_EMAILS promotion: a verified listed address was made ADMIN", { userId: row.id });
    }
    row = { ...row, role: "ADMIN" };
  }

  return row;
}

async function claimOrCreate(
  db: PrismaClient,
  identity: ClerkIdentity,
  who: { email: string; trusted: boolean; name: string | null },
): Promise<User> {
  const { email, trusted, name } = who;

  if (trusted) {
    const existing = await db.user.findUnique({ where: { email } });
    if (existing && existing.clerkId === null) {
      await db.user.updateMany({
        where: { id: existing.id, clerkId: null },
        data: { clerkId: identity.clerkId, ...(name && !existing.name ? { name } : {}) },
      });
      // Read back by clerkId rather than trusting the count: a parallel request
      // for the same Clerk account may have linked the row first, which is fine.
      const linked = await db.user.findUnique({ where: { clerkId: identity.clerkId } });
      if (linked) return linked;
      // The row was claimed by a different Clerk account in the meantime: fall through, address unusable.
    } else if (!existing) {
      try {
        return await db.user.create({ data: { clerkId: identity.clerkId, email, name } });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        const raced = await db.user.findUnique({ where: { clerkId: identity.clerkId } });
        if (raced) return raced;
        // The address was taken in the meantime: fall through to the placeholder.
      }
    } else {
      // The row belongs to a different Clerk account. Taking it over would hand
      // that person's data to this one.
      logger.warn("[auth] verified address already belongs to another sign-in — creating a separate account", { clerkId: identity.clerkId });
    }
  }

  try {
    return await db.user.create({ data: { clerkId: identity.clerkId, email: placeholderEmail(identity.clerkId), name } });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const raced = await db.user.findUnique({ where: { clerkId: identity.clerkId } });
    if (raced) return raced;
    throw err;
  }
}

function toSessionUser(row: User, fallbackName: string): DemoUser {
  const placeholder = isPlaceholderEmail(row.email);
  return {
    id: row.id,
    email: placeholder ? "" : row.email,
    name: row.name ?? (placeholder ? fallbackName : row.email),
    role: row.role,
    plan: effectivePlan({
      plan: row.plan,
      stripeSubStatus: row.stripeSubStatus,
      stripeCurrentPeriodEnd: row.stripeCurrentPeriodEnd,
    }),
    subscriptionStatus: row.stripeSubStatus,
    storedPlan: row.plan,
    currentPeriodEnd: row.stripeCurrentPeriodEnd,
    cancelAtPeriodEnd: row.stripeCancelAtPeriodEnd,
    trialUsedAt: row.trialUsedAt,
    emailVerified: !placeholder,
  };
}

/**
 * Resolve the current user.
 *  - Demo mode (never in production): the seeded superadmin.
 *  - Otherwise: the signed-in Clerk user mapped by syncSignedInUser().
 * Never throws — returns null when nobody is signed in (or the database is
 * unreachable). Memoised per request with React cache(): a layout, a page and
 * their children share one Clerk call and one SELECT.
 */
export const getCurrentUser = cache(async (): Promise<DemoUser | null> => {
  if (isDemoMode()) {
    if (isDatabaseConfigured()) {
      try {
        const superadmin = await prisma.user.findUnique({ where: { email: SUPERADMIN_EMAIL } });
        const fallback = !superadmin ? await prisma.user.findUnique({ where: { email: "demo@wasfixpro.nl" } }) : null;
        const user = superadmin ?? fallback;
        if (user) return { ...toSessionUser(user, "Demo User"), name: user.name ?? "Demo User" };
      } catch { /* DB unreachable — fall through to static user */ }
    }
    return STATIC_DEMO_USER;
  }

  try {
    const identity = await identityReader();
    if (!identity) return null;

    if (!isDatabaseConfigured()) {
      // Signed in, but no database yet: still let the user in with a FREE plan.
      const email = normalizeEmail(identity.email);
      return { id: identity.clerkId, email, name: identity.name ?? email, role: "CONSUMER", plan: "FREE" };
    }

    const row = await syncSignedInUser(identity);
    return toSessionUser(row, identity.name ?? "");
  } catch (err) {
    logger.warn("[auth] could not resolve the signed-in user", { err: err instanceof Error ? err.message : String(err) });
    return null;
  }
});

// ─── Entitlements ────────────────────────────────────────────────────────────

/**
 * Plan limits come from src/lib/plans.ts so pricing pages, Stripe and
 * entitlement checks can never drift apart. API is a legacy internal plan
 * that behaves like MONTEUR_PRO.
 *
 * Pass the USER (not only user.plan) wherever a price is decided: the product
 * rule (project lead, "D13") is that the parts discount applies only while the
 * subscription is paying, never while it is trialing, so a free trial cannot be
 * used to take 5-15% off parts. Only the user carries the status. Everything else a
 * plan includes (diagnoses, guides, dashboard) applies during the trial. The old
 * call getPlanLimits("MONTEUR_PRO") still works and cannot know about a trial.
 */
export function getPlanLimits(who: string | { plan: string; subscriptionStatus?: string | null }) {
  const planId = typeof who === "string" ? who : who.plan;
  const trialing = typeof who !== "string" && who.subscriptionStatus === "trialing";
  const resolved = planId === "API" ? "MONTEUR_PRO" : planId;
  const p = getPlan(resolved);
  return {
    diagnosesPerMonth: p.diagnosesPerMonth,
    partsDiscount: trialing ? 0 : p.partsDiscount,
    /** The discount the plan gives once the first payment has been made (what a trial will turn into). */
    partsDiscountWhenPaying: p.partsDiscount,
    premiumGuides: p.premiumGuides,
    technicianDashboard: p.technicianDashboard,
  };
}

/**
 * Plans that unlock the Monteur Pro dashboard, CRM, work orders and the B2B API.
 * The PLAN decides, not the role: TECHNICIAN/BUSINESS used to open all of it
 * without a subscription, and survived a cancellation. ADMIN keeps access so the
 * owner can look at what customers see.
 */
export function hasProAccess(user: Pick<DemoUser, "plan" | "role">): boolean {
  return ["MONTEUR_PRO", "BEDRIJF", "API"].includes(user.plan) || user.role === "ADMIN";
}

/** The name to show for a plan. The legacy internal "API" plan behaves like Monteur Pro (getPlanLimits), so it is named that, not "Gratis". */
export function planDisplayName(plan: string): string {
  return getPlan(plan === "API" ? "MONTEUR_PRO" : plan).name;
}
