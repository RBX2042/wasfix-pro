import { DiagnoseDark } from "@/components/redesign/DiagnoseDark";
import { WasFixShell } from "@/components/redesign/SharedLayout";
import { ErrorBoundary } from "@/components/error-boundary";
import { Suspense } from "react";
import { pageDescription, pageMetadata, pageTitle } from "@/lib/seo";

// The title brought its own " · WasFix Pro" and the template added a second one; the description was 179 characters.
// ?prefill=... addresses are the same page with a text box filled in: they name /diagnose as canonical.
export const metadata = pageMetadata({
  title: pageTitle("AI wasmachine diagnose"),
  description: pageDescription("Beschrijf je probleem of typ een foutcode en krijg een eerste indicatie van de waarschijnlijke oorzaak en de onderdelen die je mogelijk nodig hebt. Een indicatie, geen garantie."),
  path: "/diagnose",
});

export const dynamic = "force-dynamic";

export default function DiagnosePage() {
  return (
    <WasFixShell>
      <ErrorBoundary>
        <Suspense fallback={<div className="container section" style={{ color: "var(--mute)" }}>Laden...</div>}>
          <DiagnoseDark />
        </Suspense>
      </ErrorBoundary>
    </WasFixShell>
  );
}
