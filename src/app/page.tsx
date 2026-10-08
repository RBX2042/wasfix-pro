import WasFixHome from "@/components/redesign/WasFixHome";
import { dbParts, dbErrorCodes, dbStats } from "@/lib/static-db";
import { formatEur } from "@/lib/utils";
import { SHIPPING } from "@/lib/plans";
import { catalogStats, formatCount } from "@/lib/catalog-stats";

// Cached instead of force-dynamic: nothing on this page is per visitor (the cart
// and the account menu are client-side), so every ad click used to cost a function
// run and several queries for the same HTML. The catalogue reads underneath are
// tagged CATALOG_TAG; POST /api/parts/revalidate refreshes this page on demand and
// otherwise it is at most 60 seconds old.
export const revalidate = 60;

export const metadata = {
  // absolute: the root template would append " · WasFix Pro" to a title that
  // already starts with the name.
  title: { absolute: "WasFix Pro — AI wasmachine diagnose en onderdelen" },
  alternates: { canonical: "/" },
  // Geen "gemiddeld €140 bespaard": dat bedrag is nooit gemeten. Een
  // besparingsclaim moet onderbouwd kunnen worden (art. 6:193c BW), en wat een
  // reparatie in een concreet geval scheelt rekent de calculator uit.
  description:
    "Foto of foutcode → een eerste AI-diagnose, het waarschijnlijke onderdeel en stap-voor-stap reparatie. Een indicatie, geen zekerheid. Geen voorrijkosten.",
  openGraph: {
    title: "WasFix Pro — AI wasmachine diagnose",
    description: "Eerste AI-diagnose van je wasmachine, het waarschijnlijke onderdeel en stap-voor-stap reparatie.",
    url: "https://wasfix.nl",
    siteName: "WasFix Pro",
    locale: "nl_NL",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "WasFix Pro — AI wasmachine diagnose",
    description: "Eerste AI-diagnose van je wasmachine, het waarschijnlijke onderdeel en stap-voor-stap reparatie.",
  },
};

export default async function HomePage() {
  // Headline numbers from the live catalogue (database when there is one).
  const live = await dbStats();
  const base = catalogStats();
  const STATS = { ...base, errorCodes: live.errorCodesCount, guides: live.guidesCount, parts: live.partsCount, machines: live.machinesCount };

  // Featured parts for the catalogue strip: in-stock first, but sold-out parts are
  // allowed in so the strip is never empty on a catalogue whose stock is still 0.
  const partItems = (await dbParts({ orderBy: "stock-desc", take: 8 })).map((p) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    brand: p.brand,
    priceEur: p.priceEur,
    stock: p.stock,
    isOriginal: p.isOriginal,
  }));

  // Top error codes for the explorer — first 12 by severity
  const codeItems = (await dbErrorCodes({ take: 12 })).map((ec) => ({
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
    },
    // FAQ schema for homepage — answers Google searches directly
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [
        { "@type": "Question", name: "Werkt WasFix Pro voor mijn wasmachine?",
          acceptedAnswer: { "@type": "Answer", text: `Ja, we ondersteunen alle grote merken: Miele, Bosch, Siemens, Samsung, LG, AEG, Electrolux, Whirlpool, Beko en Indesit. De database bevat ${formatCount(STATS.errorCodes)} foutcodes en ${formatCount(STATS.guides)} reparatiegidsen.` } },
        { "@type": "Question", name: "Hoeveel kost een diagnose?",
          acceptedAnswer: { "@type": "Answer", text: "De eerste 3 diagnoses per maand zijn gratis. Voor onbeperkte diagnoses + voordelen: Particulier €4,99/mnd of Monteur Pro €29/mnd." } },
        { "@type": "Question", name: "Is mijn wasmachine nog te repareren of moet ik een nieuwe kopen?",
          acceptedAnswer: { "@type": "Answer", text: "Gebruik onze gratis Repareren-of-Vervangen tool. We berekenen op basis van leeftijd, kosten en levensduur of repareren nog rendabel is. EU Right-to-Repair: onderdelen blijven 10 jaar beschikbaar." } },
        { "@type": "Question", name: "Hoe snel komt mijn onderdeel?",
          acceptedAnswer: { "@type": "Answer", text: `We verzenden op werkdagen en je krijgt een track & trace-code zodra je bestelling is verzonden. Verzending kost ${formatEur(SHIPPING.rateEur)} en is gratis vanaf ${formatEur(SHIPPING.freeFromEur)} (verzending binnen Nederland).` } },
        { "@type": "Question", name: "Geld terug als de diagnose niet klopt?",
          acceptedAnswer: { "@type": "Answer", text: "30 dagen retourrecht — ook als achteraf blijkt dat het toch een ander onderdeel was. Gratis retour bij defect of fout van onze kant." } },
      ],
    },
    // NOTE: no AggregateRating/Review markup here. Ratings may only be published
    // once they are backed by verifiable customer reviews (schema.org policy +
    // EU Omnibus Directive art. 7 on consumer reviews). Real per-product ratings
    // are emitted on /onderdelen/[sku] and /gidsen/[slug] from the Review table.
  ];

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <WasFixHome
        parts={partItems}
        codes={codeItems}
        stats={{ errorCodes: STATS.errorCodes, parts: STATS.parts, guides: STATS.guides, brands: STATS.brands }}
      />
    </>
  );
}
