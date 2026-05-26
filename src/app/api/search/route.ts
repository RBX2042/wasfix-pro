import { NextRequest, NextResponse } from "next/server";
import { errorCodes, machines, parts, guides } from "@/lib/static-db";
import helpArticles from "@/data/help-articles.json";
import blogPosts from "@/data/blog-posts.json";
import brands from "@/data/brands.json";

export const dynamic = "force-dynamic";

type Hit = {
  type: "foutcode" | "onderdeel" | "gids" | "help" | "blog" | "merk";
  title: string;
  subtitle?: string;
  url: string;
  score: number;
};

// Simple substring + word-prefix scoring. No external deps.
function score(haystack: string, q: string): number {
  const h = haystack.toLowerCase();
  const query = q.toLowerCase().trim();
  if (!query) return 0;
  if (h === query) return 100;
  if (h.startsWith(query)) return 80;
  // Word-prefix match
  const words = h.split(/\W+/);
  for (const w of words) {
    if (w === query) return 70;
    if (w.startsWith(query)) return 60;
  }
  if (h.includes(query)) return 40;
  // Multi-word query: each word found
  const qWords = query.split(/\s+/);
  if (qWords.length > 1) {
    const matched = qWords.filter((qw) => h.includes(qw)).length;
    if (matched > 0) return 20 + (matched / qWords.length) * 20;
  }
  return 0;
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ q, hits: [], total: 0 });
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") ?? "20", 10), 50);

  const machineById = new Map(machines.map((m) => [m.id, m]));
  const hits: Hit[] = [];

  // Foutcodes — searchable by brand + code + title + description
  for (const ec of errorCodes) {
    const m = machineById.get(ec.machineId);
    const brand = m?.brand ?? "";
    const haystack = `${brand} ${ec.code} ${ec.title} ${ec.description}`;
    const s = score(haystack, q);
    if (s > 0) {
      hits.push({
        type: "foutcode",
        title: `${brand} ${ec.code} — ${ec.title}`,
        subtitle: ec.description.slice(0, 100),
        url: `/foutcodes/${encodeURIComponent(brand)}-${encodeURIComponent(ec.code)}`,
        score: s + 5, // slight boost for foutcodes
      });
    }
  }

  // Parts — searchable by sku + name + brand + category + description
  for (const p of parts) {
    const haystack = `${p.sku} ${p.name} ${p.brand} ${p.category} ${p.description ?? ""}`;
    const s = score(haystack, q);
    if (s > 0) {
      hits.push({
        type: "onderdeel",
        title: p.name,
        subtitle: `${p.brand} · ${p.sku} · € ${p.priceEur.toFixed(2).replace(".", ",")}`,
        url: `/onderdelen/${p.sku}`,
        score: s,
      });
    }
  }

  // Guides
  for (const g of guides) {
    const haystack = `${g.title} ${g.summary} ${g.slug}`;
    const s = score(haystack, q);
    if (s > 0) {
      hits.push({
        type: "gids",
        title: g.title,
        subtitle: g.summary?.slice(0, 100),
        url: `/gidsen/${g.slug}`,
        score: s + 3,
      });
    }
  }

  // Help articles
  for (const a of (helpArticles as Array<{ slug: string; title: string; summary: string; category: string }>)) {
    const haystack = `${a.title} ${a.summary} ${a.category}`;
    const s = score(haystack, q);
    if (s > 0) {
      hits.push({
        type: "help",
        title: a.title,
        subtitle: `Helpcentrum · ${a.category}`,
        url: `/help/${a.slug}`,
        score: s,
      });
    }
  }

  // Blog
  for (const b of (blogPosts as Array<{ slug: string; title: string; summary: string; category: string }>)) {
    const haystack = `${b.title} ${b.summary} ${b.category}`;
    const s = score(haystack, q);
    if (s > 0) {
      hits.push({
        type: "blog",
        title: b.title,
        subtitle: `Blog · ${b.category}`,
        url: `/blog/${b.slug}`,
        score: s,
      });
    }
  }

  // Brand pages
  for (const br of (brands as Array<{ slug: string; brand: string; tagline: string }>)) {
    const haystack = `${br.brand} ${br.tagline} wasmachine reparatie`;
    const s = score(haystack, q);
    if (s > 0) {
      hits.push({
        type: "merk",
        title: `${br.brand} wasmachine reparatie`,
        subtitle: br.tagline,
        url: `/${br.slug}-wasmachine-reparatie`,
        score: s + 8, // commercial intent boost
      });
    }
  }

  hits.sort((a, b) => b.score - a.score);
  const top = hits.slice(0, limit);

  return NextResponse.json({ q, hits: top, total: hits.length }, {
    headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=600" },
  });
}
