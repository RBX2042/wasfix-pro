import { env } from "@/lib/env";
import { MetadataRoute } from "next";
import { dbErrorCodes, dbMachines, dbParts, dbGuides } from "@/lib/static-db";
import helpArticles from "@/data/help-articles.json";
import blogPosts from "@/data/blog-posts.json";
import cities from "@/data/cities.json";
import brandsData from "@/data/brands.json";
import comparisons from "@/data/comparisons.json";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = env.APP_URL;

  // Same source as the pages themselves: a part the admin created has to be in
  // here, one that was withdrawn must not be — a sitemap of URLs that 404 is
  // worse than no sitemap. Falls back to src/data when there is no database.
  const [ecRows, guideRows, machineRows, partRows] = await Promise.all([
    dbErrorCodes({}),
    dbGuides(),
    dbMachines(),
    dbParts(),
  ]);
  const errorCodes = ecRows.map((ec) => ({ code: ec.code, machine: { brand: ec.machine.brand } }));
  const guides = guideRows.map((g) => ({ slug: g.slug, createdAt: new Date(g.createdAt) }));
  const machines = machineRows.map((m) => ({ brand: m.brand, model: m.model }));
  const parts = partRows.map((p) => ({ sku: p.sku }));

  const now = new Date();

  const staticPages = [
    "/",
    "/diagnose",
    "/merken",
    "/foutcodes",
    "/gidsen",
    "/onderdelen",
    "/prijzen",
    "/monteur",
    "/help",
    "/blog",
    "/pers",
    "/right-to-repair",
    "/api-docs",
    "/contact",
    "/over",
    "/api-info",
    "/privacy",
    "/voorwaarden",
    "/cookies",
    "/garantie",
    "/klachten",
    "/disclaimer",
    "/retourvoorwaarden",
    "/retour/start",
    "/tools/repareren-of-vervangen",
    "/tools/garantie-check",
    "/tools/predictive",
    "/tools/qr-sticker",
  ].map((path) => ({
    url: `${baseUrl}${path}`,
    lastModified: now,
    changeFrequency: "weekly" as const,
    priority: path === "/" ? 1 : path === "/diagnose" ? 0.95 : 0.8,
  }));

  const helpPages = (helpArticles as Array<{ slug: string }>).map((a) => ({
    url: `${baseUrl}/help/${a.slug}`,
    lastModified: now,
    changeFrequency: "monthly" as const,
    priority: 0.65,
  }));

  const blogPages = (blogPosts as Array<{ slug: string; publishedAt: string }>).map((p) => ({
    url: `${baseUrl}/blog/${p.slug}`,
    lastModified: new Date(p.publishedAt),
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }));

  // Programmatic SEO: 50 NL city pages
  const cityPages = (cities as Array<{ slug: string }>).map((c) => ({
    url: `${baseUrl}/wasmachine-kapot/${c.slug}`,
    lastModified: now,
    changeFrequency: "monthly" as const,
    priority: 0.65,
  }));

  // Programmatic SEO: per-brand commercial-intent pages
  const brandRepairPages = (brandsData as Array<{ slug: string }>).map((b) => ({
    url: `${baseUrl}/${b.slug}-wasmachine-reparatie`,
    lastModified: now,
    changeFrequency: "weekly" as const,
    priority: 0.75,
  }));

  // Comparison pages
  const vsPages = (comparisons as Array<{ slug: string }>).map((c) => ({
    url: `${baseUrl}/vs/${c.slug}`,
    lastModified: now,
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }));

  const errorCodePages = errorCodes.map((ec) => ({
    url: `${baseUrl}/foutcodes/${encodeURIComponent(ec.machine.brand)}-${encodeURIComponent(ec.code)}`,
    lastModified: now,
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }));

  const guidePages = guides.map((g) => ({
    url: `${baseUrl}/gidsen/${g.slug}`,
    lastModified: g.createdAt,
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }));

  const brands = Array.from(new Set(machines.map((m) => m.brand)));
  const brandPages = brands.map((brand) => ({
    url: `${baseUrl}/merken/${encodeURIComponent(brand)}`,
    lastModified: now,
    changeFrequency: "weekly" as const,
    priority: 0.75,
  }));

  const modelPages = machines.map((m) => ({
    url: `${baseUrl}/merken/${encodeURIComponent(m.brand)}/${encodeURIComponent(m.model)}`,
    lastModified: now,
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));

  const partPages = parts.map((p) => ({
    url: `${baseUrl}/onderdelen/${p.sku}`,
    lastModified: now,
    changeFrequency: "weekly" as const,
    priority: 0.6,
  }));

  return [...staticPages, ...helpPages, ...blogPages, ...cityPages, ...brandRepairPages, ...vsPages, ...errorCodePages, ...guidePages, ...brandPages, ...modelPages, ...partPages];
}
