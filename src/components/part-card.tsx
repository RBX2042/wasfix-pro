import { PartCardClient, type PartCardPart } from "./part-card-client";
import { toPublicPart } from "@/lib/static-db";

/**
 * A part in a grid. This is a SERVER component on purpose: whatever object a
 * page hands it is reduced to the public fields before it becomes a prop of the
 * client component, and props of client components are written into the page's
 * HTML. Pages used to pass full database rows, so costEur and supplier of every
 * listed part were readable in the source of /onderdelen and every part page.
 *
 * Only import this from server components (every current caller is one). A
 * client component that needs a card must receive already-public data and use
 * PartCardClient directly.
 */
export function PartCard({
  part,
  showAddToCart = true,
  note,
}: {
  part: PartCardPart & { description?: string | null };
  showAddToCart?: boolean;
  note?: string;
}) {
  const pub = toPublicPart({ description: null, ...part });
  return (
    <PartCardClient
      part={{
        id: pub.id,
        sku: pub.sku,
        name: pub.name,
        brand: pub.brand,
        category: pub.category,
        priceEur: pub.priceEur,
        imageUrl: pub.imageUrl,
        stock: pub.stock,
        isOriginal: pub.isOriginal,
      }}
      showAddToCart={showAddToCart}
      note={note}
    />
  );
}
