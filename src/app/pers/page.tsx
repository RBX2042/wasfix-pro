import { WasFixShell, Icon } from "@/components/redesign/SharedLayout";
import Link from "next/link";
import { catalogStats, formatCount } from "@/lib/catalog-stats";

export const metadata = {
  title: "Pers & media kit · WasFix Pro",
  description: "Logo's, founder bio, statistieken en persberichten van WasFix Pro. Voor journalisten en bloggers in tech, duurzaamheid en consumentenrechten.",
  alternates: { canonical: "/pers" },
};

const CATALOG = catalogStats();

// Only what the catalog can back up. Usage figures ("50K+ diagnoses sinds
// launch") were removed: nothing measures them, and a press page is the last
// place to put a number a journalist might quote.
const STATS = [
  { value: formatCount(CATALOG.errorCodes), label: "Foutcodes in database" },
  { value: formatCount(CATALOG.partsInStock), label: "Onderdelen op voorraad" },
  { value: formatCount(CATALOG.guides), label: "Reparatiegidsen NL" },
  { value: formatCount(CATALOG.brands), label: "Ondersteunde merken" },
];

// The three "press releases" that stood here were invented, including a
// research finding ("uit een interne analyse van 50.000 diagnoses blijkt dat
// 73%…") that no study produced and an adoption claim of 1.000+ monteurs.
// A journalist quoting those would be repeating fabrications, so the section
// now carries background a reporter can actually verify against the product.
const BACKGROUND = [
  {
    title: "Wat het platform doet",
    body: "WasFix Pro combineert een AI-diagnose voor wasmachinestoringen met een foutcodedatabase, stap-voor-stap reparatiegidsen en een onderdelenshop. De diagnose vraagt door op merk en symptoom en verwijst daarna naar de gids en het onderdeel dat bij de waarschijnlijke oorzaak hoort.",
  },
  {
    title: "Waarom reparatie in plaats van vervanging",
    body: "De EU Right-to-Repair-richtlijn (2024/1799) verplicht fabrikanten onderdelen langer beschikbaar te houden. Een wasmachine vervangen kost al snel een veelvoud van de reparatie; het platform maakt zichtbaar welk onderdeel stuk is en wat dat kost, zodat die afweging op cijfers rust.",
  },
  {
    title: "Voor monteurs",
    body: "Naast consumenten richt het platform zich op zelfstandige monteurs, met een klanten- en werkorderadministratie, facturatie met btw-specificatie, korting op onderdelen en een B2B API voor koppeling met eigen planningssoftware.",
  },
];

const FOUNDER = {
  name: "Het WasFix team",
  bio: "WasFix Pro is gebouwd door een team van techneuten en monteurs met meer dan 30 jaar gecombineerde ervaring in witgoed-reparatie. We geloven dat AI ons in staat moet stellen apparaten langer te gebruiken, niet sneller te vervangen.",
  contact: "pers@wasfix.nl",
};

