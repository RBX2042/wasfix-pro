import { MarketingLayout } from "@/components/marketing-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { CheckCircle2, X, Sparkles } from "lucide-react";

export const metadata = { title: "Prijzen — WasFix Pro abonnementen" };

const PLANS = [
  {
    name: "Gratis",
    price: "€0",
    period: "voor altijd",
    description: "Ideaal om te proeven",
    cta: "Probeer gratis",
    href: "/diagnose",
    features: [
      { included: true, text: "3 AI diagnoses per maand" },
      { included: true, text: "Basis foutcode database" },
      { included: true, text: "Toegang tot gratis gidsen" },
      { included: false, text: "Premium reparatiegidsen" },
      { included: false, text: "Korting op onderdelen" },
      { included: false, text: "Prioriteit support" },
    ],
  },
  {
    name: "Particulier",
    price: "€4,99",
    period: "/maand",
    description: "Voor de slimme klusser",
    highlight: true,
    cta: "Word Particulier",
    href: "/upgrade?plan=PARTICULIER",
    features: [
      { included: true, text: "Onbeperkte AI diagnoses" },
      { included: true, text: "Volledige foutcode database" },
      { included: true, text: "Alle premium gidsen (incl. video)" },
      { included: true, text: "5% korting op alle onderdelen" },
      { included: true, text: "Diagnoses geschiedenis" },
      { included: true, text: "Prioriteit e-mail support" },
    ],
  },
  {
    name: "Monteur Pro",
    price: "€29",
    period: "/maand",
    description: "Voor zelfstandige monteurs",
    cta: "Voor monteurs",
    href: "/upgrade?plan=MONTEUR_PRO",
    features: [
      { included: true, text: "Alles in Particulier" },
      { included: true, text: "10% korting onderdelen" },
      { included: true, text: "Klanten dashboard" },
      { included: true, text: "Werkorder management" },
      { included: true, text: "Bulk parts ordering" },
      { included: true, text: "API toegang (1000 calls/mnd)" },
    ],
  },
  {
    name: "Bedrijf",
    price: "€199",
    period: "/maand",
    description: "Voor reparatiebedrijven",
    cta: "Contact verkoop",
    href: "/contact?plan=BEDRIJF",
    features: [
      { included: true, text: "Alles in Monteur Pro" },
      { included: true, text: "Tot 20 gebruikers" },
      { included: true, text: "15% korting onderdelen" },
      { included: true, text: "White-label optie" },
      { included: true, text: "Dedicated account manager" },
      { included: true, text: "Onbeperkte API calls" },
    ],
  },
];

export default function PrijzenPage() {
  return (
    <MarketingLayout>
      <section className="border-b">
        <div className="container py-16 text-center">
          <Badge variant="secondary" className="mb-3"><Sparkles className="h-3 w-3 mr-1" /> Tarieven</Badge>
          <h1 className="font-heading text-3xl md:text-5xl font-bold">Het juiste plan voor jou</h1>
          <p className="text-lg text-muted-foreground mt-3 max-w-2xl mx-auto">
            Begin gratis, upgrade wanneer je meer nodig hebt. Geen verborgen kosten, opzeggen wanneer je wilt.
          </p>
        </div>
      </section>

      <div className="container py-12">
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {PLANS.map((plan) => (
            <Card key={plan.name} className={plan.highlight ? "border-primary border-2 relative shadow-xl" : ""}>
              {plan.highlight && (
                <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">Meest gekozen</Badge>
              )}
              <CardContent className="p-6 space-y-5 h-full flex flex-col">
                <div>
                  <h3 className="font-heading font-bold text-xl">{plan.name}</h3>
                  <p className="text-sm text-muted-foreground">{plan.description}</p>
                  <div className="flex items-baseline mt-3">
                    <span className="font-heading text-4xl font-bold">{plan.price}</span>
                    <span className="text-muted-foreground ml-1.5 text-sm">{plan.period}</span>
                  </div>
                </div>

                <ul className="space-y-2.5 flex-1">
                  {plan.features.map((f, i) => (
                    <li key={i} className={`flex items-start gap-2 text-sm ${!f.included ? "text-muted-foreground" : ""}`}>
                      {f.included ? (
                        <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                      ) : (
                        <X className="h-4 w-4 text-muted-foreground/50 mt-0.5 shrink-0" />
                      )}
                      <span>{f.text}</span>
                    </li>
                  ))}
                </ul>

                <Button asChild className="w-full" variant={plan.highlight ? "default" : "outline"}>
                  <Link href={plan.href}>{plan.cta}</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="mt-16 max-w-2xl mx-auto">
          <h2 className="font-heading text-2xl font-bold text-center mb-8">Veelgestelde vragen</h2>
          <div className="space-y-4">
            <Faq q="Kan ik op elk moment opzeggen?" a="Ja, opzeggen kan maandelijks zonder vragen. Je behoudt toegang tot het einde van je betaalperiode." />
            <Faq q="Hoe werkt de korting op onderdelen?" a="Particulier krijgt 5% korting, Monteur Pro 10%, Bedrijf 15%. De korting wordt automatisch toegepast in je winkelmand." />
            <Faq q="Welke betaalmethoden zijn er?" a="iDEAL, creditcard (Visa, Mastercard, Amex), Bancontact. Voor zakelijke klanten ook factuur." />
            <Faq q="Is er een setup fee?" a="Nee, geen setup fee voor Particulier en Monteur Pro. Voor Bedrijf neem je contact op voor een offerte op maat." />
          </div>
        </div>
      </div>
    </MarketingLayout>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <Card>
      <CardContent className="p-5">
        <h3 className="font-semibold mb-1">{q}</h3>
        <p className="text-sm text-muted-foreground">{a}</p>
      </CardContent>
    </Card>
  );
}
