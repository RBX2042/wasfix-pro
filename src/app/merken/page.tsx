import { MarketingLayout } from "@/components/marketing-layout";
import { dbMachines } from "@/lib/static-db";
import { Card, CardContent } from "@/components/ui/card";
import Link from "next/link";
import { FOOTER_BRAND_REPAIR } from "@/components/redesign/footer-links";

// Cached (tagged catalogue reads) instead of force-dynamic; nothing here is per visitor.
export const revalidate = 60;

export const metadata = {
  title: "Wasmachine merken en modellen",
  description:
    "Alle merken en modellen in de WasFix-catalogus: kies je merk voor de foutcodes, reparatiegidsen en onderdelen die bij jouw wasmachine horen.",
  alternates: { canonical: "/merken" },
};

export default async function MerkenPage() {
  const machines = await dbMachines();

  // Group by brand
  const brandMap = new Map<string, typeof machines>();
  machines.forEach((m) => {
    const arr = brandMap.get(m.brand) ?? [];
    arr.push(m);
    brandMap.set(m.brand, arr);
  });

  const brands = Array.from(brandMap.entries());

  return (
    <MarketingLayout>
      <section className="border-b bg-muted/30">
        <div className="container py-12">
          <h1 className="font-heading text-3xl md:text-4xl font-bold">Wasmachine merken</h1>
          <p className="text-muted-foreground mt-2 max-w-2xl">
            Bekijk alle ondersteunde merken en modellen. Klik op een merk om alle modellen, foutcodes en gidsen te zien.
          </p>
        </div>
      </section>

      <div className="container py-8">
        <div className="grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {brands.map(([brand, models]) => (
            <Link key={brand} href={`/merken/${encodeURIComponent(brand)}`}>
              <Card className="hover:border-primary transition-colors h-full group">
                <CardContent className="p-5 text-center">
                  <div className="h-16 w-16 mx-auto rounded-full bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center mb-3">
                    <span className="font-heading font-bold text-xl text-primary">{brand[0]}</span>
                  </div>
                  <h3 className="font-heading text-lg font-semibold group-hover:text-primary transition-colors">{brand}</h3>
                  <p className="text-xs text-muted-foreground mt-1">{models.length} {models.length === 1 ? "model" : "modellen"}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        {/* The 15 brand-repair pages were in the sitemap but linked from nowhere. */}
        <h2 className="font-heading text-xl font-semibold mt-12 mb-3">Reparatie per merk</h2>
        <div className="flex flex-wrap gap-x-4">
          {FOOTER_BRAND_REPAIR.map((b) => (
            <Link key={b.slug} href={`/${b.slug}-wasmachine-reparatie`} className="inline-flex items-center min-h-11 text-primary hover:underline">
              {b.label} reparatie
            </Link>
          ))}
        </div>
      </div>
    </MarketingLayout>
  );
}