export default function PressPage() {
  return (
    <WasFixShell>
      <section className="section" style={{ paddingTop: 56 }}>
        <div className="container" style={{ maxWidth: 900 }}>
          <div className="eyebrow">Voor pers & media</div>
          <h1 className="h-display" style={{ fontSize: "clamp(32px, 4.5vw, 52px)", marginBottom: 14 }}>
            Press <em>kit</em>
          </h1>
          <p className="lead" style={{ marginBottom: 32 }}>
            Logo&apos;s, cijfers over de database, teambio en achtergrond. Iets specifieks nodig? Mail{" "}
            <a href="mailto:pers@wasfix.nl" style={{ color: "var(--acc-2)", textDecoration: "underline" }}>pers@wasfix.nl</a> — we reageren binnen 4 uur (werkdagen).
          </p>

          {/* WasFix in numbers */}
          <section style={{ marginBottom: 56 }}>
            <h2 className="h-section" style={{ fontSize: 24, marginBottom: 20 }}>
              WasFix in <em>cijfers</em>
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
              {STATS.map((s) => (
                <div key={s.label} className="step-card" style={{ padding: "20px 16px", textAlign: "center" }}>
                  <div style={{ fontSize: 32, fontWeight: 300, color: "var(--acc-2)", letterSpacing: "-0.02em", marginBottom: 4 }}>
                    {s.value}
                  </div>
                  <div className="muted" style={{ fontSize: 11.5, letterSpacing: "0.04em" }}>{s.label}</div>
                </div>
              ))}
            </div>
          </section>

          {/* Logo download */}
          <section style={{ marginBottom: 56 }}>
            <h2 className="h-section" style={{ fontSize: 24, marginBottom: 20 }}>
              Logo&apos;s & <em>brand assets</em>
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
              <LogoCard variant="dark">
                <BrandMark />
                <span style={{ fontWeight: 500, fontSize: 18, color: "#e8eefb" }}>WasFix<span style={{ color: "#7b88a6", marginLeft: 4 }}>Pro</span></span>
              </LogoCard>
              <LogoCard variant="light">
                <BrandMark light />
                <span style={{ fontWeight: 500, fontSize: 18, color: "#0b1224" }}>WasFix<span style={{ color: "#7b88a6", marginLeft: 4 }}>Pro</span></span>
              </LogoCard>
              <LogoCard variant="mono">
                <BrandMark mono />
              </LogoCard>
            </div>
            <div style={{ marginTop: 12 }}>
              <p className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>
                SVG-bronnen op aanvraag via pers@wasfix.nl. Onze brand-kleuren: primair <code style={{ background: "var(--surf-2)", padding: "1px 6px", borderRadius: 3 }}>#4f8cff</code>, accent <code style={{ background: "var(--surf-2)", padding: "1px 6px", borderRadius: 3 }}>#00d4ff</code>, achtergrond <code style={{ background: "var(--surf-2)", padding: "1px 6px", borderRadius: 3 }}>#060912</code>.
              </p>
            </div>
          </section>

          {/* Founder */}
          <section style={{ marginBottom: 56 }}>
            <h2 className="h-section" style={{ fontSize: 24, marginBottom: 20 }}>
              Over het <em>team</em>
            </h2>
            <div className="step-card" style={{ padding: 24 }}>
              <div style={{ fontWeight: 500, fontSize: 17, marginBottom: 10 }}>{FOUNDER.name}</div>
              <p style={{ color: "var(--text-2)", lineHeight: 1.7, marginBottom: 16, fontSize: 14 }}>{FOUNDER.bio}</p>
              <a href={`mailto:${FOUNDER.contact}`} className="btn btn-sm">
                <Icon name="send" size={12} /> {FOUNDER.contact}
              </a>
            </div>
          </section>

          {/* Press releases */}
          <section style={{ marginBottom: 56 }}>
            <h2 className="h-section" style={{ fontSize: 24, marginBottom: 20 }}>
              Achtergrond
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {BACKGROUND.map((item, i) => (
                <article key={i} className="step-card" style={{ padding: "20px 22px" }}>
                  <h3 style={{ fontSize: 17, fontWeight: 500, marginBottom: 8, lineHeight: 1.3 }}>{item.title}</h3>
                  <p style={{ color: "var(--text-2)", fontSize: 13.5, lineHeight: 1.6 }}>{item.body}</p>
                </article>
              ))}
            </div>
            <p className="muted" style={{ fontSize: 12.5, marginTop: 14, lineHeight: 1.6 }}>
              We publiceren geen gebruikscijfers zolang we ze niet gemeten hebben. Heb je cijfers nodig voor
              een artikel, mail dan{" "}
              <a href="mailto:pers@wasfix.nl" style={{ color: "var(--acc-2)", textDecoration: "underline" }}>pers@wasfix.nl</a>{" "}
              en we vertellen je precies wat we wel en niet weten.
            </p>
          </section>

          {/* Story angles */}
          <section style={{ marginBottom: 56 }}>
            <h2 className="h-section" style={{ fontSize: 24, marginBottom: 16 }}>
              Story <em>angles</em>
            </h2>
            <p style={{ color: "var(--text-2)", marginBottom: 16, fontSize: 14, lineHeight: 1.6 }}>
              Verhalen die we graag vertellen — perfect voor stukken over duurzaamheid, AI, consumentenrechten of e-commerce.
            </p>
            <ul style={{ paddingLeft: 22, lineHeight: 1.8, color: "var(--text-2)", fontSize: 14 }}>
              <li>Hoe AI ons in staat stelt 30+ jaar oude wasmachines nog te repareren</li>
              <li>Right to Repair in praktijk: van politiek naar consumentenkeuze</li>
              <li>Monteurs + AI: wat pre-diagnose betekent voor een servicebezoek</li>
              <li>Het EU-platform achter de regels: wat de nieuwe Ecodesign-verordening écht betekent</li>
            </ul>
          </section>

          {/* Contact */}
          <div style={{ padding: 28, background: "linear-gradient(135deg, rgba(79,140,255,0.08), rgba(0,212,255,0.04))", border: "1px solid var(--border-ac)", borderRadius: 14, textAlign: "center" }}>
            <h2 style={{ fontSize: 20, fontWeight: 500, marginBottom: 8 }}>Direct contact</h2>
            <p className="muted" style={{ marginBottom: 16, fontSize: 14 }}>
              Voor interviews, foto&apos;s, of background calls.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center" }}>
              <a href="mailto:pers@wasfix.nl" className="btn btn-primary">
                <Icon name="send" size={13} /> pers@wasfix.nl
              </a>
              <Link href="/right-to-repair" className="btn">
                R2R landing page
              </Link>
            </div>
          </div>
        </div>
      </section>
    </WasFixShell>
  );
}

function LogoCard({ variant, children }: { variant: "dark" | "light" | "mono"; children: React.ReactNode }) {
  const bg = variant === "dark" ? "linear-gradient(135deg, #060912, #1a1f3a)" : variant === "light" ? "#fafbfd" : "#fff";
  return (
    <div style={{ aspectRatio: "16/9", background: bg, borderRadius: 10, border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", gap: 12, padding: 16, position: "relative" }}>
      {children}
      <span className="mono" style={{ position: "absolute", bottom: 8, right: 10, fontSize: 9, color: variant === "light" ? "#7b88a6" : "rgba(232,238,251,0.4)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
        {variant}
      </span>
    </div>
  );
}

function BrandMark({ light, mono }: { light?: boolean; mono?: boolean }) {
  const fg = mono ? "#0b1224" : "#fff";
  const bg = mono ? "transparent" : "linear-gradient(135deg, #4f8cff, #00d4ff)";
  void light;
  return (
    <div style={{ width: 40, height: 40, borderRadius: 10, background: bg, display: "grid", placeItems: "center", border: mono ? "1.5px solid #0b1224" : "none" }}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={fg} strokeWidth="2">
        <circle cx="12" cy="12" r="7" />
        <circle cx="12" cy="12" r="3" fill={fg} />
      </svg>
    </div>
  );
}
