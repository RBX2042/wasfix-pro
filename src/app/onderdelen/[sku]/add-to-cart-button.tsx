"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useCart } from "@/components/cart-provider";
import { ShoppingCart, Plus, Minus } from "lucide-react";
import { toast } from "sonner";
import { track, EVT } from "@/lib/analytics";

export function AddToCartButton({ part }: {
  part: { id: string; sku: string; name: string; brand: string; category: string; priceEur: number; imageUrl: string | null; stock: number };
}) {
  const [qty, setQty] = useState(1);
  const add = useCart((s) => s.add);
  const soldOut = part.stock <= 0;

  function handleAdd() {
    add({
      partId: part.id,
      sku: part.sku,
      name: part.name,
      brand: part.brand,
      priceEur: part.priceEur,
      imageUrl: part.imageUrl,
    }, qty);
    track(EVT.PART_ADDED_TO_CART, { sku: part.sku, category: part.category, count: qty, source: "product" });
    toast.success(`${qty}x toegevoegd aan winkelmand`);
  }

  return (
    <div className="flex gap-2 sm:gap-3">
      <div className="flex items-center border rounded-md" role="group" aria-label="Aantal">
        <Button variant="ghost" size="icon" className="h-11 w-10 sm:w-11" aria-label="Aantal verlagen" disabled={soldOut || qty <= 1} onClick={() => setQty(Math.max(1, qty - 1))}>
          <Minus className="h-4 w-4" />
        </Button>
        <span className="w-8 sm:w-10 text-center font-medium" aria-live="polite">{qty}</span>
        <Button variant="ghost" size="icon" className="h-11 w-10 sm:w-11" aria-label="Aantal verhogen" disabled={soldOut || qty >= part.stock} onClick={() => setQty(Math.min(part.stock, qty + 1))}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <Button onClick={handleAdd} size="lg" className="flex-1 min-w-0 h-11 px-3" disabled={soldOut}>
        <ShoppingCart className="h-4 w-4" /> {soldOut ? "Uitverkocht" : "In winkelmand"}
      </Button>
    </div>
  );
}
