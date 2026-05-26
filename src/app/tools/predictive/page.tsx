import { WasFixShell } from "@/components/redesign/SharedLayout";
import { PredictiveClient } from "./client";

export const metadata = {
  title: "Voorspellende onderhoud — Health-score wasmachine · WasFix Pro",
  description: "Krijg een health-score per onderdeel-categorie op basis van merk + leeftijd. Voorkom defecten met preventief bestel-pakket.",
  alternates: { canonical: "/tools/predictive" },
};

export default function PredictivePage() {
  return (
    <WasFixShell>
      <section className="section" style={{ paddingTop: 56 }}>
        <div className="container" style={{ maxWidth: 800 }}>
          <div className="eyebrow">Tools</div>
          <h1 className="h-display" style={{ fontSize: "clamp(28px, 4vw, 44px)", marginBottom: 14 }}>
            Voorspellend <em>onderhoud</em>
          </h1>
          <p className="lead" style={{ marginBottom: 32 }}>
            Vul je merk + leeftijd in. Wij berekenen een health-score per onderdeel-categorie op basis van bekende failure-rates en merk-betrouwbaarheid. Krijg een preventief bestel-pakket voor de 3 onderdelen met de laagste health.
          </p>
          <PredictiveClient />
        </div>
      </section>
    </WasFixShell>
  );
}
