import { siteUrl } from "@/lib/site-url";
import { logger } from "@/lib/logger";
import { MetadataRoute } from "next";
import { dbErrorCodes, dbMachines, dbParts, dbGuides } from "@/lib/static-db";
import helpArticles from "@/data/help-articles.json";
import blogPosts from "@/data/blog-posts.json";
import brandsData from "@/data/brands.json";
import comparisons from "@/data/comparisons.json";

// Regenerated at most hourly. Without this the sitemap is rendered once at build
// time: a part an admin creates later would only appear after the next deploy.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = siteUrl();
  if (!baseUrl) {
    // Production without a usable NEXT_PUBLIC_APP_URL. Search Console rejects a
    // sitemap whose URLs are on another host, and http://localhost:3000 used to be
    // published here. An empty sitemap is wrong too, but visibly so and harmless.
    logger.error("[sitemap] NEXT_PUBLIC_APP_URL is unusable in production: publishing an empty sitemap");
    return [];
  }

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

  // lastmod is published ONLY where a row really has a date (blog posts, guides). It used to be
  // "now" on every entry, which with hourly regeneration made every page "modified this hour"
  // forever; Google then ignores lastmod for the whole sitemap. Parts, error codes and models
  // carry no date in src/lib/static-db.ts, so they publish none.
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
    changeFrequency: "weekly" as const,
    priority: path === "/" ? 1 : path === "/diagnose" ? 0.95 : 0.8,
  }));

  const helpPages = (helpArticles as Array<{ slug: string }>).map((a) => ({
    url: `${baseUrl}/help/${a.slug}`,
    changeFrequency: "monthly" as const,
    priority: 0.65,
  }));

  const blogPages = (blogPosts as Array<{ slug: string; publishedAt: string }>).map((p) => ({
    url: `${baseUrl}/blog/${p.slug}`,
    lastModified: new Date(p.publishedAt),
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }));

  // City pages (/wasmachine-kapot/*) are NOT listed: they are noindex until they carry
  // content of their own, and a sitemap that submits noindex URLs is a contradictory
  // signal (Search Console: "Submitted URL marked noindex"). Add them back together
  // with the removal of their noindex.

  // Per-brand commercial-intent pages. A brand with no machines, codes or parts in the
  // catalogue (Zanussi, Hotpoint, Candy, Haier, Panasonic) is noindex on its page, so it
  // is left out here by the same rule that page uses.
  const catalogueBrands = new Set(errorCodes.map((ec) => ec.machine.brand));
  const brandRepairPages = (brandsData as Array<{ slug: string; brand: string }>)
    .filter((b) => catalogueBrands.has(b.brand))
    .map((b) => ({
      url: `${baseUrl}/${b.slug}-wasmachine-reparatie`,
        changeFrequency: "weekly" as const,
      priority: 0.75,
    }));

  // Comparison pages
  const vsPages = (comparisons as Array<{ slug: string }>).map((c) => ({
    url: `${baseUrl}/vs/${c.slug}`,
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }));

  const errorCodePages = errorCodes.map((ec) => ({
    url: `${baseUrl}/foutcodes/${encodeURIComponent(ec.machine.brand)}-${encodeURIComponent(ec.code)}`,
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
    changeFrequency: "weekly" as const,
    priority: 0.75,
  }));

  const modelPages = machines.map((m) => ({
    url: `${baseUrl}/merken/${encodeURIComponent(m.brand)}/${encodeURIComponent(m.model)}`,
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));

  const partPages = parts.map((p) => ({
    url: `${baseUrl}/onderdelen/${p.sku}`,
    changeFrequency: "weekly" as const,
    priority: 0.6,
  }));

  return [...staticPages, ...helpPages, ...blogPages, ...brandRepairPages, ...vsPages, ...errorCodePages, ...guidePages, ...brandPages, ...modelPages, ...partPages];
}
