import { DiagnoseDark } from "@/components/redesign/DiagnoseDark";
import { WasFixShell } from "@/components/redesign/SharedLayout";
import { ErrorBoundary } from "@/components/error-boundary";
import { Suspense } from "react";

export const metadata = {
  title: "AI wasmachine diagnose · WasFix Pro",
  description: "Beschrijf je probleem of plak een foutcode. Onze AI geeft binnen 60 seconden de diagnose + juiste onderdeel.",
};

export const dynamic = "force-dynamic";

export default function DiagnosePage() {
  return (
    <WasFixShell>
      <ErrorBoundary>
        <Suspense fallback={<div className="container section" style={{ color: "var(--muted)" }}>Laden...</div>}>
          <DiagnoseDark />
        </Suspense>
      </ErrorBoundary>
    </WasFixShell>
  );
}
