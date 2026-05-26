import { env } from "@/lib/env";
import { MetadataRoute } from "next";
import {
  errorCodes as staticEcs,
  machines as staticMachines,
  parts as staticParts,
  guides as staticGuides,
} from "@/lib/static-db";
import helpArticles from "@/data/help-articles.json";
import blogPosts from "@/data/blog-posts.json";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = env.APP_URL;

  // All data from static catalog — instant, no DB dependency
  const errorCodes = staticEcs.map((ec) => {
    const machine = staticMachines.find((m) => m.id === ec.machineId);
    return { code: ec.code, machine: { brand: machine?.brand ?? "" } };
  });
  const guides = staticGuides.map((g) => ({ slug: g.slug, createdAt: new Date(g.createdAt) }));
  const machines = staticMachines.map((m) => ({ brand: m.brand, model: m.model }));
  const parts = staticParts.map((p) => ({ sku: p.sku }));

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

  return [...staticPages, ...helpPages, ...blogPages, ...errorCodePages, ...guidePages, ...brandPages, ...modelPages, ...partPages];
}
