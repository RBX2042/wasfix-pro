import { WasFixShell, Icon } from "@/components/redesign/SharedLayout";
import Link from "next/link";
import { catalogStats, formatCount } from "@/lib/catalog-stats";

export const metadata = {
  title: "EU Right to Repair — wat zijn jouw rechten? · WasFix Pro",
  description: "Wat de EU-regels over repareren precies zeggen — met de verordening en richtlijn erbij, zodat je het zelf kunt nalezen.",
  alternates: { canonical: "/right-to-repair" },
};

/**
 * Every claim on this page is tied to a specific EU instrument, and every
 * instrument is linked at the bottom. The page previously cited EU 2023/1670
 * (which covers smartphones and tablets, not washing machines) for the parts
 * rules, and asserted price caps, an eight-year Dutch statutory guarantee, a
 * 2025 Repair Score mandate and 4%-of-turnover fines — none of which exist.
 */
const STATS = catalogStats();

const RIGHTS = [
  {
    title: "10 jaar reserve-onderdelen",
    text: "Fabrikanten moeten onderdelen voor wasmachines en was-droogcombinaties 10 jaar beschikbaar houden nadat het laatste exemplaar van een model op de markt is gebracht. Een deel daarvan — deurscharnieren en -afdichtingen, het deurslot, de wasmiddellade en andere kunststof randonderdelen — moet aan iedereen worden geleverd; de rest alleen aan professionele reparateurs.",
    law: "Verordening (EU) 2019/2023, bijlage II — geldt sinds 1 maart 2021",
  },
  {
    title: "Levering binnen 15 werkdagen",
    text: "Bestelt een reparateur een onderdeel bij de fabrikant, dan moet dat binnen 15 werkdagen geleverd worden. Fabrikanten moeten bovendien online een lijst met beschikbare onderdelen publiceren.",
    law: "Verordening (EU) 2019/2023, bijlage II",
  },
  {
    title: "Reparatie ook ná de garantie",
    text: "Fabrikanten van onder meer wasmachines moeten een defect product op verzoek repareren tegen een redelijke prijs en binnen een redelijke termijn — ook als de wettelijke garantieperiode al voorbij is. Onderdelen en reparatiegereedschap moeten tegen een redelijke prijs beschikbaar zijn voor elke reparateur, professioneel of niet.",
    law: "Richtlijn (EU) 2024/1799 — lidstaten moeten dit uiterlijk 31 juli 2026 in nationaal recht hebben omgezet",
  },
  {
    title: "12 maanden extra garantie na reparatie",
    text: "Kies je binnen de wettelijke garantieperiode voor reparatie in plaats van vervanging, dan loopt die periode 12 maanden langer door vanaf het moment dat de reparatie klaar is.",
    law: "Richtlijn (EU) 2024/1799, die Richtlijn (EU) 2019/771 wijzigt",
  },
  {
    title: "Geen kunstmatige reparatiedrempels",
    text: "Fabrikanten mogen reparatie niet blokkeren met contractuele, hardwarematige of softwarematige belemmeringen — bijvoorbeeld door originele of tweedehands onderdelen te weigeren of door een reparatie door een onafhankelijke reparateur onmogelijk te maken.",
    law: "Richtlijn (EU) 2024/1799, artikel 5",
  },
  {
    title: "Wat de Nederlandse wet erbovenop zegt",
    text: "Los van de EU-regels geldt in Nederland de conformiteitseis: een product moet de eigenschappen hebben die je er redelijkerwijs van mag verwachten. Voor een wasmachine betekent dat een flink aantal jaren — maar er staat géén vaste termijn in de wet. Wie beweert dat je 7 of 8 jaar wettelijke garantie hebt, verzint dat.",
    law: "Artikel 7:17 Burgerlijk Wetboek",
  },
];

const TIMELINE = [
  { year: "2021", label: "Verordening (EU) 2019/2023 wordt van toepassing: ecodesign-eisen en 10 jaar onderdelen voor wasmachines" },
  { year: "2024", label: "Richtlijn (EU) 2024/1799 (Right to Repair) treedt in werking op 30 juli" },
  { year: "2026", label: "31 juli: uiterste datum waarop lidstaten de richtlijn in nationaal recht moeten hebben omgezet" },
];

export default function RightToRepairPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: "EU Right to Repair — wat zijn jouw rechten?",
    description: "Wat de EU-regels over repareren precies zeggen, met bronvermelding per recht.",
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
            <Icon name="leaf" size={12} /> Richtlijn (EU) 2024/1799
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
                  `Onze ${formatCount(STATS.guides)} reparatiegidsen zijn gratis te lezen en in gewone taal geschreven.`,
                  `Onze database bevat ${formatCount(STATS.errorCodes)} foutcodes over ${STATS.brands} merken. Bij elke code staat of we de betekenis tegen een openbare bron hebben gecontroleerd — en zo niet, dan zeggen we dat ook.`,
                  "De diagnose werkt zonder account: geen e-mailmuur en geen tracking-cookies zonder toestemming.",
                  "Bij elke foutcode staat eerlijk of het een klus is die je zelf kunt doen — als het om netspanning, de motor of de besturingsmodule gaat, zeggen we dat je een monteur moet bellen.",
                  "Wat we niet doen: onderdelen tien jaar op voorraad garanderen. Die verplichting ligt bij de fabrikant, niet bij ons, en we beloven niets wat we niet waar kunnen maken.",
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
                { label: "Richtlijn (EU) 2024/1799 — repareren van goederen", href: "https://eur-lex.europa.eu/eli/dir/2024/1799/oj" },
                { label: "Verordening (EU) 2019/2023 — ecodesign wasmachines", href: "https://eur-lex.europa.eu/eli/reg/2019/2023/oj" },
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
