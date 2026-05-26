import { WasFixShell, Icon } from "@/components/redesign/SharedLayout";
import Link from "next/link";

export const metadata = {
  title: "Pers & media kit · WasFix Pro",
  description: "Logo's, founder bio, statistieken en persberichten van WasFix Pro. Voor journalisten en bloggers in tech, duurzaamheid en consumentenrechten.",
  alternates: { canonical: "/pers" },
};

const STATS = [
  { value: "568+", label: "Geïndexeerde pagina's" },
  { value: "331", label: "Foutcodes in database" },
  { value: "96", label: "Onderdelen op voorraad" },
  { value: "26", label: "Reparatiegidsen NL" },
  { value: "10+", label: "Ondersteunde merken" },
  { value: "50K+", label: "Diagnoses sinds launch" },
];

const PRESS_RELEASES = [
  {
    date: "2026-05-22",
    title: "WasFix Pro lanceert eerste AI-gedreven Right-to-Repair platform NL",
    excerpt: "Amsterdam — WasFix Pro lanceert vandaag een platform dat consumenten in staat stelt hun wasmachine zelf te repareren met behulp van AI-diagnose en originele onderdelen. Het platform sluit aan op de EU Right-to-Repair Directive 2024/1799.",
  },
  {
    date: "2026-04-12",
    title: "WasFix-onderzoek: 73% van de Nederlandse wasmachine-vervangingen onnodig",
    excerpt: "Uit een interne analyse van 50.000 diagnoses blijkt dat 73% van de vervangen wasmachines nog gerepareerd had kunnen worden voor minder dan 30% van de aanschafprijs van een nieuwe.",
  },
  {
    date: "2026-03-04",
    title: "Monteurs adopteren AI: 1.000+ vakmensen gebruiken WasFix Pro voor pre-diagnose",
    excerpt: "In 6 maanden groeide de monteur-community naar duizend abonnees. De AI-pre-diagnose bespaart hen gemiddeld 28 minuten per klantbezoek en verlaagt 'verkeerd onderdeel'-incidents met 84%.",
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
            Logo&apos;s, statistieken, founder-bio en persberichten. Iets specifieks nodig? Mail{" "}
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
              Persberichten
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {PRESS_RELEASES.map((pr, i) => (
                <article key={i} className="step-card" style={{ padding: "20px 22px" }}>
                  <div className="mono" style={{ fontSize: 11, color: "var(--muted)", letterSpacing: "0.04em", marginBottom: 6 }}>
                    {new Date(pr.date).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" })}
                  </div>
                  <h3 style={{ fontSize: 17, fontWeight: 500, marginBottom: 8, lineHeight: 1.3 }}>{pr.title}</h3>
                  <p style={{ color: "var(--text-2)", fontSize: 13.5, lineHeight: 1.6 }}>{pr.excerpt}</p>
                </article>
              ))}
            </div>
            <div style={{ marginTop: 14 }}>
              <a href="mailto:pers@wasfix.nl?subject=Volledig%20persbericht%20opvragen" className="btn btn-sm">
                Vraag volledig persbericht aan <Icon name="arrow" size={13} />
              </a>
            </div>
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
              <li>De CO2-impact van één vermeden wasmachine-vervanging: 320kg</li>
              <li>Right to Repair in praktijk: van politiek naar consumentenkeuze</li>
              <li>Monteurs + AI = win-win: hoe 1.000 vakmensen 28 min/klant besparen</li>
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
