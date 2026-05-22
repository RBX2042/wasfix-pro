import { MarketingLayout } from "@/components/marketing-layout";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatEur } from "@/lib/utils";
import { CheckCircle2, Truck, ShieldCheck, RotateCcw, Package } from "lucide-react";
import { AddToCartButton } from "./add-to-cart-button";
import Image from "next/image";
import Link from "next/link";
import { PartCard } from "@/components/part-card";
import PartViewer3DWrapper from "@/components/3d/PartViewer3DWrapper";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const dynamic = "force-dynamic";


export async function generateMetadata({ params }: { params: Promise<{ sku: string }> }) {
  const { sku } = await params;
  const part = await prisma.part.findUnique({ where: { sku } });
  if (!part) return { title: "Onderdeel niet gevonden" };
  return { title: `${part.name} — ${formatEur(part.priceEur)}` };
}

export default async function PartDetailPage({ params }: { params: Promise<{ sku: string }> }) {
  const { sku } = await params;
  const part = await prisma.part.findUnique({
    where: { sku },
    include: {
      machines: { include: { machine: true } },
      guides: { include: { guide: true } },
      errorCodes: { include: { errorCode: { include: { machine: true } } } },
    },
  });

  if (!part) notFound();

  const compatibleBrands = Array.from(new Set(part.machines.map((m) => m.machine.brand)));
  const relatedParts = await prisma.part.findMany({
    where: { category: part.category, id: { not: part.id }, stock: { gt: 0 } },
    take: 4,
  });

  return (
    <MarketingLayout>
      <div className="container py-8">
        <nav className="text-sm text-muted-foreground mb-6">
          <Link href="/onderdelen" className="hover:text-foreground">Onderdelen</Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">{part.sku}</span>
        </nav>

        <div className="grid lg:grid-cols-2 gap-10">
          <div>
            <Tabs defaultValue="3d" className="w-full">
              <TabsList className="mb-3">
                <TabsTrigger value="3d">3D Model</TabsTrigger>
                <TabsTrigger value="photo">Foto</TabsTrigger>
              </TabsList>
              <TabsContent value="3d" className="mt-0">
                <PartViewer3DWrapper category={part.category} />
              </TabsContent>
              <TabsContent value="photo" className="mt-0">
                {part.imageUrl ? (
                  <div className="relative w-full h-72 md:h-96 rounded-lg overflow-hidden bg-muted border">
                    <Image src={part.imageUrl} alt={part.name} fill sizes="(max-width: 1024px) 100vw, 50vw" className="object-cover" priority />
                  </div>
                ) : (
                  <div className="w-full h-72 md:h-96 rounded-lg bg-muted border flex items-center justify-center text-muted-foreground">
                    Geen afbeelding beschikbaar
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>

          <div className="space-y-5">
            <div>
              <Badge variant="outline" className="mb-2">{part.brand}</Badge>
              {part.isOriginal && (
                <Badge variant="accent" className="ml-2">Origineel onderdeel</Badge>
              )}
              <h1 className="font-heading text-2xl md:text-3xl font-bold mt-2">{part.name}</h1>
              <p className="text-sm text-muted-foreground mt-1">SKU: {part.sku}</p>
            </div>

            <div className="text-3xl font-heading font-bold text-primary">{formatEur(part.priceEur)}</div>

            {part.stock > 0 ? (
              <div className="flex items-center gap-2 text-emerald-600 font-medium text-sm">
                <CheckCircle2 className="h-4 w-4" /> Op voorraad — {part.stock} stuks
              </div>
            ) : (
              <div className="text-destructive font-medium text-sm">Tijdelijk uitverkocht</div>
            )}

            {part.description && <p className="text-muted-foreground leading-relaxed">{part.description}</p>}

            <AddToCartButton part={part} />

            <Card>
              <CardContent className="p-4 grid grid-cols-3 gap-3 text-center">
                <div>
                  <Truck className="h-5 w-5 mx-auto mb-1 text-primary" />
                  <p className="text-xs text-muted-foreground">Voor 22:00 besteld<br/>morgen in huis</p>
                </div>
                <div>
                  <ShieldCheck className="h-5 w-5 mx-auto mb-1 text-primary" />
                  <p className="text-xs text-muted-foreground">2 jaar<br/>garantie</p>
                </div>
                <div>
                  <RotateCcw className="h-5 w-5 mx-auto mb-1 text-primary" />
                  <p className="text-xs text-muted-foreground">30 dagen<br/>retour</p>
                </div>
              </CardContent>
            </Card>

            {compatibleBrands.length > 0 && (
              <div>
                <p className="text-sm font-semibold mb-2 flex items-center gap-2"><Package className="h-4 w-4" /> Compatibel met</p>
                <div className="flex flex-wrap gap-2">
                  {compatibleBrands.map((b) => (
                    <Badge key={b} variant="secondary">{b}</Badge>
                  ))}
                </div>
                {part.machines.length > 0 && (
                  <details className="mt-3">
                    <summary className="text-sm text-primary cursor-pointer">{part.machines.length} compatibele modellen tonen</summary>
                    <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                      {part.machines.map((pm) => (
                        <li key={pm.machineId}>· {pm.machine.brand} {pm.machine.model}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </div>
        </div>

        {part.guides.length > 0 && (
          <div className="mt-16">
            <h2 className="font-heading text-xl font-bold mb-4">Bijbehorende reparatiegidsen</h2>
            <div className="grid md:grid-cols-3 gap-4">
              {part.guides.map((gp) => (
                <Link key={gp.guide.id} href={`/gidsen/${gp.guide.slug}`}>
                  <Card className="hover:border-primary transition-colors h-full">
                    <CardContent className="p-5">
                      <p className="font-medium mb-1">{gp.guide.title}</p>
                      <p className="text-xs text-muted-foreground line-clamp-2">{gp.guide.summary}</p>
                      <p className="text-xs text-primary mt-2">Bekijk gids →</p>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        )}

        {relatedParts.length > 0 && (
          <div className="mt-16">
            <h2 className="font-heading text-xl font-bold mb-4">Vergelijkbare onderdelen</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {relatedParts.map((p) => (
                <PartCard key={p.id} part={p} />
              ))}
            </div>
          </div>
        )}
      </div>
    </MarketingLayout>
  );
}
