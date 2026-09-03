import Link from "next/link";
import { WasFixShell } from "@/components/redesign/SharedLayout";
import { Icon } from "@/components/redesign/SharedLayout";

export const metadata = {
  title: "Voor monteurs — De pro-tool voor wasmachine-reparatie · WasFix Pro",
  description: "AI-diagnose, klanten-CRM, werkorders met factuur, B2B API en 10% korting op onderdelen. De tool die nooit meer een verkeerd onderdeel bestelt.",
};

// Deze lijst verkocht een witlabel-portal, voorrang bij voorraadgebrek, een
// bulkminimum van 5 stuks en omzet-analytics. Niets daarvan bestaat: er is geen
// witlabel-implementatie, geen voorraad-allocatie per klant, geen
// minimum-afname en het monteur-dashboard toont vier tellingen zonder
// omzetcijfer. Een niet-bestaande functie verkopen is misleidend onder
// art. 6:193c BW, dus staat er nu alleen wat je na inloggen echt aantreft.
const features = [
  { icon: "sparkle", title: "AI pre-diagnose", text: "Zet foutcode of foto in WasFix, en je hebt de waarschijnlijke oorzaak + benodigd onderdeel vóór je vertrekt." },
  { icon: "user", title: "Klanten-CRM", text: "Alle klantgeschiedenis, machines, eerdere reparaties en facturen op één plek." },
  { icon: "code", title: "B2B API", text: "Integreer diagnose-data in je eigen ERP of werkorder-systeem. 1.000 calls/mnd inbegrepen." },
  { icon: "cart", title: "10% korting", text: "Op alle onderdelen, automatisch verrekend in je winkelmand. Boven €50 verzenden we gratis." },
  { icon: "chart", title: "Je cijfers in één overzicht", text: "Aantal klanten, openstaande werkorders en je diagnoses op het monteur-dashboard." },
];

// This page used to quote three repair businesses by name that do not exist,
// with quantified savings nobody measured. Replaced with what Monteur Pro
// actually does — claims that can be checked against the product.
const capabilities = [
  {
    title: "Klanten en werkorders op één plek",
    body: "Leg per klant vast welke machine er staat en wat je er eerder aan deed. Werkorders lopen van open naar voltooid met één klik, en je ziet in één oogopslag wat er nog openstaat.",
  },
  {
    title: "Factuur direct vanaf de werkorder",
    body: "Vul je bedrijfsgegevens één keer in en elke afgeronde werkorder wordt een factuur met btw-specificatie, in je eigen doorlopende nummerreeks. Printen of opslaan als pdf.",
  },
  {
    title: "10% korting op alle onderdelen",
    body: "De korting wordt automatisch toegepast in je winkelmand, ook bij bulkbestellingen. Boven €50 verzenden we gratis.",
  },
  {
    title: "B2B API voor je eigen systeem",
    body: "1.000 calls per maand op diagnose, foutcodes en onderdelen. Koppel het aan je planning of je eigen klantportaal.",
  },
];

