import { LegalPage } from "@/components/redesign/LegalPage";
import { COMPANY, realOrNull } from "@/lib/plans";
import Link from "next/link";

export const metadata = {
  title: "Retourvoorwaarden · WasFix Pro",
  description: "Hoe je een onderdeel retour stuurt naar WasFix Pro — 30 dagen bedenktijd.",
};

export default function RetourPage() {
  // Het retouradres liep buiten realOrNull() om en drukte daardoor het stand-in
  // adres uit lib/plans af. Wie daar een pakket heen stuurt, raakt het kwijt —
  // dus zolang het echte vestigingsadres niet is geconfigureerd noemen we het
  // niet en krijg je het adres bij je RMA-nummer.
  const street = realOrNull(COMPANY.street);
  const postalCode = realOrNull(COMPANY.postalCode);
  const address = street && postalCode ? `${street}, ${postalCode} ${COMPANY.city}` : null;

  return (
    <LegalPage title="Retour" emphasis="voorwaarden">
      <p>
        Niet tevreden of toch het verkeerde onderdeel? Geen probleem. Wij hanteren een ruimhartig retourbeleid van <strong>30 dagen bedenktijd</strong> — bijna 2x zo lang als de wettelijk verplichte 14 dagen. Onderstaande pagina legt uit hoe het werkt.
      </p>

      <h2>1. Wanneer kun je retour sturen?</h2>
      <ul>
        <li>Binnen <strong>30 dagen</strong> na ontvangst van je bestelling</li>
        <li>Je mag het onderdeel uitpakken, bekijken en beoordelen zoals je in een winkel zou doen (art. 6:230s lid 2 BW). Een geopende verpakking of een verbroken zegel kost je je herroepingsrecht dus niet — stuur het wel zo compleet mogelijk terug, met de originele verpakking als je die nog hebt.</li>
        <li>Ga je verder dan nodig is om aard en werking vast te stellen — bijvoorbeeld door het onderdeel echt te monteren en te gebruiken — en is het daardoor minder waard, dan verrekenen we alleen die waardevermindering met je terugbetaling.</li>
        <li>Je hebt de orderbevestiging of factuur paraat</li>
      </ul>

      <h2>2. Uitsluitingen</h2>
      <p>De volgende producten zijn uitgesloten van retour:</p>
      <ul>
        <li>Op maat gemaakte onderdelen of voor jou speciaal besteld bij de fabrikant</li>
        <li>Verzegelde producten die om gezondheids- of hygiënische redenen niet teruggestuurd kunnen worden, als je het zegel hebt verbroken (art. 6:230p sub f BW). Onderdelen als pompen, deurrubbers en filters vallen daar niet onder, dus daarop beroepen wij ons niet.</li>
        <li>Digitale producten (abonnementen na activatie — wel mogelijk via opzegging volgens <Link href="/voorwaarden">voorwaarden</Link>)</li>
      </ul>

      <h2>3. Hoe stuur je een product retour?</h2>
      <ol>
        <li><strong>Vraag een retour aan</strong> via het <Link href="/retour/start">retour-formulier</Link> of mail naar <a href="mailto:retour@wasfix.nl">retour@wasfix.nl</a> met vermelding van je bestelnummer.</li>
        <li><strong>Ontvang je RMA-nummer</strong> per e-mail (binnen 24u op werkdagen).</li>
        <li><strong>Pak het product in</strong> in originele verpakking + RMA-nummer goed zichtbaar op buitenkant.</li>
        <li><strong>Verstuur</strong> binnen 14 dagen na het ontvangen van je RMA-nummer naar het opgegeven retouradres.</li>
        <li><strong>Bewaar het verzendbewijs</strong> tot je restitutie hebt ontvangen.</li>
      </ol>

      <h2>4. Wie betaalt de retourkosten?</h2>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12, fontSize: 13 }}>
        <thead>
          <tr style={{ background: "var(--surf-2)" }}>
            <th style={{ padding: "10px 12px", textAlign: "left", borderBottom: "1px solid var(--border)" }}>Situatie</th>
            <th style={{ padding: "10px 12px", textAlign: "left", borderBottom: "1px solid var(--border)" }}>Kosten retour</th>
          </tr>
        </thead>
        <tbody>
          <tr><td style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>Bedenktijd / verkeerd besteld</td><td style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>Voor jouw rekening</td></tr>
          <tr><td style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>Defect / verkeerd geleverd door ons</td><td style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>Gratis (wij sturen retour-label)</td></tr>
          <tr><td style={{ padding: "10px 12px" }}>Garantieclaim binnen periode</td><td style={{ padding: "10px 12px" }}>Gratis</td></tr>
        </tbody>
      </table>

      <h2>5. Wanneer krijg je je geld terug?</h2>
      <p>
        Wij betalen binnen <strong>14 dagen</strong> na je herroepingsmelding het volledige bedrag terug, inclusief de oorspronkelijke verzendkosten (op het laagste tarief) — art. 6:230r lid 1 BW. Wij mogen daarmee wachten tot wij het product terug hebben of tot jij hebt aangetoond dat je het hebt verzonden (lid 3); daarom is je verzendbewijs genoeg om de betaling in gang te zetten. Restitutie gebeurt op dezelfde betaalmethode waarmee je hebt betaald.
      </p>

      <h2>6. Modelformulier voor herroeping</h2>
      <p>
        Je hoeft het niet te gebruiken (een mail volstaat), maar als je liever het wettelijk modelformulier invult:
      </p>
      <pre style={{ background: "var(--surf-2)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px", fontSize: 12.5, lineHeight: 1.6, color: "var(--text-2)", overflowX: "auto", margin: "12px 0" }}>
{`Aan: ${COMPANY.name}
${address ? `   ${address}\n` : ""}   retour@wasfix.nl

Ik/Wij* deel/delen* hierbij mee dat ik/wij* onze
overeenkomst betreffende de verkoop van de volgende
producten/levering van de volgende dienst herroep/
herroepen*:

Besteld op: ___________  Ontvangen op: ___________
Bestelnummer: ___________
Naam consument(en): ___________
Adres consument(en): ___________

Handtekening: ___________  Datum: ___________

(* doorhalen wat niet van toepassing is)`}
      </pre>

      <h2>7. Retouradres</h2>
      {address ? (
        <p style={{ background: "var(--surf-2)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px" }}>
          {COMPANY.name}<br />
          T.a.v. Retouren (RMA-nummer op buitenkant)<br />
          {street}<br />
          {postalCode} {COMPANY.city}<br />
          {COMPANY.country}
        </p>
      ) : (
        <p style={{ background: "var(--surf-2)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px" }}>
          Het retouradres staat in de e-mail met je RMA-nummer. Stuur nog niets terug voordat je die hebt: {COMPANY.name} is nog in oprichting en het vestigingsadres staat daarom nog niet op deze pagina.
        </p>
      )}

      <p style={{ marginTop: 32 }}>
        <strong>Vragen?</strong> Mail <a href="mailto:retour@wasfix.nl">retour@wasfix.nl</a> of bekijk de <Link href="/help">help-pagina</Link>.
      </p>
    </LegalPage>
  );
}
