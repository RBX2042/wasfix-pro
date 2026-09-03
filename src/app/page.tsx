import WasFixHome from "@/components/redesign/WasFixHome";
import { staticParts, staticErrorCodes } from "@/lib/static-db";
import { formatEur } from "@/lib/utils";
import { SHIPPING } from "@/lib/plans";
import { catalogStats, formatCount } from "@/lib/catalog-stats";

const STATS = catalogStats();

export const dynamic = "force-dynamic";

export const metadata = {
  title: "WasFix Pro — AI wasmachine diagnose in 60 seconden",
  // Geen "gemiddeld €140 bespaard": dat bedrag is nooit gemeten. Een
  // besparingsclaim moet onderbouwd kunnen worden (art. 6:193c BW), en wat een
  // reparatie in een concreet geval scheelt rekent de calculator uit.
  description:
    "Foto of foutcode → diagnose, juist onderdeel, stap-voor-stap reparatie. Geen voorrijkosten, geen wachtweken.",
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
          acceptedAnswer: { "@type": "Answer", text: `We verzenden op werkdagen en je krijgt een track & trace zodra het pakket is aangemeld. Verzending kost ${formatEur(SHIPPING.rateEur)} en is gratis vanaf ${formatEur(SHIPPING.freeFromEur)} in NL en BE.` } },
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
      <WasFixHome parts={partItems} codes={codeItems} />
    </>
  );
}