export default function MonteurLandingPage() {
  return (
    <WasFixShell>
      <section className="section" style={{ paddingTop: 56 }}>
        <div className="container">
          <div className="pill pill-acc" style={{ marginBottom: 16 }}>
            <Icon name="bolt" size={12} /> Voor wasmachine-monteurs en reparatiebedrijven
          </div>
          <h1 className="h-display" style={{ fontSize: "clamp(36px, 5.5vw, 64px)", marginBottom: 18 }}>
            De pro-tool die nooit meer<br />
            een <em>verkeerd onderdeel</em> bestelt.
          </h1>
          <p className="lead" style={{ maxWidth: 720, marginBottom: 28 }}>
            AI-diagnose vóór je in de auto stapt. Klanten-CRM. B2B API. 10% korting op onderdelen. Voor zelfstandige monteurs en reparatie-bedrijven.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            <Link className="btn btn-primary" href="/registreren?plan=monteur_pro">
              Word Monteur Pro <Icon name="arrow" size={14} />
            </Link>
            <Link className="btn" href="/contact?onderwerp=monteur-demo">
              Plan een demo
            </Link>
          </div>
          <div className="muted mono" style={{ fontSize: 12, marginTop: 16, letterSpacing: "0.04em" }}>
            14 dagen gratis · Maandelijks opzegbaar · Direct toegang · Nederlandse support
          </div>
        </div>
      </section>

      <section className="section" id="monteur-features">
        <div className="container">
          <div className="eyebrow">Wat krijg je</div>
          <h2 className="h-section">Alles in <em>één tool</em>.</h2>
          <div className="features-grid" style={{ marginTop: 36 }}>
            {features.map((f, i) => (
              <div key={i} className="feature-card">
                <div className="feature-icon"><Icon name={f.icon as Parameters<typeof Icon>[0]["name"]} size={18} /></div>
                <div className="feature-title">{f.title}</div>
                <div className="feature-text">{f.text}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="container">
          <div className="eyebrow">Tijdsbesparing</div>
          <h2 className="h-section">Pre-diagnose <em>vóór</em> het bezoek.</h2>
          <p className="lead" style={{ marginBottom: 24 }}>
            Zet de foutcode of een foto van de display erin. Onze AI geeft binnen 60s de top-3 oorzaken + de SKU&apos;s van onderdelen die je waarschijnlijk nodig hebt. Jij vertrekt met de juiste spullen.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
            {[
              { num: "1", title: "Klant meldt probleem", text: "Telefonisch of per mail. Jij zet merk, model en foutcode in WasFix — of je koppelt je eigen intakeformulier op onze API." },
              { num: "2", title: "AI diagnose in 60s", text: "Foutcode + symptomen + machine-model → top 3 oorzaken met confidence %." },
              { num: "3", title: "Jij ziet onderdelen", text: "Met SKU, actuele voorraad en jouw 10% monteurprijs. Direct bestellen vanuit je monteur-onderdelenpagina." },
              { num: "4", title: "Ga naar de klant", text: "Met het juiste onderdeel, eerste keer raak. Klant blij, jij efficiënter." },
            ].map((s) => (
              <div key={s.num} className="step-card">
                <div className="step-num">{s.num}</div>
                <div className="step-title">{s.title}</div>
                <div className="step-text">{s.text}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="container">
          <div className="eyebrow">API</div>
          <h2 className="h-section">Integreer met <em>jouw</em> systeem.</h2>
          <p className="lead" style={{ marginBottom: 24 }}>
            REST API voor diagnose, onderdelen-lookup, voorraadcheck. Werkt met elk planning- of werkorder-systeem. 1.000 calls per maand inbegrepen bij Monteur Pro.
          </p>
          <div style={{ background: "var(--surf-2)", border: "1px solid var(--border)", borderRadius: 12, padding: 24 }}>
            <div className="mono" style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10, letterSpacing: "0.08em" }}>POST /v1/diagnose</div>
            <pre className="mono" style={{ fontSize: 13, color: "var(--text-2)", overflowX: "auto", lineHeight: 1.6, margin: 0 }}>
{`curl -X POST https://api.wasfix.nl/v1/diagnose \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "brand": "Bosch",
    "model": "WAU28T40NL",
    "errorCode": "E18",
    "symptoms": "Water blijft staan in trommel"
  }'

# → { confidence: 87, cause: "Verstopte pluizenfilter of afvoerpomp",
#     parts: ["WF-FILTER-09", "WF-PUMP-04"], guides: [...] }`}
            </pre>
          </div>
          <div style={{ marginTop: 16 }}>
            <Link className="btn" href="/api-info">
              Bekijk volledige API-docs <Icon name="arrow" size={14} />
            </Link>
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="container">
          <div className="eyebrow">Wat je ervoor krijgt</div>
          <h2 className="h-section">Voor <em>€29</em> per maand.</h2>
          <div className="testimonials-grid" style={{ marginTop: 32 }}>
            {capabilities.map((c, i) => (
              <div key={i} className="testimonial">
                <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 8 }}>{c.title}</div>
                <div className="muted" style={{ fontSize: 13.5, lineHeight: 1.6 }}>{c.body}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="container">
          <div className="eyebrow">Veelgestelde vragen</div>
          <h2 className="h-section">Voor je <em>begint</em>.</h2>
          <div style={{ marginTop: 32, display: "grid", gap: 12, maxWidth: 820 }}>
            {[
              { q: "Hoeveel kost Monteur Pro?", a: "€29 per maand, exclusief BTW. Inclusief AI-diagnose, klanten-CRM, werkorders met factuur, 10% onderdelen-korting en de B2B API (1.000 calls/maand). Geen verborgen kosten." },
              { q: "Werkt het met mijn bestaande planning-systeem?", a: "Via onze REST API kan elke moderne software koppelen. Kant-en-klare integraties met bestaande planningspakketten hebben we niet — die koppeling bouw je zelf of laat je door je leverancier bouwen. Vraag onze support naar de documentatie." },
              { q: "Hoe snel kan ik beginnen?", a: "5 minuten. Account maken, abonnement starten (14 dagen gratis), inloggen op je monteur-dashboard. Direct toegang tot alle features." },
              { q: "Wat als ik wil opzeggen?", a: "Maandelijks opzegbaar, per email of vanuit je dashboard. Geen lange contracten, geen opzegtermijn, geen verborgen kosten." },
              { q: "Krijg ik training of onboarding?", a: "Ja — gratis 30-minuten 1-op-1 onboarding-call binnen 2 werkdagen na aanmelden. Plus een uitgebreide kennisbank en NL-talige videosupport." },
              { q: "Is de data van mijn klanten veilig?", a: "Je klantgegevens staan in een Europese database van onze hostingpartner, die versleutelt at-rest, en al het verkeer gaat over TLS. Elke monteur ziet uitsluitend zijn eigen klanten en werkorders — dat is afgedwongen in de query, niet alleen in de UI. We hebben geen ISO 27001-certificering; als je daar een leverancierseis voor hebt, zeg het en we sturen je wat we wél kunnen aantonen. Jij bent eigenaar van je klantdata en kunt die altijd exporteren." },
            ].map((f, i) => (
              <details key={i} style={{ background: "var(--surf)", border: "1px solid var(--border)", borderRadius: 10, padding: "16px 18px" }}>
                <summary style={{ cursor: "pointer", fontWeight: 500, listStyle: "none", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  {f.q}
                  <Icon name="chevron" size={14} className="dim" />
                </summary>
                <div style={{ marginTop: 10, color: "var(--text-2)", fontSize: 14, lineHeight: 1.6 }}>{f.a}</div>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="container" style={{ textAlign: "center", padding: "48px 24px", background: "linear-gradient(135deg, rgba(79,140,255,0.08), rgba(0,212,255,0.04))", border: "1px solid var(--border-ac)", borderRadius: 16 }}>
          <h2 className="h-section" style={{ marginBottom: 12 }}>Klaar om <em>tijd</em> te besparen?</h2>
          <p className="lead" style={{ marginBottom: 24, maxWidth: 560, margin: "0 auto 24px" }}>
            Start vandaag met je 14-dagen gratis proef. Maandelijks opzegbaar.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center" }}>
            <Link className="btn btn-primary" href="/registreren?plan=monteur_pro">
              Word Monteur Pro <Icon name="arrow" size={14} />
            </Link>
            <Link className="btn" href="/prijzen">
              Vergelijk plannen
            </Link>
          </div>
        </div>
      </section>
    </WasFixShell>
  );
}
