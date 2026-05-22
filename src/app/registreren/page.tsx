import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Sparkles } from "lucide-react";

export const metadata = { title: "Registreren" };

export default function RegisterPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-muted/30 p-4">
      <Link href="/" className="flex items-center gap-2 font-heading font-bold text-xl mb-8">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Sparkles className="h-4 w-4" />
        </span>
        WasFix<span className="text-accent">Pro</span>
      </Link>

      <Card className="w-full max-w-md">
        <CardContent className="p-8">
          <h1 className="font-heading text-2xl font-bold text-center mb-2">Maak je account</h1>
          <p className="text-center text-muted-foreground text-sm mb-6">Krijg 3 gratis diagnoses per maand</p>

          <div className="rounded-md bg-muted p-4 text-sm text-muted-foreground mb-4">
            <strong>Demo modus:</strong> Voor lokale demo bent je automatisch ingelogd als demo gebruiker.
          </div>

          <Button asChild className="w-full" size="lg">
            <Link href="/dashboard">Doorgaan naar dashboard</Link>
          </Button>

          <p className="text-center text-sm text-muted-foreground mt-6">
            Al een account?{" "}
            <Link href="/inloggen" className="text-primary hover:underline">Inloggen</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
