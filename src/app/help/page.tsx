import { MarketingLayout } from "@/components/marketing-layout";
import { Card, CardContent } from "@/components/ui/card";
import Link from "next/link";
import { Sparkles, Wrench, ShoppingCart, CreditCard, Mail } from "lucide-react";

export const metadata = { title: "Helpcentrum" };

const TOPICS = [
  { icon: Sparkles, title: "AI Diagnose", text: "Hoe werkt de AI diagnose? Wat als ik geen foutcode heb?", href: "/diagnose" },
  { icon: Wrench, title: "Reparatie", text: "Welke reparaties kun je zelf doen? Wat als ik er niet uitkom?", href: "/gidsen" },
  { icon: ShoppingCart, title: "Onderdelen", text: "Hoe weet ik welk onderdeel ik nodig heb? Levertijden en retourneren.", href: "/onderdelen" },
  { icon: CreditCard, title: "Abonnement", text: "Verschil tussen plannen, opzeggen, factuur info.", href: "/prijzen" },
];

export default function HelpPage() {
  return (
    <MarketingLayout>
      <section className="border-b bg-muted/30">
        <div className="container py-12">
          <h1 className="font-heading text-3xl md:text-4xl font-bold">Helpcentrum</h1>
          <p className="text-muted-foreground mt-2 max-w-2xl">
            Antwoorden op de meest gestelde vragen. Niet gevonden wat je zocht? <Link href="/contact" className="text-primary hover:underline">Neem contact op</Link>.
          </p>
        </div>
      </section>

      <div className="container py-8">
        <div className="grid md:grid-cols-2 gap-6 mb-12">
          {TOPICS.map((t) => (
            <Link key={t.href} href={t.href}>
              <Card className="hover:border-primary transition-colors h-full">
                <CardContent className="p-6">
                  <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center text-primary mb-3">
                    <t.icon className="h-5 w-5" />
                  </div>
                  <h2 className="font-heading text-lg font-semibold mb-1">{t.title}</h2>
                  <p className="text-sm text-muted-foreground">{t.text}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        <Card>
          <CardContent className="p-6">
            <h2 className="font-heading text-xl font-semibold mb-3">Veelgestelde vragen</h2>
            <div className="space-y-4">
              <Faq q="Hoe werkt de AI diagnose?" a="Beschrijf je wasmachine merk, model en symptoom. Onze AI zoekt in een database van duizenden gevallen naar de meest waarschijnlijke oorzaak en stelt eventueel verduidelijkende vragen." />
              <Faq q="Wat is de levertijd van onderdelen?" a="Voor 22:00 besteld is morgen in huis (Nederland). Voor België 1-2 werkdagen. Verzending is gratis vanaf €50." />
              <Faq q="Kan ik een onderdeel retourneren?" a="Ja, binnen 30 dagen onbeschadigd terugsturen. We betalen het aankoopbedrag terug." />
              <Faq q="Werkt het ook voor andere merken?" a="We ondersteunen 10+ grote merken inclusief Miele, Bosch, Samsung, LG, AEG, Whirlpool, Electrolux, Beko, Indesit en Siemens." />
              <Faq q="Is mijn data veilig?" a="Ja. We slaan alleen het minimale op (e-mail, naam, adres voor verzending). Diagnose data is geanonimiseerd voor model verbetering." />
            </div>
          </CardContent>
        </Card>

        <div className="mt-8 text-center">
          <p className="text-muted-foreground mb-3">Vraag niet gevonden?</p>
          <Link href="/contact" className="inline-flex items-center gap-2 text-primary hover:underline">
            <Mail className="h-4 w-4" /> Stuur ons een bericht
          </Link>
        </div>
      </div>
    </MarketingLayout>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <details className="rounded-md border p-4">
      <summary className="font-medium cursor-pointer">{q}</summary>
      <p className="text-sm text-muted-foreground mt-2">{a}</p>
    </details>
  );
}
