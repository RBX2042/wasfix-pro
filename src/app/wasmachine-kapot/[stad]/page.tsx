import { WasFixShell, Icon } from "@/components/redesign/SharedLayout";
import { notFound } from "next/navigation";
import Link from "next/link";
import citiesData from "@/data/cities.json";
import { catalogStats, formatCount } from "@/lib/catalog-stats";

const STATS = catalogStats();

type City = { slug: string; name: string; province: string; population: number };
const cities = citiesData as City[];

export function generateStaticParams() {
  return cities.map((c) => ({ stad: c.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ stad: string }> }) {
  const { stad } = await params;
  const city = cities.find((c) => c.slug === stad);
  if (!city) return { title: "Stad niet gevonden" };
  return {
    title: `Wasmachine kapot in ${city.name}? AI-diagnose in 60s · WasFix Pro`,
    description: `Wasmachine kapot in ${city.name}? Krijg gratis AI-diagnose, vind het juiste onderdeel en repareer zelf — of neem de diagnose mee naar je eigen reparateur.`,
    alternates: { canonical: `/wasmachine-kapot/${city.slug}` },
    openGraph: {
      title: `Wasmachine reparatie ${city.name}`,
      description: `Online diagnose + onderdelen-shop voor inwoners van ${city.name}. We verzenden op werkdagen, met track & trace.`,
      type: "website",
    },
  };
}

export default async function CityPage({ params }: { params: Promise<{ stad: string }> }) {
  const { stad } = await params;
  const city = cities.find((c) => c.slug === stad);
  if (!city) notFound();

  // LocalBusiness + Service schema for SEO
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Service",
    serviceType: "Wasmachine reparatie & onderdelen",
    provider: { "@type": "Organization", name: "WasFix Pro", url: "https://wasfix.nl" },
    areaServed: { "@type": "City", name: city.name, containedInPlace: { "@type": "AdministrativeArea", name: city.province } },
    offers: { "@type": "Offer", price: "0", priceCurrency: "EUR", description: "Gratis AI-diagnose" },
  };

  return (
    <WasFixShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <section className="section" style={{ paddingTop: 56 }}>
        <div className="container" style={{ maxWidth: 800 }}>
          <div className="eyebrow">Wasmachine reparatie · {city.province}</div>
          <h1 className="h-display" style={{ fontSize: "clamp(32px, 4.5vw, 52px)", marginBottom: 14 }}>
            Wasmachine kapot in <em>{city.name}</em>?
          </h1>
          <p className="lead" style={{ marginBottom: 32 }}>
            Krijg in 60 seconden een gratis AI-diagnose. Zie meteen welk onderdeel je nodig hebt — we verzenden op werkdagen naar {city.name}, met track &amp; trace zodra je pakket is aangemeld.
          </p>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 48 }}>
            <Link className="btn btn-primary" href="/diagnose">
              Start gratis diagnose <Icon name="arrow" size={14} />
            </Link>
            <Link className="btn" href="/onderdelen">
              Bekijk onderdelen
            </Link>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 48 }}>
            <Stat label="Inwoners" value={city.population.toLocaleString("nl-NL")} />
            <Stat label="Provincie" value={city.province} />
            <Stat label="Verzending" value="Op werkdagen" />
            <Stat label="Onderdelen op voorraad" value={formatCount(STATS.partsInStock)} />
          </div>

          <h2 className="h-section" style={{ fontSize: 26, marginBottom: 14 }}>
            Hoe werkt het in <em>{city.name}</em>?
          </h2>
          <ol style={{ paddingLeft: 22, lineHeight: 1.8, color: "var(--text-2)", marginBottom: 32 }}>
            <li><strong style={{ color: "var(--text)" }}>Diagnose online</strong> — Foutcode of probleemomschrijving in onze AI. 60 seconden.</li>
            <li><strong style={{ color: "var(--text)" }}>Onderdeel bestellen</strong> — We verzenden op werkdagen naar {city.name}. Zodra je pakket bij de vervoerder is aangemeld, krijg je een track &amp; trace-link.</li>
            <li><strong style={{ color: "var(--text)" }}>Zelf repareren</strong> — Stap-voor-stap gids met foto&apos;s. Of vind een monteur in {city.province}.</li>
            <li><strong style={{ color: "var(--text)" }}>30 dagen retour</strong> — Verkeerd besteld? Geen probleem. Gratis retour bij defect.</li>
          </ol>

          <h2 className="h-section" style={{ fontSize: 26, marginBottom: 14 }}>
            Top foutcodes voor inwoners van {city.name}
          </h2>
          <p className="lead" style={{ fontSize: 15, marginBottom: 20 }}>
            Klik op een foutcode voor directe oplossing.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 48 }}>
            {["Bosch-E18", "Miele-F11", "Samsung-OE", "LG-UE", "Bosch-F21", "AEG-E20", "Whirlpool-F02", "Samsung-dC", "Miele-F36", "LG-DE"].map((code) => (
              <Link key={code} href={`/foutcodes/${code}`} className="pill pill-mono" style={{ fontSize: 12, padding: "5px 10px", textDecoration: "none" }}>
                {code.replace("-", " ")}
              </Link>
            ))}
          </div>

          {/* Hier stond dat we "een netwerk van verifieerde monteurs in heel
              Nederland" hebben, met een besparing van €30-50 en 30 minuten. Dat
              netwerk bestaat niet: monteurs kunnen zich alleen aanmelden (die
              aanmeldingen blijven PENDING, er wordt niemand geverifieerd) en er
              is geen code die een consument aan een monteur koppelt. Een
              erkenning of keurmerk claimen dat je niet hebt staat op de zwarte
              lijst van bijlage I bij de Richtlijn oneerlijke handelspraktijken
              (art. 6:193g BW), dus staat er nu wat we wél doen. */}
          <div style={{ padding: 24, background: "var(--surf-2)", border: "1px solid var(--border)", borderRadius: 12 }}>
            <h2 style={{ fontSize: 20, fontWeight: 500, marginBottom: 10 }}>
              Liever een monteur in {city.name}?
            </h2>
            <p className="muted" style={{ marginBottom: 16, fontSize: 14, lineHeight: 1.6 }}>
              We hebben geen eigen monteursnetwerk en bemiddelen niet — je zoekt zelf een reparateur in {city.province}. Wat we wél doen: de diagnose vooraf. Neem de uitkomst en de vermoedelijke onderdelen mee naar het gesprek, dan weet je wat er waarschijnlijk moet gebeuren voordat er iemand langskomt.
            </p>
            <Link className="btn btn-sm" href="/diagnose">
              Doe eerst de gratis diagnose <Icon name="arrow" size={13} />
            </Link>
          </div>
        </div>
      </section>
    </WasFixShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "var(--surf)", border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
      <div className="mono" style={{ fontSize: 10, color: "var(--muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
      <div style={{ fontWeight: 500, fontSize: 16 }}>{value}</div>
    </div>
  );
}
