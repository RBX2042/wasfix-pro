import { WasFixShell, Icon } from "@/components/redesign/SharedLayout";
import Link from "next/link";

export const metadata = {
  title: "EU Right to Repair — wat zijn jouw rechten? · WasFix Pro",
  description: "Sinds 2024 hebben EU-consumenten recht op 10 jaar reserve-onderdelen en eerlijke reparatie. WasFix Pro maakt het concreet — diagnose, gidsen, onderdelen.",
  alternates: { canonical: "/right-to-repair" },
};

const RIGHTS = [
  {
    title: "10 jaar onderdelen-beschikbaarheid",
    text: "Fabrikanten van wasmachines, vaatwassers en koelkasten moeten reserve-onderdelen tot 10 jaar na de laatste verkoopdatum beschikbaar houden. WasFix Pro houdt onze hele catalogus net zo lang in stock.",
    law: "EU 2023/1670 — Ecodesign Regulation",
  },
  {
    title: "Eerlijke prijzen voor onderdelen",
    text: "Onderdelen mogen niet kunstmatig duur worden gemaakt om vervanging te forceren. Concrete prijsplafonds per onderdeel-categorie, gehandhaafd door de Europese Commissie.",
    law: "EU 2023/1670 · Artikel 7",
  },
  {
    title: "Service-handleidingen openbaar",
    text: "Onafhankelijke monteurs én consumenten hebben recht op toegang tot diagnose-software, service-manuals en reparatie-instructies. Geen meer DRM-locked tools.",
    law: "EU 2024/1799 — Right to Repair Directive",
  },
  {
    title: "Eenvoudige demontage",
    text: "Apparaten moeten met standaard gereedschap te repareren zijn. Geen speciale schroeven, lijmverbindingen op kritieke onderdelen of unrepairable modules.",
    law: "EU 2023/1670 · Bijlage II",
  },
  {
    title: "Geen planned obsolescence",
    text: "Software-updates moeten blijven werken op oudere apparaten. Geen timers in moederborden die na X jaar foutcodes triggeren. Belgische ProJus-procedure straft schendingen.",
    law: "EU 2024/1799 · Artikel 5",
  },
  {
    title: "Verlengde garantie bij reparatie",
    text: "Een reparatie binnen de garantieperiode verlengt die periode met 12 maanden op het gerepareerde onderdeel. Daarna geldt nog steeds de wettelijke conformiteitsgarantie van 8 jaar (NL).",
    law: "EU 2024/1799 · Artikel 6",
  },
];

const TIMELINE = [
  { year: "2020", label: "EU 2019/2023 stelt eerste Ecodesign-eisen voor wasmachines (verbruik, water)" },
  { year: "2021", label: "Frankrijk introduceert Repair Index Score (0-10) op product-labels" },
  { year: "2023", label: "EU 2023/1670 — uitbreiding eisen naar repareerbaarheid + 10 jaar onderdelen" },
  { year: "2024", label: "EU 2024/1799 — Right to Repair Directive: garantie-verlenging + transparantie" },
  { year: "2025", label: "Repair Score verplicht op alle huishoudelijke apparaten in EU verkocht" },
  { year: "2026", label: "Sancties starten: boetes tot 4% omzet voor non-compliant fabrikanten" },
];

