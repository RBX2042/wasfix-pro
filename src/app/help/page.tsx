import { WasFixShell, Icon } from "@/components/redesign/SharedLayout";
import Link from "next/link";
import articlesData from "@/data/help-articles.json";

export const metadata = {
  title: "Helpcentrum · WasFix Pro",
  description: "Antwoorden op de meest gestelde vragen. AI diagnose, onderdelen, bestellingen, abonnement, garantie, privacy.",
};

type Article = { slug: string; category: string; title: string; summary: string; content: string };
const articles = articlesData as Article[];

export default function HelpPage() {
  // Group by category
  const grouped = articles.reduce((acc, a) => {
    (acc[a.category] ??= []).push(a);
    return acc;
  }, {} as Record<string, Article[]>);

  const CATEGORY_ICONS: Record<string, string> = {
    "AI Diagnose": "sparkle",
    "Onderdelen": "package",
    "Bestellingen": "cart",
    "Abonnement": "shield",
    "Reparatie": "code",
    "Klantenservice": "user",
    "Privacy": "shield",
  };

  return (
    <WasFixShell>
      <section className="section" style={{ paddingTop: 56 }}>
        <div className="container" style={{ maxWidth: 920 }}>
          <div className="eyebrow">Helpcentrum</div>
          <h1 className="h-display" style={{ fontSize: "clamp(32px, 4.5vw, 52px)", marginBottom: 14 }}>
            Hoe kunnen we <em>helpen</em>?
          </h1>
          <p className="lead" style={{ marginBottom: 40 }}>
            Veelgestelde vragen per categorie. Vind je niet wat je zoekt? <Link href="/contact" style={{ color: "var(--acc-2)", textDecoration: "underline" }}>Stuur ons een bericht</Link>.
          </p>

          <div style={{ display: "grid", gap: 32 }}>
            {Object.entries(grouped).map(([category, items]) => {
              const iconName = (CATEGORY_ICONS[category] ?? "book") as Parameters<typeof Icon>[0]["name"];
              return (
                <div key={category}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(79,140,255,0.1)", display: "grid", placeItems: "center", color: "var(--acc-2)" }}>
                      <Icon name={iconName} size={14} />
                    </div>
                    <h2 style={{ fontSize: 20, fontWeight: 500, margin: 0, letterSpacing: "-0.01em" }}>{category}</h2>
                    <span className="muted mono" style={{ fontSize: 11, marginLeft: 4 }}>{items.length} artikel{items.length === 1 ? "" : "en"}</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
                    {items.map((a) => (
                      <Link
                        key={a.slug}
                        href={`/help/${a.slug}`}
                        className="step-card"
                        style={{ textDecoration: "none", color: "inherit", display: "block" }}
                      >
                        <div style={{ fontWeight: 500, marginBottom: 4, fontSize: 14.5 }}>{a.title}</div>
                        <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.55 }}>{a.summary}</div>
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 56, padding: 32, background: "linear-gradient(135deg, rgba(79,140,255,0.08), rgba(0,212,255,0.04))", border: "1px solid var(--border-ac)", borderRadius: 16, textAlign: "center" }}>
            <h2 style={{ fontSize: 22, fontWeight: 500, marginBottom: 10 }}>Niet gevonden wat je zocht?</h2>
            <p className="muted" style={{ marginBottom: 18, maxWidth: 480, margin: "0 auto 18px" }}>
              Stuur ons een bericht — we reageren binnen 24u op werkdagen.
            </p>
            <Link className="btn btn-primary" href="/contact">
              Contact support <Icon name="send" size={13} />
            </Link>
          </div>
        </div>
      </section>
    </WasFixShell>
  );
}
