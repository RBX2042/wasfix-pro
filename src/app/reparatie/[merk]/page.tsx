import { WasFixShell, Icon } from "@/components/redesign/SharedLayout";
import { notFound } from "next/navigation";
import Link from "next/link";
import brandsData from "@/data/brands.json";
import { staticErrorCodes, staticParts } from "@/lib/static-db";

/**
 * Does the catalogue hold anything for this brand? Five brands in brands.json
 * (Zanussi, Hotpoint, Candy, Haier, Panasonic) have editorial copy but no
 * machines, codes or parts, so their pages are thin by definition and are not
 * indexed.
 */
function hasCatalogCoverage(brand: string): boolean {
  return staticErrorCodes({}).some((ec) => ec.machine.brand === brand);
}

type BrandPage = {
  slug: string;
  brand: string;
  tagline: string;
  blurb: string;
  topCodes: string[];
  common: string[];
  modelExamples: string[];
};

const brands = brandsData as BrandPage[];

export function generateStaticParams() {
  return brands.map((b) => ({ merk: b.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ merk: string }> }) {
  const { merk } = await params;
  const brand = brands.find((b) => b.slug === merk);
  if (!brand) return { title: "Merk niet gevonden" };
  const covered = hasCatalogCoverage(brand.brand);
  return {
    title: `${brand.brand} wasmachine reparatie — diagnose + onderdelen · WasFix Pro`,
    // A brand we carry no codes or parts for is a thin page by definition.
    // Keep it reachable for someone who lands on it, keep it out of the index.
    robots: covered ? undefined : { index: false, follow: true },
    description: `${brand.brand} wasmachine kapot of foutcode? Gratis diagnose, reparatiegidsen en originele onderdelen. ${brand.tagline}.`,
    alternates: { canonical: `/${brand.slug}-wasmachine-reparatie` },
    openGraph: {
      title: `${brand.brand} wasmachine reparatie`,
      description: brand.tagline,
      type: "website",
    },
  };
}

export default async function BrandRepairPage({ params }: { params: Promise<{ merk: string }> }) {
  const { merk } = await params;
  const brand = brands.find((b) => b.slug === merk);
  if (!brand) notFound();

  // Get top error codes for this brand from our database
  const allCodes = staticErrorCodes({});
  const brandCodes = allCodes.filter((ec) => ec.machine.brand === brand.brand).slice(0, 12);

  // Get top parts for this brand
  const allParts = staticParts({ where: { minStock: 1 }, take: 200 });
  const brandParts = allParts.filter((p) => p.brand === brand.brand || (brand.brand === "Bosch" && p.brand === "Siemens")).slice(0, 6);

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Service",
      serviceType: `${brand.brand} wasmachine reparatie`,
      provider: { "@type": "Organization", name: "WasFix Pro", url: "https://wasfix.nl" },
      areaServed: { "@type": "Country", name: "Nederland" },
      offers: { "@type": "Offer", price: "0", priceCurrency: "EUR", description: "Gratis AI-diagnose" },
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [
        { "@type": "Question", name: `Hoe lang gaat een ${brand.brand} wasmachine mee?`,
          acceptedAnswer: { "@type": "Answer", text: `Een ${brand.brand} wasmachine gaat gemiddeld 10-15 jaar mee bij normaal gebruik. Met goed onderhoud (maandelijks ontkalken, filter schoonmaken) kan dit naar 18+ jaar.` } },
        { "@type": "Question", name: `Kan ik mijn ${brand.brand} zelf repareren?`,
          acceptedAnswer: { "@type": "Answer", text: `De meeste ${brand.brand} reparaties zijn DIY-vriendelijk. ${brand.common.join(", ")} zijn de meest gangbare defecten, allemaal met onze stap-voor-stap gidsen te repareren in 30-90 minuten.` } },
        ...(brandCodes.length > 0
          ? [{ "@type": "Question", name: `Wat zijn veelvoorkomende ${brand.brand} foutcodes?`,
              acceptedAnswer: { "@type": "Answer", text: `In onze database staan onder meer ${brandCodes.slice(0, 6).map((ec) => ec.code).join(", ")}. Bekijk per foutcode de oorzaak, de oplossing en de benodigde onderdelen.` } }]
          : []),
      ],
    },
  ];

  return (
    <WasFixShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <section className="section" style={{ paddingTop: 56 }}>
        <div className="container" style={{ maxWidth: 920 }}>
          <div className="eyebrow">{brand.brand} reparatie</div>
          <h1 className="h-display" style={{ fontSize: "clamp(32px, 4.5vw, 52px)", marginBottom: 14 }}>
            <em>{brand.brand}</em> wasmachine reparatie
          </h1>
          <p className="lead" style={{ marginBottom: 16 }}>{brand.tagline}.</p>
          <p style={{ color: "var(--text-2)", lineHeight: 1.7, marginBottom: 32, maxWidth: 720 }}>
            {brand.blurb}
          </p>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 48 }}>
            <Link className="btn btn-primary" href={`/diagnose?prefill=${encodeURIComponent(`Mijn ${brand.brand} wasmachine...`)}`}>
              Start {brand.brand} diagnose <Icon name="arrow" size={14} />
            </Link>
            <Link className="btn" href={`/merken/${encodeURIComponent(brand.brand)}`}>
              Bekijk {brand.brand} modellen
            </Link>
          </div>

          {/* Top foutcodes — only when we actually hold codes for this brand. */}
          {brandCodes.length === 0 ? (
            <section style={{ marginBottom: 48 }}>
              <h2 className="h-section" style={{ fontSize: 28, marginBottom: 16 }}>
                {brand.brand} in onze database
              </h2>
              <p className="lead" style={{ fontSize: 15 }}>
                We hebben nog geen {brand.brand}-foutcodes of -onderdelen in de catalogus. De diagnose
                werkt wel voor {brand.brand}: beschrijf je klacht en de code op het display, dan komen we
                zo ver als we kunnen — en zeggen we het eerlijk als we je niet verder helpen.
              </p>
              <div style={{ marginTop: 16 }}>
                <Link href="/diagnose" className="btn btn-sm">Start een diagnose <Icon name="arrow" size={13} /></Link>
              </div>
            </section>
          ) : (
          <section style={{ marginBottom: 48 }}>
            <h2 className="h-section" style={{ fontSize: 28, marginBottom: 16 }}>
              {brand.brand} <em>foutcodes</em>
            </h2>
            <p className="lead" style={{ fontSize: 15, marginBottom: 20 }}>
              Klik voor de directe oplossing per code.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
              {brandCodes.slice(0, 9).map((ec) => (
                <Link
                  key={ec.id}
                  href={`/foutcodes/${encodeURIComponent(brand.brand)}-${encodeURIComponent(ec.code)}`}
                  className="step-card"
                  style={{ textDecoration: "none", color: "inherit", display: "block" }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                    <span className="mono pill" style={{ fontSize: 11, padding: "3px 8px" }}>{ec.code}</span>
                    {ec.diyFriendly && <span style={{ color: "var(--ok)", fontSize: 10 }}>● DIY</span>}
                  </div>
                  <div style={{ fontWeight: 500, fontSize: 13.5, marginBottom: 4 }}>{ec.title}</div>
                  <div className="muted" style={{ fontSize: 12, lineHeight: 1.5, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                    {ec.description}
                  </div>
                </Link>
              ))}
            </div>
            {brandCodes.length > 9 && (
              <div style={{ marginTop: 16 }}>
                <Link href={`/foutcodes?merk=${encodeURIComponent(brand.brand)}`} className="btn btn-sm">
                  Alle {brandCodes.length} {brand.brand} codes <Icon name="arrow" size={13} />
                </Link>
              </div>
            )}
          </section>
          )}

          {/* Top parts */}
          {brandParts.length > 0 && (
            <section style={{ marginBottom: 48 }}>
              <h2 className="h-section" style={{ fontSize: 28, marginBottom: 16 }}>
                Populaire {brand.brand} <em>onderdelen</em>
              </h2>
              <p className="lead" style={{ fontSize: 15, marginBottom: 20 }}>
                We verzenden op werkdagen, met track &amp; trace zodra je pakket is aangemeld. 30 dagen retour.
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
                {brandParts.map((p) => (
                  <Link
                    key={p.id}
                    href={`/onderdelen/${p.sku}`}
                    className="step-card"
                    style={{ textDecoration: "none", color: "inherit", display: "block" }}
                  >
                    <div style={{ fontSize: 11, color: "var(--muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>
                      {p.isOriginal ? "Origineel" : "Universeel"} · {p.brand}
                    </div>
                    <div style={{ fontWeight: 500, fontSize: 14, marginBottom: 6, lineHeight: 1.3 }}>{p.name}</div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 8 }}>
                      <span style={{ fontSize: 18, fontWeight: 500, color: "var(--acc-2)" }}>
                        € {p.priceEur.toFixed(2).replace(".", ",")}
                      </span>
                      <span className="muted mono" style={{ fontSize: 11 }}>{p.sku}</span>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* Common repairs */}
          <section style={{ marginBottom: 48 }}>
            <h2 className="h-section" style={{ fontSize: 28, marginBottom: 16 }}>
              Meest voorkomende <em>reparaties</em>
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
              {brand.common.map((c) => (
                <div key={c} className="step-card">
                  <div style={{ fontWeight: 500, fontSize: 13, textTransform: "capitalize" }}>{c}</div>
                </div>
              ))}
            </div>
          </section>

          {/* Model examples */}
          <section style={{ marginBottom: 48 }}>
            <h2 className="h-section" style={{ fontSize: 28, marginBottom: 16 }}>
              {brand.brand} <em>modellen</em>
            </h2>
            <p className="lead" style={{ fontSize: 14, marginBottom: 16 }}>
              We ondersteunen alle {brand.brand} modellen. Voorbeelden:
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {brand.modelExamples.map((m) => (
                <span key={m} className="pill mono" style={{ fontSize: 12, padding: "5px 10px" }}>{m}</span>
              ))}
            </div>
          </section>

          {/* CTA */}
          <div style={{ padding: 32, background: "linear-gradient(135deg, rgba(79,140,255,0.08), rgba(0,212,255,0.04))", border: "1px solid var(--border-ac)", borderRadius: 16, textAlign: "center" }}>
            <h2 style={{ fontSize: 24, fontWeight: 500, marginBottom: 10, letterSpacing: "-0.015em" }}>
              {brand.brand} kapot? Begin met gratis diagnose
            </h2>
            <p className="muted" style={{ marginBottom: 20, maxWidth: 520, margin: "0 auto 20px" }}>
              60 seconden — krijg de top 3 oorzaken + welk onderdeel je nodig hebt. Geen account vereist.
            </p>
            <Link className="btn btn-primary" href="/diagnose">
              Start gratis {brand.brand} diagnose <Icon name="arrow" size={14} />
            </Link>
          </div>
        </div>
      </section>
    </WasFixShell>
  );
}
