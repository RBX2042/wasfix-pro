import Link from "next/link";
import { WasFixShell, Icon } from "@/components/redesign/SharedLayout";

export const metadata = {
  title: "Pagina niet gevonden",
  description: "Deze pagina bestaat niet of is verplaatst.",
};

const popularLinks = [
  { href: "/diagnose", title: "AI Diagnose", desc: "Start in 60s een gratis diagnose", icon: "sparkle" as const },
  { href: "/foutcodes", title: "Foutcodes database", desc: "2.180+ foutcodes per merk", icon: "code" as const },
  { href: "/onderdelen", title: "Onderdelen-shop", desc: "5.600+ originele onderdelen", icon: "package" as const },
  { href: "/gidsen", title: "Reparatiegidsen", desc: "Stap-voor-stap met foto's", icon: "book" as const },
];

export default function NotFound() {
  return (
    <WasFixShell>
      <section className="section" style={{ paddingTop: 64 }}>
        <div className="container" style={{ maxWidth: 720, textAlign: "center" }}>
          <div className="mono" style={{ fontSize: 96, fontWeight: 200, lineHeight: 1, color: "var(--acc-2)", letterSpacing: "-0.05em", marginBottom: 8 }}>
            404
          </div>
          <h1 className="h-display" style={{ fontSize: "clamp(28px, 4vw, 44px)", marginBottom: 14 }}>
            Pagina <em>niet gevonden</em>
          </h1>
          <p className="lead" style={{ maxWidth: 480, margin: "0 auto 28px" }}>
            Deze pagina bestaat niet of is verplaatst. Probeer hieronder een populaire pagina, of begin met een nieuwe diagnose.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center", marginBottom: 48 }}>
            <Link className="btn btn-primary" href="/">
              Terug naar home <Icon name="arrow" size={14} />
            </Link>
            <Link className="btn" href="/diagnose">
              Start gratis diagnose
            </Link>
          </div>

          <div className="eyebrow" style={{ marginBottom: 18 }}>Populaire pagina&apos;s</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, textAlign: "left" }}>
            {popularLinks.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="step-card"
                style={{ textDecoration: "none", color: "inherit", cursor: "pointer" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <span style={{ width: 28, height: 28, borderRadius: 7, background: "rgba(79,140,255,0.1)", display: "grid", placeItems: "center", color: "var(--acc-2)" }}>
                    <Icon name={l.icon} size={14} />
                  </span>
                  <div className="step-title" style={{ fontSize: 14 }}>{l.title}</div>
                </div>
                <div className="step-text" style={{ fontSize: 12.5 }}>{l.desc}</div>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </WasFixShell>
  );
}
