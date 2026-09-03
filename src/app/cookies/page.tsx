"use client";

import * as React from "react";
import Link from "next/link";
import { LegalPage } from "@/components/redesign/LegalPage";

export default function CookiesPage() {
  const [resetting, setResetting] = React.useState(false);
  const resetConsent = () => {
    document.cookie = "wasfix-consent=; Max-Age=0; Path=/; SameSite=Lax";
    setResetting(true);
    setTimeout(() => window.location.reload(), 600);
  };

  return (
    <LegalPage title="Cookie" emphasis="beleid">
      <p>
        Wij gebruiken cookies en vergelijkbare technieken (localStorage, sessionStorage) om de site te laten werken, jouw voorkeuren te onthouden en — uitsluitend met toestemming — geanonimiseerd te meten hoe de site wordt gebruikt. Deze pagina legt uit welke we gebruiken en hoe je je voorkeuren beheert.
      </p>

      <div className="callout">
        <strong>Snel je voorkeuren wijzigen?</strong>{" "}
        <button
          onClick={resetConsent}
          style={{
            background: "transparent",
            color: "var(--acc-2)",
            border: 0,
            cursor: "pointer",
            textDecoration: "underline",
            font: "inherit",
            padding: 0,
          }}
        >
          {resetting ? "Bezig…" : "Reset cookie-instellingen"}
        </button>
        {" "}— Daarna verschijnt de cookie-banner opnieuw zodat je opnieuw kunt kiezen.
      </div>

      <h2>1. Wat is een cookie?</h2>
      <p>
        Een cookie is een klein tekstbestandje dat op je apparaat wordt opgeslagen wanneer je een website bezoekt. Cookies worden gebruikt om voorkeuren te onthouden (taal, je cookiekeuze), je sessie actief te houden tijdens browsen, of statistieken te verzamelen over het gebruik van de site.
      </p>

      <h2>2. Welke cookies gebruiken wij?</h2>

      <h3>2.1 Functionele cookies (altijd actief — geen toestemming vereist)</h3>
      <p>Deze zijn essentieel voor het werken van de site:</p>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8, fontSize: 13 }}>
        <thead>
          <tr style={{ background: "var(--surf-2)" }}>
            <th style={{ padding: "8px 10px", textAlign: "left", borderBottom: "1px solid var(--border)" }}>Naam</th>
            <th style={{ padding: "8px 10px", textAlign: "left", borderBottom: "1px solid var(--border)" }}>Doel</th>
            <th style={{ padding: "8px 10px", textAlign: "left", borderBottom: "1px solid var(--border)" }}>Bewaartermijn</th>
          </tr>
        </thead>
        <tbody>
          <tr><td style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)" }}><code>wasfix-consent</code></td><td style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>Jouw keuze in de cookie-banner onthouden</td><td style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>365 dagen</td></tr>
          <tr><td style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)" }}><code>wasfix-locale</code></td><td style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>De taalversie waarin je de site bekijkt (alleen zodra de meertalige site aanstaat)</td><td style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>365 dagen</td></tr>
          <tr><td style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)" }}><code>wasfix-locale-suggested</code></td><td style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>Onthouden dat we je al hebben gevraagd of je de site liever in een andere taal leest</td><td style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>30 dagen</td></tr>
          <tr><td style={{ padding: "8px 10px" }}><code>__clerk_*</code></td><td style={{ padding: "8px 10px" }}>Auth-sessie (Clerk)</td><td style={{ padding: "8px 10px" }}>Sessie / 30 dagen</td></tr>
        </tbody>
      </table>
      <p>
        <strong>Geen cookies:</strong> je winkelmand (<code>wasfix-cart</code>) en je licht/donker-voorkeur (<code>theme</code>) bewaren we in de <em>localStorage</em> van je browser. Die gegevens gaan nooit met een verzoek mee naar ons of naar derden en blijven staan tot je ze via je browser wist.
      </p>

      <h3>2.2 Analytics (opt-in)</h3>
      <p>Alleen actief na expliciete toestemming. Geen profielen, geen ad-targeting:</p>
      <ul>
        <li><strong>Vercel Analytics</strong> — page-views en Web Vitals. Plaatst geen cookie, maar berekent een bezoeker-hash uit kenmerken van je apparaat en je verzoek. Ook dat is het uitlezen van gegevens op je apparaat, dus het script laadt pas nadat je analytics hebt aangezet.</li>
        <li><strong>Vercel Speed Insights</strong> — Core Web Vitals. Eveneens cookieloos, en om dezelfde reden pas na toestemming.</li>
        <li><strong>PostHog</strong> (EU-servers) — product-analytics: welke pagina&apos;s en functies worden gebruikt. Zet een <code>ph_*_posthog</code>-cookie met een willekeurig id (365 dagen). Session recording staat uit. Draait alleen als PostHog voor deze omgeving is ingeschakeld én je analytics hebt toegestaan.</li>
      </ul>

      <h3>2.3 Marketing-cookies (opt-in, standaard uit)</h3>
      <p>
        Wij doen geen retargeting en werken niet met advertentienetwerken. De enige marketing-cookies zijn die van ons doorverwijs-programma; ze worden pas geplaatst als je in de banner marketing hebt aangezet:
      </p>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8, fontSize: 13 }}>
        <thead>
          <tr style={{ background: "var(--surf-2)" }}>
            <th style={{ padding: "8px 10px", textAlign: "left", borderBottom: "1px solid var(--border)" }}>Naam</th>
            <th style={{ padding: "8px 10px", textAlign: "left", borderBottom: "1px solid var(--border)" }}>Doel</th>
            <th style={{ padding: "8px 10px", textAlign: "left", borderBottom: "1px solid var(--border)" }}>Bewaartermijn</th>
          </tr>
        </thead>
        <tbody>
          <tr><td style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)" }}><code>wasfix-ref</code></td><td style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>De doorverwijs-code van de link waarmee je binnenkwam, zodat degene die jou doorverwees krediet krijgt</td><td style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>30 dagen</td></tr>
          <tr><td style={{ padding: "8px 10px" }}><code>wasfix-vid</code></td><td style={{ padding: "8px 10px" }}>Anoniem bezoeker-id bij die doorverwijs-klik, zodat één klik niet dubbel telt. httpOnly: alleen onze server leest deze, JavaScript niet</td><td style={{ padding: "8px 10px" }}>30 dagen</td></tr>
        </tbody>
      </table>

      <h2>3. Cookies van derden</h2>
      <ul>
        <li><strong>Stripe</strong> (alleen op de checkout-pagina) — betaalverwerking en fraude-preventie (Stripe Radar). Noodzakelijk om een betaling te kunnen doen.</li>
        <li><strong>Clerk</strong> (alleen op auth-pagina&apos;s) — session-management, zie <code>__clerk_*</code> hierboven.</li>
        <li><strong>PostHog</strong> — zie 2.2: alleen na toestemming voor analytics.</li>
        <li><strong>Crisp</strong> (live chat) — laadt alleen als de chat voor deze omgeving is ingeschakeld én je toestemming hebt gegeven voor analytics of marketing. Crisp bewaart dan een sessie-identificatie zodat je je gesprek terugvindt.</li>
      </ul>

      <h2>4. Hoe beheer je je voorkeuren?</h2>
      <ul>
        <li>Bij je eerste bezoek kies je via de cookie-banner welke categorieën je toestaat.</li>
        <li>Je kunt je keuze altijd wijzigen via de knop &ldquo;Reset cookie-instellingen&rdquo; hierboven.</li>
        <li>Je kunt cookies ook handmatig verwijderen via je browser-instellingen (Chrome: Instellingen → Privacy en beveiliging → Cookies).</li>
      </ul>

      <h2>5. Wijzigingen</h2>
      <p>
        Wij kunnen dit cookiebeleid wijzigen. Bij wezenlijke wijzigingen vragen we opnieuw toestemming via de banner. Zie ook ons <Link href="/privacy">privacybeleid</Link>.
      </p>
    </LegalPage>
  );
}
