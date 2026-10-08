/**
 * Which order does a return request belong to?
 *
 * The customer types a reference. What they can find is the short number in the
 * confirmation mail and on the invoice page (first 8 characters of the order id,
 * "#7K3F9QXA"), the invoice number ("2026-00002"), or they arrive from their order
 * page with the full id and the access token in the link.
 *
 * A match is only accepted when the customer can PROVE the order is theirs:
 *   - the access token in the link equals Order.accessToken (constant time), or
 *   - the e-mail address typed on the form equals the order's, ignoring case.
 * A reference that exists but does not pass is treated like one that does not
 * exist, so the form cannot be used to find out which order numbers exist. The
 * request is stored either way; unlinked ones are flagged in the admin screen.
 */
import { prisma } from "@/lib/prisma";
import { orderAccessOk } from "@/lib/invoicing";

/** `email` is the ORDER's address (not the typed one): the acknowledgement goes there. */
export type ResolvedOrder = { id: string; via: "token" | "email"; email: string };

export function cleanReference(raw: string): string {
  return raw.trim().replace(/^#/, "").replace(/\s+/g, "");
}

export async function resolveOrderForReturn(reference: string, email: string, token?: string | null): Promise<ResolvedOrder | null> {
  const ref = cleanReference(reference);
  if (ref.length < 4 || ref.length > 60) return null;

  const select = { id: true, email: true, accessToken: true } as const;
  let candidates: Array<{ id: string; email: string; accessToken: string | null }> = [];
  if (/^\d{4}-\d{5}$/.test(ref)) {
    const inv = await prisma.invoice.findUnique({ where: { number: ref }, select: { order: { select } } });
    if (inv) candidates = [inv.order];
  } else if (/^[a-z0-9]+$/i.test(ref)) {
    const id = ref.toLowerCase();
    // Full id: exact. Short number: the id starts with it (8 characters or more).
    candidates =
      id.length >= 20
        ? await prisma.order.findMany({ where: { id }, select, take: 1 })
        : id.length >= 8
          ? await prisma.order.findMany({ where: { id: { startsWith: id } }, select, take: 5 })
          : [];
  }

  const wanted = email.trim().toLowerCase();
  for (const c of candidates) {
    if (token && orderAccessOk(c, token)) return { id: c.id, via: "token", email: c.email };
  }
  for (const c of candidates) {
    if (wanted && c.email.trim().toLowerCase() === wanted) return { id: c.id, via: "email", email: c.email };
  }
  return null;
}
