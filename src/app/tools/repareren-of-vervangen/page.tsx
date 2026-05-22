import { MarketingLayout } from "@/components/marketing-layout";
import RepairOrReplaceCalculator from "@/components/tools/RepairOrReplaceCalculator";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Leaf, Euro, Clock } from "lucide-react";

export const metadata = {
  title: "Repareren of vervangen wasmachine? — Eerlijk advies in 2 minuten",
  description:
    "Twijfelt u of uw wasmachine repareren wel de moeite waard is? Onze gratis calculator geeft eerlijk advies op basis van leeftijd, kosten en energieverbruik. EU Right to Repair compliant.",
  keywords: ["wasmachine repareren of vervangen", "wasmachine kapot vervangen", "is reparatie de moeite waard", "right to repair", "wasmachine economisch"],
  openGraph: {
    title: "Repareren of vervangen? — WasFix Pro Calculator",
    description: "Eerlijk advies in 2 minuten — gebaseerd op leeftijd, kosten en CO₂ impact.",
  },
  alternates: { canonical: "/tools/repareren-of-vervangen" },
};

export default function RepairOrReplacePage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "WasFix Pro Repareren of Vervangen Calculator",
    applicationCategory: "UtilitiesApplication",
    description: "Gratis tool om te bepalen of uw wasmachine repareren of vervangen de slimste keuze is",
    offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
  };

  return (
    <MarketingLayout>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <section className="border-b bg-muted/30">
        <div className="container py-12 max-w-3xl">
          <Badge variant="accent" className="mb-3">
            <Leaf className="h-3 w-3 mr-1" /> Right to Repair tool
          </Badge>
          <h1 className="font-heading text-3xl md:text-5xl font-bold leading-tight">
            Repareren of vervangen?
            <br />
            <span className="text-primary">Eerlijk advies in 2 minuten.</span>
          </h1>
          <p className="text-lg text-muted-foreground mt-4 max-w-2xl">
            Twijfelt u of uw wasmachine de reparatie nog waard is? Onze calculator weegt leeftijd, reparatiekosten,
            energieverbruik en milieu-impact af tot één eerlijk advies. Geen verkoper, geen monteur — gewoon de cijfers.
          </p>
        </div>
      </section>

      <div className="container py-10 max-w-3xl">
        <div className="grid md:grid-cols-3 gap-3 mb-8">
          <Card>
            <CardContent className="p-4 text-center">
              <Euro className="h-5 w-5 text-primary mx-auto mb-1" />
              <p className="font-semibold text-sm">Bespaar geld</p>
              <p className="text-xs text-muted-foreground">Reparatie kost vaak 1/4 van een nieuwe machine</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <Leaf className="h-5 w-5 text-primary mx-auto mb-1" />
              <p className="font-semibold text-sm">Bespaar CO₂</p>
              <p className="text-xs text-muted-foreground">±80kg CO₂ per geredde wasmachine</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <Clock className="h-5 w-5 text-primary mx-auto mb-1" />
              <p className="font-semibold text-sm">Bespaar tijd</p>
              <p className="text-xs text-muted-foreground">Geen weken wachten op nieuwe levering</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="p-6 md:p-8">
            <RepairOrReplaceCalculator />
          </CardContent>
        </Card>

        <div className="mt-12 prose prose-stone max-w-none text-sm text-muted-foreground">
          <h2 className="font-heading text-xl font-bold text-foreground mb-3">Hoe werkt deze calculator?</h2>
          <p>
            We combineren vijf factoren tot één score van 0-100. Boven 60: repareren is de slimste keuze. Tussen 40 en
            60: het is een twijfelgeval. Onder 40: een nieuwe machine loont op de lange termijn.
          </p>
          <ul className="list-disc pl-5 space-y-1 mt-3">
            <li>
              <strong>Leeftijd:</strong> machines van 0-3 jaar repareren altijd, 10+ jaar bijna nooit
            </li>
            <li>
              <strong>Reparatiekosten als % van aankoop:</strong> onder 25% is de moeite waard
            </li>
            <li>
              <strong>Storingsfrequentie:</strong> 3+ storingen in 2 jaar wijst op structureel probleem
            </li>
            <li>
              <strong>Energielabel:</strong> oude C-labels verbruiken €40+/jaar meer dan A+++
            </li>
            <li>
              <strong>Milieu-impact:</strong> CO₂ vermeden door langer gebruik van bestaande machine
            </li>
          </ul>
          <p className="mt-3">
            <strong>EU Right to Repair (2024):</strong> u heeft recht op reparatie tot minimaal 7 jaar na aankoop. Onderdelen
            moeten beschikbaar zijn tot 10 jaar.
          </p>
        </div>
      </div>
    </MarketingLayout>
  );
}
