import { MarketingLayout } from "@/components/marketing-layout";
import { getCurrentUser, getPlanLimits } from "@/lib/auth";
import { CheckoutClient } from "./checkout-client";

export const dynamic = "force-dynamic";

export const metadata = { title: "Afrekenen" };

export default async function CheckoutPage() {
  // The summary has to match what /api/checkout will charge, so the plan
  // discount is resolved server-side and handed to the client component.
  const user = await getCurrentUser();
  const partsDiscount = user ? getPlanLimits(user.plan).partsDiscount : 0;

  return (
    <MarketingLayout>
      <CheckoutClient partsDiscount={partsDiscount} />
    </MarketingLayout>
  );
}
