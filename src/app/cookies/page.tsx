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
        Een cookie is een klein tekstbestandje dat op je apparaat wordt opgeslagen wanneer je een website bezoekt. Cookies worden gebruikt om voorkeuren te onthouden (taal, winkelmand), je sessie actief te houden tijdens browsen, of statistieken te verzamelen over het gebruik van de site.
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
          <tr><td style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)" }}><code>wasfix-cart</code></td><td style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>Winkelmand-inhoud onthouden</td><td style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>30 dagen</td></tr>
          <tr><td style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)" }}><code>wasfix-consent</code></td><td style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>Cookie-voorkeur opslaan</td><td style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>365 dagen</td></tr>
          <tr><td style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)" }}><code>__clerk_*</code></td><td style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>Auth-sessie (Clerk)</td><td style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>Sessie / 30 dagen</td></tr>
          <tr><td style={{ padding: "8px 10px" }}><code>theme</code></td><td style={{ padding: "8px 10px" }}>Licht/donker voorkeur</td><td style={{ padding: "8px 10px" }}>365 dagen</td></tr>
        </tbody>
      </table>

      <h3>2.2 Analytics-cookies (opt-in)</h3>
      <p>Alleen geplaatst na expliciete toestemming. Geanonimiseerd — geen profielen, geen ad-targeting:</p>
      <ul>
        <li><strong>Vercel Analytics</strong> — page-views, Web Vitals (laadtijd, interactiesnelheid). Cookieloos via fingerprint-hashing. Geen persoonlijke data.</li>
        <li><strong>Vercel Speed Insights</strong> — Core Web Vitals meting. Cookieloos.</li>
      </ul>

      <h3>2.3 Marketing-cookies (opt-in, standaard uit)</h3>
      <p>
        Momenteel gebruiken we <strong>geen</strong> marketing-cookies. Mochten we in de toekomst retargeting of ad-tracking willen inzetten, dan vragen we daar opnieuw expliciet toestemming voor.
      </p>

      <h2>3. Cookies van derden</h2>
      <ul>
        <li><strong>Stripe</strong> (alleen op checkout-pagina) — voor fraude-preventie (Stripe Radar). Vereist voor het verwerken van betalingen.</li>
        <li><strong>Clerk</strong> (alleen op auth-pagina&apos;s) — session-management.</li>
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
