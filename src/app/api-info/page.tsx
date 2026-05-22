import { MarketingLayout } from "@/components/marketing-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Code, Zap, Shield, BarChart } from "lucide-react";

export const metadata = { title: "API toegang" };

export default function ApiPage() {
  return (
    <MarketingLayout>
      <section className="border-b bg-muted/30">
        <div className="container py-12 max-w-3xl">
          <h1 className="font-heading text-3xl md:text-4xl font-bold">WasFix Pro API</h1>
          <p className="text-lg text-muted-foreground mt-3">
            Integreer onze AI diagnose en onderdelen catalogus in je eigen applicatie of werkflow.
          </p>
        </div>
      </section>

      <div className="container py-12 max-w-3xl space-y-6">
        <div className="grid sm:grid-cols-2 gap-4">
          <Card>
            <CardContent className="p-5">
              <Zap className="h-5 w-5 text-primary mb-2" />
              <h3 className="font-heading font-semibold mb-1">Snel</h3>
              <p className="text-sm text-muted-foreground">Diagnose API responstijd onder 2 seconden voor 99% van requests.</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <Shield className="h-5 w-5 text-primary mb-2" />
              <h3 className="font-heading font-semibold mb-1">Veilig</h3>
              <p className="text-sm text-muted-foreground">Bearer token authenticatie, TLS 1.3, AVG-compliant.</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <BarChart className="h-5 w-5 text-primary mb-2" />
              <h3 className="font-heading font-semibold mb-1">Schaalbaar</h3>
              <p className="text-sm text-muted-foreground">Van 1.000 calls/maand tot enterprise volumes met SLA.</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <Code className="h-5 w-5 text-primary mb-2" />
              <h3 className="font-heading font-semibold mb-1">Eenvoudig</h3>
              <p className="text-sm text-muted-foreground">REST/JSON, OpenAPI 3.0 spec, SDKs voor Node, Python, PHP.</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="p-6">
            <h2 className="font-heading text-xl font-semibold mb-3">Voorbeeld: diagnose endpoint</h2>
            <pre className="bg-muted text-xs p-4 rounded-md overflow-x-auto">
{`curl -X POST https://api.wasfixpro.nl/v1/diagnose \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "brand": "Bosch",
    "model": "WAU28T40NL",
    "symptom": "Foutcode E18, water blijft staan"
  }'

# Response:
{
  "diagnosis": {
    "errorCode": "E18",
    "confidence": 87,
    "mainCause": "Verstopte pluizenfilter of afvoerpomp",
    "diyFriendly": true,
    "recommendedAction": "..."
  },
  "recommendedParts": [...],
  "recommendedGuides": [...]
}`}
            </pre>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-primary/5 to-accent/5 border-primary/20">
          <CardContent className="p-6 text-center">
            <h2 className="font-heading text-xl font-bold mb-2">Klaar om te integreren?</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Vanaf €99/maand voor 5.000 calls. Enterprise vanaf €499/maand voor onbeperkt + SLA.
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
