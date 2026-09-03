import { WasFixShell, Icon } from "@/components/redesign/SharedLayout";
import Link from "next/link";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return {
    title: `Machine ${code} · WasFix Pro`,
    description: `Scan-resultaat voor wasmachine QR-code ${code}.`,
    robots: "noindex", // Per-machine pages — don't index
  };
}

// QR scan landing page. Scanned from a sticker — shows machine actions:
// view diagnose, recent issues, order parts. Anonymous-safe version (no DB).
// When logged in + machine saved in dashboard, this would redirect to the
// specific machine page.
export default async function QRScanPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;

  return (
    <WasFixShell>
      <section className="section" style={{ paddingTop: 56 }}>
        <div className="container" style={{ maxWidth: 600, textAlign: "center" }}>
          <div className="pill pill-acc" style={{ marginBottom: 16 }}>
            <Icon name="qr" size={12} /> QR scan
          </div>
          <h1 className="h-display" style={{ fontSize: "clamp(28px, 4vw, 40px)", marginBottom: 10 }}>
            Machine <em>{code}</em>
          </h1>
          <p className="muted mono" style={{ fontSize: 12, letterSpacing: "0.04em", marginBottom: 32 }}>
            Code: {code} · Gescand vanaf sticker
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10, marginBottom: 32 }}>
            <Link href="/diagnose" className="step-card" style={{ textDecoration: "none", color: "inherit", display: "block" }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>🔍</div>
              <div style={{ fontWeight: 500, fontSize: 14 }}>Start AI diagnose</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Foutcode? Geluid? Lekkage?</div>
            </Link>
            <Link href="/foutcodes" className="step-card" style={{ textDecoration: "none", color: "inherit", display: "block" }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>📋</div>
              <div style={{ fontWeight: 500, fontSize: 14 }}>Foutcodes</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Zoek op merk + code</div>
            </Link>
            <Link href="/onderdelen" className="step-card" style={{ textDecoration: "none", color: "inherit", display: "block" }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>🔧</div>
              <div style={{ fontWeight: 500, fontSize: 14 }}>Bestel onderdeel</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Verzending op werkdagen</div>
            </Link>
            <Link href="/gidsen" className="step-card" style={{ textDecoration: "none", color: "inherit", display: "block" }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>📖</div>
              <div style={{ fontWeight: 500, fontSize: 14 }}>Reparatiegidsen</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Stap-voor-stap</div>
            </Link>
          </div>

          <div style={{ padding: 18, background: "var(--surf-2)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 13, color: "var(--text-2)", lineHeight: 1.6 }}>
            <strong style={{ color: "var(--text)" }}>Tip:</strong> log in om deze QR-sticker te koppelen aan je machine in /dashboard/wasmachines. Dan zie je je reparatiegeschiedenis + krijg je preventieve onderhoudsmeldingen.
          </div>

          <div style={{ marginTop: 20 }}>
            <Link href="/inloggen?next=/dashboard/wasmachines" className="btn btn-sm">
              Koppel aan account <Icon name="arrow" size={13} />
            </Link>
          </div>
        </div>
      </section>
    </WasFixShell>
  );
}
