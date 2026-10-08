/**
 * Who may open /bestelling/<id> and /bestelling/<id>/factuur (decision D2).
 *
 * Exactly three ways in, nothing else:
 *   1. the per-order token from the link (?t=...), compared in constant time;
 *   2. the signed-in customer who owns the order;
 *   3. an admin.
 * The middleware no longer sends these routes to sign-in (a guest who has just
 * paid has no account), so THIS is the only gate. Everyone else gets the same
 * 404 as for an order that does not exist: the page does not confirm that an
 * id is real.
 *
 * A database that cannot be read is an error (the error boundary), not "not
 * found": the previous version swallowed it and showed a generic "thanks" page
 * for an order it could not load.
 */
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/env";
import { orderAccessOk } from "@/lib/invoicing";

export type Viewer = { id: string; role: string } | null;
export type AccessVia = "token" | "owner" | "admin";

/** Pure decision, so the access matrix can be tested without a session. */
export function decideOrderAccess(
  order: { userId: string; accessToken?: string | null },
  viewer: Viewer,
  token: string | null | undefined,
): AccessVia | null {
  if (orderAccessOk(order, token)) return "token";
  if (viewer && viewer.id === order.userId) return "owner";
  if (viewer && viewer.role === "ADMIN") return "admin";
  return null;
}

/** `?t=` may be missing, repeated or absurdly long. Returns the first value, or null. */
export function tokenFromParam(raw: string | string[] | undefined): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== "string") return null;
  return v.length > 0 && v.length <= 200 ? v : null;
}

const INCLUDE = {
  items: { include: { part: { select: { id: true, sku: true, name: true, imageUrl: true } } } },
  invoice: { select: { number: true } },
} as const;

async function fetchOrder(id: string) {
  return prisma.order.findUnique({ where: { id }, include: INCLUDE });
}
export type ViewableOrder = NonNullable<Awaited<ReturnType<typeof fetchOrder>>>;

export async function loadOrderForViewer(
  id: string,
  token: string | null,
): Promise<{ order: ViewableOrder; via: AccessVia } | null> {
  if (!isDatabaseConfigured()) return null;
  // Ids are cuids; refuse anything else before it reaches the database.
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) return null;
  const order = await fetchOrder(id);
  if (!order) return null;

  // A valid token needs no session, so skip the (Clerk) user lookup then.
  let via = decideOrderAccess(order, null, token);
  if (!via) {
    const user = await getCurrentUser().catch(() => null);
    via = decideOrderAccess(order, user ? { id: user.id, role: user.role } : null, token);
  }
  return via ? { order, via } : null;
}
