import { MarketingLayout } from "@/components/marketing-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { CheckCircle2, ArrowLeft } from "lucide-react";
import { UpgradeButton } from "./upgrade-button";
import { BILLABLE_PLANS, PLANS, formatPlanPrice, planPriceSuffix, type PlanId } from "@/lib/plans";

export const metadata = { title: "Upgrade abonnement" };

export default async function UpgradePage({ searchParams }: { searchParams: Promise<{ plan?: string }> }) {
  const sp = await searchParams;
  const plan = (sp.plan ?? "PARTICULIER").toUpperCase();
  const detail = BILLABLE_PLANS.includes(plan as PlanId) ? PLANS[plan as PlanId] : undefined;

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

            <UpgradeButton plan={plan} />

            <p className="text-xs text-muted-foreground text-center">
              {detail.trialDays > 0
                ? `Eerste ${detail.trialDays} dagen gratis — je betaalt pas daarna. Maandelijks opzegbaar, veilig betalen via Stripe.`
                : "Maandelijks opzegbaar. Veilig betalen via Stripe."}
            </p>
          </CardContent>
        </Card>
      </div>
    </MarketingLayout>
  );
}
