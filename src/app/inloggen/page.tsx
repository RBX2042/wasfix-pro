import Link from "next/link";
import { SignIn } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Sparkles } from "lucide-react";
import { CLERK_ENABLED } from "@/lib/clerk-flag";
import { isDemoMode } from "@/lib/demo-mode";
import { env } from "@/lib/env";
import { signInTarget } from "@/lib/safe-next";

export const metadata = { title: "Inloggen" };

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

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[]; redirect_url?: string | string[] }> }) {
  const sp = await searchParams;
  // Only a place on this site: the value comes from the address bar and ends up in a link and a redirect.
  const next = signInTarget(sp);

  if (CLERK_ENABLED) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-muted/30 p-4">
        <Brand />
        <SignIn routing="hash" signUpUrl="/registreren" fallbackRedirectUrl={next} />
        <p className="text-center text-sm text-muted-foreground mt-6">
          Nog geen account?{" "}
          <Link href="/registreren" className="text-primary hover:underline">Registreer</Link>
        </p>
      </div>
    );
  }

  // Clerk is not configured. The demo card is for a local demo only: isDemoMode()
  // is false in production whatever the flags say, and there nobody is signed in,
  // so a "you are logged in as demo admin" message would be false and would
  // describe our configuration to strangers.
  if (isDemoMode()) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-muted/30 p-4">
        <Brand />
        <Card className="w-full max-w-md">
          <CardContent className="p-8">
            <h1 className="font-heading text-2xl font-bold text-center mb-2">Welkom terug</h1>
            <p className="text-center text-muted-foreground text-sm mb-6">Log in op je WasFix Pro account</p>

            <div className="rounded-md bg-muted p-4 text-sm text-muted-foreground mb-4">
              <strong>Demo modus:</strong> authenticatie is uitgeschakeld. Je bent automatisch ingelogd als demo-beheerder.
            </div>

            <Button asChild className="w-full" size="lg">
              <Link href={next}>Naar dashboard</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-muted/30 p-4">
      <Brand />
      <Card className="w-full max-w-md">
        <CardContent className="p-8 text-center space-y-4">
          <h1 className="font-heading text-2xl font-bold">Inloggen is tijdelijk niet beschikbaar</h1>
          <p className="text-muted-foreground text-sm">
            We kunnen je nu niet laten inloggen. Probeer het later opnieuw
            {env.COMPANY_EMAIL ? (
              <>
                {" "}of mail ons op <a href={`mailto:${env.COMPANY_EMAIL}`} className="text-primary hover:underline">{env.COMPANY_EMAIL}</a>.
              </>
            ) : (
              <>
                {" "}of neem <Link href="/contact" className="text-primary hover:underline">contact met ons op</Link>.
              </>
            )}
          </p>
          <Button asChild variant="outline"><Link href="/">Terug naar de homepage</Link></Button>
        </CardContent>
      </Card>
    </div>
  );
}
