import { MarketingLayout } from "@/components/marketing-layout";
import { dbGuide, FREE_GUIDE_STEPS } from "@/lib/static-db";
import { notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { PartThumb } from "@/components/part-photo";
import { Clock, AlertTriangle, ChevronRight, Wrench, Crown, ShoppingCart, BookOpen } from "lucide-react";
import { pickArr, formatEur } from "@/lib/utils";
import { GuideStepper } from "./guide-stepper";
import { Reviews } from "@/components/Reviews";
import { getReviews, reviewStats, aggregateRatingLd } from "@/lib/reviews";
import { getCurrentUser } from "@/lib/auth";
import { canReadPremiumGuide } from "@/lib/entitlements";
import { PLANS, formatPlanPrice } from "@/lib/plans";
import { prisma } from "@/lib/prisma";
import { isDatabaseConfigured } from "@/lib/env";
import { logger } from "@/lib/logger";
import { pageDescription, pageMetadata, pageTitle, robotsMeta } from "@/lib/seo";
import { breadcrumbLd, ldJson } from "@/lib/json-ld";

// Stays dynamic on purpose: what a visitor may read depends on their plan
// (canReadPremiumGuide), so this page cannot be shared from a cache. The data reads
// are still the cached ones.
export const dynamic = "force-dynamic";


export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const guide = await dbGuide(slug);
  if (!guide) return { title: "Gids niet gevonden", robots: robotsMeta(false, true) };
  return pageMetadata({
    title: pageTitle(`${guide.title}: stap-voor-stap reparatiegids`, `${guide.title}: reparatiegids`, guide.title),
    description: pageDescription(guide.summary, "Stap voor stap, met het gereedschap en een tijdsindicatie."),
    path: `/gidsen/${guide.slug}`,
    type: "article",
  });
}

export default async function GuideDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const guide = await dbGuide(slug);

  if (!guide) notFound();

  const allSteps = JSON.parse(guide.steps) as Array<{ stepNum: number; title: string; description: string; warning?: string; imageUrl?: string }>;

  // Premium guides are a paid feature ("alle premium gidsen" sells the
  // Particulier plan), so the full text is gated. Everyone still gets the
  // first steps: enough to judge the guide, and enough for the page to carry
  // real content for search. The structured data below is built from the
  // steps actually shown, so the markup never promises more than the page has.
  const user = await getCurrentUser().catch(() => null);
  const hasPremiumAccess = canReadPremiumGuide(user?.plan);
  const isLocked = guide.isPremium && !hasPremiumAccess;
  const steps = isLocked ? allSteps.slice(0, FREE_GUIDE_STEPS) : allSteps;
  const lockedStepCount = allSteps.length - steps.length;

  const tools = pickArr(guide.tools);
  const parts = guide.parts.map((gp) => gp.part);

  const reviews = await getReviews({ slug: guide.slug });
  const stats = reviewStats(reviews);

  // Count the view for real. The seed used to ship invented counts (900-4000
  // per guide) which /gidsen printed as "N keer bekeken"; they now start at
  // zero and only go up when someone actually opens the page. Best-effort:
  // a failed counter must never take the guide down with it.
  if (isDatabaseConfigured()) {
    prisma.repairGuide
      .update({ where: { id: guide.id }, data: { views: { increment: 1 } } })
      .catch((err) => logger.warn("[guides] view counter failed", err));
  }

  // schema.org HowTo structured data
  const howToLd = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: guide.title,
    description: guide.summary,
    totalTime: `PT${guide.timeMinutes}M`,
    // No estimatedCost: it was the sum of every part listed beside the guide, a total the page does not show and
    // parts that can be alternatives of each other. The parts themselves are listed as `supply` below.
    tool: tools.map((t) => ({ "@type": "HowToTool", name: t })),
    supply: parts.map((p) => ({ "@type": "HowToSupply", name: p.name, image: p.imageUrl ?? undefined })),
    step: steps.map((s) => ({
      "@type": "HowToStep",
      name: s.title,
      text: s.description + (s.warning ? ` Let op: ${s.warning}` : ""),
      position: s.stepNum,
    })),
    aggregateRating: aggregateRatingLd(stats),
  };

  const breadcrumb = breadcrumbLd([{ name: "Gidsen", path: "/gidsen" }, { name: guide.title }]);

  return (
    <MarketingLayout>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(howToLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(breadcrumb) }} />
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

        <h1 className="font-heading text-2xl sm:text-3xl md:text-4xl font-bold leading-tight [overflow-wrap:anywhere]">{guide.title}</h1>
        <p className="text-lg text-muted-foreground mt-3 max-w-2xl">{guide.summary}</p>

        {guide.warnings && (
          <Card className="mt-6 border-warning/30 bg-warning/10">
            <CardContent className="p-4 flex gap-3">
              <AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-foreground mb-1">Veiligheidswaarschuwing</p>
                <p className="text-sm text-foreground">{guide.warnings}</p>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-8 mt-8">
          <div className="min-w-0">
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

            {isLocked && lockedStepCount > 0 && (
              <Card className="mt-6 border-primary/40 border-2 bg-gradient-to-br from-primary/5 to-accent/5">
                <CardContent className="p-6 text-center">
                  <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Crown className="h-5 w-5" />
                  </div>
                  <h2 className="font-heading text-xl font-bold">
                    Nog {lockedStepCount} {lockedStepCount === 1 ? "stap" : "stappen"} te gaan
                  </h2>
                  <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
                    Deze premium gids gaat verder met de demontage, de meetwaarden en de afstelling.
                    Word Particulier voor {formatPlanPrice(PLANS.PARTICULIER)} per maand en lees alle
                    {" "}premium gidsen — de eerste {PLANS.PARTICULIER.trialDays} dagen gratis.
                  </p>
                  <div className="mt-5 flex flex-wrap gap-2 justify-center">
                    <Button asChild>
                      <Link href="/upgrade?plan=PARTICULIER">Ontgrendel deze gids</Link>
                    </Button>
                    <Button asChild variant="outline">
                      <Link href="/prijzen">Bekijk de plannen</Link>
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-4">
                    Liever zelf klussen zonder abonnement? De{" "}
                    <Link href="/gidsen" className="text-primary hover:underline">gratis gidsen</Link>{" "}
                    dekken de meest voorkomende storingen.
                  </p>
                </CardContent>
              </Card>
            )}
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
                        <PartThumb imageUrl={p.imageUrl} name={p.name} />
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
                <p className="text-sm text-muted-foreground">Twijfel over de diagnose? Onze AI geeft je een eerste indicatie. Een indicatie, geen zekerheid.</p>
                <Button asChild className="w-full min-h-11">
                  <Link href="/diagnose"><BookOpen className="h-4 w-4" /> Start AI diagnose</Link>
                </Button>
              </CardContent>
            </Card>
          </aside>
        </div>

        <div className="mt-12 max-w-3xl">
          <Reviews slug={guide.slug} />
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
