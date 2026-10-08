"use client";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCart } from "./cart-provider";
import { MemberPrice } from "./member-price";
import { PartPhoto } from "./part-photo";
import { formatEur } from "@/lib/utils";
import { availabilityOf } from "@/lib/part-categories";
import { track, EVT } from "@/lib/analytics";
import { ShoppingCart, CheckCircle2, X } from "lucide-react";
import { toast } from "sonner";

export type PartCardPart = {
  id: string;
  sku: string;
  name: string;
  brand: string;
  category: string;
  priceEur: number;
  imageUrl: string | null;
  stock: number;
  isOriginal: boolean;
};

type PartCardProps = {
  part: PartCardPart;
  showAddToCart?: boolean;
  /** Small label above the name, e.g. "Mogelijk nodig". */
  note?: string;
};

/**
 * The interactive half of PartCard. Never render this from a page directly:
 * pass the part through <PartCard>, which strips it down to the public fields
 * before it crosses into this client component (and therefore into the HTML).
 */
export function PartCardClient({ part, showAddToCart = true, note }: PartCardProps) {
  const add = useCart((s) => s.add);
  const availability = availabilityOf(part.stock);

  return (
    <Card className="overflow-hidden hover:border-primary transition-colors group">
      <Link href={`/onderdelen/${part.sku}`}>
        <div className="relative">
          <PartPhoto
            imageUrl={part.imageUrl}
            name={part.name}
            category={part.category}
            sizes="(max-width: 640px) 200px, (max-width: 1024px) 250px, 300px"
            className="w-full h-36 sm:h-44 md:h-48"
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
          {availability === "out" && (
            <div className="absolute inset-0 bg-background/70 flex items-center justify-center">
              <Badge variant="danger">Uitverkocht</Badge>
            </div>
          )}
        </div>
        <CardContent className="p-3 sm:p-4">
          <Badge variant="outline" className="text-[10px] mb-1.5">{part.brand}</Badge>
          {note && <p className="text-[11px] font-medium text-amber-700 dark:text-amber-400 mb-0.5">{note}</p>}
          <h3 className="text-sm font-medium line-clamp-2 leading-snug min-h-[40px] group-hover:text-primary transition-colors break-words">
            {part.name}
          </h3>
          {/* flex-wrap: on a 360px phone a card is ~158px wide, too narrow for "€ 12,00" and "Op voorraad" side by side; the label drops to its own line instead of being cut off. */}
          <div className="flex flex-wrap items-center justify-between mt-3 gap-x-2 gap-y-0.5">
            <span className="text-lg font-bold text-primary">{formatEur(part.priceEur)}</span>
            <span className="text-xs text-muted-foreground flex items-center gap-1 text-right">
              {availability === "out" ? (
                <><X className="h-3 w-3 text-destructive shrink-0" /> Niet op voorraad</>
              ) : availability === "low" ? (
                <><CheckCircle2 className="h-3 w-3 text-amber-500 shrink-0" /> Beperkt</>
              ) : (
                <><CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" /> Op voorraad</>
              )}
            </span>
          </div>
          <MemberPrice priceEur={part.priceEur} className="mt-1" />
        </CardContent>
      </Link>
      {showAddToCart && part.stock > 0 && (
        <div className="px-3 pb-3 sm:px-4 sm:pb-4">
          {/* h-11: size="sm" is 32px, 12px under the minimum tap target, on the
              primary purchase action repeated 60x on /onderdelen. Keep the sm
              text and padding — the card is only ~153px wide on a phone, the
              default size would push "In winkelmand" out of the button. */}
          <Button
            size="sm"
            className="w-full h-11 px-2 whitespace-nowrap"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              add({ partId: part.id, sku: part.sku, name: part.name, brand: part.brand, priceEur: part.priceEur, imageUrl: part.imageUrl }, 1);
              track(EVT.PART_ADDED_TO_CART, { sku: part.sku, category: part.category, source: "card" });
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
