"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useCart } from "@/components/cart-provider";
import { clearSharedAttempt } from "@/lib/cart-attempt";

const POLL_EVERY_MS = 3000;
const POLL_FOR_MS = 90_000;

/**
 * The browser-side half of the confirmation page. Renders nothing except, while
 * a card/iDEAL payment is still being confirmed, a short status line.
 *
 *  1. fresh=true (the customer has just placed or paid the order): empty the cart
 *     ONCE. The marker is stored per order, so reloading the page or opening
 *     the same link from the e-mail later never empties a cart the customer has
 *     filled since. If storage is blocked the cart is still emptied in memory.
 *  2. fresh=true: scroll to the top and move focus to the heading. On a phone the
 *     form that was just submitted leaves the page scrolled far down, and the
 *     confirmation (with the IBAN) used to sit above the visible area.
 *  3. waitingForPayment: ask the server again every few seconds. The order flips
 *     to "Betaald" when Stripe's webhook arrives, which is usually seconds after
 *     the customer is sent back here; this page must not claim a payment it
 *     has not seen, and must not make the customer reload by hand either.
 */
export function OrderEffects({
  orderId,
  fresh,
  clearCartOnce,
  waitingForPayment,
}: {
  orderId: string;
  fresh: boolean;
  clearCartOnce: boolean;
  waitingForPayment: boolean;
}) {
  const clear = useCart((s) => s.clear);
  const router = useRouter();
  const [gaveUp, setGaveUp] = React.useState(false);
  const cleared = React.useRef(false);

  React.useEffect(() => {
    if (!fresh) return;
    // This order is done: the next checkout is a new order and must not reuse its Idempotency-Key.
    clearSharedAttempt();
    window.scrollTo(0, 0);
    document.getElementById("order-heading")?.focus({ preventScroll: true });

    if (!clearCartOnce || cleared.current) return;
    cleared.current = true;
    const key = `wasfix-cart-cleared:${orderId}`;
    try {
      if (window.localStorage.getItem(key)) return;
      clear();
      window.localStorage.setItem(key, "1");
    } catch {
      clear();
    }
  }, [fresh, clearCartOnce, orderId, clear]);

  React.useEffect(() => {
    if (!waitingForPayment) return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - started > POLL_FOR_MS) {
        window.clearInterval(timer);
        setGaveUp(true);
        return;
      }
      router.refresh();
    }, POLL_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [waitingForPayment, router]);

  if (!waitingForPayment) return null;
  return (
    <p role="status" className="text-sm text-muted-foreground mb-6">
      {gaveUp
        ? "Het duurt langer dan normaal voordat we de bevestiging van de betaling hebben. Je hoeft niets opnieuw te betalen: je kunt deze pagina sluiten en later via dezelfde link terugkomen."
        : "We wachten op de bevestiging van je betaling. Deze pagina ververst vanzelf."}
    </p>
  );
}
