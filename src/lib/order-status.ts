/**
 * Order states and the ONLY definition of which transitions are allowed.
 * Pure data and pure functions: no database, no environment except APP_URL, so
 * it is safe to import from client components (labels, badges, filters).
 *
 * CONTRACT
 *   ORDER_STATUSES                 PENDING, OPENSTAAND, PAID, SHIPPED, DELIVERED, CANCELLED
 *   OrderStatus                    the union of those
 *   isOrderStatus(v)               type guard for a string read from the database
 *   ORDER_STATUS_LABEL[s]          Dutch label for the customer and the admin
 *   ORDER_TRANSITIONS[from]        states reachable from `from`
 *   canTransition(from, to)        true when the table allows it
 *   statusesThatCanGo(to)          every `from` that may move to `to`, for the
 *                                  `status IN (...)` of a conditional update
 *   holdsStock(s)                  true when units for an order in state `s` are
 *                                  already taken off the shelf
 *   orderRef(id)                   the short order number shown everywhere ("#" + this):
 *                                  the first 8 characters of the id, upper case
 *   customerOrderUrl(id, token)    absolute /bestelling/<id>?t=<token>
 *
 * The lifecycle:
 *
 *   PENDING ------+                       (Stripe, unpaid; reserves NO stock)
 *   OPENSTAAND ---+--> PAID --> SHIPPED --> DELIVERED
 *                 |      |
 *                 +------+--> CANCELLED   (reachable from PENDING, OPENSTAAND
 *                                          and PAID, never from SHIPPED)
 *
 * Every real transition is a CONDITIONAL UPDATE: `updateMany` with the expected
 * current status in the WHERE and a check for `count === 0`, so two concurrent
 * callers cannot both win. canTransition() is the guard in front of that update
 * and the table the tests walk; it does not take the lock itself.
 *
 * CANCELLED -> PAID is NOT one of the edges the project lead listed (D3); it is
 * a deliberate addition by the author of this file, kept because refusing it
 * would turn a customer's real payment into a stuck order. It exists for exactly one case: a bank transfer that arrives
 * after an unpaid order was cancelled and its stock released. It is allowed
 * only for BANK_TRANSFER orders that have no credit note, and only if the
 * stock can be taken again; markOrderPaidByBankTransfer enforces those three
 * conditions. No other code may use this edge.
 *
 * Stock, as src/app/api/checkout/route.ts and the Stripe webhook stood when this
 * was written (read, not re-derived): an OPENSTAAND order reserves its units
 * when it is created; a Stripe order takes them when it is paid. So PENDING
 * holds no stock, and every other live state does (see holdsStock). If checkout
 * ever reserves for Stripe orders too, holdsStock and the cancel path must
 * change together. Cancelling gives units back only for the
 * states that hold them, once, because the cancellation itself is the claim.
 */
import { env } from "./env";

export const ORDER_STATUSES = ["PENDING", "OPENSTAAND", "PAID", "SHIPPED", "DELIVERED", "CANCELLED"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === "string" && (ORDER_STATUSES as readonly string[]).includes(value);
}

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: "Wacht op betaling",
  OPENSTAAND: "Wacht op overschrijving",
  PAID: "Betaald",
  SHIPPED: "Verzonden",
  DELIVERED: "Afgeleverd",
  CANCELLED: "Geannuleerd",
};

export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  PENDING: ["PAID", "CANCELLED"],
  OPENSTAAND: ["PAID", "CANCELLED"],
  PAID: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["DELIVERED"],
  DELIVERED: [],
  // Late bank transfer only; see the module comment.
  CANCELLED: ["PAID"],
};

export function canTransition(from: string, to: string): boolean {
  if (!isOrderStatus(from) || !isOrderStatus(to)) return false;
  return ORDER_TRANSITIONS[from].includes(to);
}

/** Every state from which `to` can be reached, minus the late-payment edge. */
export function statusesThatCanGo(to: OrderStatus, opts: { includeLatePayment?: boolean } = {}): OrderStatus[] {
  return ORDER_STATUSES.filter((from) => {
    if (!ORDER_TRANSITIONS[from].includes(to)) return false;
    if (from === "CANCELLED" && !opts.includeLatePayment) return false;
    return true;
  });
}

/** Are the order's units off the shelf? (PENDING reserves nothing.) */
export function holdsStock(status: string): boolean {
  return status === "OPENSTAAND" || status === "PAID" || status === "SHIPPED" || status === "DELIVERED";
}

/** The order number people see and quote: first 8 characters of the id, upper case. */
export function orderRef(orderId: string): string {
  return orderId.slice(0, 8).toUpperCase();
}

/**
 * The link a customer gets in mail and on screen. The token is the
 * credential: do not log the result. Without a token the link only works for a
 * signed-in owner of the order, so callers that have one must pass it.
 */
export function customerOrderUrl(orderId: string, accessToken?: string | null, extraQuery?: Record<string, string>): string {
  const base = env.APP_URL.replace(/\/+$/, "");
  const q = new URLSearchParams();
  if (accessToken) q.set("t", accessToken);
  for (const [k, v] of Object.entries(extraQuery ?? {})) q.set(k, v);
  const qs = q.toString();
  return `${base}/bestelling/${encodeURIComponent(orderId)}${qs ? `?${qs}` : ""}`;
}
