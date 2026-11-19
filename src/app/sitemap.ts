import { siteUrl } from "@/lib/site-url";
import { logger } from "@/lib/logger";
import { MetadataRoute } from "next";
import { dbErrorCodes, dbMachines, dbParts, dbGuides } from "@/lib/static-db";
import { SITEMAP_STATIC_PATHS, coveredBrands, indexability } from "@/lib/seo";
import helpArticles from "@/data/help-articles.json";
import blogPosts from "@/data/blog-posts.json";
import brandsData from "@/data/brands.json";
import citiesData from "@/data/cities.json";
import comparisons from "@/data/comparisons.json";

// Regenerated at most every 60 seconds, the window of the catalogue reads below (CATALOG_REVALIDATE_SECONDS in
// src/lib/cache-tags.ts: with a database they go through the data cache, whose window lowers the route's). This used
// to say 3600 ("at most hourly"), but the build already counted 60 (prerender-manifest initialRevalidateSeconds 60,
// "/sitemap.xml 1m" in the build table); the number is written out because segment config must be a literal, and
// scripts/qa-seo.ts checks that the two agree. Without it a sitemap read from src/data (no database) would be
// rendered once at build time. A row deleted straight in the database (another QA suite's part) stays listed until
// the sitemap and the data cache have both expired: up to about two windows (decision D25).
export const revalidate = 60;

/**
 * The sitemap lists exactly the pages that are indexable (src/lib/seo.ts indexability(), the same function the
 * pages' robots tags ask), answer 200 and name themselves as canonical. Nothing else: no private page, no
 * parameter variant, no thin page. scripts/qa-seo.ts opens every URL in it (a sample of each family, or all
 * with QA_SEO_FULL=1) and checks that.
 *
 * No changefreq and no priority: they were typed by hand ("weekly" on the privacy policy), Google documents
 * ignoring both and Bing does not rely on them. A lastmod appears only where a row has a real publication or
 * change date (blog posts), never an import timestamp.
 */
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
  // In slug order: dbGuides() lists by views, then createdAt, so every guide visit changed the sitemap's order at its next
  // regeneration (and 20 guides share one createdAt). The other families keep their order: parts by SKU, models by brand and
  // model, error codes by severity and code (rows nothing but the admin changes; no visit writes to them).
  const guides = guideRows.map((g) => ({ slug: g.slug })).sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const machines = machineRows.map((m) => ({ brand: m.brand, model: m.model }));
  const parts = partRows.map((p) => ({ sku: p.sku }));

  // lastmod is published ONLY where a row has a real date of publication or change: blog posts (publishedAt, the
  // date the post prints). It used to be "now" on every entry, which with every regeneration made every page
  // "modified just now" forever; Google then ignores lastmod for the whole sitemap. Guides carry only createdAt, the
  // moment a row was imported (two imports: 6 guides within 5 ms on 27 April, 20 at the same millisecond on 26 May),
  // which says nothing about when a guide was written or changed, so they publish none (decision D25); nor do parts,
  // error codes and models, which carry no date at all. scripts/qa-seo.ts checks both: no lastmod outside the blog,
  // and the blog's is its publishedAt.
  const staticPages = SITEMAP_STATIC_PATHS.map((path) => ({ url: `${baseUrl}${path}` }));

  const helpPages = (helpArticles as Array<{ slug: string }>).map((a) => ({ url: `${baseUrl}/help/${a.slug}` }));

  const blogPages = (blogPosts as Array<{ slug: string; publishedAt: string }>).map((p) => ({
    url: `${baseUrl}/blog/${p.slug}`,
    lastModified: new Date(p.publishedAt),
  }));

  // City pages (/wasmachine-kapot/*): listed only when indexability() says they are indexable. Today they are not
  // (a template with the city name swapped in), and a sitemap that submits noindex URLs is a contradictory
  // signal (Search Console: "Submitted URL marked noindex"). Flip CITY_PAGES_INDEXABLE in src/lib/seo.ts and the
  // page's robots tag and this list change together.
  const cityPages = (citiesData as Array<{ slug: string }>)
    .filter(() => indexability({ kind: "city" }).index)
    .map((c) => ({ url: `${baseUrl}/wasmachine-kapot/${c.slug}` }));

  // Per-brand commercial-intent pages. A brand with no machines, codes or parts in the
  // catalogue (Zanussi, Hotpoint, Candy, Haier, Panasonic) is noindex on its page, so it
  // is left out here by the same rule that page uses.
  const covered = coveredBrands(errorCodes);
  const brandRepairPages = (brandsData as Array<{ slug: string; brand: string }>)
    .filter((b) => indexability({ kind: "brandRepair", brand: b.brand, covered }).index)
    .map((b) => ({ url: `${baseUrl}/${b.slug}-wasmachine-reparatie` }));

  // Comparison pages
  const vsPages = (comparisons as Array<{ slug: string }>).map((c) => ({ url: `${baseUrl}/vs/${c.slug}` }));

  const errorCodePages = errorCodes.map((ec) => ({
    url: `${baseUrl}/foutcodes/${encodeURIComponent(ec.machine.brand)}-${encodeURIComponent(ec.code)}`,
  }));

  const guidePages = guides.map((g) => ({ url: `${baseUrl}/gidsen/${g.slug}` }));

  const modelsPerBrand = new Map<string, number>();
  for (const m of machines) modelsPerBrand.set(m.brand, (modelsPerBrand.get(m.brand) ?? 0) + 1);
  const brandPages = [...modelsPerBrand.entries()]
    .filter(([, n]) => indexability({ kind: "brandHub", machines: n }).index)
    .map(([brand]) => ({ url: `${baseUrl}/merken/${encodeURIComponent(brand)}` }));

  const modelPages = machines.map((m) => ({
    url: `${baseUrl}/merken/${encodeURIComponent(m.brand)}/${encodeURIComponent(m.model)}`,
  }));

  // encodeURIComponent like the page's own canonical: a SKU with a space or a slash would otherwise name another address.
  const partPages = parts.map((p) => ({ url: `${baseUrl}/onderdelen/${encodeURIComponent(p.sku)}` }));

  return [
    ...staticPages,
    ...helpPages,
    ...blogPages,
    ...cityPages,
    ...brandRepairPages,
    ...vsPages,
    ...errorCodePages,
    ...guidePages,
    ...brandPages,
    ...modelPages,
    ...partPages,
  ];
}
