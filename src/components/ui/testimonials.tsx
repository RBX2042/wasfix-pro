import { Card, CardContent } from "@/components/ui/card";
import { Star } from "lucide-react";

const testimonials = [
  {
    name: "Marieke V.",
    city: "Rotterdam",
    text: "Mijn Bosch gaf F21. Via WasFix Pro wist ik in 2 minuten dat het filter verstopt was. Zelf opgelost, geen monteur nodig.",
    rating: 5,
    plan: "Particulier",
    saved: "€280",
  },
  {
    name: "Thomas B.",
    city: "Amsterdam",
    text: "Als ZZP-monteur gebruik ik het dashboard dagelijks. De technische database is echt compleet — alle Miele en Bosch codes erin.",
    rating: 5,
    plan: "Monteur Pro",
    saved: null,
  },
  {
    name: "Sandra K.",
    city: "Utrecht",
    text: "Foto van de foutcode, direct diagnose. Zo simpel. Onderdeel besteld, morgen geleverd. Beter dan Coolblue.",
    rating: 5,
    plan: "Gratis",
    saved: "€89",
  },
  {
    name: "Erik de V.",
    city: "Den Haag",
    text: "Dacht dat mijn Miele kapot was. WasFix zei: koolborstels. €10 aan onderdelen, 45 minuten werk. Wasmachine is gered.",
    rating: 5,
    plan: "Particulier",
    saved: "€400",
  },
  {
    name: "Linda M.",
    city: "Eindhoven",
    text: "De repareren-of-vervangen calculator gaf eerlijk advies: repareren. Beste beslissing van het jaar. Geen nieuwe machine nodig.",
    rating: 4,
    plan: "Gratis",
    saved: "€600",
  },
  {
    name: "Pieter W.",
    city: "Groningen",
    text: "Mijn wasmachinebedrijf gebruikt de B2B API. Klanten bellen minder, we sturen ze eerst naar WasFix Pro voor pre-diagnose.",
    rating: 5,
    plan: "Bedrijf",
    saved: null,
  },
];

export function Testimonials() {
  return (
    <section className="border-t bg-muted/30">
      <div className="container py-20">
        <div className="text-center mb-12">
          <p className="text-sm font-medium text-primary uppercase tracking-wider mb-2">Klanten besparen</p>
          <h2 className="font-heading text-3xl md:text-4xl font-bold">Echte verhalen, echte besparing</h2>
          <div className="flex items-center justify-center gap-2 mt-3 text-sm text-muted-foreground">
            <div className="flex items-center text-amber-500">
              {[...Array(5)].map((_, i) => (
                <Star key={i} className="h-4 w-4 fill-current" />
              ))}
            </div>
            <span>4.8/5 — gebaseerd op 1.247 reviews</span>
          </div>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {testimonials.map((t, i) => (
            <Card key={i} className="hover:shadow-md transition-shadow">
              <CardContent className="p-6 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1 text-amber-500">
                    {Array.from({ length: t.rating }).map((_, j) => (
                      <Star key={j} className="h-3.5 w-3.5 fill-current" />
                    ))}
                  </div>
                  {t.saved && (
                    <span className="text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                      {t.saved} bespaard
                    </span>
                  )}
                </div>
                <p className="text-sm leading-relaxed">&ldquo;{t.text}&rdquo;</p>
                <div className="flex items-center justify-between pt-2 border-t">
                  <div>
                    <p className="text-sm font-medium">{t.name}</p>
                    <p className="text-xs text-muted-foreground">{t.city}</p>
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded-full border text-muted-foreground">{t.plan}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