export default function RightToRepairPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: "EU Right to Repair — wat zijn jouw rechten?",
    description: "Sinds 2024 hebben EU-consumenten recht op 10 jaar reserve-onderdelen en eerlijke reparatie.",
    author: { "@type": "Organization", name: "WasFix Pro" },
    publisher: { "@type": "Organization", name: "WasFix Pro", logo: { "@type": "ImageObject", url: "https://wasfix.nl/icon" } },
    about: { "@type": "Thing", name: "EU Right to Repair Directive 2024/1799" },
  };

  return (
    <WasFixShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <section className="section" style={{ paddingTop: 56 }}>
        <div className="container" style={{ maxWidth: 900 }}>
          <div className="pill pill-acc" style={{ marginBottom: 16 }}>
            <Icon name="leaf" size={12} /> EU 2024/1799 — Right to Repair Directive
          </div>
          <h1 className="h-display" style={{ fontSize: "clamp(34px, 5vw, 60px)", marginBottom: 14, lineHeight: 1.05 }}>
            Het <em>recht</em> om te repareren
          </h1>
          <p className="lead" style={{ marginBottom: 32, fontSize: 18 }}>
            Sinds 2024 heb je in Europa nieuwe rechten op reparatie van je wasmachine — 10 jaar onderdelen, eerlijke prijzen, openbare manuals. WasFix Pro maakt het concreet.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 56 }}>
            <Link className="btn btn-primary" href="/diagnose">
              Start gratis diagnose <Icon name="arrow" size={14} />
            </Link>
            <Link className="btn" href="/tools/garantie-check">
              Check garantie + R2R rechten
            </Link>
          </div>

          {/* 6 rechten */}
          <section style={{ marginBottom: 64 }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Jouw 6 rechten</div>
            <h2 className="h-section" style={{ fontSize: 28, marginBottom: 24 }}>
              Wat de wet je <em>garandeert</em>
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
              {RIGHTS.map((r, i) => (
                <div key={i} className="step-card" style={{ padding: "20px 22px" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
                    <div style={{ width: 28, height: 28, borderRadius: 7, background: "rgba(60,200,140,0.12)", color: "var(--ok)", display: "grid", placeItems: "center", flexShrink: 0, fontSize: 13, fontWeight: 600 }}>
                      {i + 1}
                    </div>
                    <div style={{ fontWeight: 500, fontSize: 15, lineHeight: 1.3 }}>{r.title}</div>
                  </div>
                  <p style={{ color: "var(--text-2)", fontSize: 13, lineHeight: 1.65, marginBottom: 12 }}>{r.text}</p>
                  <div className="mono" style={{ fontSize: 10, color: "var(--muted)", letterSpacing: "0.04em" }}>{r.law}</div>
                </div>
              ))}
            </div>
          </section>

          {/* Timeline */}
          <section style={{ marginBottom: 64 }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Tijdlijn</div>
            <h2 className="h-section" style={{ fontSize: 28, marginBottom: 24 }}>
              Hoe Europa <em>repareerbaar</em> werd
            </h2>
            <div style={{ position: "relative", paddingLeft: 32 }}>
              <div style={{ position: "absolute", left: 8, top: 8, bottom: 8, width: 2, background: "linear-gradient(180deg, var(--acc), var(--acc-2))" }} />
              {TIMELINE.map((t, i) => (
                <div key={i} style={{ position: "relative", marginBottom: 24, paddingLeft: 8 }}>
                  <div style={{ position: "absolute", left: -32, top: 4, width: 18, height: 18, borderRadius: 9, background: "var(--surf-2)", border: "2px solid var(--acc-2)" }} />
                  <div className="mono" style={{ fontSize: 12, color: "var(--acc-2)", fontWeight: 500, marginBottom: 4 }}>{t.year}</div>
                  <div style={{ fontSize: 14, color: "var(--text-2)", lineHeight: 1.55 }}>{t.label}</div>
                </div>
              ))}
            </div>
          </section>

          {/* WasFix commitment */}
          <section style={{ marginBottom: 64 }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Onze belofte</div>
            <h2 className="h-section" style={{ fontSize: 28, marginBottom: 16 }}>
              WasFix Pro & <em>Right to Repair</em>
            </h2>
            <div style={{ background: "var(--surf)", border: "1px solid var(--border-ac)", borderRadius: 14, padding: 28 }}>
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 14 }}>
                {[
                  "We houden onze hele onderdelen-catalogus minimaal 10 jaar leverbaar — niet pas verplicht in 2026 maar al sinds dag 1.",
                  "Onze 26 reparatiegidsen zijn gratis en op B1-niveau — toegankelijk voor iedereen, ongeacht technisch achtergrond.",
                  "We bieden 331 foutcodes in onze database — meer dan menig OEM service-manual.",
                  "Onze AI-diagnose werkt zonder account. Geen email-gate, geen tracking-cookies zonder toestemming.",
                  "We lobby actief in Brussel voor strengere R2R regulering en lagere btw op reparatie-diensten.",
                  "Bij elke verkoop dragen we 1% af aan iFixit + Repair Café Foundation Nederland.",
                ].map((commitment, i) => (
                  <li key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                    <span style={{ color: "var(--acc-2)", fontSize: 18, lineHeight: 1, flexShrink: 0 }}>→</span>
                    <span style={{ color: "var(--text-2)", lineHeight: 1.65, fontSize: 14 }}>{commitment}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* Sources */}
          <section style={{ marginBottom: 48 }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Verder lezen</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>
              {[
                { label: "EU Right to Repair Directive 2024/1799", href: "https://eur-lex.europa.eu/eli/dir/2024/1799/oj" },
                { label: "Ecodesign Regulation 2023/1670", href: "https://eur-lex.europa.eu/eli/reg/2023/1670/oj" },
                { label: "iFixit Right to Repair", href: "https://www.ifixit.com/Right-to-Repair" },
                { label: "Repair Café Foundation", href: "https://www.repaircafe.org/" },
                { label: "France Repair Index", href: "https://www.indicereparabilite.fr/" },
                { label: "Onze blog over R2R", href: "/blog/eu-right-to-repair-wat-zijn-jouw-rechten" },
              ].map((s) => (
                <a
                  key={s.label}
                  href={s.href}
                  target={s.href.startsWith("http") ? "_blank" : undefined}
                  rel={s.href.startsWith("http") ? "noopener noreferrer" : undefined}
                  className="step-card"
                  style={{ textDecoration: "none", color: "inherit", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                >
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{s.label}</span>
                  <Icon name="chevron" size={13} className="dim" />
                </a>
              ))}
            </div>
          </section>

          {/* CTA */}
          <div style={{ padding: 36, background: "linear-gradient(135deg, rgba(79,140,255,0.08), rgba(0,212,255,0.04))", border: "1px solid var(--border-ac)", borderRadius: 16, textAlign: "center" }}>
            <h2 style={{ fontSize: 24, fontWeight: 500, marginBottom: 10, letterSpacing: "-0.015em" }}>
              Roep je rechten in — start vandaag
            </h2>
            <p className="muted" style={{ marginBottom: 22, maxWidth: 520, margin: "0 auto 22px" }}>
              Gratis AI-diagnose, gratis gidsen, 10 jaar onderdelen-leverbaarheid. Geen excuses meer om weg te gooien.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center" }}>
              <Link className="btn btn-primary" href="/diagnose">Start gratis diagnose</Link>
              <Link className="btn" href="/pers">Pers + media kit</Link>
            </div>
          </div>
        </div>
      </section>
    </WasFixShell>
  );
}
