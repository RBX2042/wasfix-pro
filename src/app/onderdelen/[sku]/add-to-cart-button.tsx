"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useCart } from "@/components/cart-provider";
import { ShoppingCart, Plus, Minus } from "lucide-react";
import { toast } from "sonner";

export function AddToCartButton({ part }: {
  part: { id: string; sku: string; name: string; brand: string; priceEur: number; imageUrl: string | null; stock: number };
}) {
  const [qty, setQty] = useState(1);
  const add = useCart((s) => s.add);

  function handleAdd() {
    add({
      partId: part.id,
      sku: part.sku,
      name: part.name,
      brand: part.brand,
      priceEur: part.priceEur,
      imageUrl: part.imageUrl,
    }, qty);
    toast.success(`${qty}x toegevoegd aan winkelmand`);
  }

  return (
    <div className="flex gap-3">
      <div className="flex items-center border rounded-md">
        <Button variant="ghost" size="icon" className="h-11 w-11" onClick={() => setQty(Math.max(1, qty - 1))}>
          <Minus className="h-4 w-4" />
        </Button>
        <span className="w-10 text-center font-medium">{qty}</span>
        <Button variant="ghost" size="icon" className="h-11 w-11" onClick={() => setQty(Math.min(part.stock, qty + 1))}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <Button onClick={handleAdd} size="lg" className="flex-1" disabled={part.stock === 0}>
        <ShoppingCart className="h-4 w-4" /> In winkelmand
      </Button>
    </div>
  );
}
