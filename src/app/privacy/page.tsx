import { WasFixShell } from "@/components/redesign/SharedLayout";
import { COMPANY, realOrNull, PENDING_REGISTRATION } from "@/lib/plans";
import Link from "next/link";

export const metadata = {
  title: "Privacybeleid · WasFix Pro",
  description: "Hoe WasFix Pro persoonsgegevens verwerkt — AVG-conform privacybeleid.",
};

export default function PrivacyPage() {
  return (
    <WasFixShell>
      <section className="section" style={{ paddingTop: 56 }}>
        <div className="container" style={{ maxWidth: 800 }}>
          <div className="eyebrow">Juridisch</div>
          <h1 className="h-display" style={{ fontSize: "clamp(28px, 4vw, 44px)", marginBottom: 8 }}>
            Privacy<em>beleid</em>
          </h1>
          <p className="muted mono" style={{ fontSize: 12, marginBottom: 36, letterSpacing: "0.04em" }}>
            Laatste update: 23 mei 2026 · Versie 2.1
          </p>

          <div className="legal-content">
            <p style={{ fontSize: 16, lineHeight: 1.7, color: "var(--text-2)" }}>
              WasFix Pro hecht waarde aan jouw privacy. In dit beleid leggen we uit welke persoonsgegevens we verzamelen, waarom we ze verzamelen, wat we ermee doen, hoe lang we ze bewaren en welke rechten je hebt. Dit beleid is AVG-conform (Algemene Verordening Gegevensbescherming, EU 2016/679).
            </p>

            <h2>1. Verwerkingsverantwoordelijke</h2>
            <p>
              {COMPANY.name}<br />
              {realOrNull(COMPANY.street) && realOrNull(COMPANY.city) ? (
                <>
                  {realOrNull(COMPANY.street)}, {realOrNull(COMPANY.postalCode)} {realOrNull(COMPANY.city)}, {COMPANY.country}
                  <br />
                </>
              ) : (
                <>
                  Vestigingsadres: {PENDING_REGISTRATION}
                  <br />
                </>
              )}
              KvK: {realOrNull(COMPANY.kvk) ?? PENDING_REGISTRATION} · BTW:{" "}
              {realOrNull(COMPANY.vatNumber) ?? PENDING_REGISTRATION}
              <br />
              Contact privacy: <a href="mailto:privacy@wasfix.nl">privacy@wasfix.nl</a>
            </p>

            <h2>2. Welke gegevens verzamelen we</h2>
            <h3>2.1 Bij accountregistratie</h3>
            <ul>
              <li>Naam en e-mailadres. Je wachtwoord komt nooit bij ons binnen: inloggen loopt via Clerk, onze authenticatiepartner, die de inloggegevens beheert.</li>
              <li>Optioneel: telefoonnummer, factuuradres</li>
              <li>Bij monteur-account: KvK-nummer, BTW-nummer, bedrijfsnaam</li>
            </ul>
            <h3>2.2 Bij AI-diagnose</h3>
            <ul>
              <li>Beschreven probleem (tekst), foutcode, merk + model wasmachine</li>
              <li>Eventueel uploaded foto van het display of onderdeel</li>
              <li>Chat-geschiedenis tijdens diagnose-sessie</li>
              <li>Gegenereerde diagnose-output (AI-resultaat)</li>
            </ul>
            <h3>2.3 Bij bestelling</h3>
            <ul>
              <li>Verzendadres, factuuradres</li>
              <li>Bestelde onderdelen, hoeveelheden, totaalbedrag</li>
              <li>Betaalmethode (betaaldata zelf verwerkt door Stripe — wij zien geen volledige kaartnummers)</li>
            </ul>
            <h3>2.4 Bij gebruik van de site</h3>
            <ul>
              <li>IP-adres (geanonimiseerd na 7 dagen)</li>
              <li>Browser-versie, apparaattype, schermresolutie</li>
              <li>Bezochte pagina&apos;s, klikgedrag (alleen bij analytics-consent)</li>
              <li>Sessie-cookies (functioneel — winkelmand, login)</li>
            </ul>

            <h2>3. Rechtsgrondslagen</h2>
            <p>We verwerken persoonsgegevens uitsluitend op basis van een geldige rechtsgrond:</p>
            <ul>
              <li><strong>Uitvoering van overeenkomst</strong> — voor bestellingen, abonnementen, accountbeheer (art. 6(1)(b) AVG)</li>
              <li><strong>Toestemming</strong> — voor analytics-cookies, marketing-e-mails, vrijblijvende AI-diagnose voor niet-ingelogde gebruikers (art. 6(1)(a))</li>
              <li><strong>Wettelijke verplichting</strong> — voor boekhouding, BTW-aangifte, identificatieplicht (art. 6(1)(c))</li>
              <li><strong>Gerechtvaardigd belang</strong> — voor beveiliging, fraudepreventie, geanonimiseerde productverbetering (art. 6(1)(f))</li>
            </ul>

            <h2>4. Met wie delen we gegevens</h2>
            <p>We delen jouw gegevens uitsluitend met verwerkers waarmee we een verwerkersovereenkomst (DPA) hebben:</p>
            <ul>
              <li><strong>Vercel Inc.</strong> (hosting) — server-logs, geanonimiseerde analytics. Data verwerkt in EU.</li>
              <li><strong>Supabase</strong> (database) — alle accountdata. Hosting in EU (Frankfurt).</li>
              <li><strong>Stripe Inc.</strong> (betalingen) — naam, e-mail, factuuradres, betaalmethode. PCI-DSS Level 1.</li>
              <li><strong>Resend</strong> (transactionele e-mail) — naam + e-mailadres voor het versturen van bevestigingen.</li>
              <li><strong>Google LLC</strong> (Gemini AI) — geanonimiseerde diagnose-input. Geen accountgegevens. Data verwerkt onder EU-VS Privacy Framework.</li>
              <li><strong>Clerk Inc.</strong> (authenticatie) — e-mailadres, wachtwoord-hash, sessietokens. SOC 2 Type II.</li>
            </ul>
            <p>We <strong>verkopen nooit</strong> persoonsgegevens aan derden. We delen ook niets met adverteerders.</p>

            <h2>5. Doorgifte buiten de EU</h2>
            <p>Sommige verwerkers (Stripe, Google) zijn in de VS gevestigd. Doorgifte van persoonsgegevens vindt plaats onder het <em>EU-US Data Privacy Framework</em> en met aanvullende <em>Standard Contractual Clauses (SCCs)</em>. Dit biedt een passend beschermingsniveau conform AVG art. 45-46.</p>

            <h2>6. Bewaartermijnen</h2>
            <ul>
              <li><strong>Accountgegevens:</strong> zolang het account actief is + 30 dagen na opzegging (voor herstel)</li>
              <li><strong>Diagnoses:</strong> 12 maanden gekoppeld aan account, daarna geanonimiseerd</li>
              <li><strong>Bestellingen en facturen:</strong> 7 jaar (fiscale bewaarplicht Belastingdienst)</li>
              <li><strong>Server-logs:</strong> 90 dagen</li>
              <li><strong>Marketing-toestemming:</strong> tot aan opzegging via unsubscribe</li>
              <li><strong>Cookies:</strong> zoals beschreven in het <Link href="/cookies">cookiebeleid</Link></li>
            </ul>

            <h2>7. Jouw rechten</h2>
            <p>Onder de AVG heb je de volgende rechten. Stuur een verzoek naar <a href="mailto:privacy@wasfix.nl">privacy@wasfix.nl</a> — we reageren binnen 30 dagen.</p>
            <ul>
              <li><strong>Inzage</strong> (art. 15) — Welke gegevens hebben we van je?</li>
              <li><strong>Correctie</strong> (art. 16) — Klopt iets niet? We passen het aan.</li>
              <li><strong>Verwijdering</strong> (art. 17, &ldquo;recht op vergetelheid&rdquo;) — Tenzij wettelijke bewaarplicht geldt.</li>
              <li><strong>Beperking</strong> (art. 18) — Tijdelijk niet meer verwerken.</li>
              <li><strong>Dataportabiliteit</strong> (art. 20) — Krijg je gegevens in JSON-export.</li>
              <li><strong>Bezwaar</strong> (art. 21) — Tegen verwerkingen op basis van gerechtvaardigd belang.</li>
              <li><strong>Intrekken toestemming</strong> — Voor verwerkingen op basis van toestemming, zonder gevolgen voor de rechtmatigheid van eerdere verwerkingen.</li>
            </ul>

            <h2>8. Beveiliging</h2>
            <p>We nemen technische en organisatorische maatregelen om jouw gegevens te beschermen:</p>
            <ul>
              <li>HTTPS/TLS voor alle verbindingen</li>
              <li>Inloggegevens worden beheerd door Clerk; wij slaan geen wachtwoorden op</li>
              <li>Versleuteling at-rest door onze hostingpartner</li>
              <li>Betalingen lopen via Stripe; kaartgegevens komen nooit op onze servers</li>
              <li>Datalek-procedure conform AVG art. 33-34 (melding binnen 72u aan Autoriteit Persoonsgegevens en getroffenen indien risico)</li>
            </ul>

            <h2>9. Cookies en tracking</h2>
            <p>We gebruiken een 3-laags cookie-systeem:</p>
            <ul>
              <li><strong>Functioneel</strong> (altijd aan) — Sessie, winkelmand, taalvoorkeur. Geen toestemming vereist (AVG art. 6(1)(b)).</li>
              <li><strong>Analytics</strong> (opt-in) — Vercel Analytics. Geanonimiseerd, geen persoonlijke profielen.</li>
              <li><strong>Marketing</strong> (opt-in) — Standaard uit. Alleen na expliciete toestemming.</li>
            </ul>
            <p>Beheer je voorkeuren via de <Link href="/cookies">cookie-instellingen</Link>.</p>

            <h2>10. Geautomatiseerde besluitvorming</h2>
            <p>Onze AI-diagnose geeft <em>aanbevelingen</em>, geen bindende besluiten. Je bent altijd vrij om een advies te negeren, een tweede mening te vragen, of een monteur te bellen. Er is geen sprake van profilering met juridische gevolgen.</p>

            <h2>11. Minderjarigen</h2>
            <p>Onze diensten zijn gericht op personen van 16 jaar of ouder. Voor minderjarigen onder de 16 is toestemming van een ouder/voogd vereist (AVG art. 8).</p>

            <h2>12. Klachten</h2>
            <p>Heb je een klacht over onze gegevensverwerking? Neem eerst contact met ons op via <a href="mailto:privacy@wasfix.nl">privacy@wasfix.nl</a>. Kom je er met ons niet uit? Je hebt het recht een klacht in te dienen bij de Autoriteit Persoonsgegevens:</p>
            <p style={{ background: "var(--surf-2)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 16px" }}>
              <strong>Autoriteit Persoonsgegevens</strong><br />
              Postbus 93374, 2509 AJ Den Haag<br />
              <a href="https://autoriteitpersoonsgegevens.nl" target="_blank" rel="noopener noreferrer">autoriteitpersoonsgegevens.nl</a>
            </p>

            <h2>13. Wijzigingen</h2>
            <p>We kunnen dit beleid wijzigen. Bij ingrijpende wijzigingen sturen we ingelogde gebruikers een e-mail. De laatste versie staat altijd op deze pagina, met datum bovenaan.</p>
          </div>
        </div>
      </section>

      <style>{`
        .legal-content h2 {
          font-size: 22px;
          font-weight: 500;
          letter-spacing: -0.015em;
          margin-top: 36px;
          margin-bottom: 12px;
          color: var(--text);
        }
        .legal-content h3 {
          font-size: 16px;
          font-weight: 500;
          margin-top: 20px;
          margin-bottom: 8px;
          color: var(--text);
        }
        .legal-content p {
          color: var(--text-2);
          line-height: 1.7;
          margin: 12px 0;
        }
        .legal-content ul {
          color: var(--text-2);
          line-height: 1.7;
          padding-left: 22px;
          margin: 12px 0;
        }
        .legal-content ul li { margin-bottom: 6px; }
        .legal-content a {
          color: var(--acc-2);
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        .legal-content a:hover { color: var(--acc); }
        .legal-content strong { color: var(--text); font-weight: 500; }
      `}</style>
    </WasFixShell>
  );
}
