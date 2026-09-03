import { MarketingLayout } from "@/components/marketing-layout";
import { staticErrorCode } from "@/lib/static-db";
import { notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PartCard } from "@/components/part-card";
import { pickArr } from "@/lib/utils";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, BookOpen, Sparkles, ChevronRight, Wrench } from "lucide-react";

export const dynamic = "force-dynamic";


export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const decoded = decodeURIComponent(code);
  const [brand, ec] = decoded.split("-");
  const errorCode = staticErrorCode(brand, ec);
  if (!errorCode) {
    return { title: `${brand} ${ec} foutcode — oorzaak & oplossing` };
  }
  const title = `${brand} ${ec} foutcode — ${errorCode.title} oplossen | WasFix Pro`;
  const description = `${brand} wasmachine toont ${ec}? ${errorCode.description.substring(0, 140)}... ✓ Directe oplossing ✓ Juiste onderdelen ✓ Stap-voor-stap gids`;
  return {
    title,
    description,
    keywords: [
      `${brand} ${ec}`,
      `${brand} wasmachine ${ec}`,
      `foutcode ${ec} oplossen`,
      `${brand} ${ec} betekenis`,
      "wasmachine storing",
      "wasmachine reparatie",
    ],
    openGraph: { title, description, type: "article" },
    alternates: { canonical: `/foutcodes/${encodeURIComponent(brand)}-${encodeURIComponent(ec)}` },
  };
}

