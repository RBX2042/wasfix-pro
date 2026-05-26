import { WasFixShell, Icon } from "@/components/redesign/SharedLayout";
import { notFound } from "next/navigation";
import Link from "next/link";
import postsData from "@/data/blog-posts.json";

type Post = { slug: string; category: string; title: string; summary: string; readTime: number; publishedAt: string; heroEmoji: string; content: string };
const posts = postsData as Post[];

export function generateStaticParams() {
  return posts.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = posts.find((p) => p.slug === slug);
  if (!post) return { title: "Artikel niet gevonden" };
  return {
    title: `${post.title} · Blog · WasFix Pro`,
    description: post.summary,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      title: post.title,
      description: post.summary,
      type: "article",
      publishedTime: post.publishedAt,
    },
  };
}

// Same minimal renderer as help/[slug]
function renderMarkdown(md: string) {
  const lines = md.split("\n");
  const out: React.ReactNode[] = [];
  let inList = false;
  let listItems: React.ReactNode[] = [];

  const flushList = () => {
    if (inList) {
      out.push(<ul key={`l-${out.length}`} style={{ paddingLeft: 22, lineHeight: 1.7, color: "var(--text-2)", marginBottom: 16 }}>{listItems}</ul>);
      listItems = [];
      inList = false;
    }
  };

  const renderInline = (text: string) => {
    const parts: React.ReactNode[] = [];
    let r = text;
    let k = 0;
    while (r.length) {
      const bold = r.match(/^\*\*([^*]+)\*\*/);
      const link = r.match(/^\[([^\]]+)\]\(([^)]+)\)/);
      if (bold) {
        parts.push(<strong key={k++} style={{ color: "var(--text)" }}>{bold[1]}</strong>);
        r = r.slice(bold[0].length);
      } else if (link) {
        const isExternal = link[2].startsWith("http");
        parts.push(isExternal
          ? <a key={k++} href={link[2]} target="_blank" rel="noopener noreferrer" style={{ color: "var(--acc-2)", textDecoration: "underline" }}>{link[1]}</a>
          : <Link key={k++} href={link[2]} style={{ color: "var(--acc-2)", textDecoration: "underline" }}>{link[1]}</Link>
        );
        r = r.slice(link[0].length);
      } else {
        parts.push(r[0]);
        r = r.slice(1);
      }
    }
    return parts;
  };

  const renderTableRow = (line: string) => {
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    return cells;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("### ")) {
      flushList();
      out.push(<h3 key={i} style={{ fontSize: 17, fontWeight: 500, marginTop: 24, marginBottom: 10 }}>{line.slice(4)}</h3>);
    } else if (line.startsWith("## ")) {
      flushList();
      out.push(<h2 key={i} style={{ fontSize: 23, fontWeight: 500, marginTop: 36, marginBottom: 14, letterSpacing: "-0.015em" }}>{line.slice(3)}</h2>);
    } else if (line.match(/^\|.*\|$/)) {
      // Table
      flushList();
      const rows: string[] = [line];
      let j = i + 1;
      while (j < lines.length && lines[j].match(/^\|.*\|$/)) { rows.push(lines[j]); j++; }
      if (rows.length >= 2) {
        const headers = renderTableRow(rows[0]);
        const bodyRows = rows.slice(2).map(renderTableRow); // skip separator
        out.push(
          <div key={`t-${i}`} style={{ overflowX: "auto", margin: "16px 0" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "var(--surf-2)" }}>
                  {headers.map((h, hi) => <th key={hi} style={{ padding: "10px 12px", textAlign: "left", borderBottom: "1px solid var(--border)" }}>{renderInline(h)}</th>)}
                </tr>
              </thead>
              <tbody>
                {bodyRows.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((c, ci) => <td key={ci} style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", color: "var(--text-2)" }}>{renderInline(c)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      i = j - 1;
    } else if (line.match(/^[-*] /)) {
      inList = true;
      listItems.push(<li key={i}>{renderInline(line.slice(2))}</li>);
    } else if (line.match(/^\d+\. /)) {
      flushList();
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
      out.push(<p key={i} style={{ color: "var(--text-2)", lineHeight: 1.75, margin: "12px 0" }}>{renderInline(line)}</p>);
    }
  }
  flushList();
  return out;
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = posts.find((p) => p.slug === slug);
  if (!post) notFound();

  const related = posts.filter((p) => p.slug !== slug).slice(0, 3);

  const articleLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.summary,
    articleSection: post.category,
    datePublished: post.publishedAt,
    author: { "@type": "Organization", name: "WasFix Pro" },
    publisher: {
      "@type": "Organization",
      name: "WasFix Pro",
      logo: { "@type": "ImageObject", url: "https://wasfix.nl/icon" },
    },
  };

  return (
    <WasFixShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleLd) }} />
      <section className="section" style={{ paddingTop: 56 }}>
        <div className="container" style={{ maxWidth: 800 }}>
          <nav style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16 }}>
            <Link href="/blog" style={{ color: "var(--muted)" }}>Blog</Link>
            <span style={{ margin: "0 6px" }}>›</span>
            <span style={{ color: "var(--text-2)" }}>{post.category}</span>
          </nav>

          <div style={{ fontSize: 56, marginBottom: 16 }}>{post.heroEmoji}</div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16 }}>
            <span className="pill pill-mono">{post.category}</span>
            <span className="muted" style={{ fontSize: 12.5 }}>
              {new Date(post.publishedAt).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" })} · {post.readTime} min lezen
            </span>
          </div>

          <h1 className="h-display" style={{ fontSize: "clamp(28px, 4vw, 44px)", marginBottom: 14, lineHeight: 1.15 }}>
            {post.title}
          </h1>
          <p className="lead" style={{ marginBottom: 36 }}>{post.summary}</p>

          <article style={{ background: "var(--surf)", border: "1px solid var(--border)", borderRadius: 12, padding: "28px 32px" }}>
            {renderMarkdown(post.content)}
          </article>

          {related.length > 0 && (
            <div style={{ marginTop: 40 }}>
              <div className="eyebrow" style={{ marginBottom: 14 }}>Gerelateerde artikelen</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
                {related.map((r) => (
                  <Link
                    key={r.slug}
                    href={`/blog/${r.slug}`}
                    className="step-card"
                    style={{ textDecoration: "none", color: "inherit", display: "block" }}
                  >
                    <div style={{ fontSize: 24, marginBottom: 6 }}>{r.heroEmoji}</div>
                    <div style={{ fontWeight: 500, fontSize: 14, marginBottom: 6 }}>{r.title}</div>
                    <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>{r.summary}</div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    </WasFixShell>
  );
}
