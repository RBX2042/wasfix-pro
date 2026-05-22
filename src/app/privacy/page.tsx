import { MarketingLayout } from "@/components/marketing-layout";

export const metadata = { title: "Privacybeleid" };

export default function PrivacyPage() {
  return (
    <MarketingLayout>
      <div className="container py-12 max-w-3xl prose prose-stone">
        <h1 className="font-heading text-3xl md:text-4xl font-bold mb-2">Privacybeleid</h1>
        <p className="text-muted-foreground mb-8">Laatste update: april 2026</p>

        <div className="space-y-6 text-sm leading-relaxed">
          <section>
            <h2 className="font-heading text-xl font-semibold mb-2">1. Wie zijn wij</h2>
            <p>WasFix Pro B.V. (Hoofdstraat 1, 1234 AB Amsterdam, KvK 12345678) is verantwoordelijk voor de verwerking van persoonsgegevens zoals beschreven in dit beleid.</p>
          </section>

          <section>
            <h2 className="font-heading text-xl font-semibold mb-2">2. Welke gegevens verzamelen we</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Account:</strong> naam, e-mailadres bij registratie</li>
              <li><strong>Diagnose:</strong> wasmachine merk/model, beschreven symptomen, chatgeschiedenis (tijdelijk)</li>
              <li><strong>Bestelling:</strong> verzendadres, betaalgegevens (verwerkt door Stripe)</li>
              <li><strong>Gebruik:</strong> apparaat info, browser, sessie data (analytics)</li>
            </ul>
          </section>

          <section>
            <h2 className="font-heading text-xl font-semibold mb-2">3. Waarvoor gebruiken we deze gegevens</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>Het leveren en verbeteren van onze diagnose service</li>
              <li>Het verwerken van bestellingen en abonnementen</li>
              <li>Klantondersteuning</li>
              <li>Wettelijke verplichtingen (boekhouding, BTW)</li>
            </ul>
          </section>

          <section>
            <h2 className="font-heading text-xl font-semibold mb-2">4. Met wie delen we gegevens</h2>
            <p>Met onze verwerkers: Stripe (betalingen), Supabase (hosting database), Resend (e-mail), Google (Gemini AI diagnoses — geanonimiseerd). Deze partijen zijn AVG-compliant en hebben verwerkersovereenkomsten.</p>
          </section>

          <section>
            <h2 className="font-heading text-xl font-semibold mb-2">5. Hoe lang bewaren we gegevens</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>Account data: zolang account actief is</li>
              <li>Diagnoses: 12 maanden, daarna geanonimiseerd</li>
              <li>Bestellingen: 7 jaar (wettelijke verplichting)</li>
              <li>Marketing data: tot je je uitschrijft</li>
            </ul>
          </section>

          <section>
            <h2 className="font-heading text-xl font-semibold mb-2">6. Jouw rechten</h2>
            <p>Je hebt het recht om je gegevens in te zien, te corrigeren, te laten verwijderen of over te dragen. Stuur een verzoek naar <a href="mailto:privacy@wasfix.nl" className="text-primary underline">privacy@wasfix.nl</a>.</p>
          </section>

          <section>
            <h2 className="font-heading text-xl font-semibold mb-2">7. Cookies</h2>
            <p>We gebruiken alleen essentiële cookies voor het functioneren van de website (sessie, winkelmand). Geen tracking cookies zonder toestemming.</p>
          </section>

          <section>
            <h2 className="font-heading text-xl font-semibold mb-2">8. Klachten</h2>
            <p>Klachten over de verwerking kun je indienen bij de Autoriteit Persoonsgegevens (autoriteitpersoonsgegevens.nl).</p>
          </section>
        </div>
      </div>
    </MarketingLayout>
  );
}
