import { DiagnoseDark } from "@/components/redesign/DiagnoseDark";
import { WasFixShell } from "@/components/redesign/SharedLayout";
import { ErrorBoundary } from "@/components/error-boundary";
import { Suspense } from "react";

export const metadata = {
  title: "AI wasmachine diagnose · WasFix Pro",
  description: "Beschrijf je probleem of typ een foutcode. Je krijgt een eerste indicatie van de waarschijnlijke oorzaak en de onderdelen die je mogelijk nodig hebt. Een indicatie, geen garantie.",
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
