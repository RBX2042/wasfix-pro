import Link from "next/link";
import { MarketingLayout } from "@/components/marketing-layout";
import { Button } from "@/components/ui/button";
import { ShieldQuestion } from "lucide-react";

export const metadata = { title: "Bestelling niet gevonden", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

/**
 * One page for "no such order" and "not yours": the two must look the same, or
 * the page would confirm which order ids exist.
 */
export default function OrderNotFound() {
  return (
    <MarketingLayout>
      <div className="container py-16 max-w-xl text-center">
        <ShieldQuestion className="mx-auto h-12 w-12 text-muted-foreground/40 mb-4" />
        <h1 className="font-heading text-2xl font-bold mb-2">Bestelling niet gevonden</h1>
        <p className="text-muted-foreground mb-6">
          Deze link klopt niet of je hebt geen toegang tot deze bestelling. Open de volledige link van je bestelling (die
          bevat een persoonlijke code): die staat op de pagina waar je na het bestellen terechtkwam en, als je er een hebt
          ontvangen, in je e-mail. Heb je een account? Log dan in met het account waarmee je hebt besteld.
        </p>
        <div className="flex flex-wrap gap-3 justify-center">
          <Button asChild><Link href="/inloggen">Inloggen</Link></Button>
          <Button asChild variant="outline"><Link href="/onderdelen">Verder winkelen</Link></Button>
        </div>
      </div>
    </MarketingLayout>
  );
}
