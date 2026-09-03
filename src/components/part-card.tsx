"use client";
import Link from "next/link";
import Image from "next/image";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCart } from "./cart-provider";
import { formatEur } from "@/lib/utils";
import { ShoppingCart, CheckCircle2, X } from "lucide-react";
import { toast } from "sonner";

type PartCardProps = {
  part: {
    id: string;
    sku: string;
    name: string;
    brand: string;
    priceEur: number;
    imageUrl: string | null;
    stock: number;
    isOriginal: boolean;
  };
  showAddToCart?: boolean;
};

export function PartCard({ part, showAddToCart = true }: PartCardProps) {
  const add = useCart((s) => s.add);

  return (
    <Card className="overflow-hidden hover:border-primary transition-colors group">
      <Link href={`/onderdelen/${part.sku}`}>
        {part.imageUrl && (
          <div className="relative w-full h-44 sm:h-48 md:h-52 bg-muted overflow-hidden">
            <Image
              src={part.imageUrl}
              alt={part.name}
              fill
              sizes="(max-width: 640px) 200px, (max-width: 1024px) 250px, 300px"
              className="object-cover group-hover:scale-105 transition-transform"
            />
            {/* accent-foreground on bg-accent is 4.27:1 in the light theme, under the
                4.5:1 minimum for this 10px badge; white reaches 4.64:1. The dark theme
                uses a lighter accent, where the dark accent-foreground is the readable
                side, so keep it there. */}
            {part.isOriginal && (
              <Badge variant="accent" className="absolute top-2 left-2 text-[10px] text-white dark:text-accent-foreground">
                Origineel
              </Badge>
            )}
            {part.stock === 0 && (
              <div className="absolute inset-0 bg-background/70 flex items-center justify-center">
                <Badge variant="danger">Uitverkocht</Badge>
              </div>
            )}
          </div>
        )}
        <CardContent className="p-4">
          <Badge variant="outline" className="text-[10px] mb-1.5">{part.brand}</Badge>
          <h3 className="text-sm font-medium line-clamp-2 leading-snug min-h-[40px] group-hover:text-primary transition-colors">
            {part.name}
          </h3>
          <div className="flex items-center justify-between mt-3">
            <span className="text-lg font-bold text-primary">{formatEur(part.priceEur)}</span>
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              {part.stock > 0 ? (
                <><CheckCircle2 className="h-3 w-3 text-emerald-500" /> Op voorraad</>
              ) : (
                <><X className="h-3 w-3 text-destructive" /> Niet op voorraad</>
              )}
            </span>
          </div>
        </CardContent>
      </Link>
      {showAddToCart && part.stock > 0 && (
        <div className="px-4 pb-4">
          {/* h-11: size="sm" is 32px, 12px under the minimum tap target, on the
              primary purchase action repeated 60x on /onderdelen. Keep the sm
              text and padding — the card is only ~153px wide on a phone, the
              default size would push "In winkelmand" out of the button. */}
          <Button
            size="sm"
            className="w-full h-11"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              add({ partId: part.id, sku: part.sku, name: part.name, brand: part.brand, priceEur: part.priceEur, imageUrl: part.imageUrl }, 1);
              toast.success("Toegevoegd aan winkelmand");
            }}
          >
            <ShoppingCart className="h-3 w-3" /> In winkelmand
          </Button>
        </div>
      )}
    </Card>
  );
}
