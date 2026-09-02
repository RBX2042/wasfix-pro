import { WasFixShell } from "@/components/redesign/SharedLayout";
import { QrStickerClient } from "./client";

export const metadata = {
  title: "QR sticker generator — voor je wasmachine · WasFix Pro",
  description: "Genereer een QR-sticker voor op je wasmachine. Scan om snel naar diagnose, onderdelen en gidsen voor jouw specifieke machine.",
  alternates: { canonical: "/tools/qr-sticker" },
};

export default function QrStickerPage() {
  return (
    <WasFixShell>
      <section className="section" style={{ paddingTop: 56 }}>
        <div className="container" style={{ maxWidth: 720 }}>
          <div className="eyebrow">Tools</div>
          <h1 className="h-display" style={{ fontSize: "clamp(28px, 4vw, 44px)", marginBottom: 14 }}>
            QR sticker <em>generator</em>
          </h1>
          <p className="lead" style={{ marginBottom: 32 }}>
            Plak deze QR op je wasmachine. Bij toekomstige problemen scan je &apos;m met je telefoon en kom je direct bij diagnose, onderdelen en reparatiegidsen voor jouw machine. Voor monteurs: één sticker per klant = klantbinding + 1-click pre-diagnose.
          </p>
          <QrStickerClient />
        </div>
      </section>
    </WasFixShell>
  );
}
