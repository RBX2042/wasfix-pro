import { MarketingLayout } from "@/components/marketing-layout";
import { safeDecode } from "@/lib/safe-param";
import { dbErrorCode, dbErrorCodes, dbMachineBrands, dbSuggestedPartsForCode } from "@/lib/static-db";
import { notFound, permanentRedirect } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PartCard } from "@/components/part-card";
import { pickArr } from "@/lib/utils";
import { clipAtWord } from "@/lib/seo-text";
import { TrustStrip } from "@/components/trust-strip";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, BookOpen, Sparkles, ChevronRight, Wrench, UserRound } from "lucide-react";
import { absoluteUrl } from "@/lib/site-url";

// ISR instead of force-dynamic: these 329 pages are the Google entry points and
// nothing on them depends on the visitor. The catalogue reads underneath are tagged
// (CATALOG_TAG), so POST /api/parts/revalidate shows a price change without waiting
// for the 60 second window.
export const revalidate = 60;

/** "Bosch-E18" -> ["Bosch", "E18"]. Split on the FIRST hyphen only: a code may contain one. */
function splitSlug(decoded: string): [string, string] {
  const i = decoded.indexOf("-");
  return i < 0 ? [decoded, ""] : [decoded.slice(0, i), decoded.slice(i + 1)];
}


// Nothing is pre-rendered at build time (the catalogue lives in the database, and a
// build must not need one), but declaring the params lets Next render each page on
// its first request and then serve it from the cache until revalidate/revalidateCatalog().
// Without this a dynamic-segment page is rendered on every request even when it uses
// nothing per visitor.
export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const decoded = safeDecode(code);
  if (decoded === null) return { title: "Foutcode niet gevonden", robots: { index: false } };
  const [brand, ec] = splitSlug(decoded);
  const errorCode = await dbErrorCode(brand, ec);
  if (!errorCode) {
    return { title: `${brand} ${ec} foutcode`, robots: { index: false } };
  }
  // No manual " | WasFix Pro": the root title template adds the site name (561 titles
  // ended "· WasFix Pro · WasFix Pro"). Description cut at a word boundary, not mid-word
  // plus "...".
  const title = `${brand} ${ec} foutcode: ${errorCode.title}`;
  const description = clipAtWord(`${brand} wasmachine toont ${ec}? ${errorCode.description}`, 155);
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
    openGraph: { title, description, type: "article", images: [{ url: "/opengraph-image", width: 1200, height: 630 }] },
    alternates: { canonical: `/foutcodes/${encodeURIComponent(brand)}-${encodeURIComponent(ec)}` },
  };
}

