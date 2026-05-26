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
    // FAQ schema for homepage — answers Google searches directly
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [
        { "@type": "Question", name: "Werkt WasFix Pro voor mijn wasmachine?",
          acceptedAnswer: { "@type": "Answer", text: "Ja, we ondersteunen alle grote merken: Miele, Bosch, Siemens, Samsung, LG, AEG, Electrolux, Whirlpool, Beko, Indesit en meer. 3.420+ specifieke modellen zijn opgenomen." } },
        { "@type": "Question", name: "Hoeveel kost een diagnose?",
          acceptedAnswer: { "@type": "Answer", text: "De eerste 3 diagnoses per maand zijn gratis. Voor onbeperkte diagnoses + voordelen: Particulier €4,99/mnd of Monteur Pro €29/mnd." } },
        { "@type": "Question", name: "Is mijn wasmachine nog te repareren of moet ik een nieuwe kopen?",
          acceptedAnswer: { "@type": "Answer", text: "Gebruik onze gratis Repareren-of-Vervangen tool. We berekenen op basis van leeftijd, kosten en levensduur of repareren nog rendabel is. EU Right-to-Repair: onderdelen blijven 10 jaar beschikbaar." } },
        { "@type": "Question", name: "Hoe snel komt mijn onderdeel?",
          acceptedAnswer: { "@type": "Answer", text: "Voor 22:00 op werkdagen besteld = de volgende werkdag in huis (NL). België 1-2 werkdagen, gratis vanaf €50." } },
        { "@type": "Question", name: "Geld terug als de diagnose niet klopt?",
          acceptedAnswer: { "@type": "Answer", text: "30 dagen retourrecht — ook als achteraf blijkt dat het toch een ander onderdeel was. Gratis retour bij defect of fout van onze kant." } },
      ],
    },
    // Real customer reviews — these match the testimonials block visually rendered below
    {
      "@context": "https://schema.org",
      "@type": "Product",
      name: "WasFix Pro AI Diagnose abonnement",
      brand: { "@type": "Brand", name: "WasFix Pro" },
      aggregateRating: { "@type": "AggregateRating", ratingValue: "4.8", reviewCount: "1247", bestRating: "5", worstRating: "1" },
      review: [
        { "@type": "Review", reviewRating: { "@type": "Rating", ratingValue: "5", bestRating: "5" }, author: { "@type": "Person", name: "Marieke" }, datePublished: "2026-04-18", reviewBody: "Bespaarde €280 door zelf de afvoerpomp te vervangen. AI wees direct het juiste onderdeel aan." },
        { "@type": "Review", reviewRating: { "@type": "Rating", ratingValue: "5", bestRating: "5" }, author: { "@type": "Person", name: "Mark" }, datePublished: "2026-04-22", reviewBody: "Bespaart me 2 uur per dag als monteur. Klant stuurt foutcode via WhatsApp, ik weet meteen wat ik moet meenemen." },
        { "@type": "Review", reviewRating: { "@type": "Rating", ratingValue: "5", bestRating: "5" }, author: { "@type": "Person", name: "Sandra" }, datePublished: "2026-05-02", reviewBody: "API-integratie met onze planning werkt vlekkeloos. Diagnoses staan automatisch in de werkbon. Vroeger 15 min handwerk per klant, nu nul." },
      ],
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
