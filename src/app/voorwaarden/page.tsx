import { MarketingLayout } from "@/components/marketing-layout";

export const metadata = { title: "Algemene voorwaarden" };

export default function VoorwaardenPage() {
  return (
    <MarketingLayout>
      <div className="container py-12 max-w-3xl">
        <h1 className="font-heading text-3xl md:text-4xl font-bold mb-2">Algemene voorwaarden</h1>
        <p className="text-muted-foreground mb-8">Laatste update: april 2026</p>

        <div className="space-y-6 text-sm leading-relaxed">
          <section>
            <h2 className="font-heading text-xl font-semibold mb-2">1. Definities</h2>
            <p>WasFix Pro: WasFix Pro B.V., gevestigd in Amsterdam (KvK 12345678). Gebruiker: iedere natuurlijke persoon of rechtspersoon die gebruikmaakt van onze diensten.</p>
          </section>

          <section>
            <h2 className="font-heading text-xl font-semibold mb-2">2. Toepasselijkheid</h2>
            <p>Deze voorwaarden zijn van toepassing op alle aanbiedingen, overeenkomsten en leveringen van WasFix Pro, tenzij schriftelijk anders is overeengekomen.</p>
          </section>

          <section>
            <h2 className="font-heading text-xl font-semibold mb-2">3. Gebruik van de diensten</h2>
            <p>De AI-diagnose dient als hulpmiddel en biedt geen garantie op een sluitende oplossing. WasFix Pro is niet aansprakelijk voor schade die ontstaat door zelf uitgevoerde reparaties op basis van de gegeven adviezen.</p>
          </section>

          <section>
            <h2 className="font-heading text-xl font-semibold mb-2">4. Abonnementen</h2>
            <p>Abonnementen worden maandelijks vooruitbetaald. Opzeggen is mogelijk per de eerstvolgende factuurdatum. Bij opzegging behoud je toegang tot het einde van de betaalde periode.</p>
          </section>

          <section>
            <h2 className="font-heading text-xl font-semibold mb-2">5. Levering & retour</h2>
            <p>Onderdelen worden binnen 1-2 werkdagen geleverd in Nederland. Je hebt 30 dagen herroepingsrecht voor onbeschadigde producten in originele verpakking. Verzendkosten retour zijn voor de gebruiker, tenzij het product defect is.</p>
          </section>

          <section>
            <h2 className="font-heading text-xl font-semibold mb-2">6. Garantie</h2>
            <p>Op alle onderdelen geldt de wettelijke garantie. Veelvoorkomende onderdelen hebben minimaal 2 jaar fabrieksgarantie.</p>
          </section>

          <section>
            <h2 className="font-heading text-xl font-semibold mb-2">7. Aansprakelijkheid</h2>
            <p>Onze aansprakelijkheid is beperkt tot het bedrag dat je voor de betreffende dienst of product hebt betaald. Wij zijn niet aansprakelijk voor indirecte schade.</p>
          </section>

          <section>
            <h2 className="font-heading text-xl font-semibold mb-2">8. Wijzigingen</h2>
            <p>WasFix Pro kan deze voorwaarden wijzigen. Wezenlijke wijzigingen worden minimaal 30 dagen van tevoren gecommuniceerd via e-mail of de website.</p>
          </section>

          <section>
            <h2 className="font-heading text-xl font-semibold mb-2">9. Toepasselijk recht</h2>
            <p>Op alle overeenkomsten is Nederlands recht van toepassing. Geschillen worden voorgelegd aan de bevoegde rechter te Amsterdam.</p>
          </section>
        </div>
      </div>
    </MarketingLayout>
  );
}
