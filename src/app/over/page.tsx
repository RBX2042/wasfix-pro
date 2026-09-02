import { MarketingLayout } from "@/components/marketing-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Sparkles, Recycle, Users, Award } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { catalogStats, formatCount } from "@/lib/catalog-stats";

const STATS = catalogStats();

export const metadata = { title: "Over WasFix Pro" };

export default function OverPage() {
  return (
    <MarketingLayout>
      <section className="border-b">
        <div className="container py-16 max-w-3xl">
          <h1 className="font-heading text-3xl md:text-5xl font-bold">Onze missie</h1>
          <p className="text-lg text-muted-foreground mt-4">
            Een wasmachine reparatie hoort €30 te kosten, niet €180. We bouwen aan een Europa waarin elektrische apparaten weer gerepareerd worden in plaats van weggegooid.
          </p>
        </div>
      </section>

      <div className="container py-12 max-w-3xl">
        <div className="grid sm:grid-cols-2 gap-4 mb-12">
          <ValueCard icon={<Sparkles className="h-5 w-5" />} title="AI gestuurd" text="We trainen modellen op duizenden reparaties zodat jij in 2 minuten weet wat er aan de hand is." />
          <ValueCard icon={<Recycle className="h-5 w-5" />} title="Duurzaam" text="Elke reparatie voorkomt 70kg CO₂ uitstoot vergeleken met vervanging. Goed voor portemonnee én planeet." />
          <ValueCard icon={<Users className="h-5 w-5" />} title="Voor iedereen" text="Van particulier tot zelfstandige monteur tot reparatiebedrijf — we bouwen tools voor de hele keten." />
          <ValueCard icon={<Award className="h-5 w-5" />} title="Originele kwaliteit" text="We werken alleen met originele onderdelen of OEM-equivalenten van gecertificeerde fabrikanten." />
        </div>

        <Card className="bg-primary/5">
          <CardContent className="p-8">
            <h2 className="font-heading text-2xl font-bold mb-3">Wat er in het platform zit</h2>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="font-heading text-3xl font-bold text-primary">{formatCount(STATS.errorCodes)}</p>
                <p className="text-xs text-muted-foreground">foutcodes met oorzaak en oplossing</p>
              </div>
              <div>
                <p className="font-heading text-3xl font-bold text-primary">{formatCount(STATS.guides)}</p>
                <p className="text-xs text-muted-foreground">stap-voor-stap reparatiegidsen</p>
              </div>
              <div>
                <p className="font-heading text-3xl font-bold text-primary">{formatCount(STATS.partsInStock)}</p>
                <p className="text-xs text-muted-foreground">onderdelen op voorraad</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-4">
              Cijfers over gebruik — aantal diagnoses, bespaard bedrag, vermeden CO₂ — publiceren we pas
              wanneer we ze echt gemeten hebben.
            </p>
          </CardContent>
        </Card>

        <div className="text-center mt-12">
          <h2 className="font-heading text-xl font-bold mb-3">Klaar om mee te doen?</h2>
          <Button asChild size="lg"><Link href="/diagnose">Start een gratis diagnose</Link></Button>
        </div>
      </div>
    </MarketingLayout>
  );
}

function ValueCard({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center text-primary mb-2">{icon}</div>
        <h3 className="font-heading font-semibold mb-1">{title}</h3>
        <p className="text-sm text-muted-foreground">{text}</p>
      </CardContent>
    </Card>
  );
}
