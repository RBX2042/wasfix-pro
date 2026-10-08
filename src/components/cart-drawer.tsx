"use client";
import * as React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useCart, cartTotal, cartCapFor, cartOverLimit, refreshCartFromServer, describeCartNotice, type CartNotice } from "./cart-provider";
import { MAX_QTY_PER_LINE, MAX_UNITS_PER_ORDER } from "@/lib/cart-limits";
import { Button } from "@/components/ui/button";
import { formatEur } from "@/lib/utils";
import { SHIPPING } from "@/lib/plans";
import { cartTotals } from "@/lib/cart-totals";
import { memberLineTotal } from "@/lib/member-discount";
import { useMemberDiscount } from "./member-price";
import { Trash2, Plus, Minus, ShoppingBag, Truck } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

export function CartDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const items = useCart((s) => s.items);
  const remove = useCart((s) => s.remove);
  const setQty = useCart((s) => s.setQty);
  const discount = useMemberDiscount();
  const [notices, setNotices] = React.useState<CartNotice[]>([]);

  // Opening the drawer re-checks price and stock (at most every 20 s): the cart is stored in the
  // browser and can be old, and the "+" button can only be capped at stock once the stock is known.
  React.useEffect(() => {
    if (!open) return;
    let alive = true;
    refreshCartFromServer().then((changes) => {
      if (alive) setNotices(changes ?? []);
    });
    return () => {
      alive = false;
    };
  }, [open]);

  // The same arithmetic as the checkout summary, with the member discount of the signed-in plan.
  const totals = cartTotals(cartTotal(items), discount);
  const overLimit = cartOverLimit(items);
  const freeProgress = Math.min(100, Math.round(((totals.subtotalEur - totals.discountEur) / SHIPPING.freeFromEur) * 100));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingBag className="h-5 w-5" /> Winkelmand
          </DialogTitle>
          <DialogDescription className="sr-only">Bekijk en beheer je winkelmand</DialogDescription>
        </DialogHeader>

        {items.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">
            <ShoppingBag className="mx-auto h-12 w-12 opacity-30 mb-3" />
            <p>Je winkelmand is leeg</p>
            {/* Why it is empty: the server check removes sold-out parts, and a silent empty cart looks like a bug. */}
            {notices.length > 0 && (
              <div role="status" className="mt-4 rounded-md border border-amber-400 bg-amber-50 dark:bg-amber-950/30 p-3 text-left text-xs text-foreground space-y-1">
                {notices.map((n, i) => (
                  <p key={i}>{describeCartNotice(n)}</p>
                ))}
              </div>
            )}
            <Button asChild className="mt-4" onClick={() => onOpenChange(false)}>
              <Link href="/onderdelen">Bekijk onderdelen</Link>
            </Button>
          </div>
        ) : (
          <>
            {notices.length > 0 && (
              <div role="status" className="rounded-md border border-amber-400 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs space-y-1">
                {notices.map((n, i) => (
                  <p key={i}>{describeCartNotice(n)}</p>
                ))}
              </div>
            )}
            <div className="max-h-[50vh] overflow-y-auto space-y-3 pr-1">
              {items.map((i) => {
                const { cap, limit } = cartCapFor(i, items.filter((o) => o !== i));
                const atMax = i.quantity >= cap;
                return (
                  <div key={i.partId} className="flex gap-3 rounded-md border p-3">
                    {i.imageUrl && (
                      <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md bg-muted">
                        <Image src={i.imageUrl} alt={i.name} fill sizes="64px" className="object-cover" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium line-clamp-2">{i.name}</p>
                      <p className="text-xs text-muted-foreground">{i.sku} · {i.brand}</p>
                      {/* 44px targets: these were 28px and icon-only, so a screen reader
                          announced three nameless buttons per row. flex-wrap keeps the row
                          inside the drawer on a 390px screen now that they are wider. */}
                      <div className="flex flex-wrap items-center justify-between gap-y-2 mt-2">
                        <div className="flex items-center gap-1">
                          <Button size="icon" variant="outline" aria-label={`Aantal verlagen voor ${i.name}`} className="h-11 w-11" onClick={() => setQty(i.partId, i.quantity - 1)}>
                            <Minus className="h-3 w-3" />
                          </Button>
                          <span className="w-8 text-center text-sm">{i.quantity}</span>
                          <Button
                            size="icon"
                            variant="outline"
                            aria-label={`Aantal verhogen voor ${i.name}`}
                            className="h-11 w-11"
                            disabled={atMax}
                            title={atMax ? limitNote(limit, i.stock) : undefined}
                            onClick={() => setQty(i.partId, i.quantity + 1)}
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-right">
                            <span className="font-semibold block">{formatEur(i.priceEur * i.quantity)}</span>
                            {discount > 0 && (
                              <span className="block text-xs font-medium text-emerald-700 dark:text-emerald-400">
                                Jouw prijs {formatEur(memberLineTotal(i.priceEur, discount, i.quantity))}
                              </span>
                            )}
                          </span>
                          <Button size="icon" variant="ghost" aria-label={`${i.name} uit winkelmand verwijderen`} className="h-11 w-11 text-destructive" onClick={() => remove(i.partId)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                      {atMax && <p className="text-xs text-muted-foreground mt-1">{limitNote(limit, i.stock)}</p>}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="border-t pt-4 space-y-2">
              {/* Shipping and the free-shipping threshold were invisible until the last step. */}
              <div className="space-y-1" aria-label="Gratis verzending">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={freeProgress} aria-label="Voortgang naar gratis verzending">
                  <div className="h-full bg-emerald-500 transition-all" style={{ width: `${freeProgress}%` }} />
                </div>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Truck className="h-3 w-3" aria-hidden />
                  {totals.toFreeShippingEur > 0
                    ? `Nog ${formatEur(totals.toFreeShippingEur)} voor gratis verzending (vanaf ${formatEur(SHIPPING.freeFromEur)})`
                    : "Je krijgt gratis verzending"}
                </p>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotaal</span>
                <span>{formatEur(totals.subtotalEur)}</span>
              </div>
              {totals.discountEur > 0 && (
                <div className="flex justify-between text-sm text-emerald-700 dark:text-emerald-400">
                  <span>Ledenkorting ({Math.round(discount * 100)}%)</span>
                  <span>-{formatEur(totals.discountEur)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Verzendkosten</span>
                <span>{totals.shippingEur === 0 ? "Gratis" : formatEur(totals.shippingEur)}</span>
              </div>
              <div className="flex justify-between font-semibold">
                <span>Totaal <span className="text-xs font-normal text-muted-foreground">incl. btw</span></span>
                <span>{formatEur(totals.totalEur)}</span>
              </div>
              {overLimit && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{overLimit}</p>}
              <Button asChild className="w-full" size="lg" onClick={() => onOpenChange(false)}>
                <Link href="/checkout">Naar afrekenen</Link>
              </Button>
              <Button variant="outline" className="w-full" onClick={() => onOpenChange(false)}>
                Verder winkelen
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Which limit stops the "+" button, in words. */
function limitNote(limit: "stock" | "units" | "line", stock: number | undefined): string {
  if (limit === "stock") return `Maximaal ${stock} op voorraad`;
  if (limit === "units") return `Maximaal ${MAX_UNITS_PER_ORDER} stuks per bestelling`;
  return `Maximaal ${MAX_QTY_PER_LINE} per onderdeel per bestelling`;
}
