import Link from "next/link";
import { WasFixShell } from "@/components/redesign/SharedLayout";
import { Icon } from "@/components/redesign/SharedLayout";

export const metadata = {
  title: "Voor monteurs — De pro-tool voor wasmachine-reparatie · WasFix Pro",
  description: "AI-diagnose, klanten-CRM, B2B API, 10% korting op originele onderdelen, witlabel. De tool die nooit meer een verkeerd onderdeel bestelt.",
};

const features = [
  { icon: "sparkle", title: "AI pre-diagnose", text: "Klant geeft foutcode of foto, jij krijgt de waarschijnlijke oorzaak + benodigd onderdeel vóór je vertrekt." },
  { icon: "user", title: "Klanten-CRM", text: "Alle klantgeschiedenis, machines, eerdere reparaties en facturen op één plek." },
  { icon: "code", title: "B2B API", text: "Integreer diagnose-data in je eigen ERP of werkorder-systeem. 1.000 calls/mnd inbegrepen." },
  { icon: "cart", title: "10% korting", text: "Op alle originele onderdelen + voorrang bij voorraadgebrek. Bulk-bestellen vanaf 5 stuks." },
  { icon: "shield", title: "Witlabel optie", text: "Je eigen logo in diagnose-rapporten naar klanten. Eigen domein voor diagnose-portal." },
  { icon: "chart", title: "MTD omzet + analytics", text: "Welke onderdelen levert wat op? Welke merken vragen het meest tijd? Inzicht in cijfers." },
];

const testimonials = [
  { q: "WasFix bespaart me 2 uur per dag. Klant stuurt foutcode via WhatsApp, ik weet meteen wat ik moet meenemen — geen tweede bezoek meer.", who: "Mark · Mark's Wasmachineservice, Utrecht" },
  { q: "De API-integratie met onze planning werkt vlekkeloos. Diagnoses staan automatisch in de werkbon. Vroeger 15 min handwerk per klant, nu nul.", who: "Sandra · Witgoed Service West, Den Haag" },
  { q: "10% korting + nooit een verkeerd onderdeel. Mijn marge per reparatie is met €18 omhoog. Verdient zichzelf 20x terug in een maand.", who: "Tom · Reparatie Tom, Eindhoven" },
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
            AI-diagnose vóór je in de auto stapt. Klanten-CRM. B2B API. 10% korting op originele onderdelen. Voor zelfstandige monteurs en reparatie-bedrijven.
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
            14 dagen gratis · Geen creditcard · Direct toegang · Nederlandse support
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
            Klant stuurt foutcode of foto via je portal. Onze AI geeft binnen 60s de top-3 oorzaken + de SKU's van onderdelen je waarschijnlijk nodig hebt. Jij vertrekt met de juiste spullen.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
            {[
              { num: "1", title: "Klant meldt probleem", text: "Via formulier op jouw witlabel-portal, WhatsApp, of jouw eigen app via API." },
              { num: "2", title: "AI diagnose in 60s", text: "Foutcode + symptomen + machine-model → top 3 oorzaken met confidence %." },
              { num: "3", title: "Jij ziet onderdelen", text: "Met SKU + voorraadcheck + 10% monteur-prijs. One-click bulk-bestellen." },
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
          <div className="eyebrow">Monteurs vertellen</div>
          <h2 className="h-section">Ze gebruiken het <em>elke dag</em>.</h2>
          <div className="testimonials-grid" style={{ marginTop: 32 }}>
            {testimonials.map((t, i) => (
              <div key={i} className="testimonial">
                <div style={{ display: "flex", gap: 4, marginBottom: 14 }}>
                  {[...Array(5)].map((_, j) => <Icon key={j} name="star" size={14} className="star-on" />)}
                </div>
                <div style={{ fontSize: 14.5, lineHeight: 1.55, color: "var(--text)" }}>&ldquo;{t.q}&rdquo;</div>
                <div className="muted" style={{ fontSize: 12.5, marginTop: 14 }}>— {t.who}</div>
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
              { q: "Hoeveel kost Monteur Pro?", a: "€29 per maand, exclusief BTW. Inclusief AI-diagnose, klanten-CRM, 10% onderdelen-korting, B2B API (1.000 calls/maand), witlabel-optie. Geen verborgen kosten." },
              { q: "Werkt het met mijn bestaande planning-systeem?", a: "Ja — via onze REST API kan elke moderne software integreren. We hebben directe koppelingen voor de meest gebruikte NL-systemen. Vraag onze support naar maatwerk." },
              { q: "Hoe snel kan ik beginnen?", a: "5 minuten. Account maken, abonnement starten (14 dagen gratis), inloggen op je monteur-dashboard. Direct toegang tot alle features." },
              { q: "Wat als ik wil opzeggen?", a: "Maandelijks opzegbaar, per email of vanuit je dashboard. Geen lange contracten, geen opzegtermijn, geen verborgen kosten." },
              { q: "Krijg ik training of onboarding?", a: "Ja — gratis 30-minuten 1-op-1 onboarding-call binnen 2 werkdagen na aanmelden. Plus een uitgebreide kennisbank en NL-talige videosupport." },
              { q: "Is de data van mijn klanten veilig?", a: "Ja. AVG-compliant, AES-256 versleuteld at-rest en in-transit, Nederlandse serverlocatie, ISO 27001 certificering. Jij bent eigenaar van je klantdata, altijd exporteerbaar." },
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
            Start vandaag met je 14-dagen gratis proef. Geen creditcard nodig.
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
