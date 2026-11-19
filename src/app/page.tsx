import WasFixHome from "@/components/redesign/WasFixHome";
import { dbParts, dbErrorCodes, dbStats } from "@/lib/static-db";
import { PLANS } from "@/lib/plans";
import { catalogStats } from "@/lib/catalog-stats";
import { publicCompany } from "@/lib/company";
import { pageMetadata, pageTitle } from "@/lib/seo";
import { ldJson, organizationLd, websiteLd } from "@/lib/json-ld";

// Cached instead of force-dynamic: nothing on this page is per visitor (the cart
// and the account menu are client-side), so every ad click used to cost a function
// run and several queries for the same HTML. The catalogue reads underneath are
// tagged CATALOG_TAG; POST /api/parts/revalidate refreshes this page on demand and
// otherwise it is at most 60 seconds old.
export const revalidate = 60;

export const metadata = pageMetadata({
  // pageTitle returns this as an absolute title: the root template would append " · WasFix Pro" to a title that
  // already starts with the name.
  title: pageTitle("WasFix Pro — AI wasmachine diagnose en onderdelen"),
  path: "/",
  // Geen "gemiddeld €140 bespaard": dat bedrag is nooit gemeten. Een
  // besparingsclaim moet onderbouwd kunnen worden (art. 6:193c BW), en wat een
  // reparatie in een concreet geval scheelt rekent de calculator uit.
  description:
    "Foto of foutcode → een eerste AI-diagnose, het waarschijnlijke onderdeel en stap-voor-stap reparatie. Een indicatie, geen zekerheid. Geen voorrijkosten.",
});

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

  // Organization and WebSite are built from what is configured (src/lib/json-ld.ts): the postal address, KvK, VAT
  // number and e-mail appear only when publicCompany() has them, never as a bare country or a stand-in.
  // No FAQPage (decision D23): the five questions were not on the page, and two answers promised more than the
  // terms do ("gratis retour" in every case, "onderdelen blijven 10 jaar beschikbaar" as if it were our promise).
  const jsonLd = [
    organizationLd(publicCompany(), {
      name: "WasFix Pro",
      description: "AI-gestuurde wasmachine diagnose en onderdelen, voor consumenten en monteurs.",
    }),
    // /foutcodes?q= is a working results page (scripts/qa-seo.ts opens it), so the SearchAction is true.
    websiteLd({ name: "WasFix Pro", searchPath: "/foutcodes?q={search_term_string}" }),
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "WasFix Pro",
      applicationCategory: "UtilitiesApplication",
      operatingSystem: "Web",
      // The free plan, nothing more: the paid plans and their prices are on /prijzen.
      offers: { "@type": "Offer", price: "0", priceCurrency: "EUR", description: `Gratis abonnement: ${PLANS.FREE.diagnosesPerMonth} AI-diagnoses per maand` },
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
        dangerouslySetInnerHTML={{ __html: ldJson(jsonLd) }}
      />
      <WasFixHome
        parts={partItems}
        codes={codeItems}
        stats={{ errorCodes: STATS.errorCodes, parts: STATS.parts, guides: STATS.guides, brands: STATS.brands }}
      />
    </>
  );
}
