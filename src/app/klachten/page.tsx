import { COMPLAINT_RESOLUTION_DAYS, SUPPORT_RESPONSE_WORKDAYS } from "@/lib/plans";
import { ContactEmail } from "@/lib/contact-email";
import { LegalPage } from "@/components/redesign/LegalPage";
import Link from "next/link";

export const metadata = {
  title: "Klachtenprocedure",
  description: "Hoe dien je een klacht in bij WasFix Pro — procedure, termijnen en welke stappen je daarna nog hebt.",
  alternates: { canonical: "/klachten" },
};

export default function KlachtenPage() {
  return (
    <LegalPage title="Klachten" emphasis="procedure" lastUpdate="9 oktober 2026" version="2.2">
      <p>
        Niet tevreden? Vervelend — laten we het oplossen. Wij streven naar 100% klanttevredenheid en nemen iedere klacht serieus. Onderstaande procedure beschrijft hoe je een klacht indient en welke stappen we doorlopen.
      </p>

      <h2>Stap 1 — Neem contact op met ons</h2>
      <p>
        De snelste oplossing is meestal een direct gesprek. Stuur ons een e-mail:
      </p>
      <ul>
        <li><strong>E-mail:</strong> <ContactEmail /> (we reageren binnen {SUPPORT_RESPONSE_WORKDAYS} werkdagen)</li>
      </ul>
      <p>
        Vermeld in je bericht: bestelnummer, omschrijving van het probleem, gewenste oplossing. Voeg foto&apos;s of bewijsmateriaal toe indien relevant.
      </p>

      <h2>Stap 2 — Onze afhandeling</h2>
      <ol>
        <li>We reageren binnen <strong>{SUPPORT_RESPONSE_WORKDAYS} werkdagen</strong>.</li>
        <li>We streven ernaar je klacht binnen <strong>{COMPLAINT_RESOLUTION_DAYS} dagen</strong> op te lossen. Duurt het langer, dan informeren we je tussentijds.</li>
        <li>Mogelijke oplossingen: vervanging, reparatie, restitutie, korting op volgende bestelling.</li>
      </ol>

      <h2>Stap 3 — Niet tevreden met onze oplossing?</h2>
      <p>
        Als we er samen niet uitkomen, blijven de volgende routes voor je open.
      </p>

      <h3>Gang naar de rechter</h3>
      <p>
        Je hebt altijd het recht een geschil voor te leggen aan de bevoegde rechter. Op alle overeenkomsten is Nederlands recht van toepassing. Geschillen worden behandeld door de rechtbank Amsterdam, tenzij de wet anders dwingend voorschrijft. Vorderingen tot € 25.000 behandelt de kantonrechter; daar heb je geen advocaat voor nodig.
      </p>

      <h3>Onafhankelijke geschillenbeslechting</h3>
      <p>
        WasFix Pro is op dit moment <strong>niet aangesloten</strong> bij een erkende Geschillencommissie. Wij kunnen een geschil dus niet eenzijdig daarheen doorverwijzen; voorleggen aan een geschilleninstantie kan alleen als wij daar in dat concrete geval samen mee instemmen. Gratis en onafhankelijk advies over je rechten krijg je wel bij <a href="https://www.consuwijzer.nl" target="_blank" rel="noopener noreferrer">ACM ConsuWijzer</a> en <a href="https://www.juridischloket.nl" target="_blank" rel="noopener noreferrer">Het Juridisch Loket</a>.
      </p>
      <p>
        Kom je elders nog een verwijzing tegen naar het Europese ODR-platform van de Europese Commissie: dat platform is opgeheven. Het nam vanaf 20 maart 2025 geen klachten meer aan en is op 20 juli 2025 gesloten (Verordening (EU) 2024/3228). Die route bestaat dus niet meer.
      </p>

      <h2>Klacht over een AVG-kwestie?</h2>
      <p>
        Heb je een klacht over hoe wij omgaan met persoonsgegevens? Lees ons <Link href="/privacy">privacybeleid</Link>. Je kunt ook contact opnemen met de Autoriteit Persoonsgegevens via <a href="https://autoriteitpersoonsgegevens.nl" target="_blank" rel="noopener noreferrer">autoriteitpersoonsgegevens.nl</a>.
      </p>

      <div className="callout">
        <strong>Onze belofte:</strong> elke klacht wordt persoonlijk behandeld door een mens (geen bot-replies), met als doel binnen {COMPLAINT_RESOLUTION_DAYS} dagen een redelijke oplossing te vinden. Wij leren van elke klacht.
      </div>
    </LegalPage>
  );
}
