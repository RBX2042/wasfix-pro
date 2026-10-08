import { MarketingLayout } from "@/components/marketing-layout";
import { safeDecode } from "@/lib/safe-param";
import { dbMachineFull } from "@/lib/static-db";
import { notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PartCard } from "@/components/part-card";
import Link from "next/link";
import { ChevronRight, Sparkles, AlertTriangle, BookOpen } from "lucide-react";

export const revalidate = 60;

// Nothing is pre-rendered at build time (the catalogue lives in the database, and a
// build must not need one), but declaring the params lets Next render each page on
// its first request and then serve it from the cache until revalidate/revalidateCatalog().
// Without this a dynamic-segment page is rendered on every request even when it uses
// nothing per visitor.
export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: { params: Promise<{ brand: string; model: string }> }) {
  const { brand: encBrand, model: encModel } = await params;
  const brand = safeDecode(encBrand);
  const model = safeDecode(encModel);
  if (brand === null || model === null) return { title: "Model niet gevonden", robots: { index: false } };
  const machine = await dbMachineFull(brand, model);
  const title = `${brand} ${model}: foutcodes en onderdelen`;
  // 18 model pages carried the generic root description and no canonical.
  const description = machine
    ? `${brand} ${model}${machine.yearFrom ? ` (${machine.yearFrom}${machine.yearTo ? `–${machine.yearTo}` : ""})` : ""}: ${machine.errorCodes.length} foutcodes, ${machine.repairGuides.length} reparatiegidsen en ${machine.parts.length} compatibele onderdelen.`
    : `Foutcodes en onderdelen voor de ${brand} ${model}.`;
  return {
    title,
    description,
    alternates: { canonical: `/merken/${encodeURIComponent(brand)}/${encodeURIComponent(model)}` },
    robots: machine ? undefined : { index: false },
    openGraph: { title, description, images: [{ url: "/opengraph-image", width: 1200, height: 630 }] },
  };
}

export default async function ModelPage({ params }: { params: Promise<{ brand: string; model: string }> }) {
  const { brand: encBrand, model: encModel } = await params;
  const brand = safeDecode(encBrand);
  const model = safeDecode(encModel);
  if (brand === null || model === null) notFound();

  const machine = await dbMachineFull(brand, model);

  if (!machine) notFound();

  const allParts = machine.parts.map((pm) => pm.part);
  const parts = allParts.slice(0, 6);

  return (
    <MarketingLayout>
      <section className="border-b bg-muted/30">
        <div className="container py-10">
          <nav className="text-sm text-muted-foreground mb-3">
            <Link href="/merken" className="hover:text-foreground">Merken</Link>
            <ChevronRight className="inline h-3 w-3 mx-1" />
            <Link href={`/merken/${encodeURIComponent(brand)}`} className="hover:text-foreground">{brand}</Link>
            <ChevronRight className="inline h-3 w-3 mx-1" />
            <span className="text-foreground">{model}</span>
          </nav>
          <Badge variant="outline" className="mb-2">{machine.yearFrom}–{machine.yearTo}</Badge>
          <h1 className="font-heading text-2xl sm:text-3xl md:text-4xl font-bold [overflow-wrap:anywhere]">{brand} {model}</h1>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild className="min-h-11">
              <Link href={`/diagnose?prefill=${encodeURIComponent(`Mijn ${brand} ${model}`)}`}>
                <Sparkles className="h-4 w-4" /> Start diagnose voor dit model
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* grid-cols-1 + min-w-0: the unspecified column was sized to its min-content,
          which pushed this page to 391px wide on a 375px phone. */}
      <div className="container py-8 grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Card className="min-w-0">
          <CardContent className="p-6">
            <h2 className="font-heading text-xl font-semibold mb-4 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" /> Foutcodes ({machine.errorCodes.length})
            </h2>
            <div className="space-y-2">
              {machine.errorCodes.map((ec) => (
                <Link key={ec.id} href={`/foutcodes/${encodeURIComponent(brand)}-${encodeURIComponent(ec.code)}`} className="block min-w-0">
                  <div className="flex items-center gap-3 rounded-md border p-3 min-h-11 hover:border-primary transition-colors">
                    <span className="font-heading font-bold text-primary text-sm shrink-0">{ec.code}</span>
                    <span className="text-sm flex-1 min-w-0 [overflow-wrap:anywhere]">{ec.title}</span>
                    <ChevronRight className="h-3 w-3 text-muted-foreground" />
                  </div>
                </Link>
              ))}
            </div>
            {machine.errorCodes.length === 0 && (
              <p className="text-sm text-muted-foreground py-4">Nog geen foutcodes voor dit model.</p>
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardContent className="p-6">
            <h2 className="font-heading text-xl font-semibold mb-4 flex items-center gap-2">
              <BookOpen className="h-5 w-5" /> Compatibele onderdelen
            </h2>
            <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
              {parts.map((p) => (
                <PartCard key={p.id} part={p} showAddToCart={false} />
              ))}
            </div>
            {allParts.length > 0 && (
              <Link href={`/onderdelen?q=${encodeURIComponent(model)}`} className="inline-flex items-center min-h-11 mt-3 text-sm text-primary hover:underline">
                Alle {allParts.length} compatibele onderdelen →
              </Link>
            )}
            {allParts.length === 0 && (
              <p className="text-sm text-muted-foreground py-2">Voor dit model hebben we nog geen gekoppelde onderdelen.</p>
            )}
          </CardContent>
        </Card>

        {machine.repairGuides.length > 0 && (
          <Card className="min-w-0 lg:col-span-2">
            <CardContent className="p-6">
              <h2 className="font-heading text-xl font-semibold mb-4">Reparatiegidsen voor dit model</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {machine.repairGuides.map((g) => (
                  <Link key={g.id} href={`/gidsen/${g.slug}`} className="block rounded-md border p-3 min-h-11 hover:border-primary transition-colors [overflow-wrap:anywhere]">
                    <span className="text-sm font-medium">{g.title}</span>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </MarketingLayout>
  );
}
