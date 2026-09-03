import { WasFixShell } from "@/components/redesign/SharedLayout";
import { formatEur } from "@/lib/utils";
import { SHIPPING, COMPANY, realOrNull } from "@/lib/plans";
import Link from "next/link";

export const metadata = {
  title: "Algemene voorwaarden · WasFix Pro",
  description: "Algemene voorwaarden van WasFix Pro B.V. voor diensten, onderdelen-verkoop en abonnementen.",
};

export default function VoorwaardenPage() {
  const kvk = realOrNull(COMPANY.kvk);
  const vat = realOrNull(COMPANY.vatNumber);
  const street = realOrNull(COMPANY.street);
  const postalCode = realOrNull(COMPANY.postalCode);
  const address = street && postalCode ? `${street}, ${postalCode} ${COMPANY.city}` : null;

  return (
    <WasFixShell>
      <section className="section" style={{ paddingTop: 56 }}>
        <div className="container" style={{ maxWidth: 800 }}>
          <div className="eyebrow">Juridisch</div>
          <h1 className="h-display" style={{ fontSize: "clamp(28px, 4vw, 44px)", marginBottom: 8 }}>
            Algemene <em>voorwaarden</em>
          </h1>
          <p className="muted mono" style={{ fontSize: 12, marginBottom: 36, letterSpacing: "0.04em" }}>
            Laatste update: 23 mei 2026 · Versie 2.1
          </p>

          <div className="legal-content">
            <p style={{ fontSize: 16, lineHeight: 1.7, color: "var(--text-2)" }}>
              Deze algemene voorwaarden zijn van toepassing op alle aanbiedingen, overeenkomsten en leveringen van WasFix Pro B.V. (&ldquo;WasFix&rdquo;, &ldquo;wij&rdquo;, &ldquo;ons&rdquo;) aan jou als gebruiker, consument of zakelijke afnemer. Door gebruik te maken van onze diensten of een bestelling te plaatsen, accepteer je deze voorwaarden.
            </p>

            <h2>Artikel 1 — Definities</h2>
            <ul>
              <li><strong>WasFix:</strong> {COMPANY.name}{address ? `, ${address}` : ""}{kvk ? `, KvK ${kvk}` : ""}{vat ? `, BTW ${vat}` : ""}. {COMPANY.isPlaceholder && "De inschrijving bij de Kamer van Koophandel is nog niet afgerond; zodra dat zo is staan het KvK- en btw-nummer hier."}</li>
              <li><strong>Gebruiker / Klant:</strong> iedere natuurlijke persoon of rechtspersoon die gebruikmaakt van een dienst of een product koopt.</li>
              <li><strong>Consument:</strong> natuurlijke persoon die niet handelt in de uitoefening van beroep of bedrijf.</li>
              <li><strong>Diensten:</strong> AI-diagnose, reparatiegidsen, foutcodes-database, monteur-tools, API-toegang, abonnementen.</li>
              <li><strong>Producten:</strong> originele en compatibele wasmachine-onderdelen die via onze webshop worden verkocht.</li>
              <li><strong>Abonnement:</strong> een terugkerend betaald lidmaatschap (Particulier, Monteur Pro, Bedrijf).</li>
              <li><strong>Overeenkomst:</strong> iedere overeenkomst tot levering van diensten en/of producten.</li>
            </ul>

            <h2>Artikel 2 — Toepasselijkheid</h2>
            <p>
              Deze voorwaarden zijn van toepassing op elke aanbieding van WasFix, elke bestelling en elke overeenkomst. Afwijkingen gelden alleen indien schriftelijk overeengekomen. Algemene voorwaarden van de Klant worden uitdrukkelijk van de hand gewezen.
            </p>

            <h2>Artikel 3 — Aanbod, prijzen en totstandkoming overeenkomst</h2>
            <ul>
              <li>Alle prijzen op de website zijn inclusief 21% BTW (consumenten) tenzij anders aangegeven.</li>
              <li>Voor zakelijke klanten gelden prijzen exclusief BTW, weergegeven in bestelproces.</li>
              <li>Voorbeelden, illustraties en specificaties dienen ter indicatie; kleine afwijkingen tussen afbeelding en geleverd product vormen geen grond voor ontbinding.</li>
              <li>Een overeenkomst komt tot stand op het moment dat WasFix een bestelbevestiging per e-mail verstuurt.</li>
              <li>WasFix kan een bestelling weigeren of aanvullende voorwaarden stellen bij vermoeden van fraude, technische storingen of foutieve prijsstelling (kennelijke vergissing).</li>
            </ul>

            <h2>Artikel 4 — Levering</h2>
            <ul>
              <li>Bestellingen worden op werkdagen verzonden. De bezorgtijd hangt af van de vervoerder; je ontvangt een track &amp; trace zodra je pakket is aangemeld.</li>
              <li>Levertijd is een indicatie, geen fatale termijn. Bij vertraging informeren we je per e-mail.</li>
              <li>Verzendkosten: gratis vanaf {formatEur(SHIPPING.freeFromEur)} in NL/BE, anders {formatEur(SHIPPING.rateEur)}.</li>
              <li>Levering geschiedt op het door jou opgegeven adres. Onjuiste adresinformatie komt voor jouw rekening.</li>
              <li>Het risico van beschadiging of verlies gaat over op het moment van bezorging (consumenten) of overdracht aan de vervoerder (zakelijke afnemers, art. 7:11 BW).</li>
            </ul>

            <h2>Artikel 5 — Herroepingsrecht (alleen voor consumenten)</h2>
            <p>
              Bij aankopen op afstand heb je als consument het wettelijk recht om binnen <strong>14 dagen</strong> zonder opgave van redenen de overeenkomst te ontbinden. Wij verlengen dit vrijwillig naar <strong>30 dagen</strong>.
            </p>
            <h3>5.1 Hoe oefen je het herroepingsrecht uit?</h3>
            <ul>
              <li>Stuur een mail naar <a href="mailto:retour@wasfix.nl">retour@wasfix.nl</a> of vul het <Link href="/retour/start">retour-formulier</Link> in.</li>
              <li>Stuur het product binnen 14 dagen na herroeping retour, in originele verpakking, ongebruikt en compleet.</li>
              <li>Wij betalen binnen 14 dagen na ontvangst het volledige bedrag terug, inclusief oorspronkelijke verzendkosten (laagste tarief).</li>
              <li>De kosten voor retourzending zijn voor jouw rekening, tenzij het product defect of verkeerd geleverd is.</li>
            </ul>
            <h3>5.2 Uitsluitingen</h3>
            <p>Geen herroepingsrecht voor:</p>
            <ul>
              <li>Producten die op maat zijn gemaakt of voor jou speciaal besteld bij de fabrikant</li>
              <li>Producten die hygiënisch ongeschikt zijn voor retour (bv. afgesloten verpakking geopend)</li>
              <li>Digitale diensten waarvoor je expliciet toestemming hebt gegeven om vóór afloop van de bedenktermijn te starten</li>
            </ul>

            <h2>Artikel 6 — Garantie</h2>
            <ul>
              <li>Op alle producten geldt de <strong>wettelijke conformiteitsgarantie</strong> conform art. 7:17 BW: het product moet voldoen aan wat je redelijkerwijs mag verwachten.</li>
              <li>Aanvullend bieden we voor originele onderdelen <strong>24 maanden fabrieksgarantie</strong> op materiaal- en fabricagefouten.</li>
              <li>Universele/compatibele onderdelen: 12 maanden WasFix-garantie.</li>
              <li>Garantie vervalt bij verkeerd gebruik, ondeskundige installatie, of overmacht (water, brand, bliksem).</li>
              <li>Onder de EU Right-to-Repair zijn wij verplicht onderdelen voor minimaal 10 jaar beschikbaar te houden.</li>
            </ul>

            <h2>Artikel 7 — Betaling</h2>
            <ul>
              <li>Betaling vooraf via iDEAL, Bancontact, creditcard, Apple/Google Pay (via Stripe).</li>
              <li>Zakelijke afnemers (MONTEUR_PRO, BEDRIJF): factuur 14 dagen netto na bevestigingsmail.</li>
              <li>Bij niet-tijdige betaling: wettelijke handelsrente + €40 incassokosten conform WIK.</li>
              <li>Eigendom van producten gaat pas over op de Klant na volledige betaling.</li>
            </ul>

            <h2>Artikel 8 — Abonnementen</h2>
            <ul>
              <li>Abonnementen lopen maandelijks (Particulier, Monteur Pro) of jaarlijks (Bedrijf) en zijn altijd opzegbaar per de eerstvolgende factuurdatum.</li>
              <li>Eerste 14 dagen gratis bij Monteur Pro — opzegbaar vóór de eerste factuurdatum zonder kosten.</li>
              <li>Opzeggen kan via je dashboard (&ldquo;Abonnement&rdquo;) of per e-mail naar <a href="mailto:support@wasfix.nl">support@wasfix.nl</a>.</li>
              <li>Bij opzegging blijft toegang behouden tot het einde van de betaalde periode. Geen pro-rata teruggave.</li>
              <li>WasFix kan prijzen aanpassen met 60 dagen aankondiging. Je hebt het recht het abonnement op te zeggen vóór de wijziging ingaat.</li>
            </ul>

            <h2>Artikel 9 — Gebruik van diensten</h2>
            <ul>
              <li>De AI-diagnose is een <strong>hulpmiddel</strong>, geen vervanging voor professioneel monteur-advies bij twijfel of veiligheidsrisico&apos;s.</li>
              <li>Reparatie-instructies in onze gidsen volg je op eigen risico. Bij elektrische werkzaamheden altijd de stekker eruit, water afsluiten, en bij twijfel een gekwalificeerde monteur inschakelen.</li>
              <li>API-toegang is bedoeld voor gebruik in eigen software. Doorverkoop of resale van API-resultaten is niet toegestaan zonder schriftelijke toestemming.</li>
              <li>Misbruik (scraping, overmatig gebruik, security-aanvallen) leidt tot directe blokkering zonder restitutie.</li>
            </ul>

            <h2>Artikel 10 — Aansprakelijkheid</h2>
            <ul>
              <li>Onze aansprakelijkheid voor directe schade is beperkt tot het bedrag dat je in de 12 maanden voorafgaand aan het schade-evenement aan WasFix hebt betaald.</li>
              <li>Wij zijn niet aansprakelijk voor indirecte schade (gederfde omzet, vervolgschade, gebruiksverlies).</li>
              <li>Wij zijn niet aansprakelijk voor schade als gevolg van zelf uitgevoerde reparaties op basis van AI-diagnose of gidsen.</li>
              <li>Voornoemde beperkingen gelden niet bij opzet of bewuste roekeloosheid van WasFix of haar leidinggevenden.</li>
              <li>De wettelijke rechten van consumenten worden door dit artikel niet aangetast.</li>
            </ul>

            <h2>Artikel 11 — Intellectueel eigendom</h2>
            <p>
              Alle teksten, afbeeldingen, video&apos;s, gidsen, AI-output en software op deze site zijn eigendom van WasFix Pro B.V. of haar licentiegevers. Kopiëren, verspreiden of commercieel gebruiken is niet toegestaan zonder schriftelijke toestemming. Voor citaten en linkjes naar pagina&apos;s geldt de gebruikelijke fair-use uitzondering.
            </p>

            <h2>Artikel 12 — Privacy</h2>
            <p>
              Op de verwerking van persoonsgegevens is ons <Link href="/privacy">privacybeleid</Link> van toepassing. Door gebruik te maken van onze diensten ga je daarmee akkoord.
            </p>

            <h2>Artikel 13 — Klachten en geschillen</h2>
            <ul>
              <li>Klachten kun je indienen via <a href="mailto:klachten@wasfix.nl">klachten@wasfix.nl</a>. We reageren binnen 7 werkdagen, met een oplossing binnen 30 dagen.</li>
              <li>Kom je er met ons niet uit? Je kunt een geschil voorleggen via het Europese ODR-platform: <a href="https://ec.europa.eu/consumers/odr" target="_blank" rel="noopener noreferrer">ec.europa.eu/consumers/odr</a>.</li>
              <li>Op alle overeenkomsten is Nederlands recht van toepassing.</li>
              <li>Geschillen tussen partijen worden voorgelegd aan de bevoegde rechter in het arrondissement Amsterdam, tenzij de wet anders dwingend voorschrijft.</li>
            </ul>

            <h2>Artikel 14 — Overmacht</h2>
            <p>
              WasFix is niet aansprakelijk voor vertraging of niet-nakoming door overmacht (oorlog, pandemie, brand, overstroming, uitval van leveranciers of telecom). Bij overmacht langer dan 30 dagen kunnen beide partijen de overeenkomst ontbinden zonder schadevergoedingsplicht.
            </p>

            <h2>Artikel 15 — Wijzigingen</h2>
            <p>
              We kunnen deze voorwaarden wijzigen. Wezenlijke wijzigingen kondigen we minimaal 30 dagen vooraf aan via e-mail aan abonnees of een melding op de website. De op het moment van bestelling geldende voorwaarden zijn van toepassing op die specifieke overeenkomst.
            </p>

            <h2>Artikel 16 — Slotbepalingen</h2>
            <ul>
              <li>Als een bepaling van deze voorwaarden ongeldig of onuitvoerbaar is, blijven de overige bepalingen onverkort van kracht.</li>
              <li>De Nederlandse tekst van deze voorwaarden is leidend boven eventuele vertalingen.</li>
            </ul>

            <p style={{ marginTop: 36, fontSize: 12, color: "var(--muted)", borderTop: "1px solid var(--border)", paddingTop: 18 }}>
              Deze voorwaarden zijn opgesteld in overeenstemming met de Nederlandse Wet en de Algemene Verordening Gegevensbescherming (AVG). Een eerdere versie blijft van toepassing op overeenkomsten die vóór de wijziging zijn gesloten.
            </p>
          </div>
        </div>
      </section>

      <style>{`
        .legal-content h2 {
          font-size: 22px; font-weight: 500; letter-spacing: -0.015em;
          margin-top: 36px; margin-bottom: 12px; color: var(--text);
        }
        .legal-content h3 {
          font-size: 16px; font-weight: 500;
          margin-top: 20px; margin-bottom: 8px; color: var(--text);
        }
        .legal-content p { color: var(--text-2); line-height: 1.7; margin: 12px 0; }
        .legal-content ul { color: var(--text-2); line-height: 1.7; padding-left: 22px; margin: 12px 0; }
        .legal-content ul li { margin-bottom: 6px; }
        .legal-content a {
          color: var(--acc-2); text-decoration: underline; text-underline-offset: 2px;
        }
        .legal-content a:hover { color: var(--acc); }
        .legal-content strong { color: var(--text); font-weight: 500; }
      `}</style>
    </WasFixShell>
  );
}
