import { MarketingLayout } from "@/components/marketing-layout";
import { DiagnoseClient } from "./diagnose-client";
import { ErrorBoundary } from "@/components/error-boundary";

export const metadata = { title: "AI wasmachine diagnose" };

export default function DiagnosePage() {
  return (
    <MarketingLayout>
      <ErrorBoundary>
        <DiagnoseClient />
      </ErrorBoundary>
    </MarketingLayout>
  );
}
