/**
 * Every limit that bounds what one anonymous caller can do at checkout, in one
 * place. Client-safe (no imports): the cart UI uses the same numbers to cap the
 * steppers, the server uses them to refuse.
 *
 * WHY THESE EXIST. A bank-transfer order takes its units off the shelf and burns
 * a gapless invoice number the moment it is placed, and the only thing it asks
 * of the caller is an e-mail address nobody verifies. One POST used to reserve
 * the whole pump category for 21 days (A1-08). The numbers below bound the damage:
 * they are a trade-off between that and refusing a real customer, so they are
 * constants a person can change on purpose, not magic numbers in a route.
 */

/** Most units of one part in a cart. Business buyers who need more can mail. */
export const MAX_QTY_PER_LINE = 20;
/** Most different parts in one order. */
export const MAX_LINES_PER_ORDER = 15;
/** Most units in one order, over all lines. */
export const MAX_UNITS_PER_ORDER = 50;

/** Payment term printed on the invoice for an order paid by bank transfer. */
export const BANK_TRANSFER_TERM_DAYS = 14;
/** Days after the due date before an unpaid invoice gives its stock back (voorwaarden art. 7). */
export const BANK_TRANSFER_GRACE_DAYS = 7;

/**
 * Open (unpaid) bank-transfer orders one buyer may hold at the same time.
 * Guests are anonymous, so they get the tighter limit; a signed-in account is
 * counted by account, not by the e-mail address typed into the form.
 */
export const OPEN_BANK_TRANSFER_LIMITS = {
  guest: { orders: 2, valueEur: 500 },
  member: { orders: 5, valueEur: 2500 },
} as const;

/**
 * The most unpaid bank-transfer reservations may be worth, ALL buyers together, while a GUEST is
 * placing another one. A guest order is refused when the open bank-transfer orders of everyone
 * (guests, signed-in accounts, businesses) plus the new order would exceed this.
 *
 * It counts every holder on purpose. An earlier version counted only users without a Clerk id, so a
 * guest who typed the e-mail address of a registered account put the order on that account and
 * escaped the count (measured: EUR 10,500 held against a EUR 3000 "pool").
 *
 * The trade-off: guests are shut out of bank transfer while the shop as a whole has more than this
 * reserved. They can still pay with iDEAL or kaart once Stripe is on, and the owner is told when
 * the limit keeps being hit. Raise the number deliberately if real volume needs it.
 */
export const MAX_OPEN_GUEST_BANK_TRANSFER_VALUE_EUR = 3000;

/**
 * The same sum, but the ceiling for a SIGNED-IN account's order. Members get higher per-buyer
 * limits (OPEN_BANK_TRANSFER_LIMITS), not unlimited ones: without a ceiling an attacker with
 * throw-away accounts would hold 5 orders / EUR 2500 per account without end. Both ceilings are
 * evaluated against one count taken under a single database lock (see /api/checkout), so parallel
 * requests queue up behind each other instead of all seeing the same total; scripts/qa-checkout.ts
 * runs a burst of 14 parallel guest orders against the guest ceiling, and a member order against this
 * one. Orders created by other code (an admin, a script) are counted but not blocked by it.
 */
export const MAX_OPEN_BANK_TRANSFER_VALUE_EUR = 10000;

/** Expired bank-transfer reservations one checkout request releases in the background. */
export const MAX_SWEEP_PER_CHECKOUT = 3;
/** How long a checkout may wait for releasing stock that only an expired reservation is holding. */
export const SHORTAGE_SWEEP_DEADLINE_MS = 5000;
/** A Stripe order that is still PENDING after this many hours was abandoned (the Stripe session itself expires after 24 h). */
export const ABANDONED_STRIPE_ORDER_HOURS = 48;

/**
 * Bank-transfer orders per IP address per 24 hours. The counter is bumped just before the order is
 * written, after the per-buyer and pool checks, so a request refused for those reasons does not use
 * up the allowance. Without UPSTASH_* it lives in the memory of one server instance only.
 *
 * 10, not 3 (decision D17). An address is not a person: households, offices and mobile carriers
 * (carrier-grade NAT) put many customers behind one IP, and until Stripe is live bank transfer is the
 * ONLY way to pay, so a cap of 3 turned away real customers from the 4th order of the day (rehearsal
 * D12; whether this happens on mobile networks was not measured). The real guards are the value-based
 * caps above: OPEN_BANK_TRANSFER_LIMITS per buyer and the shop-wide MAX_OPEN_*_BANK_TRANSFER_VALUE_EUR
 * ceilings, which bound what an anonymous caller can hold in reservations whatever number of addresses
 * they use. This one only stops a single address from hammering the endpoint. The owner is still told
 * when it keeps being hit (CAP_HITS_BEFORE_OWNER_NOTICE).
 */
export const MAX_BANK_TRANSFER_ORDERS_PER_IP_PER_DAY = 10;
/** Orders (any method) per IP address per hour. */
export const MAX_ORDERS_PER_IP_PER_HOUR = 10;
/** Checkout requests of any kind (including refused ones) per IP address per hour. */
export const MAX_CHECKOUT_REQUESTS_PER_IP_PER_HOUR = 60;

/** A cap that was hit this many times within an hour is reported to the owner. */
export const CAP_HITS_BEFORE_OWNER_NOTICE = 3;

/** Longest customer remark kept on an order. */
export const MAX_CUSTOMER_NOTE_LENGTH = 300;
