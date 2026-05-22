import { MarketingLayout } from "@/components/marketing-layout";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PartCard } from "@/components/part-card";
import Link from "next/link";
import { ChevronRight, Sparkles, AlertTriangle, BookOpen } from "lucide-react";

export const dynamic = "force-dynamic";


export async function generateMetadata({ params }: { params: Promise<{ brand: string; model: string }> }) {
  const { brand, model } = await params;
  return { title: `${decodeURIComponent(brand)} ${decodeURIComponent(model)} — foutcodes & onderdelen` };
}

export default async function ModelPage({ params }: { params: Promise<{ brand: string; model: string }> }) {
  const { brand: encBrand, model: encModel } = await params;
  const brand = decodeURIComponent(encBrand);
  const model = decodeURIComponent(encModel);

  const machine = await prisma.washingMachine.findFirst({
    where: { brand, model },
    include: {
      errorCodes: { orderBy: { code: "asc" } },
      parts: { include: { part: true }, take: 8 },
    },
  });

  if (!machine) notFound();

  const parts = machine.parts.map((pm) => pm.part);

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
          <h1 className="font-heading text-3xl md:text-4xl font-bold">{brand} {model}</h1>
          <div className="mt-6 flex gap-3">
            <Button asChild>
              <Link href={`/diagnose?prefill=${encodeURIComponent(`Mijn ${brand} ${model}`)}`}>
                <Sparkles className="h-4 w-4" /> Start diagnose voor dit model
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <div className="container py-8 grid lg:grid-cols-2 gap-8">
        <Card>
          <CardContent className="p-6">
            <h2 className="font-heading text-xl font-semibold mb-4 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" /> Foutcodes ({machine.errorCodes.length})
            </h2>
            <div className="space-y-2">
              {machine.errorCodes.map((ec) => (
                <Link key={ec.id} href={`/foutcodes/${encodeURIComponent(brand)}-${encodeURIComponent(ec.code)}`}>
                  <div className="flex items-center gap-3 rounded-md border p-3 hover:border-primary transition-colors">
                    <span className="font-heading font-bold text-primary text-sm">{ec.code}</span>
                    <span className="text-sm flex-1">{ec.title}</span>
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

        <Card>
          <CardContent className="p-6">
            <h2 className="font-heading text-xl font-semibold mb-4 flex items-center gap-2">
              <BookOpen className="h-5 w-5" /> Compatibele onderdelen
            </h2>
            <div className="grid grid-cols-2 gap-3">
              {parts.slice(0, 6).map((p) => (
                <PartCard key={p.id} part={p} showAddToCart={false} />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </MarketingLayout>
  );
}
