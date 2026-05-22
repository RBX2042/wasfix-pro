import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { MetadataRoute } from "next";

// Sitemap is generated at runtime, not build time — keeps build green even
// without DB connectivity (DATABASE_URL not yet configured in deploy env).
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = env.APP_URL;

  // If the DB isn't reachable (e.g. before DATABASE_URL is set in Vercel), still
  // emit the static URLs so the site can be indexed and the build won't fail.
  let errorCodes: Array<{ code: string; machine: { brand: string } }> = [];
  let guides: Array<{ slug: string; createdAt: Date }> = [];
  let machines: Array<{ brand: string; model: string }> = [];
  let parts: Array<{ sku: string }> = [];
  try {
    [errorCodes, guides, machines, parts] = await Promise.all([
      prisma.errorCode.findMany({ select: { code: true, machine: { select: { brand: true } } } }),
      prisma.repairGuide.findMany({ select: { slug: true, createdAt: true } }),
      prisma.washingMachine.findMany({ select: { brand: true, model: true } }),
      prisma.part.findMany({ select: { sku: true } }),
    ]);
  } catch {
    // DB unreachable — fall through with empty arrays
  }

  const now = new Date();

  const staticPages = [
    "/",
    "/diagnose",
    "/merken",
    "/foutcodes",
    "/gidsen",
    "/onderdelen",
    "/prijzen",
    "/help",
    "/contact",
    "/over",
    "/privacy",
    "/voorwaarden",
    "/api-info",
    "/tools/repareren-of-vervangen",
  ].map((path) => ({
    url: `${baseUrl}${path}`,
    lastModified: now,
    changeFrequency: "weekly" as const,
    priority: path === "/" ? 1 : path === "/diagnose" ? 0.95 : 0.8,
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

  return [...staticPages, ...errorCodePages, ...guidePages, ...brandPages, ...modelPages, ...partPages];
}
