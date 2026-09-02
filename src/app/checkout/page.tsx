import { MarketingLayout } from "@/components/marketing-layout";
import { isStripeConfigured } from "@/lib/env";
import { CheckoutClient } from "./checkout-client";

export const metadata = { title: "Afrekenen" };

export default function CheckoutPage() {
  return (
    <MarketingLayout>
      <CheckoutClient stripeAvailable={isStripeConfigured()} />
    </MarketingLayout>
  );
}
