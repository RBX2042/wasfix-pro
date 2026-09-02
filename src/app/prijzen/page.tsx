import { MarketingLayout } from "@/components/marketing-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { CheckCircle2, X, Sparkles } from "lucide-react";
import { PLANS, PLAN_ORDER, formatPlanPrice, planPriceSuffix } from "@/lib/plans";

export const metadata = {
  title: "Prijzen — Gratis tot €29/mnd · WasFix Pro abonnementen",
  description: "Gratis, Particulier €4,99/mnd of Monteur Pro €29/mnd. Onbeperkte AI-diagnoses, kortingen op onderdelen, API. 14 dagen gratis proefperiode.",
  alternates: { canonical: "/prijzen" },
};

const PRICING_JSONLD = PLAN_ORDER.filter((id) => PLANS[id].priceCents > 0).map((id) => {
  const plan = PLANS[id];
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: `WasFix Pro ${plan.name}`,
    applicationCategory: plan.audience === "business" ? "BusinessApplication" : "UtilitiesApplication",
    operatingSystem: "Web",
    offers: {
      "@type": "Offer",
      price: (plan.priceCents / 100).toFixed(2),
      priceCurrency: "EUR",
      availability: "https://schema.org/InStock",
      url: `https://wasfix.nl/upgrade?plan=${plan.id}`,
    },
  };
});

const FREE_MISSING = ["Premium reparatiegidsen", "Korting op onderdelen", "Prioriteit support"];

const TIERS = PLAN_ORDER.map((id) => {
  const plan = PLANS[id];
  return {
    id,
    name: plan.name,
    price: formatPlanPrice(plan),
    period: planPriceSuffix(plan),
    description: plan.tagline,
    highlight: plan.highlight ?? false,
    trialDays: plan.trialDays,
    cta: plan.priceCents === 0 ? "Probeer gratis" : `Word ${plan.name}`,
    href: plan.priceCents === 0 ? "/diagnose" : `/upgrade?plan=${plan.id}`,
    features: [
      ...plan.features.map((text) => ({ included: true, text })),
      ...(plan.id === "FREE" ? FREE_MISSING.map((text) => ({ included: false, text })) : []),
    ],
  };
});

export default function PrijzenPage() {
  return (
    <MarketingLayout>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(PRICING_JSONLD) }} />
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
          {TIERS.map((plan) => (
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
                    <span className="text-muted-foreground ml-1.5 text-xs">{plan.period}</span>
                  </div>
                  {plan.trialDays > 0 && (
                    <p className="text-xs text-primary mt-1.5">Eerste {plan.trialDays} dagen gratis</p>
                  )}
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
            <Faq q="Is er een setup fee?" a="Nee. Elk plan is direct online af te sluiten en maandelijks opzegbaar, zonder setup fee. Voor meer dan 20 gebruikers of maatwerk maken we een offerte." />
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
