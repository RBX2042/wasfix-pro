import { MarketingLayout } from "@/components/marketing-layout";
import { dbPartFull, dbRelatedParts } from "@/lib/static-db";
import { notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatEur } from "@/lib/utils";
import { SHIPPING, COMPANY, VAT_RATE, companyIdentityLine } from "@/lib/plans";
import { env } from "@/lib/env";
import { paymentMethodsLine } from "@/lib/storefront-facts";
import { availabilityOf, categoryLabel } from "@/lib/part-categories";
import { warrantyFor, formatWarranty } from "@/lib/warranty";
import { clipAtWord } from "@/lib/seo-text";
import { CheckCircle2, Truck, ShieldCheck, RotateCcw, Package, CreditCard, Building2 } from "lucide-react";
import { AddToCartButton } from "./add-to-cart-button";
import Link from "next/link";
import { PartCard } from "@/components/part-card";
import { PartPhoto } from "@/components/part-photo";
import { MemberPrice } from "@/components/member-price";
import PartViewer3DWrapper from "@/components/3d/PartViewer3DWrapper";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Reviews } from "@/components/Reviews";
import { getReviews, reviewStats, aggregateRatingLd, reviewsLd } from "@/lib/reviews";

// ISR instead of force-dynamic: nothing here depends on the visitor (the member
// price is fetched client-side), and every search click used to run the page and
// its queries from scratch. The reads underneath are tagged CATALOG_TAG: POST
// /api/parts/revalidate refreshes this page on demand; a price or stock change made
// any other way shows up within the 60 second window (admin and checkout do not
// call revalidateCatalog() yet).
export const revalidate = 60;

// Nothing is pre-rendered at build time (the catalogue lives in the database, and a
// build must not need one), but declaring the params lets Next render each page on
// its first request and then serve it from the cache until revalidate/revalidateCatalog().
// Without this a dynamic-segment page is rendered on every request even when it uses
// nothing per visitor.
export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: { params: Promise<{ sku: string }> }) {
  const { sku } = await params;
  const part = await dbPartFull(sku);
  if (!part) return { title: "Onderdeel niet gevonden", robots: { index: false } };
  const title = `${part.name} (${part.sku})`;
  const description = clipAtWord(
    `${part.name}${part.brand === "Universeel" ? "" : ` van ${part.brand}`}${part.isOriginal ? ", origineel onderdeel" : ", universele vervanger"}. ${formatEur(part.priceEur)} incl. btw. Verzending binnen Nederland, 30 dagen bedenktijd.`,
    155,
  );
  return {
    title,
    description,
    alternates: { canonical: `/onderdelen/${part.sku}` },
    openGraph: {
      title,
      description,
      type: "website",
      // A real photo, or the site-wide card. The placehold.co tiles are filtered out
      // upstream (realImageUrl), so they are never advertised as the product picture.
      images: part.imageUrl ? [part.imageUrl] : [{ url: "/opengraph-image", width: 1200, height: 630 }],
    },
  };
}

