import { LegalPage } from "@/components/redesign/LegalPage";
import Link from "next/link";

export const metadata = {
  title: "Retourvoorwaarden · WasFix Pro",
  description: "Hoe je een onderdeel retour stuurt naar WasFix Pro — 30 dagen bedenktijd.",
};

export default function RetourPage() {
  return (
    <LegalPage title="Retour" emphasis="voorwaarden">
      <p>
        Niet tevreden of toch het verkeerde onderdeel? Geen probleem. Wij hanteren een ruimhartig retourbeleid van <strong>30 dagen bedenktijd</strong> — bijna 2x zo lang als de wettelijk verplichte 14 dagen. Onderstaande pagina legt uit hoe het werkt.
      </p>

      <h2>1. Wanneer kun je retour sturen?</h2>
      <ul>
        <li>Binnen <strong>30 dagen</strong> na ontvangst van je bestelling</li>
        <li>Het product is <strong>ongebruikt</strong> en in <strong>originele verpakking</strong></li>
        <li>Eventuele zegels en plastic zijn niet verbroken</li>
        <li>Je hebt de orderbevestiging of factuur paraat</li>
      </ul>

      <h2>2. Uitsluitingen</h2>
      <p>De volgende producten zijn uitgesloten van retour:</p>
      <ul>
        <li>Op maat gemaakte onderdelen of voor jou speciaal besteld bij de fabrikant</li>
        <li>Onderdelen waarvan de verpakking om hygiënische redenen niet geretourneerd kan worden (na openen)</li>
        <li>Producten met sporen van montage of gebruik</li>
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
          <tr><td style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>Bedenktijd / verkeerd besteld</td><td style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>Voor jouw rekening (vanaf €4,95)</td></tr>
          <tr><td style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>Defect / verkeerd geleverd door ons</td><td style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>Gratis (wij sturen retour-label)</td></tr>
          <tr><td style={{ padding: "10px 12px" }}>Garantieclaim binnen periode</td><td style={{ padding: "10px 12px" }}>Gratis</td></tr>
        </tbody>
      </table>

      <h2>5. Wanneer krijg je je geld terug?</h2>
      <p>
        Wij betalen binnen <strong>14 dagen</strong> na ontvangst en goedkeuring van de retour het volledige bedrag terug, inclusief de oorspronkelijke verzendkosten (op het laagste tarief, conform wet). Restitutie gebeurt op dezelfde betaalmethode waarmee je hebt betaald (iDEAL, kaart).
      </p>

      <h2>6. Modelformulier voor herroeping</h2>
      <p>
        Je hoeft het niet te gebruiken (een mail volstaat), maar als je liever het wettelijk modelformulier invult:
      </p>
      <pre style={{ background: "var(--surf-2)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px", fontSize: 12.5, lineHeight: 1.6, color: "var(--text-2)", overflowX: "auto", margin: "12px 0" }}>
{`Aan: WasFix Pro B.V.
   Hoofdstraat 1, 1234 AB Amsterdam
   retour@wasfix.nl

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
      <p style={{ background: "var(--surf-2)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px" }}>
        WasFix Pro B.V.<br />
        T.a.v. Retouren (RMA-nummer op buitenkant)<br />
        Hoofdstraat 1<br />
        1234 AB Amsterdam<br />
        Nederland
      </p>

      <p style={{ marginTop: 32 }}>
        <strong>Vragen?</strong> Mail <a href="mailto:retour@wasfix.nl">retour@wasfix.nl</a> of bekijk de <Link href="/help">help-pagina</Link>.
      </p>
    </LegalPage>
  );
}
