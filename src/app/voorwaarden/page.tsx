import { ContactEmail } from "@/lib/contact-email";
import { WasFixShell } from "@/components/redesign/SharedLayout";
import { formatEur } from "@/lib/utils";
import { SHIPPING, COMPANY, PLANS, realOrNull, SUPPORT_RESPONSE_WORKDAYS, COMPLAINT_RESOLUTION_DAYS } from "@/lib/plans";
import { PAID_DAILY_CALLS } from "@/lib/diagnose-core";
import Link from "next/link";

export const metadata = {
  title: "Algemene voorwaarden",
  description: "Algemene voorwaarden van WasFix Pro voor diensten, onderdelen-verkoop en abonnementen.",
  alternates: { canonical: "/voorwaarden" },
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
            Laatste update: 9 oktober 2026 · Versie 2.3
          </p>

          <div className="legal-content">
            <p style={{ fontSize: 16, lineHeight: 1.7, color: "var(--text-2)" }}>
              Deze algemene voorwaarden zijn van toepassing op alle aanbiedingen, overeenkomsten en leveringen van {COMPANY.name} (&ldquo;WasFix&rdquo;, &ldquo;wij&rdquo;, &ldquo;ons&rdquo;) aan jou als gebruiker, consument of zakelijke afnemer. Door gebruik te maken van onze diensten of een bestelling te plaatsen, accepteer je deze voorwaarden.
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
              <li>Bestellingen worden op werkdagen verzonden. De bezorgtijd hangt af van de vervoerder. Zodra wij je bestelling als verzonden markeren, ontvang je een e-mail met een track &amp; trace-code.</li>
              <li>Levertijd is een indicatie, geen fatale termijn. Bij vertraging informeren we je per e-mail.</li>
              <li>Wij leveren op dit moment uitsluitend in Nederland. Verzendkosten: gratis vanaf {formatEur(SHIPPING.freeFromEur)}, anders {formatEur(SHIPPING.rateEur)}.</li>
              <li>Levering geschiedt op het door jou opgegeven adres. Onjuiste adresinformatie komt voor jouw rekening.</li>
              <li>Het risico van beschadiging of verlies gaat over op het moment van bezorging (consumenten) of overdracht aan de vervoerder (zakelijke afnemers, art. 7:11 BW).</li>
            </ul>

            <h2>Artikel 5 — Herroepingsrecht (alleen voor consumenten)</h2>
            <p>
              Bij aankopen op afstand heb je als consument het wettelijk recht om binnen <strong>14 dagen</strong> zonder opgave van redenen de overeenkomst te ontbinden. Wij verlengen dit vrijwillig naar <strong>30 dagen</strong>.
            </p>
            <h3>5.1 Hoe oefen je het herroepingsrecht uit?</h3>
            <ul>
              <li>Stuur een mail naar <ContactEmail /> of vul het <Link href="/retour/start">retour-formulier</Link> in.</li>
              <li>Stuur het product binnen 14 dagen na je melding retour.</li>
              <li>Je mag het onderdeel uitpakken, bekijken en beoordelen zoals je in een winkel zou doen (art. 6:230s lid 2 BW). Een geopende verpakking, een verbroken zegel of een kort gepast onderdeel kost je je herroepingsrecht dus niet. Ga je verder dan nodig is om aard en werking vast te stellen en is het onderdeel daardoor minder waard, dan verrekenen we alleen die waardevermindering.</li>
              <li>Wij betalen binnen 14 dagen na ontvangst van je herroepingsmelding het volledige bedrag terug, inclusief de oorspronkelijke verzendkosten (laagste tarief) — art. 6:230r lid 1 BW. Wij mogen daarmee wachten tot wij het product terug hebben of tot jij hebt aangetoond dat je het hebt verzonden (lid 3).</li>
              <li>De kosten voor retourzending zijn voor jouw rekening, tenzij het product defect of verkeerd geleverd is.</li>
            </ul>
            <h3>5.2 Uitsluitingen</h3>
            <p>Geen herroepingsrecht voor:</p>
            <ul>
              <li>Producten die op maat zijn gemaakt of voor jou speciaal besteld bij de fabrikant</li>
              <li>Digitale diensten waarvoor je expliciet toestemming hebt gegeven om vóór afloop van de bedenktermijn te starten</li>
            </ul>
            <p>
              De hygiëne-uitzondering van art. 6:230p sub f BW geldt alleen voor verzegelde producten die om gezondheids- of hygiënische redenen niet teruggestuurd kunnen worden. Onderdelen als pompen, deurrubbers en filters vallen daar niet onder, dus daarop beroepen wij ons niet.
            </p>

            <h2>Artikel 6 — Garantie</h2>
            <ul>
              <li>Op alle producten geldt de <strong>wettelijke conformiteitsgarantie</strong> conform art. 7:17 BW: het product moet voldoen aan wat je redelijkerwijs mag verwachten.</li>
              <li>Aanvullend bieden we voor originele onderdelen <strong>24 maanden fabrieksgarantie</strong> op materiaal- en fabricagefouten.</li>
              <li>Universele/compatibele onderdelen: 12 maanden WasFix-garantie.</li>
              <li>Garantie vervalt bij verkeerd gebruik, ondeskundige installatie, of overmacht (water, brand, bliksem).</li>
              <li>Fabrikanten van wasmachines moeten reserve-onderdelen tot 10 jaar na het laatste op de markt gebrachte exemplaar leverbaar houden (Verordening (EU) 2019/2023, bijlage II). Die verplichting rust op de fabrikant, niet op WasFix — zie <Link href="/right-to-repair">right to repair</Link>.</li>
            </ul>

            <h2>Artikel 7 — Betaling</h2>
            <h3>7.1 Betaalmogelijkheden</h3>
            <ul>
              <li>Betaling vooraf via iDEAL of creditcard (via Stripe).</li>
              <li><strong>Bankoverschrijving (vooruitbetaling):</strong> in de checkout kun je ook kiezen voor betaling per bankoverschrijving — dit staat open voor iedere klant, dus ook voor consumenten. Kies je dit, dan ontvang je meteen een factuur en maak je het bedrag binnen <strong>14 dagen</strong> na factuurdatum over. <strong>Wij verzenden pas nadat de betaling op onze rekening is bijgeschreven;</strong> er wordt dus nooit geleverd op krediet. Lukt een betaling via iDEAL of creditcard niet, dan blijf je in de checkout met een melding; wij schakelen je nooit zelf over naar een andere betaalmethode en maken dan ook geen bestelling of factuur aan.</li>
              <li>De bestelde onderdelen worden bij een bestelling op rekening direct voor je gereserveerd. Is de factuur 7 dagen na de vervaldatum nog niet betaald, dan mogen wij de bestelling annuleren; de gereserveerde onderdelen komen dan weer beschikbaar voor andere klanten. Een factuur wijzigen of verwijderen wij nooit: bij annulering of terugbetaling van een gefactureerde bestelling sturen wij je een creditfactuur. Betaal je daarna alsnog, dan storten wij het bedrag terug of plaatsen we in overleg een nieuwe bestelling.</li>
              <li>Eigendom van producten gaat pas over op de Klant na volledige betaling.</li>
            </ul>
            <h3>7.2 Betaling blijft uit</h3>
            <p>
              Omdat wij pas verzenden na ontvangst van de betaling, ontstaat er bij een bestelling geen vordering op jou. Betaal je niet binnen de termijn, dan sturen wij rond de vervaldatum en kort voor de annulering een kosteloze betalingsherinnering. Is de factuur 7 dagen na de vervaldatum nog niet betaald, dan mogen wij de bestelling annuleren (zie 7.1). Wij brengen daarbij geen incassokosten, rente of andere kosten in rekening.
            </p>
            <h3>7.3 Zakelijke afnemers en abonnementen</h3>
            <ul>
              <li>Voor zakelijke afnemers geldt hetzelfde als voor consumenten: wij leveren onderdelen pas na ontvangst van de betaling.</li>
              <li>Abonnementen (Particulier, Monteur Pro en Bedrijf) betaal je per maand vooruit via iDEAL of creditcard (Stripe), zie artikel 8.</li>
            </ul>

            <h2>Artikel 8 — Abonnementen</h2>
            {/* The days and the monthly/excl.-btw facts come from PLANS, so this text cannot drift from what Stripe is told. */}
            <ul>
              <li>Abonnementen (Particulier, Monteur Pro en Bedrijf) lopen maandelijks en lopen door totdat je opzegt. Opzeggen kan op elk moment; het abonnement eindigt aan het einde van de periode waarvoor je hebt betaald.</li>
              <li>Particulier is inclusief btw. Monteur Pro en Bedrijf zijn zakelijke abonnementen en worden berekend exclusief btw; de btw komt er bij het afrekenen bij.</li>
              <li>Een nieuw abonnement begint met een gratis proefperiode van {PLANS.PARTICULIER.trialDays} dagen (Particulier), {PLANS.MONTEUR_PRO.trialDays} dagen (Monteur Pro) of {PLANS.BEDRIJF.trialDays} dagen (Bedrijf), één keer per account. Je kunt vóór de eerste betaling kosteloos opzeggen.</li>
              <li>De korting op onderdelen van je abonnement geldt vanaf je eerste betaling, niet tijdens de gratis proefperiode.</li>
              <li>&ldquo;Onbeperkt&rdquo; aantal AI-diagnoses betekent: ruim voldoende voor normaal gebruik. Om misbruik en onnodige kosten te voorkomen stopt de AI na {PAID_DAILY_CALLS} berichten per dag; de volgende dag kun je gewoon verder.</li>
              <li>Opzeggen kan via je dashboard (&ldquo;Abonnement&rdquo;) of per e-mail naar <ContactEmail />.</li>
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
              Alle teksten, afbeeldingen, video&apos;s, gidsen, AI-output en software op deze site zijn eigendom van {COMPANY.name} of haar licentiegevers. Kopiëren, verspreiden of commercieel gebruiken is niet toegestaan zonder schriftelijke toestemming. Voor citaten en linkjes naar pagina&apos;s geldt de gebruikelijke fair-use uitzondering.
            </p>

            <h2>Artikel 12 — Privacy</h2>
            <p>
              Op de verwerking van persoonsgegevens is ons <Link href="/privacy">privacybeleid</Link> van toepassing. Door gebruik te maken van onze diensten ga je daarmee akkoord.
            </p>

            <h2>Artikel 13 — Klachten en geschillen</h2>
            <ul>
              <li>Klachten kun je indienen via <ContactEmail />. We reageren binnen {SUPPORT_RESPONSE_WORKDAYS} werkdagen, met een oplossing binnen {COMPLAINT_RESOLUTION_DAYS} dagen.</li>
              <li>Kom je er met ons niet uit? Dan kun je het geschil voorleggen aan de bevoegde Nederlandse rechter. WasFix is niet aangesloten bij een erkende Geschillencommissie; een geschil kan alleen aan een geschilleninstantie worden voorgelegd als beide partijen daar in dat geval mee instemmen. Het Europese ODR-platform is per 20 juli 2025 gesloten (Verordening (EU) 2024/3228) en is dus geen route meer.</li>
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
