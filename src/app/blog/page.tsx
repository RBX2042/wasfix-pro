import { WasFixShell, Icon } from "@/components/redesign/SharedLayout";
import Link from "next/link";
import postsData from "@/data/blog-posts.json";

export const metadata = {
  title: "Blog & kennisbank · WasFix Pro",
  description: "Wasmachine reparatie tips, EU Right to Repair updates, foutcodes-analyses, en duurzame onderhoudsguides.",
  alternates: { canonical: "/blog" },
};

type Post = { slug: string; category: string; title: string; summary: string; readTime: number; publishedAt: string; heroEmoji: string; content: string };
const posts = postsData as Post[];

export default function BlogIndexPage() {
  // Sort by publishedAt desc
  const sorted = [...posts].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const categories = Array.from(new Set(posts.map((p) => p.category)));

  return (
    <WasFixShell>
      <section className="section" style={{ paddingTop: 56 }}>
        <div className="container" style={{ maxWidth: 920 }}>
          <div className="eyebrow">Blog</div>
          <h1 className="h-display" style={{ fontSize: "clamp(32px, 4.5vw, 52px)", marginBottom: 14 }}>
            Wasmachine <em>kennishub</em>
          </h1>
          <p className="lead" style={{ marginBottom: 32 }}>
            Tips, duurzaamheid, EU Right to Repair updates, en grondige analyses van foutcodes per merk. Diepe content voor mensen die hun apparaten langer willen gebruiken.
          </p>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 36 }}>
            <span className="pill" style={{ background: "var(--surf-2)", color: "var(--text)" }}>Alle</span>
            {categories.map((c) => (
              <span key={c} className="pill">{c}</span>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
            {sorted.map((p) => (
              <Link
                key={p.slug}
                href={`/blog/${p.slug}`}
                className="step-card"
                style={{ textDecoration: "none", color: "inherit", display: "block", padding: "20px 22px" }}
              >
                <div style={{ fontSize: 36, marginBottom: 12 }}>{p.heroEmoji}</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                  <span className="pill pill-mono" style={{ fontSize: 10, padding: "3px 8px" }}>{p.category}</span>
                  <span className="muted" style={{ fontSize: 11.5 }}>{p.readTime} min lezen</span>
                </div>
                <h2 style={{ fontSize: 17, fontWeight: 500, lineHeight: 1.3, marginBottom: 8 }}>{p.title}</h2>
                <p className="muted" style={{ fontSize: 13, lineHeight: 1.55 }}>{p.summary}</p>
                <div style={{ marginTop: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="muted mono" style={{ fontSize: 11 }}>
                    {new Date(p.publishedAt).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" })}
                  </span>
                  <span style={{ color: "var(--acc-2)", fontSize: 13, display: "flex", alignItems: "center", gap: 4 }}>
                    Lees <Icon name="arrow" size={11} />
                  </span>
                </div>
              </Link>
            ))}
          </div>

          <div style={{ marginTop: 56, padding: 32, background: "linear-gradient(135deg, rgba(79,140,255,0.08), rgba(0,212,255,0.04))", border: "1px solid var(--border-ac)", borderRadius: 16, textAlign: "center" }}>
            <h2 style={{ fontSize: 22, fontWeight: 500, marginBottom: 10 }}>Wekelijkse nieuwsbrief</h2>
            <p className="muted" style={{ marginBottom: 18, maxWidth: 480, margin: "0 auto 18px" }}>
              Eens per week — trending foutcodes, nieuwe gidsen, duurzame tips. Geen spam, altijd opzegbaar.
            </p>
            <form action="/api/newsletter" method="post" style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
              <input
                type="email"
                name="email"
                placeholder="je@email.nl"
                required
                style={{ padding: "10px 14px", background: "var(--surf-2)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", minWidth: 240, fontSize: 14 }}
              />
              <button type="submit" className="btn btn-primary btn-sm">
                Abonneer <Icon name="send" size={13} />
              </button>
            </form>
          </div>
        </div>
      </section>
    </WasFixShell>
  );
}