export default async function PartDetailPage({ params }: { params: Promise<{ sku: string }> }) {
  const { sku } = await params;
  const part = await dbPartFull(sku);

  if (!part) notFound();

  const SITE = env.APP_URL;
  const compatibleBrands = Array.from(new Set(part.machines.map((m) => m.machine.brand)));
  const relatedParts = await dbRelatedParts(part.category, part.id, 4);

  // Ratings come from real reviews only; omitted entirely when there are none.
  const reviews = await getReviews({ sku: part.sku });
  const stats = reviewStats(reviews);

  const availability = availabilityOf(part.stock);
  const warranty = warrantyFor(part);
  const vatPercent = Math.round(VAT_RATE * 100);

  // Only the payment methods that are really switched on (see storefront-facts).
  const paymentLine = paymentMethodsLine();
  // Seller identity only when it is real; a stand-in KvK number is never printed.
  const sellerLine = COMPANY.isPlaceholder ? null : companyIdentityLine();

  // schema.org Product + Offer. Only claims the terms back: shipping rate and
  // destination from SHIPPING, a 30-day return window with the customer paying the
  // return (as /retourvoorwaarden says), no delivery-time promise (the terms call
  // delivery time an indication), and an image only when it is a real photo.
  const productLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: part.name,
    image: part.imageUrl ? [part.imageUrl] : undefined,
    description: part.description ?? `${part.name} — ${part.brand} wasmachine-onderdeel`,
    sku: part.sku,
    brand: { "@type": "Brand", name: part.brand },
    category: categoryLabel(part.category),
    offers: {
      "@type": "Offer",
      url: `${SITE}/onderdelen/${part.sku}`,
      priceCurrency: "EUR",
      price: part.priceEur.toFixed(2),
      availability: availability === "out" ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
      itemCondition: "https://schema.org/NewCondition",
      seller: { "@type": "Organization", name: "WasFix Pro" },
      shippingDetails: {
        "@type": "OfferShippingDetails",
        shippingRate: { "@type": "MonetaryAmount", value: SHIPPING.rateEur.toFixed(2), currency: "EUR" },
        shippingDestination: { "@type": "DefinedRegion", addressCountry: "NL" },
      },
      hasMerchantReturnPolicy: {
        "@type": "MerchantReturnPolicy",
        applicableCountry: "NL",
        returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
        merchantReturnDays: 30,
        returnMethod: "https://schema.org/ReturnByMail",
        returnFees: "https://schema.org/ReturnFeesCustomerResponsibility",
        merchantReturnLink: `${SITE}/retourvoorwaarden`,
      },
    },
    aggregateRating: aggregateRatingLd(stats),
    review: reviewsLd(reviews),
  };

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Onderdelen", item: `${SITE}/onderdelen` },
      { "@type": "ListItem", position: 2, name: part.brand, item: `${SITE}/onderdelen?brand=${encodeURIComponent(part.brand)}` },
      { "@type": "ListItem", position: 3, name: part.name },
    ],
  };

  return (
    <MarketingLayout>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(productLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />
      <div className="container py-4 md:py-8">
        <nav className="text-sm text-muted-foreground mb-3 md:mb-6">
          <Link href="/onderdelen" className="hover:text-foreground inline-flex items-center min-h-11">Onderdelen</Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">{part.sku}</span>
        </nav>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-10">
          {/* Buy box first on a phone (price, stock, shipping and the button above the
              fold), picture first on a desktop. */}
          <div className="order-1 lg:order-2 space-y-4 min-w-0">
            <div>
              <Badge variant="outline" className="mb-2">{part.brand}</Badge>
              {part.isOriginal && (
                <Badge variant="accent" className="ml-2">Origineel onderdeel</Badge>
              )}
              <h1 className="font-heading text-2xl md:text-3xl font-bold mt-2 break-words">{part.name}</h1>
              <p className="text-sm text-muted-foreground mt-1">SKU: {part.sku}</p>
            </div>

            <div>
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-3xl font-heading font-bold text-primary">{formatEur(part.priceEur)}</span>
                <span className="text-sm text-muted-foreground">incl. {vatPercent}% btw</span>
              </div>
              <MemberPrice priceEur={part.priceEur} className="mt-1" />
            </div>

            {availability === "out" ? (
              <div className="text-destructive font-medium text-sm">Tijdelijk uitverkocht</div>
            ) : availability === "low" ? (
              <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 font-medium text-sm">
                <CheckCircle2 className="h-4 w-4" /> Beperkt voorradig (nog {part.stock} beschikbaar)
              </div>
            ) : (
              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-medium text-sm">
                <CheckCircle2 className="h-4 w-4" /> Op voorraad
              </div>
            )}

            <p className="text-sm text-muted-foreground flex items-start gap-2">
              <Truck className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                Verzending binnen Nederland {formatEur(SHIPPING.rateEur)}, gratis vanaf {formatEur(SHIPPING.freeFromEur)}.
              </span>
            </p>

            <AddToCartButton
              part={{
                id: part.id, sku: part.sku, name: part.name, brand: part.brand, category: part.category,
                priceEur: part.priceEur, imageUrl: part.imageUrl, stock: part.stock,
              }}
            />
            {paymentLine && (
              <p className="text-xs text-muted-foreground flex items-start gap-2">
                <CreditCard className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                <span>Betaal met {paymentLine}.</span>
              </p>
            )}
          </div>

          <div className="order-2 lg:order-1 min-w-0">
            {/* Photo is the default. The 3D tab loads three.js only when it is opened
                (next/dynamic, ssr: false, and Radix unmounts the inactive tab), so the
                ~870 KB engine is no longer part of every product view. The model is a
                generic shape per category, not this part - the tab says so. */}
            <Tabs defaultValue="photo" className="w-full">
              <TabsList className="mb-3 h-auto">
                <TabsTrigger value="photo" className="min-h-11">Foto</TabsTrigger>
                <TabsTrigger value="3d" className="min-h-11">3D (schematisch)</TabsTrigger>
              </TabsList>
              <TabsContent value="photo" className="mt-0">
                <PartPhoto
                  imageUrl={part.imageUrl}
                  name={part.name}
                  category={part.category}
                  sizes="(max-width: 1024px) 100vw, 50vw"
                  priority
                  className="w-full h-56 md:h-96 rounded-lg border"
                />
              </TabsContent>
              <TabsContent value="3d" className="mt-0">
                <PartViewer3DWrapper category={part.category} />
                <p className="text-xs text-muted-foreground mt-2">
                  Schematische weergave van dit type onderdeel, niet het exacte product.
                </p>
              </TabsContent>
            </Tabs>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-10 mt-6">
          <div className="space-y-5 min-w-0">
            {part.description && <p className="text-muted-foreground leading-relaxed">{part.description}</p>}

            <Card>
              <CardContent className="p-4 space-y-3 text-sm">
                <p className="flex items-start gap-3">
                  <Truck className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                  <span>
                    <strong>Verzending:</strong> {formatEur(SHIPPING.rateEur)}, gratis vanaf {formatEur(SHIPPING.freeFromEur)} (alleen Nederland). We verzenden op werkdagen; je krijgt een track &amp; trace-code zodra je bestelling is verzonden.
                  </span>
                </p>
                <p className="flex items-start gap-3">
                  <ShieldCheck className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                  <span>
                    <strong>Garantie:</strong> {formatWarranty(warranty.months)} op dit onderdeel, naast je wettelijke rechten.{" "}
                    <Link href="/garantie" className="text-primary underline underline-offset-2">Garantievoorwaarden</Link>
                  </span>
                </p>
                <p className="flex items-start gap-3">
                  <RotateCcw className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                  <span>
                    <strong>30 dagen bedenktijd.</strong> De kosten van het terugsturen zijn voor jou, behalve bij een defect of een fout van ons.{" "}
                    <Link href="/retourvoorwaarden" className="text-primary underline underline-offset-2">Retourvoorwaarden</Link>
                  </span>
                </p>
                {sellerLine && (
                  <p className="flex items-start gap-3">
                    <Building2 className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                    <span><strong>Verkoper:</strong> {sellerLine}</span>
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          <div id="compatibel" className="space-y-4 scroll-mt-20 min-w-0">
            {compatibleBrands.length > 0 ? (
              <div>
                <p className="text-sm font-semibold mb-2 flex items-center gap-2"><Package className="h-4 w-4" /> Past dit op mijn machine?</p>
                <div className="flex flex-wrap gap-2">
                  {compatibleBrands.map((b) => (
                    <Badge key={b} variant="secondary">{b}</Badge>
                  ))}
                </div>
                {part.machines.length > 0 && (
                  <details className="mt-3">
                    <summary className="text-sm text-primary cursor-pointer min-h-11 flex items-center">
                      Bekijk de {part.machines.length} modellen waarop dit past
                    </summary>
                    <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                      {part.machines.map((pm) => (
                        <li key={pm.machine.id}>
                          ·{" "}
                          <Link href={`/merken/${encodeURIComponent(pm.machine.brand)}/${encodeURIComponent(pm.machine.model)}`} className="hover:text-foreground hover:underline">
                            {pm.machine.brand} {pm.machine.model}
                          </Link>
                        </li>
                      ))}
                    </ul>
                    <p className="text-xs text-muted-foreground mt-3">
                      Controleer het typenummer op je machine (meestal op een sticker bij de deuropening) voor je bestelt.
                    </p>
                  </details>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Voor dit onderdeel hebben we geen lijst met compatibele modellen. Twijfel je? <Link href="/contact" className="text-primary underline">Neem contact op</Link> voor je bestelt.
              </p>
            )}

            {part.errorCodes.length > 0 && (
              <div>
                <p className="text-sm font-semibold mb-2">Hoort bij deze foutcodes</p>
                <div className="flex flex-wrap gap-x-3">
                  {part.errorCodes.slice(0, 8).map(({ errorCode }) => (
                    <Link
                      key={errorCode.id}
                      href={`/foutcodes/${encodeURIComponent(errorCode.machine.brand)}-${encodeURIComponent(errorCode.code)}`}
                      className="inline-flex items-center min-h-11 text-sm text-primary hover:underline"
                    >
                      {errorCode.machine.brand} {errorCode.code}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {part.guides.length > 0 && (
          <div className="mt-12">
            <h2 className="font-heading text-xl font-bold mb-4">Bijbehorende reparatiegidsen</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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

        <div className="mt-12">
          <Reviews sku={part.sku} />
        </div>

        {relatedParts.length > 0 && (
          <div className="mt-12">
            <h2 className="font-heading text-xl font-bold mb-4">Vergelijkbare onderdelen</h2>
            <div className="grid grid-cols-1 min-[360px]:grid-cols-2 md:grid-cols-4 gap-4">
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

