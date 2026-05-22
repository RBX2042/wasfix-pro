"use client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useCart, cartTotal } from "./cart-provider";
import { Button } from "@/components/ui/button";
import { formatEur } from "@/lib/utils";
import { Trash2, Plus, Minus, ShoppingBag } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

export function CartDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const items = useCart((s) => s.items);
  const remove = useCart((s) => s.remove);
  const setQty = useCart((s) => s.setQty);

  const total = cartTotal(items);

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
            <Button asChild className="mt-4" onClick={() => onOpenChange(false)}>
              <Link href="/onderdelen">Bekijk onderdelen</Link>
            </Button>
          </div>
        ) : (
          <>
            <div className="max-h-[55vh] overflow-y-auto space-y-3 pr-1">
              {items.map((i) => (
                <div key={i.partId} className="flex gap-3 rounded-md border p-3">
                  {i.imageUrl && (
                    <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md bg-muted">
                      <Image src={i.imageUrl} alt={i.name} fill sizes="64px" className="object-cover" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium line-clamp-2">{i.name}</p>
                    <p className="text-xs text-muted-foreground">{i.sku} · {i.brand}</p>
                    <div className="flex items-center justify-between mt-2">
                      <div className="flex items-center gap-1">
                        <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => setQty(i.partId, i.quantity - 1)}>
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className="w-8 text-center text-sm">{i.quantity}</span>
                        <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => setQty(i.partId, i.quantity + 1)}>
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{formatEur(i.priceEur * i.quantity)}</span>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => remove(i.partId)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t pt-4 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotaal</span>
                <span className="font-semibold">{formatEur(total)}</span>
              </div>
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
