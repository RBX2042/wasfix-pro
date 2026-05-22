import { MarketingLayout } from "@/components/marketing-layout";
import { staticMachinesByBrand } from "@/lib/static-db";
import { notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

export const dynamic = "force-dynamic";


export async function generateMetadata({ params }: { params: Promise<{ brand: string }> }) {
  const { brand: encBrand } = await params;
  const brand = decodeURIComponent(encBrand);
  const title = `${brand} wasmachine storing? Alle foutcodes en reparaties | WasFix Pro`;
  const description = `Heeft uw ${brand} wasmachine een storing? Bekijk alle ${brand} foutcodes, reparatiegidsen en bestel originele ${brand} onderdelen. AI-diagnose in 60 seconden.`;
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
    openGraph: { title, description },
    alternates: { canonical: `/merken/${encodeURIComponent(brand)}` },
  };
}

export default async function BrandPage({ params }: { params: Promise<{ brand: string }> }) {
  const { brand: encBrand } = await params;
  const brand = decodeURIComponent(encBrand);

  const machines = staticMachinesByBrand(brand);

  if (machines.length === 0) notFound();

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
        </div>
      </section>

      <div className="container py-8">
        <h2 className="font-heading text-xl font-semibold mb-4">Beschikbare modellen ({machines.length})</h2>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
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
