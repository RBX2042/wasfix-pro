import { MarketingLayout } from "@/components/marketing-layout";
import { CheckoutClient } from "./checkout-client";

export const metadata = { title: "Afrekenen" };

export default function CheckoutPage() {
  return (
    <MarketingLayout>
      <CheckoutClient />
    </MarketingLayout>
  );
}
