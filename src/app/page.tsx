import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MarketingLayout } from "@/components/marketing-layout";
import { prisma } from "@/lib/prisma";
import { formatEur } from "@/lib/utils";
import HeroSceneWrapper from "@/components/3d/HeroSceneWrapper";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { Testimonials } from "@/components/ui/testimonials";
import { SustainabilityBadge } from "@/components/ui/sustainability-badge";
import {
  Sparkles, Package, ShieldCheck, ArrowRight,
  CheckCircle2, Bot, Zap, BookOpen, TrendingUp, Star,
} from "lucide-react";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  // Resilient to missing DB — page still renders with sensible defaults
  let partsCount = 20;
  let guidesCount = 6;
  let machinesCount = 18;
  let errorCodesCount = 26;
  let featuredParts: Array<{ id: string; sku: string; name: string; brand: string; priceEur: number; imageUrl: string | null; stock: number; category: string }> = [];
  try {
    [partsCount, guidesCount, machinesCount, errorCodesCount, featuredParts] = await Promise.all([
      prisma.part.count(),
      prisma.repairGuide.count(),
      prisma.washingMachine.count(),
      prisma.errorCode.count(),
      prisma.part.findMany({ take: 4, where: { stock: { gt: 0 } }, orderBy: { stock: "desc" } }),
    ]);
  } catch {
    // DB unreachable (e.g. demo deploy without DATABASE_URL) — fall through with defaults
  }

  return (
    <MarketingLayout>
      {/* Hero */}
      <section className="relative overflow-hidden gradient-mesh">
        <div className="container py-20 md:py-28 lg:py-36">
          <div className="grid gap-10 lg:grid-cols-2 items-center">
            <div className="space-y-6 animate-fade-in">
              <Badge variant="accent" className="rounded-full px-3 py-1">
                <Sparkles className="mr-1 h-3 w-3" /> Powered by Claude AI
              </Badge>
              <h1 className="font-heading text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tighter leading-[1.05]">
                Wasmachine kapot? <span className="text-primary italic">Wij weten wat er mis is.</span>
              </h1>
              <p className="text-lg text-muted-foreground max-w-xl">
                Beschrijf de storing of voer de foutcode in. Onze AI geeft u binnen <strong className="text-foreground">60 seconden</strong> de diagnose,
                het juiste onderdeel, en een stap-voor-stap reparatiegids. Geen wachttijd. Geen monteur nodig.
              </p>

              {/* Quick foutcode chips voor instant context */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                <span className="text-xs text-muted-foreground self-center mr-1">Populair:</span>
                {[
                  { code: "Bosch E18", probleem: "Afvoer" },
                  { code: "Miele F11", probleem: "Pomp" },
                  { code: "Samsung dE", probleem: "Deur" },
                  { code: "LG OE", probleem: "Afvoer" },
                ].map(({ code, probleem }) => (
                  <Link
                    key={code}
                    href={`/diagnose?prefill=${encodeURIComponent("Mijn " + code + " geeft een storing")}`}
                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-muted hover:bg-primary/10 hover:text-primary rounded-md text-xs transition-colors"
                  >
                    <span className="font-mono font-semibold">{code}</span>
                    <span className="text-muted-foreground">· {probleem}</span>
                  </Link>
                ))}
              </div>

              <div className="flex flex-wrap gap-3">
                <Button asChild size="xl">
                  <Link href="/diagnose">Start gratis diagnose <ArrowRight className="h-4 w-4" /></Link>
                </Button>
                <Button asChild variant="outline" size="xl">
                  <Link href="/onderdelen">Bekijk onderdelen</Link>
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground pt-4">
                <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-primary" /> 3 gratis diagnoses</span>
                <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-primary" /> Geen creditcard</span>
                <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-primary" /> 1-dag levering</span>
              </div>
            </div>

            <div className="relative">
              <div className="rounded-2xl border bg-card overflow-hidden shadow-2xl animate-fade-in relative">
                <HeroSceneWrapper />
                <div className="absolute top-4 left-4 right-4 flex items-center justify-between pointer-events-none">
                  <div className="flex items-center gap-2 rounded-full bg-card/80 backdrop-blur px-3 py-1.5 border">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-xs font-medium">Live 3D model</span>
                  </div>
                  <div className="rounded-full bg-card/80 backdrop-blur px-3 py-1.5 border text-xs font-medium flex items-center gap-1">
                    <Bot className="h-3 w-3" /> AI ready
                  </div>
                </div>
              </div>
              <div className="absolute -top-4 -right-4 h-24 w-24 rounded-full bg-accent/20 blur-3xl pointer-events-none" />
              <div className="absolute -bottom-4 -left-4 h-32 w-32 rounded-full bg-primary/20 blur-3xl pointer-events-none" />
            </div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="border-y bg-card/50">
        <div className="container py-10">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <Stat value={`${machinesCount}+`} label="Modellen ondersteund" />
            <Stat value={`${errorCodesCount}+`} label="Foutcodes in database" />
            <Stat value={`${partsCount}+`} label="Originele onderdelen" />
            <Stat value={`${guidesCount}+`} label="Reparatiegidsen" />
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="container py-20">
        <div className="text-center mb-12">
          <Badge variant="secondary" className="mb-3">Hoe het werkt</Badge>
          <h2 className="font-heading text-3xl md:text-4xl font-bold">Drie stappen naar een werkende wasmachine</h2>
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          <FeatureCard
            icon={<Bot className="h-6 w-6" />}
            num="01"
            title="AI Diagnose"
            text="Beschrijf het probleem of geef de foutcode. Claude AI analyseert duizenden mogelijke oorzaken en geeft je de meest waarschijnlijke."
          />
          <FeatureCard
            icon={<BookOpen className="h-6 w-6" />}
            num="02"
            title="Reparatiegids"
            text="Krijg een stap-voor-stap handleiding op maat van jouw probleem. Met foto's, benodigd gereedschap en veiligheidstips."
          />
          <FeatureCard
            icon={<Package className="h-6 w-6" />}
            num="03"
            title="Onderdelen besteld"
            text="Het juiste onderdeel klikt automatisch in je winkelmand. Voor 22:00 besteld = morgen in huis. Origineel of voordelig alternatief."
          />
        </div>
      </section>

      {/* Featured Parts */}
      <section className="border-y bg-muted/30">
        <div className="container py-16">
          <div className="flex items-end justify-between mb-8">
            <div>
              <h2 className="font-heading text-2xl md:text-3xl font-bold">Veelgevraagde onderdelen</h2>
              <p className="text-muted-foreground mt-1">Op voorraad en klaar voor verzending</p>
            </div>
            <Button asChild variant="outline">
              <Link href="/onderdelen">Alle onderdelen <ArrowRight className="h-4 w-4" /></Link>
            </Button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {featuredParts.map((p) => (
              <Link key={p.id} href={`/onderdelen/${p.sku}`} className="group">
                <Card className="overflow-hidden hover:border-primary transition-colors">
                  {p.imageUrl && (
                    <div className="relative w-full h-44 sm:h-48 md:h-52 bg-muted overflow-hidden">
                      <Image src={p.imageUrl} alt={p.name} fill sizes="(max-width: 640px) 200px, (max-width: 1024px) 250px, 300px" className="object-cover group-hover:scale-105 transition-transform" />
                    </div>
                  )}
                  <CardContent className="p-4">
                    <Badge variant="outline" className="text-[10px] mb-1.5">{p.brand}</Badge>
                    <p className="text-sm font-medium line-clamp-2 leading-snug min-h-[40px]">{p.name}</p>
                    <p className="text-lg font-bold text-primary mt-2">{formatEur(p.priceEur)}</p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Why us */}
      <section className="container py-20">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          <div>
            <Badge variant="secondary" className="mb-3">Waarom WasFix Pro?</Badge>
            <h2 className="font-heading text-3xl md:text-4xl font-bold mb-6">
              Bespaar honderden euro&apos;s op reparatiekosten
            </h2>
            <p className="text-muted-foreground mb-8 text-lg">
              Een monteurbezoek kost gemiddeld €120-180 voorrijkosten plus arbeidsloon.
              Met WasFix Pro repareer je 70% van de problemen zelf voor minder dan €30 aan onderdelen.
            </p>
            <div className="space-y-4">
              <Benefit icon={<Zap className="h-5 w-5" />} title="In 3 minuten gediagnosticeerd" text="Geen wachten op afspraak — direct antwoord, 24/7." />
              <Benefit icon={<ShieldCheck className="h-5 w-5" />} title="100% kloppende onderdelen" text="Onze AI matcht onderdelen op merk, model én bouwjaar." />
              <Benefit icon={<TrendingUp className="h-5 w-5" />} title="Geld terug garantie" text="Onderdeel toch niet de oorzaak? Retourneer binnen 30 dagen." />
            </div>
          </div>
          <div className="relative">
            <Card className="p-8 bg-gradient-to-br from-primary/5 to-accent/5 border-primary/20">
              <div className="space-y-6">
                <div className="flex items-baseline gap-2">
                  <span className="text-5xl font-heading font-bold text-primary">€140</span>
                  <span className="text-muted-foreground">gemiddelde besparing</span>
                </div>
                <div className="flex items-center gap-1 text-amber-500">
                  {[...Array(5)].map((_, i) => <Star key={i} className="h-4 w-4 fill-current" />)}
                  <span className="ml-2 text-sm text-foreground">4.8/5 — 1247 reviews</span>
                </div>
                <blockquote className="border-l-2 border-primary pl-4 italic">
                  &ldquo;Mijn Bosch had foutcode E18. Diagnose binnen 2 minuten, onderdeel besteld, zelf vervangen voor €28. Een monteur had €180 gevraagd.&rdquo;
                </blockquote>
                <p className="text-sm text-muted-foreground">— Sander uit Utrecht</p>
              </div>
            </Card>
          </div>
        </div>
      </section>

      {/* Pricing teaser */}
      <section className="border-t bg-muted/30">
        <div className="container py-20">
          <div className="text-center mb-10">
            <Badge variant="secondary" className="mb-3">Tarieven</Badge>
            <h2 className="font-heading text-3xl md:text-4xl font-bold">Voor iedereen het juiste plan</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            <PricingCard name="Gratis" price="€0" period="" features={["3 diagnoses per maand", "Basis foutcode database", "Toegang tot gratis gidsen"]} cta="Probeer gratis" href="/diagnose" />
            <PricingCard
              name="Particulier"
              price="€4,99"
              period="/maand"
              features={["Onbeperkte diagnoses", "Alle premium gidsen", "5% korting op onderdelen", "Prioriteit support"]}
              cta="Word lid"
              href="/prijzen"
              highlight
            />
            <PricingCard name="Monteur Pro" price="€29" period="/maand" features={["Onbeperkte diagnoses", "10% korting onderdelen", "Klanten dashboard", "API toegang"]} cta="Voor monteurs" href="/prijzen" />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="container py-20">
        <Card className="overflow-hidden border-0 bg-gradient-to-br from-primary to-primary/80 text-primary-foreground">
          <CardContent className="p-12 md:p-16 text-center">
            <h2 className="font-heading text-3xl md:text-5xl font-bold mb-4">
              Klaar om je wasmachine te repareren?
            </h2>
            <p className="text-lg mb-8 text-primary-foreground/90 max-w-xl mx-auto">
              Start nu met een gratis diagnose. Geen registratie nodig, geen creditcard.
            </p>
            <Button asChild size="xl" variant="accent">
              <Link href="/diagnose">Start nu gratis <ArrowRight className="h-4 w-4" /></Link>
            </Button>
          </CardContent>
        </Card>
      </section>

      {/* Testimonials */}
      <Testimonials />

      {/* Sustainability footer banner */}
      <section className="border-t">
        <div className="container py-12">
          <div className="flex flex-wrap gap-3 justify-center">
            <SustainabilityBadge variant="co2" />
            <SustainabilityBadge variant="right-to-repair" />
            <SustainabilityBadge variant="circular" />
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  // Extract numeric portion if "123+" pattern, else display as-is
  const match = value.match(/^(\d+)(.*)$/);
  return (
    <div className="text-center">
      <p className="font-heading text-3xl md:text-4xl font-bold text-primary">
        {match ? <><AnimatedCounter value={parseInt(match[1], 10)} />{match[2]}</> : value}
      </p>
      <p className="text-sm text-muted-foreground mt-1">{label}</p>
    </div>
  );
}

function FeatureCard({ icon, num, title, text }: { icon: React.ReactNode; num: string; title: string; text: string }) {
  return (
    <Card className="relative overflow-hidden hover:shadow-md transition-shadow">
      <CardContent className="p-6">
        <div className="absolute top-2 right-3 text-7xl font-heading font-bold text-muted/40 leading-none">{num}</div>
        <div className="flex h-12 w-12 items-center justify-center rounded-md bg-primary/10 text-primary mb-4 relative">
          {icon}
        </div>
        <h3 className="font-heading text-xl font-semibold mb-2">{title}</h3>
        <p className="text-sm text-muted-foreground">{text}</p>
      </CardContent>
    </Card>
  );
}

function Benefit({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="flex gap-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">{icon}</div>
      <div>
        <p className="font-semibold">{title}</p>
        <p className="text-sm text-muted-foreground">{text}</p>
      </div>
    </div>
  );
}

function PricingCard({ name, price, period, features, cta, href, highlight }: any) {
  return (
    <Card className={highlight ? "border-primary border-2 relative shadow-xl" : ""}>
      {highlight && <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">Populair</Badge>}
      <CardContent className="p-6 space-y-5">
        <div>
          <p className="text-sm text-muted-foreground">{name}</p>
          <div className="flex items-baseline mt-1">
            <span className="text-4xl font-heading font-bold">{price}</span>
            <span className="text-muted-foreground ml-1">{period}</span>
          </div>
        </div>
        <ul className="space-y-2">
          {features.map((f: string, i: number) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <span>{f}</span>
            </li>
          ))}
        </ul>
        <Button asChild className="w-full" variant={highlight ? "default" : "outline"}>
          <Link href={href}>{cta}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
