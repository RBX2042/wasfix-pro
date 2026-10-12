import { WasFixShell } from "@/components/redesign/SharedLayout";
import { WarrantyCheckClient } from "./client";
import { pageDescription, pageMetadata, pageTitle } from "@/lib/seo";

export const metadata = pageMetadata({
  title: pageTitle("Garantie-check wasmachine"),
  description: pageDescription("Check je fabrieksgarantie + EU Right-to-Repair rechten. Vul merk, model en aankoopdatum in — krijg een complete garantie-timeline."),
  path: "/tools/garantie-check",
});

export default function WarrantyCheckPage() {
  return (
    <WasFixShell>
      <section className="section" style={{ paddingTop: 56 }}>
        <div className="container" style={{ maxWidth: 760 }}>
          <div className="eyebrow">Tools</div>
          <h1 className="h-display" style={{ fontSize: "clamp(28px, 4vw, 44px)", marginBottom: 14 }}>
            Garantie<em>-check</em>
          </h1>
          <p className="lead" style={{ marginBottom: 32 }}>
            Vul je merk, model en aankoopdatum in — we tonen je complete garantie-tijdlijn: fabrieksgarantie, consumentenrechten en EU Right-to-Repair beschikbaarheid van onderdelen.
          </p>
          <WarrantyCheckClient />
        </div>
      </section>
    </WasFixShell>
  );
}
