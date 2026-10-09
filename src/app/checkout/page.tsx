import { MarketingLayout } from "@/components/marketing-layout";
import { env } from "@/lib/env";
import { getCurrentUser, getPlanLimits } from "@/lib/auth";
import { publicCompany } from "@/lib/company";
import { isDemoMode } from "@/lib/demo-mode";
import { logger } from "@/lib/logger";
import { companyReadiness } from "@/lib/plans";
import { warnAboutUnrealCompany } from "@/lib/invoicing";
import { checkoutUnavailableMessage, checkoutBlockedReason, stripeCheckoutAvailable } from "@/lib/cart-gate";
import { Button } from "@/components/ui/button";
import { Store } from "lucide-react";
import Link from "next/link";
import { CheckoutClient } from "./checkout-client";

export const dynamic = "force-dynamic";

export const metadata = { title: "Afrekenen" };

export default async function CheckoutPage() {
  // The same gate as POST /api/checkout, asked BEFORE the customer fills in a form
  // that would only end in a refusal. The reason goes to the log (field names only),
  // the page tells the customer nothing about the configuration.
  const blocked = checkoutBlockedReason();
  if (blocked) {
    logger.error("[checkout page] shown as unavailable", { reason: blocked.code, missing: blocked.missing });
    return (
      <MarketingLayout>
        <div className="container py-16 max-w-xl text-center">
          <Store className="mx-auto h-12 w-12 text-muted-foreground/40 mb-4" aria-hidden />
          <h1 className="font-heading text-2xl font-bold mb-2">Bestellen is op dit moment niet mogelijk</h1>
          <p className="text-muted-foreground mb-6">{checkoutUnavailableMessage()}</p>
          <Button asChild variant="outline"><Link href="/onderdelen">Bekijk de onderdelen</Link></Button>
        </div>
      </MarketingLayout>
    );
  }
  if (env.IS_PRODUCTION && companyReadiness().warnings.length > 0) void warnAboutUnrealCompany();

  // The summary has to match what /api/checkout will charge, so the plan
  // discount is resolved server-side and handed to the client component.
  const user = await getCurrentUser();
  const partsDiscount = user ? getPlanLimits(user).partsDiscount : 0;
  const company = publicCompany();

  // Prefill from the account, but never from the demo account: in demo mode every
  // visitor "is" the seeded superadmin, and that person's name and address must not
  // appear in other people's forms.
  const prefill = user && !isDemoMode() ? { email: user.email, name: user.name } : null;

  return (
    <MarketingLayout>
      <CheckoutClient
        stripeAvailable={stripeCheckoutAvailable()}
        partsDiscount={partsDiscount}
        company={{ name: company.name, iban: company.iban }}
        prefill={prefill}
      />
    </MarketingLayout>
  );
}
