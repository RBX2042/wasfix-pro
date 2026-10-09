import { MarketingLayout } from "@/components/marketing-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Code, Shield, BarChart, Zap } from "lucide-react";
import { PLAN_API_HOURLY_BURST, PLAN_API_MONTHLY_CALLS } from "@/lib/api-auth";
import { PLANS, formatPlanPrice } from "@/lib/plans";
import { apiAccountDailyCalls } from "@/lib/ai-guard";
import { siteUrl } from "@/lib/site-url";

// The docs show the real address of this deployment (NEXT_PUBLIC_APP_URL), not a literal host.
const SITE = siteUrl() ?? "https://JOUW-DOMEIN";

export const metadata = { title: "API toegang" };

const nl = (n: number) => new Intl.NumberFormat("nl-NL").format(n);

// Every figure on this page comes from the code that enforces it (PLAN_API_* in
// src/lib/api-auth.ts, prices from src/lib/plans.ts). Earlier text promised SDKs,
// a spec file, a response time and a separate API host that do not exist.
export default function ApiPage() {
  const pro = PLANS.MONTEUR_PRO;
  const bedrijf = PLANS.BEDRIJF;
  return (
    <MarketingLayout>
      <section className="border-b bg-muted/30">
        <div className="container py-12 max-w-3xl">
          <h1 className="font-heading text-3xl md:text-4xl font-bold">WasFix Pro API</h1>
          <p className="text-lg text-muted-foreground mt-3">
            Haal foutcodes, onderdelen en een AI-indicatie van de storing op in je eigen applicatie of werkflow.
          </p>
        </div>
      </section>

      <div className="container py-12 max-w-3xl space-y-6">
        <div className="grid sm:grid-cols-2 gap-4">
          <Card>
            <CardContent className="p-5">
              <Zap className="h-5 w-5 text-primary mb-2" />
              <h3 className="font-heading font-semibold mb-1">AI-diagnose</h3>
              <p className="text-sm text-muted-foreground">
                De diagnose duurt zolang het AI-model erover doet; reken op enkele seconden en bouw een time-out in. Het antwoord is een indicatie, geen garantie.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <Shield className="h-5 w-5 text-primary mb-2" />
              <h3 className="font-heading font-semibold mb-1">Sleutel per account</h3>
              <p className="text-sm text-muted-foreground">Bearer-sleutel over HTTPS. Je maakt en trekt sleutels in via je account. Een aanroep die mislukt telt niet mee voor je bundel.</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <BarChart className="h-5 w-5 text-primary mb-2" />
              <h3 className="font-heading font-semibold mb-1">Duidelijke limieten</h3>
              <p className="text-sm text-muted-foreground">
                Monteur Pro: {nl(PLAN_API_MONTHLY_CALLS.MONTEUR_PRO)} aanroepen per maand, maximaal {nl(PLAN_API_HOURLY_BURST.MONTEUR_PRO)} per uur.
                Bedrijf: {nl(PLAN_API_MONTHLY_CALLS.BEDRIJF)} per maand, maximaal {nl(PLAN_API_HOURLY_BURST.BEDRIJF)} per uur.
                Voor het diagnose-endpoint geldt daarnaast een dagelijkse grens voor eerlijk gebruik: een twintigste van je maandbundel (minimaal 50), dus {nl(apiAccountDailyCalls(PLAN_API_MONTHLY_CALLS.MONTEUR_PRO))} per dag bij Monteur Pro en {nl(apiAccountDailyCalls(PLAN_API_MONTHLY_CALLS.BEDRIJF))} bij Bedrijf.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <Code className="h-5 w-5 text-primary mb-2" />
              <h3 className="font-heading font-semibold mb-1">REST en JSON</h3>
              <p className="text-sm text-muted-foreground">Gewone HTTP-aanroepen met JSON. Er zijn geen SDK&apos;s of OpenAPI-bestand; de velden staan hieronder.</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="p-6">
            <h2 className="font-heading text-xl font-semibold mb-3">Voorbeeld: diagnose-endpoint</h2>
            <pre className="bg-muted text-xs p-4 rounded-md overflow-x-auto">
{`curl -X POST ${SITE}/api/v1/diagnose \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "brand": "Bosch",
    "model": "WAU28T40NL",
    "errorCode": "E18",
    "symptoms": "Foutcode E18, water blijft staan",
    "language": "nl"
  }'

# Antwoord (structuur; de inhoud komt van het AI-model):
{
  "data": {
    "diagnosis": { "errorCode": "...", "mainCause": "...", "alternativeCauses": [...],
                   "diyFriendly": true, "recommendedAction": "...", "confidence": 0-100 },
    "message": "...",
    "recommendedParts": [{ "sku": "...", "name": "...", "priceEur": 0, "inStock": true, "buyUrl": "..." }],
    "recommendedGuides": [{ "slug": "...", "title": "...", "url": "..." }],
    "notice": "Dit is een indicatie ..."
  },
  "meta": { "version": "v1", "language": "nl", "mode": "ai", "model_used": "<model dat echt draaide>" }
}`}
            </pre>
            <p className="text-xs text-muted-foreground mt-3">
              <code>symptoms</code> en <code>brand</code> zijn verplicht; <code>model</code>, <code>errorCode</code> en <code>language</code> (nl, en, de, fr) zijn optioneel.
              <code> confidence</code> is de eigen inschatting van het model en ontbreekt soms; Dit endpoint is eenmalig: het model wordt gevraagd geen vragen te stellen. Geeft het toch geen gestructureerde diagnose, dan is <code>diagnosis</code> <code>null</code> (lees dan <code>message</code>), staat <code>meta.counted</code> op <code>false</code> en telt de aanroep niet mee.
              Is de AI tijdelijk niet beschikbaar, dan krijg je <code>503</code> (met <code>Retry-After</code>) en wordt de aanroep niet geteld. Verder: <code>401</code> ongeldige sleutel,
              <code> 402</code> account zonder API, <code>403</code> onvoldoende rechten, <code>429</code> uur-, dag- of maandlimiet bereikt, <code>504</code> time-out bij het model.
              Zie ook de <Link href="/api-docs" className="underline">API-documentatie</Link>.
            </p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-primary/5 to-accent/5 border-primary/20">
          <CardContent className="p-6 text-center">
            <h2 className="font-heading text-xl font-bold mb-2">Klaar om te integreren?</h2>
            <p className="text-sm text-muted-foreground mb-4">
              {pro.name} {formatPlanPrice(pro)} per maand excl. btw voor {nl(PLAN_API_MONTHLY_CALLS.MONTEUR_PRO)} aanroepen, {bedrijf.name} {formatPlanPrice(bedrijf)} per maand excl. btw voor {nl(PLAN_API_MONTHLY_CALLS.BEDRIJF)}. Meer volume? Neem contact op.
            </p>
            <Button asChild>
              <Link href="/contact?subject=API">Contact verkoop</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </MarketingLayout>
  );
}