export default async function ErrorCodeDetailPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const decoded = decodeURIComponent(code);
  const [brand, codeValue] = decoded.split("-");

  const errorCode = staticErrorCode(brand, codeValue);

  if (!errorCode) notFound();

  const causes = pickArr(errorCode.likelyCauses);
  const parts = errorCode.parts.map((ep) => ep.part);
  const guides = errorCode.guides.map((eg) => eg.guide);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: `${errorCode.machine.brand} ${errorCode.code} foutcode — ${errorCode.title}`,
    description: errorCode.description,
    about: {
      "@type": "Product",
      name: `${errorCode.machine.brand} ${errorCode.machine.model}`,
      brand: { "@type": "Brand", name: errorCode.machine.brand },
    },
    proficiencyLevel: errorCode.diyFriendly ? "Beginner" : "Expert",
    publisher: { "@type": "Organization", name: "WasFix Pro" },
  };

  // FAQPage schema — Google shows rich FAQ results
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: `Wat betekent ${errorCode.machine.brand} foutcode ${errorCode.code}?`,
        acceptedAnswer: { "@type": "Answer", text: `${errorCode.title}. ${errorCode.description}` },
      },
      ...(causes.length > 0 ? [{
        "@type": "Question",
        name: `Wat zijn de oorzaken van foutcode ${errorCode.code} op een ${errorCode.machine.brand}?`,
        acceptedAnswer: { "@type": "Answer", text: `De meest voorkomende oorzaken zijn: ${causes.join("; ")}.` },
      }] : []),
      {
        "@type": "Question",
        name: `Kan ik foutcode ${errorCode.code} zelf oplossen?`,
        acceptedAnswer: { "@type": "Answer", text: errorCode.diyFriendly
          ? `Ja, foutcode ${errorCode.code} is in veel gevallen zelf op te lossen. Bekijk de aanbevolen reparatiegids voor stap-voor-stap instructies.`
          : `Nee, foutcode ${errorCode.code} vereist meestal een professionele monteur omdat het meestal een elektronisch of complex mechanisch probleem betreft.` },
      },
    ],
  };

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Foutcodes", item: "https://wasfix.nl/foutcodes" },
      { "@type": "ListItem", position: 2, name: errorCode.machine.brand, item: `https://wasfix.nl/merken/${encodeURIComponent(errorCode.machine.brand)}` },
      { "@type": "ListItem", position: 3, name: errorCode.code },
    ],
  };

  return (
    <MarketingLayout>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />
      <div className="container py-8 max-w-5xl">
        <nav className="text-sm text-muted-foreground mb-4">
          <Link href="/foutcodes" className="hover:text-foreground">Foutcodes</Link>
          <ChevronRight className="inline h-3 w-3 mx-1" />
          <span className="text-foreground">{errorCode.machine.brand} {errorCode.code}</span>
        </nav>

        <div className="flex items-start gap-6 mb-8">
          <div className="shrink-0 h-20 w-20 rounded-lg bg-primary/10 flex items-center justify-center">
            <span className="font-heading font-bold text-2xl text-primary">{errorCode.code}</span>
          </div>
          <div>
            <Badge variant="outline" className="mb-2">{errorCode.machine.brand} {errorCode.machine.model}</Badge>
            <h1 className="font-heading text-3xl md:text-4xl font-bold">{errorCode.title}</h1>
            <p className="text-muted-foreground mt-2 max-w-2xl">{errorCode.description}</p>
          </div>
        </div>

        <div className="grid lg:grid-cols-[1fr_320px] gap-8">
          <div className="space-y-6">
            <Card>
              <CardContent className="p-6">
                <h2 className="font-heading text-xl font-semibold mb-4 flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-amber-500" /> Mogelijke oorzaken
                </h2>
                <ul className="space-y-2.5">
                  {causes.map((c, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="shrink-0 h-6 w-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">{i + 1}</span>
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            {guides.length > 0 && (
              <Card>
                <CardContent className="p-6">
                  <h2 className="font-heading text-xl font-semibold mb-4 flex items-center gap-2">
                    <BookOpen className="h-5 w-5" /> Reparatiegidsen
                  </h2>
                  <div className="space-y-3">
                    {guides.map((g) => (
                      <Link key={g.id} href={`/gidsen/${g.slug}`}>
                        <div className="rounded-md border p-4 hover:border-primary transition-colors group">
                          <p className="font-medium group-hover:text-primary">{g.title}</p>
                          <p className="text-sm text-muted-foreground line-clamp-2 mt-1">{g.summary}</p>
                          <p className="text-xs text-primary mt-2">Bekijk gids →</p>
                        </div>
                      </Link>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {parts.length > 0 && (
              <Card>
                <CardContent className="p-6">
                  <h2 className="font-heading text-xl font-semibold mb-4 flex items-center gap-2">
                    <Wrench className="h-5 w-5" /> Aanbevolen onderdelen
                  </h2>
                  <div className="grid sm:grid-cols-2 gap-4">
                    {parts.map((p) => (
                      <PartCard key={p.id} part={p} />
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          <aside className="space-y-4">
            <Card className="bg-primary text-primary-foreground">
              <CardContent className="p-5 space-y-3">
                <h3 className="font-heading font-bold flex items-center gap-2">
                  <Sparkles className="h-4 w-4" /> AI Diagnose
                </h3>
                <p className="text-sm opacity-90">
                  Twijfel of dit jouw probleem is? Onze AI analyseert jouw exacte situatie in 2 minuten.
                </p>
                <Button asChild variant="accent" className="w-full">
                  <Link href={`/diagnose?prefill=${encodeURIComponent(`Mijn ${errorCode.machine.brand} geeft foutcode ${errorCode.code}`)}`}>
                    Start diagnose
                  </Link>
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-5">
                <h3 className="font-heading font-semibold mb-3">Snelle info</h3>
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between"><dt className="text-muted-foreground">Foutcode</dt><dd className="font-medium">{errorCode.code}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted-foreground">Merk</dt><dd className="font-medium">{errorCode.machine.brand}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted-foreground">Model</dt><dd className="font-medium text-right">{errorCode.machine.model}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted-foreground">Severity</dt><dd className="font-medium">{errorCode.severity}</dd></div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">DIY?</dt>
                    <dd className="font-medium flex items-center gap-1">
                      {errorCode.diyFriendly ? <><CheckCircle2 className="h-3 w-3 text-emerald-500" /> Ja</> : "Monteur"}
                    </dd>
                  </div>
                </dl>
              </CardContent>
            </Card>

            {/* Where this meaning comes from. Publishing a code without saying
                whether we checked it leaves the reader to assume we did. */}
            <Card>
              <CardContent className="p-5">
                <h3 className="font-heading font-semibold mb-2">Bron</h3>
                {errorCode.provenance === "VERIFIED" && errorCode.sourceUrl ? (
                  <p className="text-sm text-muted-foreground">
                    Betekenis gecontroleerd tegen{" "}
                    <a href={errorCode.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-primary hover:underline">
                      {errorCode.sourceName ?? "een openbare bron"}
                    </a>
                    . Fabrikanten wijzigen codes soms per serie — controleer bij twijfel de handleiding van jouw model.
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Deze betekenis circuleert bij monteurs en op reparatiefora, maar we hebben hem niet kunnen
                    bevestigen in openbare {errorCode.machine.brand}-documentatie. Behandel hem als een aanwijzing,
                    niet als vaststaand, en controleer de handleiding van jouw model.
                  </p>
                )}
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </MarketingLayout>
  );
}
