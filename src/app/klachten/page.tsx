import { LegalPage } from "@/components/redesign/LegalPage";
import Link from "next/link";

export const metadata = {
  title: "Klachtenprocedure · WasFix Pro",
  description: "Hoe dien je een klacht in bij WasFix Pro — Stichting WebwinkelKeur + ODR-platform.",
};

export default function KlachtenPage() {
  return (
    <LegalPage title="Klachten" emphasis="procedure">
      <p>
        Niet tevreden? Vervelend — laten we het oplossen. Wij streven naar 100% klanttevredenheid en nemen iedere klacht serieus. Onderstaande procedure beschrijft hoe je een klacht indient en welke stappen we doorlopen.
      </p>

      <h2>Stap 1 — Neem contact op met ons</h2>
      <p>
        De snelste oplossing is meestal een direct gesprek. Stuur ons een bericht via één van deze kanalen:
      </p>
      <ul>
        <li><strong>E-mail:</strong> <a href="mailto:klachten@wasfix.nl">klachten@wasfix.nl</a> (reactie binnen 24u op werkdagen)</li>
        <li><strong>Telefoon:</strong> 020 123 45 67 (ma-vr 9:00-17:30)</li>
        <li><strong>Formulier:</strong> <Link href="/contact?onderwerp=klacht">contact-pagina</Link></li>
      </ul>
      <p>
        Vermeld in je bericht: bestelnummer, omschrijving van het probleem, gewenste oplossing. Voeg foto&apos;s of bewijsmateriaal toe indien relevant.
      </p>

      <h2>Stap 2 — Onze afhandeling</h2>
      <ol>
        <li>We bevestigen ontvangst binnen <strong>2 werkdagen</strong>.</li>
        <li>We onderzoeken de klacht en komen met een voorstel binnen <strong>14 dagen</strong>.</li>
        <li>Bij complexe klachten kan dit uitlopen naar <strong>maximaal 30 dagen</strong> — in dat geval informeren we je tussentijds.</li>
        <li>Mogelijke oplossingen: vervanging, reparatie, restitutie, korting op volgende bestelling.</li>
      </ol>

      <h2>Stap 3 — Niet tevreden met onze oplossing?</h2>
      <p>
        Als we er samen niet uitkomen, kun je gebruikmaken van onafhankelijke geschillenbeslechting. Wij zijn aangesloten bij:
      </p>

      <h3>Stichting WebwinkelKeur</h3>
      <p style={{ background: "var(--surf-2)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px" }}>
        Stichting WebwinkelKeur biedt bemiddeling bij consumentenklachten over webshops. Hun oordeel is bindend voor ons.<br />
        <a href="https://www.webwinkelkeur.nl/klacht-indienen/" target="_blank" rel="noopener noreferrer">Klacht indienen bij WebwinkelKeur →</a>
      </p>

      <h3>Europese ODR-platform</h3>
      <p style={{ background: "var(--surf-2)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px" }}>
        Voor consumenten binnen de EU is er het online geschillenbeslechtings-platform (ODR) van de Europese Commissie:<br />
        <a href="https://ec.europa.eu/consumers/odr" target="_blank" rel="noopener noreferrer">ec.europa.eu/consumers/odr →</a><br />
        Verwijs naar e-mailadres: klachten@wasfix.nl
      </p>

      <h3>Gang naar de rechter</h3>
      <p>
        Je hebt altijd het recht een geschil voor te leggen aan de bevoegde rechter. Op alle overeenkomsten is Nederlands recht van toepassing. Geschillen worden behandeld door de rechtbank Amsterdam, tenzij de wet anders dwingend voorschrijft.
      </p>

      <h2>Klacht over een AVG-kwestie?</h2>
      <p>
        Heb je een klacht over hoe wij omgaan met persoonsgegevens? Lees ons <Link href="/privacy">privacybeleid</Link>. Je kunt ook contact opnemen met de Autoriteit Persoonsgegevens via <a href="https://autoriteitpersoonsgegevens.nl" target="_blank" rel="noopener noreferrer">autoriteitpersoonsgegevens.nl</a>.
      </p>

      <div className="callout">
        <strong>Onze belofte:</strong> elke klacht wordt persoonlijk behandeld door een mens (geen bot-replies), met als doel binnen 14 dagen een redelijke oplossing te vinden. Wij leren van elke klacht.
      </div>
    </LegalPage>
  );
}
