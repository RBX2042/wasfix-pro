import WasFixHome from "@/components/redesign/WasFixHome";
import { staticParts, staticErrorCodes } from "@/lib/static-db";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "WasFix Pro — AI wasmachine diagnose in 60 seconden",
  description:
    "Foto of foutcode → diagnose, juist onderdeel, stap-voor-stap reparatie. Geen voorrijkosten. Gemiddeld €140 bespaard per reparatie.",
  openGraph: {
    title: "WasFix Pro — AI wasmachine diagnose",
    description: "AI-diagnose in 60 seconden. Het juiste onderdeel. Stap-voor-stap reparatie.",
    url: "https://wasfix.nl",
    siteName: "WasFix Pro",
    locale: "nl_NL",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "WasFix Pro — AI wasmachine diagnose",
    description: "AI-diagnose in 60 seconden. Het juiste onderdeel. Stap-voor-stap reparatie.",
  },
};

export default function HomePage() {
  // Featured parts for the catalogue strip (8 with stock, ordered by stock)
  const partItems = staticParts({ where: { minStock: 0 }, orderBy: "stock-desc", take: 8 }).map((p) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    brand: p.brand,
    priceEur: p.priceEur,
    stock: p.stock,
    isOriginal: p.isOriginal,
  }));

  // Top error codes for the explorer — first 12 by severity
  const codeItems = staticErrorCodes({ take: 12 }).map((ec) => ({
    id: ec.code,
    brand: ec.machine.brand,
    desc: ec.title,
    // First likely cause = the "part" hint
    part: (ec.likelyCauses ?? "").split("|")[0] || "Onderdeel onbekend",
    url: `/foutcodes/${encodeURIComponent(ec.machine.brand)}-${encodeURIComponent(ec.code)}`,
  }));

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "WasFix Pro",
      url: "https://wasfix.nl",
      logo: "https://wasfix.nl/icon",
      description: "AI-gestuurde wasmachine diagnose en originele onderdelen, voor consumenten en monteurs.",
      sameAs: ["https://github.com/RBX2042/wasfix-pro"],
      address: { "@type": "PostalAddress", addressCountry: "NL" },
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "WasFix Pro",
      url: "https://wasfix.nl",
      potentialAction: {
        "@type": "SearchAction",
        target: "https://wasfix.nl/foutcodes?q={search_term_string}",
        "query-input": "required name=search_term_string",
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "WasFix Pro",
      applicationCategory: "UtilitiesApplication",
      operatingSystem: "Web",
      offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
      aggregateRating: { "@type": "AggregateRating", ratingValue: "4.8", reviewCount: "1247" },
    },
  ];

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <WasFixHome parts={partItems} codes={codeItems} />
    </>
  );
}
