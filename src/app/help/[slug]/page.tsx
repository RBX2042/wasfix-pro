import { WasFixShell, Icon } from "@/components/redesign/SharedLayout";
import { notFound } from "next/navigation";
import Link from "next/link";
import articlesData from "@/data/help-articles.json";

type Article = {
  slug: string;
  category: string;
  title: string;
  summary: string;
  content: string;
};

const articles = articlesData as Article[];

export function generateStaticParams() {
  return articles.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const article = articles.find((a) => a.slug === slug);
  if (!article) return { title: "Helpartikel niet gevonden" };
  return {
    title: `${article.title} · Helpcentrum WasFix Pro`,
    description: article.summary,
    alternates: { canonical: `/help/${article.slug}` },
  };
}

// Minimal markdown renderer (h1/h2/h3, bold, lists, links, paragraphs)
function renderMarkdown(md: string) {
  const lines = md.split("\n");
  const out: React.ReactNode[] = [];
  let inList = false;
  let listItems: React.ReactNode[] = [];

  const flushList = () => {
    if (inList) {
      out.push(<ul key={`list-${out.length}`} style={{ paddingLeft: 22, lineHeight: 1.7, color: "var(--text-2)", marginBottom: 16 }}>{listItems}</ul>);
      listItems = [];
      inList = false;
    }
  };

  const renderInline = (text: string) => {
    // Bold + links
    const parts: React.ReactNode[] = [];
    let remaining = text;
    let key = 0;
    while (remaining.length) {
      const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
      const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
      if (boldMatch) {
        parts.push(<strong key={key++} style={{ color: "var(--text)" }}>{boldMatch[1]}</strong>);
        remaining = remaining.slice(boldMatch[0].length);
      } else if (linkMatch) {
        const isExternal = linkMatch[2].startsWith("http");
        parts.push(
          isExternal ? (
            <a key={key++} href={linkMatch[2]} target="_blank" rel="noopener noreferrer" style={{ color: "var(--acc-2)", textDecoration: "underline" }}>{linkMatch[1]}</a>
          ) : (
            <Link key={key++} href={linkMatch[2]} style={{ color: "var(--acc-2)", textDecoration: "underline" }}>{linkMatch[1]}</Link>
          )
        );
        remaining = remaining.slice(linkMatch[0].length);
      } else {
        parts.push(remaining[0]);
        remaining = remaining.slice(1);
      }
    }
    return parts;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("### ")) {
      flushList();
      out.push(<h3 key={i} style={{ fontSize: 16, fontWeight: 500, marginTop: 20, marginBottom: 8 }}>{line.slice(4)}</h3>);
    } else if (line.startsWith("## ")) {
      flushList();
      out.push(<h2 key={i} style={{ fontSize: 22, fontWeight: 500, marginTop: 32, marginBottom: 12, letterSpacing: "-0.015em" }}>{line.slice(3)}</h2>);
    } else if (line.match(/^[-*] /)) {
      inList = true;
      listItems.push(<li key={i}>{renderInline(line.slice(2))}</li>);
    } else if (line.match(/^\d+\. /)) {
      flushList();
      // Numbered lists
      const items: React.ReactNode[] = [];
      let j = i;
      while (j < lines.length && lines[j].match(/^\d+\. /)) {
        items.push(<li key={j}>{renderInline(lines[j].replace(/^\d+\. /, ""))}</li>);
        j++;
      }
      out.push(<ol key={`ol-${i}`} style={{ paddingLeft: 22, lineHeight: 1.7, color: "var(--text-2)", marginBottom: 16 }}>{items}</ol>);
      i = j - 1;
    } else if (line.trim()) {
      flushList();
      out.push(<p key={i} style={{ color: "var(--text-2)", lineHeight: 1.7, margin: "10px 0" }}>{renderInline(line)}</p>);
    }
  }
  flushList();
  return out;
}

export default async function HelpArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const article = articles.find((a) => a.slug === slug);
  if (!article) notFound();

  const related = articles.filter((a) => a.category === article.category && a.slug !== article.slug).slice(0, 3);

  const articleLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    description: article.summary,
    articleSection: article.category,
    publisher: { "@type": "Organization", name: "WasFix Pro" },
  };

  return (
    <WasFixShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleLd) }} />
      <section className="section" style={{ paddingTop: 56 }}>
        <div className="container" style={{ maxWidth: 760 }}>
          <nav style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>
            <Link href="/help" style={{ color: "var(--muted)" }}>Helpcentrum</Link>
            <span style={{ margin: "0 6px" }}>›</span>
            <span style={{ color: "var(--text-2)" }}>{article.category}</span>
          </nav>

          <div className="pill" style={{ marginBottom: 14 }}>
            <Icon name="book" size={11} /> {article.category}
          </div>
          <h1 className="h-display" style={{ fontSize: "clamp(28px, 4vw, 40px)", marginBottom: 12 }}>
            {article.title}
          </h1>
          <p className="lead" style={{ marginBottom: 32 }}>{article.summary}</p>

          <article style={{ background: "var(--surf)", border: "1px solid var(--border)", borderRadius: 12, padding: "28px 32px" }}>
            {renderMarkdown(article.content)}
          </article>

          {related.length > 0 && (
            <div style={{ marginTop: 36 }}>
              <div className="eyebrow" style={{ marginBottom: 14 }}>Gerelateerde artikelen</div>
              <div style={{ display: "grid", gap: 10 }}>
                {related.map((r) => (
                  <Link
                    key={r.slug}
                    href={`/help/${r.slug}`}
                    className="step-card"
                    style={{ textDecoration: "none", color: "inherit", display: "block" }}
                  >
                    <div style={{ fontWeight: 500, marginBottom: 4 }}>{r.title}</div>
                    <div className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>{r.summary}</div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginTop: 36, padding: 20, background: "rgba(79,140,255,0.06)", border: "1px solid var(--border-ac)", borderRadius: 12, textAlign: "center" }}>
            <div style={{ fontSize: 14, marginBottom: 8 }}>Niet gevonden wat je zocht?</div>
            <Link className="btn btn-sm btn-primary" href="/contact">
              Contact support <Icon name="arrow" size={13} />
            </Link>
          </div>
        </div>
      </section>
    </WasFixShell>
  );
}
