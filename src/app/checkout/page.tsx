import { MarketingLayout } from "@/components/marketing-layout";
import { isStripeConfigured } from "@/lib/env";
import { getCurrentUser, getPlanLimits } from "@/lib/auth";
import { publicCompany } from "@/lib/company";
import { CheckoutClient } from "./checkout-client";

export const dynamic = "force-dynamic";

export const metadata = { title: "Afrekenen" };

export default async function CheckoutPage() {
  // The summary has to match what /api/checkout will charge, so the plan
  // discount is resolved server-side and handed to the client component.
  const user = await getCurrentUser();
  const partsDiscount = user ? getPlanLimits(user.plan).partsDiscount : 0;
  const company = publicCompany();

  return (
    <MarketingLayout>
      <CheckoutClient
        stripeAvailable={isStripeConfigured()}
        partsDiscount={partsDiscount}
        company={{ name: company.name, iban: company.iban }}
      />
    </MarketingLayout>
  );
}
