import { MarketingLayout } from "@/components/marketing-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { CheckCircle2, ArrowLeft } from "lucide-react";
import { UpgradeButton } from "./upgrade-button";
import { PlanActivation, type PlanSnapshot } from "./plan-activation";
import { requiresWithdrawalWaiver } from "./consent";
import { BILLABLE_PLANS, PLANS, formatPlanPrice, planPriceSuffix, type PlanId } from "@/lib/plans";
import { getCurrentUser, getPlanLimits, planDisplayName } from "@/lib/auth";
import { firstParam } from "@/lib/safe-next";
import { supportEmail } from "@/lib/support-contact";

export const metadata = { title: "Upgrade abonnement", robots: { index: false } };
export const dynamic = "force-dynamic";

type Search = { plan?: string | string[]; success?: string | string[]; upgraded?: string | string[] };

export default async function UpgradePage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  // A repeated parameter arrives as an array; only the first value counts.
  const planParam = firstParam(sp.plan)?.toUpperCase();
  const plan = planParam ?? "PARTICULIER";
  const detail = BILLABLE_PLANS.includes(plan as PlanId) ? PLANS[plan as PlanId] : undefined;
  const user = await getCurrentUser();

  // Back from Stripe: confirm what was bought, wait briefly for the webhook.
  if (sp.success !== undefined || sp.upgraded !== undefined) {
    if (!user) {
      return (
        <MarketingLayout>
          <div className="container py-16 max-w-xl text-center space-y-4">
            <h1 className="font-heading text-2xl font-bold">Log in om je abonnement te zien</h1>
            <p className="text-muted-foreground">Je sessie is verlopen. Log in met hetzelfde account waarmee je hebt afgerekend.</p>
            <Button asChild><Link href="/inloggen?next=/dashboard">Inloggen</Link></Button>
          </div>
        </MarketingLayout>
      );
    }
    const limits = getPlanLimits(user);
    const initial: PlanSnapshot = {
      plan: user.plan,
      planName: planDisplayName(user.plan),
      subscriptionStatus: user.subscriptionStatus ?? null,
      currentPeriodEnd: user.currentPeriodEnd ? user.currentPeriodEnd.toISOString() : null,
      cancelAtPeriodEnd: user.cancelAtPeriodEnd ?? false,
      partsDiscountWhenPaying: limits.partsDiscountWhenPaying,
    };
    return (
      <MarketingLayout>
        <div className="container py-12 max-w-2xl space-y-6">
          <h1 className="font-heading text-2xl md:text-3xl font-bold">Bedankt voor je abonnement</h1>
          {/* Only a plan named in the address is waited for. Without one ("/upgrade?success" followed from a bookmark) any paid plan is the confirmation: defaulting to Particulier made a Bedrijf subscriber wait 40 s for a plan they do not have. */}
          <PlanActivation initial={initial} expectedPlan={planParam ? detail?.id : undefined} supportEmail={supportEmail()} />
        </div>
      </MarketingLayout>
    );
  }

  if (!detail) {
    return (
      <MarketingLayout>
        <div className="container py-20 text-center">
          <p>Onbekend plan</p>
          <Link href="/prijzen" className="text-primary hover:underline">Bekijk plans →</Link>
        </div>
      </MarketingLayout>
    );
  }

  const waiver = requiresWithdrawalWaiver(detail.id);
  const trialAvailable = detail.trialDays > 0 && !user?.trialUsedAt;
  const discountPct = Math.round(detail.partsDiscount * 100);
  const upgradePath = `/upgrade?plan=${detail.id}`;
  const alreadyThisPlan = !!user && user.plan === detail.id;
  const otherPaidPlan = !!user && user.plan !== "FREE" && user.plan !== detail.id;

  return (
    <MarketingLayout>
      <div className="container py-12 max-w-2xl">
        <Link href="/prijzen" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-6">
          <ArrowLeft className="h-3 w-3" /> Andere plans bekijken
        </Link>

        <Card>
          <CardContent className="p-8 space-y-6">
            <Badge variant="accent">Upgrade</Badge>
            <h1 className="font-heading text-2xl md:text-3xl font-bold">Upgrade naar {detail.name}</h1>

            <div className="flex items-baseline gap-2">
              <span className="font-heading text-4xl font-bold text-primary">{formatPlanPrice(detail)}</span>
              <span className="text-muted-foreground">{planPriceSuffix(detail)}</span>
            </div>

            <ul className="space-y-2.5">
              {detail.features.map((f, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>

            {!user ? (
              <div className="space-y-3 rounded-lg border bg-muted/30 p-5 text-center" data-testid="upgrade-signed-out">
                <h2 className="font-heading text-lg font-semibold">Maak eerst een gratis account</h2>
                <p className="text-sm text-muted-foreground">
                  Een abonnement hoort bij een account. Het aanmaken is gratis en kost een minuut; daarna ga je direct door naar de betaling.
                </p>
                <Button asChild size="lg" className="w-full">
                  <Link href={`/registreren?plan=${detail.id.toLowerCase()}`}>Maak een gratis account</Link>
                </Button>
                <p className="text-sm text-muted-foreground">
                  Heb je al een account?{" "}
                  <Link href={`/inloggen?next=${encodeURIComponent(upgradePath)}`} className="text-primary hover:underline">Inloggen</Link>
                </p>
              </div>
            ) : alreadyThisPlan ? (
              <div className="rounded-lg border bg-muted/30 p-5 text-sm space-y-2" data-testid="upgrade-already">
                <p className="font-medium">Je hebt {detail.name} al.</p>
                <p className="text-muted-foreground">Je betaalmethode wijzigen of opzeggen kan onder Profiel &amp; abonnement.</p>
                <Button asChild variant="outline"><Link href="/dashboard/profiel">Naar mijn abonnement</Link></Button>
              </div>
            ) : (
              <>
                {otherPaidPlan && (
                  <p className="text-sm text-muted-foreground rounded-md border p-3">
                    Je hebt nu {planDisplayName(user.plan)}. Van plan wisselen doe je in het klantportaal; de knop hieronder brengt je daar.
                  </p>
                )}
                <UpgradeButton plan={detail.id} requiresWaiver={waiver && !otherPaidPlan} supportEmail={supportEmail()} />
              </>
            )}

            <div className="text-xs text-muted-foreground text-center space-y-1">
              <p>
                {trialAvailable
                  ? `Eerste ${detail.trialDays} dagen gratis — je betaalt pas daarna. Een proefperiode kun je één keer per account gebruiken.`
                  : "Je betaalt direct de eerste maand."}{" "}
                Maandelijks opzegbaar, veilig betalen via Stripe.
              </p>
              {discountPct > 0 && <p>De {discountPct}% korting op onderdelen gaat in zodra je eerste betaling is voldaan, niet tijdens de proefperiode.</p>}
              <p>Zie de <Link href="/voorwaarden" className="underline">algemene voorwaarden</Link>.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </MarketingLayout>
  );
}
