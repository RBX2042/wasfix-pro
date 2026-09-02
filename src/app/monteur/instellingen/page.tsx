import { DashboardLayout } from "@/components/dashboard-layout";
import { getCurrentUser, hasProAccess } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isDatabaseConfigured } from "@/lib/env";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { redirect } from "next/navigation";
import Link from "next/link";
import { MonteurProfileForm, type ProfileValues } from "./profile-form";
import { profileGaps } from "@/lib/monteur-invoicing";

export const dynamic = "force-dynamic";
export const metadata = { title: "Bedrijfsgegevens — Monteur" };

export default async function MonteurSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/inloggen?next=/monteur/instellingen");

  if (!hasProAccess(user)) {
    return (
      <DashboardLayout role={user.role}>
        <Card>
          <CardContent className="p-12 text-center">
            <h2 className="font-heading text-xl font-bold mb-2">Monteur Pro vereist</h2>
            <p className="text-muted-foreground mb-4">Facturen maken vanaf je werkorders hoort bij Monteur Pro.</p>
            <Button asChild><Link href="/upgrade?plan=MONTEUR_PRO">Bekijk Monteur Pro</Link></Button>
          </CardContent>
        </Card>
      </DashboardLayout>
    );
  }

  let values: ProfileValues = {};
  if (isDatabaseConfigured()) {
    const profile = await prisma.monteurProfile.findUnique({ where: { userId: user.id } }).catch(() => null);
    if (profile) values = profile;
  }
  const missing = profileGaps(values as { companyName?: string | null });

  return (
    <DashboardLayout role={user.role}>
      <div className="mb-6">
        <Badge variant="accent" className="mb-2">Monteur Pro</Badge>
        <h1 className="font-heading text-2xl font-bold">Bedrijfsgegevens</h1>
        <p className="text-muted-foreground text-sm">
          Deze gegevens komen op de facturen die jij naar je eigen klanten stuurt. WasFix staat er niet op —
          jij bent de verkoper.
        </p>
      </div>

      {!isDatabaseConfigured() ? (
        <Card className="mb-6 border-amber-500/40">
          <CardContent className="p-4 text-sm">
            Zonder database kunnen bedrijfsgegevens niet worden opgeslagen. Stel <code>DATABASE_URL</code> in.
          </CardContent>
        </Card>
      ) : missing.length > 0 ? (
        <Card className="mb-6 border-amber-500/40 bg-amber-50 dark:bg-amber-950/30">
          <CardContent className="p-4 text-sm">
            <p className="font-medium mb-1">Nog niet compleet</p>
            <p className="text-muted-foreground">
              Een geldige factuur heeft minimaal je {missing.join(", ")} nodig. Zolang dat ontbreekt kun je
              geen factuur maken vanaf een werkorder.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="mb-6 border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/30">
          <CardContent className="p-4 text-sm">
            Je gegevens zijn compleet. Bij elke werkorder met een bedrag kun je nu een factuur maken.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-6">
          <MonteurProfileForm values={values} />
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground mt-4">
        Facturen krijgen een doorlopende nummering in je eigen reeks (bijvoorbeeld 2026-0001). De
        Belastingdienst vereist dat die reeks geen gaten heeft, dus nummers worden pas toegekend als je
        de factuur daadwerkelijk aanmaakt.
      </p>
    </DashboardLayout>
  );
}
