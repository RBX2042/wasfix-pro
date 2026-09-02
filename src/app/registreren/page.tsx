import Link from "next/link";
import { SignUp } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Sparkles } from "lucide-react";
import { CLERK_ENABLED } from "@/lib/clerk-flag";

export const metadata = { title: "Registreren" };

const PLAN_REDIRECT: Record<string, string> = {
  particulier: "/upgrade?plan=PARTICULIER",
  monteur_pro: "/upgrade?plan=MONTEUR_PRO",
  bedrijf: "/upgrade?plan=BEDRIJF",
};

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2 font-heading font-bold text-xl mb-8">
      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <Sparkles className="h-4 w-4" />
      </span>
      WasFix<span className="text-accent">Pro</span>
    </Link>
  );
}

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ plan?: string; next?: string }> }) {
  const sp = await searchParams;
  const next = sp.next ?? PLAN_REDIRECT[(sp.plan ?? "").toLowerCase()] ?? "/dashboard";

  if (CLERK_ENABLED) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-muted/30 p-4">
        <Brand />
        <SignUp routing="hash" signInUrl="/inloggen" fallbackRedirectUrl={next} />
        <p className="text-center text-sm text-muted-foreground mt-6">
          Al een account?{" "}
          <Link href="/inloggen" className="text-primary hover:underline">Inloggen</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-muted/30 p-4">
      <Brand />
      <Card className="w-full max-w-md">
        <CardContent className="p-8">
          <h1 className="font-heading text-2xl font-bold text-center mb-2">Maak je account</h1>
          <p className="text-center text-muted-foreground text-sm mb-6">Krijg 3 gratis diagnoses per maand</p>

          <div className="rounded-md bg-muted p-4 text-sm text-muted-foreground mb-4">
            <strong>Demo modus:</strong> je bent automatisch ingelogd als demo-gebruiker. Registratie wordt actief zodra Clerk is geconfigureerd.
          </div>

          <Button asChild className="w-full" size="lg">
            <Link href={next}>Doorgaan naar dashboard</Link>
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
