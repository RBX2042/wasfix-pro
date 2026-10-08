import { WasFixShell, Icon } from "@/components/redesign/SharedLayout";
import { notFound } from "next/navigation";
import Link from "next/link";
import citiesData from "@/data/cities.json";
import { catalogStats, formatCount } from "@/lib/catalog-stats";
import { dbStats } from "@/lib/static-db";
import { FOOTER_CODES } from "@/components/redesign/footer-links";

type City = { slug: string; name: string; province: string; population: number };
const cities = citiesData as City[];

export function generateStaticParams() {
  return cities.map((c) => ({ stad: c.slug }));
}

// Requested window. The page reads dbStats(), which is cached for 60 seconds, so the
// effective freshness is the shorter of the two (the response says s-maxage=60).
export const revalidate = 3600;

export async function generateMetadata({ params }: { params: Promise<{ stad: string }> }) {
  const { stad } = await params;
  const city = cities.find((c) => c.slug === stad);
  if (!city) return { title: "Stad niet gevonden", robots: { index: false } };
  return {
    title: `Wasmachine kapot in ${city.name}? Gratis AI-diagnose`,
    description: `Wasmachine kapot in ${city.name}? Krijg een gratis AI-diagnose, vind het juiste onderdeel en repareer zelf, of neem de diagnose mee naar je eigen reparateur.`,
    alternates: { canonical: `/wasmachine-kapot/${city.slug}` },
    // noindex until each city has content that is its own. The 51 pages were one template
    // (after swapping name, province and population there are 3 distinct bodies), and the
    // title claimed a local service the body denies ("geen eigen monteursnetwerk"). That is
    // a doorway-page pattern. follow stays on so the links on the page still count.
    robots: { index: false, follow: true },
    openGraph: {
      images: [{ url: "/opengraph-image", width: 1200, height: 630 }],
      title: `Wasmachine reparatie ${city.name}`,
      description: `Online diagnose en onderdelenwinkel, ook voor inwoners van ${city.name}.`,
      type: "website",
    },
  };
}

export default async function CityPage({ params }: { params: Promise<{ stad: string }> }) {
  const { stad } = await params;
  const city = cities.find((c) => c.slug === stad);
  if (!city) notFound();

  // No Service/areaServed structured data: it asserted a local repair service in
  // every city, which this page itself says we do not offer.
  const live = await dbStats();
  const STATS = { ...catalogStats(), parts: live.partsCount };

  return (
    <WasFixShell>
      <section className="section" style={{ paddingTop: 56 }}>
        <div className="container" style={{ maxWidth: 800 }}>
          <div className="eyebrow">Wasmachine reparatie · {city.province}</div>
          <h1 className="h-display" style={{ fontSize: "clamp(32px, 4.5vw, 52px)", marginBottom: 14 }}>
            Wasmachine kapot in <em>{city.name}</em>?
          </h1>
          <p className="lead" style={{ marginBottom: 32 }}>
            Krijg een gratis AI-diagnose en zie welk onderdeel je mogelijk nodig hebt. We verzenden op werkdagen naar {city.name}; je krijgt een track &amp; trace-code zodra je bestelling is verzonden.
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
            <Stat label="Onderdelen in de catalogus" value={formatCount(STATS.parts)} />
          </div>

          <h2 className="h-section" style={{ fontSize: 26, marginBottom: 14 }}>
            Hoe werkt het in <em>{city.name}</em>?
          </h2>
          <ol style={{ paddingLeft: 22, lineHeight: 1.8, color: "var(--text-2)", marginBottom: 32 }}>
            <li><strong style={{ color: "var(--text)" }}>Diagnose online</strong> — Foutcode of probleemomschrijving in onze AI. Je krijgt een eerste indicatie, geen zekerheid.</li>
            <li><strong style={{ color: "var(--text)" }}>Onderdeel bestellen</strong> — We verzenden op werkdagen naar {city.name}. Zodra je bestelling is verzonden, krijg je een track &amp; trace-code.</li>
            <li><strong style={{ color: "var(--text)" }}>Zelf repareren</strong> — Stap-voor-stap gids. Of zoek zelf een monteur in {city.province}.</li>
            <li><strong style={{ color: "var(--text)" }}>30 dagen bedenktijd</strong> — Verkeerd besteld? Je kunt binnen 30 dagen terugsturen; retour is gratis bij een defect of fout van ons.</li>
          </ol>

          <h2 className="h-section" style={{ fontSize: 26, marginBottom: 14 }}>
            Enkele foutcodes om mee te beginnen
          </h2>
          <p className="lead" style={{ fontSize: 15, marginBottom: 20 }}>
            Klik op een foutcode voor directe oplossing.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 48 }}>
            {FOOTER_CODES.flatMap(({ brand, codes }) => codes.slice(0, 2).map((c) => `${brand}-${c}`)).map((code) => (
              <Link key={code} href={`/foutcodes/${code}`} className="pill pill-mono" style={{ fontSize: 12, padding: "5px 10px", minHeight: 44, display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
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
