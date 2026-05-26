import { MarketingLayout } from "@/components/marketing-layout";
import { staticGuide } from "@/lib/static-db";
import { notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import Image from "next/image";
import { Clock, AlertTriangle, ChevronRight, Wrench, Crown, ShoppingCart, BookOpen } from "lucide-react";
import { pickArr, formatEur } from "@/lib/utils";
import { GuideStepper } from "./guide-stepper";

export const dynamic = "force-dynamic";


export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const guide = staticGuide(slug);
  if (!guide) return { title: "Gids niet gevonden" };
  return {
    title: `${guide.title} — Stap-voor-stap reparatiegids · WasFix Pro`,
    description: guide.summary,
    alternates: { canonical: `/gidsen/${guide.slug}` },
    openGraph: { title: guide.title, description: guide.summary, type: "article" },
  };
}

export default async function GuideDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const guide = staticGuide(slug);

  if (!guide) notFound();

  const steps = JSON.parse(guide.steps) as Array<{ stepNum: number; title: string; description: string; warning?: string; imageUrl?: string }>;
  const tools = pickArr(guide.tools);
  const parts = guide.parts.map((gp) => gp.part);

  // schema.org HowTo structured data
  const howToLd = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: guide.title,
    description: guide.summary,
    totalTime: `PT${guide.timeMinutes}M`,
    estimatedCost: parts.length
      ? { "@type": "MonetaryAmount", currency: "EUR", value: parts.reduce((s, p) => s + p.priceEur, 0).toFixed(2) }
      : undefined,
    tool: tools.map((t) => ({ "@type": "HowToTool", name: t })),
    supply: parts.map((p) => ({ "@type": "HowToSupply", name: p.name, image: p.imageUrl ?? undefined })),
    step: steps.map((s) => ({
      "@type": "HowToStep",
      name: s.title,
      text: s.description + (s.warning ? ` Let op: ${s.warning}` : ""),
      position: s.stepNum,
    })),
  };

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Gidsen", item: "https://wasfix.nl/gidsen" },
      { "@type": "ListItem", position: 2, name: guide.title, item: `https://wasfix.nl/gidsen/${guide.slug}` },
    ],
  };

  return (
    <MarketingLayout>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(howToLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />
      <div className="container py-8 max-w-5xl">
        <nav className="text-sm text-muted-foreground mb-4">
          <Link href="/gidsen" className="hover:text-foreground">Gidsen</Link>
          <ChevronRight className="inline h-3 w-3 mx-1" />
          <span className="text-foreground">{guide.title}</span>
        </nav>

        <div className="flex flex-wrap gap-2 mb-3">
          <DifficultyBadge difficulty={guide.difficulty} />
          <Badge variant="outline" className="gap-1"><Clock className="h-3 w-3" /> {guide.timeMinutes} min</Badge>
          {guide.isPremium && <Badge variant="accent" className="gap-1"><Crown className="h-3 w-3" /> Premium</Badge>}
        </div>

        <h1 className="font-heading text-3xl md:text-4xl font-bold leading-tight">{guide.title}</h1>
        <p className="text-lg text-muted-foreground mt-3 max-w-2xl">{guide.summary}</p>

        {guide.warnings && (
          <Card className="mt-6 border-amber-500/30 bg-amber-50 dark:bg-amber-950/30">
            <CardContent className="p-4 flex gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-amber-900 dark:text-amber-100 mb-1">Veiligheidswaarschuwing</p>
                <p className="text-sm text-amber-900 dark:text-amber-200">{guide.warnings}</p>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid lg:grid-cols-[1fr_320px] gap-8 mt-8">
          <div>
            {tools.length > 0 && (
              <Card className="mb-6">
                <CardContent className="p-5">
                  <h2 className="font-heading text-lg font-semibold mb-3 flex items-center gap-2">
                    <Wrench className="h-4 w-4" /> Gereedschap dat je nodig hebt
                  </h2>
                  <div className="flex flex-wrap gap-2">
                    {tools.map((t, i) => (
                      <Badge key={i} variant="secondary">{t}</Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            <GuideStepper steps={steps} />
          </div>

          <aside className="space-y-4">
            {parts.length > 0 && (
              <Card>
                <CardContent className="p-5">
                  <h3 className="font-heading font-semibold mb-3 flex items-center gap-2">
                    <ShoppingCart className="h-4 w-4" /> Onderdelen
                  </h3>
                  <div className="space-y-3">
                    {parts.map((p) => (
                      <Link key={p.id} href={`/onderdelen/${p.sku}`} className="flex gap-3 rounded-md border p-3 hover:border-primary transition-colors">
                        {p.imageUrl && <Image src={p.imageUrl} alt={p.name} width={48} height={48} className="h-12 w-12 rounded bg-muted object-cover" />}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium line-clamp-2 leading-tight">{p.name}</p>
                          <p className="text-primary font-bold text-sm mt-1">{formatEur(p.priceEur)}</p>
                        </div>
                      </Link>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardContent className="p-5 space-y-3">
                <h3 className="font-heading font-semibold">Hulp nodig?</h3>
                <p className="text-sm text-muted-foreground">Twijfel over de diagnose? Onze AI helpt je in 2 minuten verder.</p>
                <Button asChild className="w-full">
                  <Link href="/diagnose"><BookOpen className="h-4 w-4" /> Start AI diagnose</Link>
                </Button>
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </MarketingLayout>
  );
}

function DifficultyBadge({ difficulty }: { difficulty: string }) {
  const map: Record<string, { label: string; variant: any }> = {
    EASY: { label: "Makkelijk", variant: "success" },
    MEDIUM: { label: "Gemiddeld", variant: "warning" },
    HARD: { label: "Moeilijk", variant: "danger" },
    EXPERT: { label: "Expert", variant: "danger" },
  };
  const m = map[difficulty] ?? map.MEDIUM;
  return <Badge variant={m.variant}>{m.label}</Badge>;
}
