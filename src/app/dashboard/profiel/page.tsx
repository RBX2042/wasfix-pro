import { DashboardLayout } from "@/components/dashboard-layout";
import { getCurrentUser, getPlanLimits, planDisplayName } from "@/lib/auth";
import { SubscriptionBanner } from "../subscription-banner";
import { supportEmail } from "@/lib/support-contact";
import { bannerFor } from "../banner-data";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { redirect } from "next/navigation";
import Link from "next/link";
import { User, CreditCard, Sparkles, Crown, Download } from "lucide-react";
import { PortalButton } from "./portal-button";
import { DeleteAccountButton } from "./delete-account";

export const dynamic = "force-dynamic";

export const metadata = { title: "Profiel" };

export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/inloggen");

  const limits = getPlanLimits(user);
  const planName = planDisplayName(user.plan);
  const banner = bannerFor(user);
  const trialing = user.subscriptionStatus === "trialing";
  const dateText = (d: Date | null | undefined) =>
    d ? new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" }).format(d) : null;
  const periodEnd = dateText(user.currentPeriodEnd);
  const ROLE_LABEL: Record<string, string> = { CONSUMER: "Klant", TECHNICIAN: "Monteur", BUSINESS: "Bedrijf", ADMIN: "Beheerder" };

  return (
    <DashboardLayout role={user.role}>
      <h1 className="font-heading text-2xl font-bold mb-6">Profiel & abonnement</h1>
      {banner && <div className="mb-6"><SubscriptionBanner notice={banner} supportEmail={supportEmail()} /></div>}

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardContent className="p-6">
            <h2 className="font-heading text-lg font-semibold mb-4 flex items-center gap-2">
              <User className="h-4 w-4" /> Persoonlijke gegevens
            </h2>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">Naam</dt><dd className="font-medium">{user.name}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">E-mail</dt><dd className="font-medium">{user.email || "nog niet bevestigd"}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Rol</dt><dd><Badge variant="outline">{ROLE_LABEL[user.role] ?? user.role}</Badge></dd></div>
            </dl>
            <div className="mt-5 flex flex-col items-start">
              <Button asChild variant="outline" size="sm">
                <a href="/api/account/data-export" download><Download className="h-4 w-4" /> Download mijn gegevens (AVG)</a>
              </Button>
              <DeleteAccountButton />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <h2 className="font-heading text-lg font-semibold mb-4 flex items-center gap-2">
              <CreditCard className="h-4 w-4" /> Abonnement
            </h2>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Huidig plan</span>
                <Badge variant="accent" className="gap-1">
                  {user.plan !== "FREE" && <Crown className="h-3 w-3" />}
                  {planName}
                </Badge>
              </div>
              {user.plan !== "FREE" && periodEnd && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{trialing ? "Eerste betaling" : user.cancelAtPeriodEnd ? "Loopt af op" : "Volgende verlenging"}</span>
                  <span>{periodEnd}</span>
                </div>
              )}
              <div className="flex justify-between"><span className="text-muted-foreground">Diagnoses/maand</span><span>{limits.diagnosesPerMonth === -1 ? "Onbeperkt" : limits.diagnosesPerMonth}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Korting onderdelen</span><span>{(limits.partsDiscount * 100).toFixed(0)}%{trialing && limits.partsDiscountWhenPaying > 0 ? ` (${(limits.partsDiscountWhenPaying * 100).toFixed(0)}% na je eerste betaling)` : ""}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Premium gidsen</span><span>{limits.premiumGuides ? "Ja" : "Nee"}</span></div>

              {user.plan === "FREE" ? (
                <Button asChild className="w-full mt-4">
                  <Link href="/prijzen"><Sparkles className="h-4 w-4" /> Upgrade abonnement</Link>
                </Button>
              ) : (
                <PortalButton />
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