export default async function ErrorCodeDetailPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const decoded = safeDecode(code);
  if (decoded === null) notFound();
  const [brand, codeValue] = splitSlug(decoded);

  const errorCode = await dbErrorCode(brand, codeValue);

  if (!errorCode) {
    // /foutcodes/bosch-e18 used to be a 404 although the page exists as Bosch-E18.
    // Redirect case variants to the canonical URL; anything else is a real 404.
    const brands = await dbMachineBrands();
    const canonicalBrand = brands.find((b) => b.toLowerCase() === brand.toLowerCase());
    if (canonicalBrand) {
      const codes = await dbErrorCodes({ where: { brand: canonicalBrand } });
      const match = codes.find((c) => c.code.toLowerCase() === codeValue.toLowerCase());
      if (match) permanentRedirect(`/foutcodes/${encodeURIComponent(canonicalBrand)}-${encodeURIComponent(match.code)}`);
    }
    notFound();
  }

  const causes = pickArr(errorCode.likelyCauses);
  const linkedParts = errorCode.parts.map((ep) => ep.part);
  const guides = errorCode.guides.map((eg) => eg.guide);
  // 282 of 329 codes link no part. Rather than a dead end, suggest parts from the
  // categories the causes point at, that fit this brand - labelled as possibilities.
  const suggestedParts = linkedParts.length === 0 ? await dbSuggestedPartsForCode(errorCode, 4) : [];
  const shownParts = linkedParts.length > 0 ? linkedParts : suggestedParts;
  const diagnoseHref = `/diagnose?prefill=${encodeURIComponent(`Mijn ${errorCode.machine.brand} geeft foutcode ${errorCode.code}`)}`;

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
      { "@type": "ListItem", position: 1, name: "Foutcodes", item: absoluteUrl("/foutcodes") },
      { "@type": "ListItem", position: 2, name: errorCode.machine.brand, item: absoluteUrl(`/merken/${encodeURIComponent(errorCode.machine.brand)}`) },
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

        <div className="flex items-start gap-4 sm:gap-6 mb-8">
          <div className="shrink-0 h-16 w-16 sm:h-20 sm:w-20 rounded-lg bg-primary/10 flex items-center justify-center overflow-hidden">
            <span className="font-heading font-bold text-xl sm:text-2xl text-primary">{errorCode.code}</span>
          </div>
          {/* min-w-0: a flex child will not shrink below its longest unbreakable word
              ("deurvergrendelingsfout") unless told it may, and break-words alone does not
              tell it. 55 of 329 code pages overflowed a 375px phone by up to 262px. */}
          <div className="min-w-0 flex-1">
            <Badge variant="outline" className="mb-2 max-w-full whitespace-normal [overflow-wrap:anywhere]">{errorCode.machine.brand} {errorCode.machine.model}</Badge>
            <h1 className="font-heading text-2xl md:text-4xl font-bold [overflow-wrap:anywhere]">{errorCode.machine.brand} {errorCode.code}: {errorCode.title}</h1>
            <p className="text-muted-foreground mt-2 max-w-2xl [overflow-wrap:anywhere]">{errorCode.description}</p>
          </div>
        </div>

        {/* Above the fold on a phone: the one next step, and the facts a first-time
            buyer wants. The diagnose card used to sit after the parts (y=2386 on a
            375px screen) and the first buy button at y=1453. */}
        <div className="-mt-3 mb-8 space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button asChild size="lg" className="min-h-11 h-auto py-2 whitespace-normal text-left">
              <Link href={diagnoseHref} data-testid="code-diagnose-cta"><Sparkles className="h-4 w-4" /> Start diagnose met deze code</Link>
            </Button>
            {shownParts.length > 0 && (
              <Button asChild size="lg" variant="outline" className="min-h-11 h-auto py-2 whitespace-normal text-left">
                <a href="#onderdelen"><Wrench className="h-4 w-4" /> Bekijk onderdelen</a>
              </Button>
            )}
          </div>
          <TrustStrip />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-8">
          <div className="space-y-6 min-w-0">
            <Card>
              <CardContent className="p-6">
                <h2 className="font-heading text-xl font-semibold mb-4 flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-amber-500" /> Mogelijke oorzaken
                </h2>
                <ul className="space-y-2.5">
                  {causes.map((c, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="shrink-0 h-6 w-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">{i + 1}</span>
                      <span className="min-w-0 [overflow-wrap:anywhere]">{c}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            {!errorCode.diyFriendly && (
              <Card className="border-amber-500/40">
                <CardContent className="p-6">
                  <h2 className="font-heading text-xl font-semibold mb-3 flex items-center gap-2">
                    <UserRound className="h-5 w-5 text-amber-600" /> Hiervoor is meestal een monteur nodig
                  </h2>
                  <p className="text-sm text-muted-foreground mb-3">
                    Deze storing zit vaak in elektronica, de motor of een onderdeel waar je aan de netspanning komt. Repareer je zelf, zet dan eerst de stekker eruit en sluit het water af.
                  </p>
                  <p className="text-sm font-medium mb-1">Wat je tegen de monteur kunt zeggen</p>
                  <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
                    <li>Merk, model en typenummer (sticker bij de deuropening) van je wasmachine.</li>
                    <li>De foutcode: <strong className="text-foreground">{errorCode.machine.brand} {errorCode.code}</strong>.</li>
                    <li>Wat je al geprobeerd hebt, bijvoorbeeld filter en afvoer gecontroleerd of de machine even uitgezet.</li>
                  </ul>
                  <Button asChild variant="outline" className="mt-4 min-h-11 h-auto py-2 whitespace-normal text-left">
                    <Link href={diagnoseHref}>Maak eerst een diagnose om te laten zien</Link>
                  </Button>
                </CardContent>
              </Card>
            )}

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

            {shownParts.length > 0 ? (
              <Card id="onderdelen" className="scroll-mt-20">
                <CardContent className="p-6">
                  <h2 className="font-heading text-xl font-semibold mb-1 flex items-center gap-2">
                    <Wrench className="h-5 w-5" /> {linkedParts.length > 0 ? "Aanbevolen onderdelen" : "Onderdelen die mogelijk nodig zijn"}
                  </h2>
                  {linkedParts.length === 0 && (
                    <p className="text-sm text-muted-foreground mb-4">
                      Op basis van de mogelijke oorzaken hierboven. We weten niet zeker welk onderdeel bij jouw machine stuk is: doe eerst de diagnose of laat een monteur kijken voor je iets bestelt.
                    </p>
                  )}
                  <div className="grid sm:grid-cols-2 gap-4 mt-3">
                    {shownParts.map((p) => (
                      <PartCard key={p.id} part={p} note={linkedParts.length === 0 ? "Mogelijk nodig" : undefined} />
                    ))}
                  </div>
                  <Link href={`/onderdelen?q=${encodeURIComponent(errorCode.machine.brand)}`} className="inline-flex items-center min-h-11 mt-3 text-sm text-primary hover:underline">
                    Alle onderdelen voor {errorCode.machine.brand} →
                  </Link>
                </CardContent>
              </Card>
            ) : (
              <Card id="onderdelen">
                <CardContent className="p-6">
                  <h2 className="font-heading text-xl font-semibold mb-2 flex items-center gap-2"><Wrench className="h-5 w-5" /> Onderdelen</h2>
                  <p className="text-sm text-muted-foreground">
                    Voor deze code hebben we geen vast onderdeel. Bekijk wat we voor {errorCode.machine.brand} hebben.
                  </p>
                  <Link href={`/onderdelen?q=${encodeURIComponent(errorCode.machine.brand)}`} className="inline-flex items-center min-h-11 mt-1 text-sm text-primary hover:underline">
                    Onderdelen voor {errorCode.machine.brand} →
                  </Link>
                </CardContent>
              </Card>
            )}
          </div>

          <aside className="space-y-4 min-w-0">
            <Card className="bg-primary text-primary-foreground hidden lg:block">
              <CardContent className="p-5 space-y-3">
                <h3 className="font-heading font-bold flex items-center gap-2">
                  <Sparkles className="h-4 w-4" /> AI Diagnose
                </h3>
                <p className="text-sm opacity-90">
                  Twijfel of dit jouw probleem is? Beschrijf je situatie en onze AI geeft een eerste indicatie. Een indicatie, geen zekerheid.
                </p>
                <Button asChild variant="accent" className="w-full">
                  <Link href={diagnoseHref}>
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

            <Card>
              <CardContent className="p-5 text-sm">
                <h3 className="font-heading font-semibold mb-2">Meer over {errorCode.machine.brand}</h3>
                <ul className="space-y-0.5">
                  <li><Link href={`/${errorCode.machine.brand.toLowerCase()}-wasmachine-reparatie`} className="inline-flex items-center min-h-11 text-primary hover:underline">{errorCode.machine.brand} reparatie en diagnose</Link></li>
                  <li><Link href={`/merken/${encodeURIComponent(errorCode.machine.brand)}`} className="inline-flex items-center min-h-11 text-primary hover:underline">Alle {errorCode.machine.brand} modellen</Link></li>
                  <li><Link href={`/foutcodes?brand=${encodeURIComponent(errorCode.machine.brand)}`} className="inline-flex items-center min-h-11 text-primary hover:underline">Alle {errorCode.machine.brand} foutcodes</Link></li>
                </ul>
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
