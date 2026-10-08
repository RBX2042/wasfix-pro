import { MarketingLayout } from "@/components/marketing-layout";
import { safeDecode } from "@/lib/safe-param";
import { dbMachinesByBrand, dbMachineBrands } from "@/lib/static-db";
import { notFound, permanentRedirect } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

export const revalidate = 60;

// Nothing is pre-rendered at build time (the catalogue lives in the database, and a
// build must not need one), but declaring the params lets Next render each page on
// its first request and then serve it from the cache until revalidate/revalidateCatalog().
// Without this a dynamic-segment page is rendered on every request even when it uses
// nothing per visitor.
export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: { params: Promise<{ brand: string }> }) {
  const { brand: encBrand } = await params;
  const brand = safeDecode(encBrand);
  if (brand === null) return { title: "Merk niet gevonden", robots: { index: false } };
  const machines = await dbMachinesByBrand(brand);
  const codeCount = machines.reduce((n, m) => n + m._count.errorCodes, 0);
  // No manual " | WasFix Pro" (the root template adds it), and a description that says
  // what is on THIS page instead of the generic root sentence.
  const title = `${brand} wasmachine storing? Foutcodes en reparaties`;
  const description = `Storing op je ${brand} wasmachine? ${machines.length} ${machines.length === 1 ? "model" : "modellen"} en ${codeCount} foutcodes met oorzaken, reparatiegidsen en bijpassende onderdelen.`;
  return {
    title,
    description,
    keywords: [
      `${brand} wasmachine storing`,
      `${brand} foutcode`,
      `${brand} onderdelen`,
      `${brand} reparatie`,
      `${brand} wasmachine kapot`,
    ],
    robots: machines.length === 0 ? { index: false } : undefined,
    openGraph: { title, description, images: [{ url: "/opengraph-image", width: 1200, height: 630 }] },
    alternates: { canonical: `/merken/${encodeURIComponent(brand)}` },
  };
}

export default async function BrandPage({ params }: { params: Promise<{ brand: string }> }) {
  const { brand: encBrand } = await params;
  const brand = safeDecode(encBrand);
  if (brand === null) notFound();

  const machines = await dbMachinesByBrand(brand);

  if (machines.length === 0) {
    // /merken/bosch used to 404 although /merken/Bosch exists.
    const canonical = (await dbMachineBrands()).find((b) => b.toLowerCase() === brand.toLowerCase());
    if (canonical && canonical !== brand) permanentRedirect(`/merken/${encodeURIComponent(canonical)}`);
    notFound();
  }
  const repairSlug = brand.toLowerCase();

  return (
    <MarketingLayout>
      <section className="border-b bg-muted/30">
        <div className="container py-10">
          <nav className="text-sm text-muted-foreground mb-3">
            <Link href="/merken" className="hover:text-foreground">Merken</Link>
            <ChevronRight className="inline h-3 w-3 mx-1" />
            <span className="text-foreground">{brand}</span>
          </nav>
          <h1 className="font-heading text-3xl md:text-4xl font-bold">{brand} wasmachines</h1>
          <p className="text-muted-foreground mt-2 max-w-2xl">
            {machines[0]?.description}
          </p>
          <div className="mt-4 flex flex-wrap gap-x-5">
            <Link href={`/${repairSlug}-wasmachine-reparatie`} className="inline-flex items-center min-h-11 text-primary hover:underline">{brand} reparatie en diagnose →</Link>
            <Link href={`/foutcodes?brand=${encodeURIComponent(brand)}`} className="inline-flex items-center min-h-11 text-primary hover:underline">Alle {brand} foutcodes →</Link>
            <Link href={`/onderdelen?q=${encodeURIComponent(brand)}`} className="inline-flex items-center min-h-11 text-primary hover:underline">{brand} onderdelen →</Link>
          </div>
        </div>
      </section>

      <div className="container py-8">
        <h2 className="font-heading text-xl font-semibold mb-4">Beschikbare modellen ({machines.length})</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {machines.map((m) => (
            <Link key={m.id} href={`/merken/${encodeURIComponent(brand)}/${encodeURIComponent(m.model)}`}>
              <Card className="hover:border-primary transition-colors group h-full">
                <CardContent className="p-5">
                  <Badge variant="outline" className="mb-2">{m.yearFrom}–{m.yearTo}</Badge>
                  <h3 className="font-heading font-semibold group-hover:text-primary transition-colors">{m.model}</h3>
                  <p className="text-xs text-muted-foreground mt-2">{m._count.errorCodes} foutcodes beschikbaar</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </MarketingLayout>
  );
}
