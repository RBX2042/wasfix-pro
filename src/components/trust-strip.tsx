import { Truck, RotateCcw, CreditCard } from "lucide-react";
import { paymentMethodsLine, shippingLine } from "@/lib/storefront-facts";

/**
 * One compact line of facts a stranger needs before trusting a shop: what shipping
 * costs, that there is a return window, how to pay. Every statement comes from the
 * same settings the checkout and the legal pages use (SHIPPING, payment methods in
 * use, the 30-day window of /retourvoorwaarden), so it cannot promise more than they
 * grant.
 */
export function TrustStrip({ className = "" }: { className?: string }) {
  const pay = paymentMethodsLine();
  return (
    <ul className={`flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground ${className}`}>
      <li className="flex items-center gap-1.5"><Truck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {shippingLine()}</li>
      <li className="flex items-center gap-1.5"><RotateCcw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> 30 dagen bedenktijd</li>
      {pay && <li className="flex items-center gap-1.5"><CreditCard className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> Betaal met {pay}</li>}
    </ul>
  );
}
