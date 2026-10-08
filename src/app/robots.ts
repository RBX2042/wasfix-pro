import { siteUrl } from "@/lib/site-url";
import { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  // null = production without a usable NEXT_PUBLIC_APP_URL: say nothing about
  // where the sitemap is rather than name http://localhost:3000 (src/lib/site-url.ts).
  const base = siteUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/"],
        // Don't index user-private or admin areas, but allow /monteur (public landing)
        disallow: [
          "/api/",
          "/admin/",
          "/dashboard/",
          "/monteur/dashboard/",
          "/monteur/klanten/",
          "/monteur/onderdelen/",
          "/monteur/werkorders/",
          "/checkout",
          "/inloggen",
          "/registreren",
          "/bestelling/",
          "/upgrade",
          "/*?ref=*", // strip referral-tracking parameters
          "/*?utm_*", // strip UTM parameters
        ],
      },
      {
        // Block AI training scrapers (we explicitly opt out — content is human-curated)
        userAgent: [
          "GPTBot",
          "ChatGPT-User",
          "Google-Extended",
          "CCBot",
          "anthropic-ai",
          "Claude-Web",
          "PerplexityBot",
          "Bytespider",
        ],
        disallow: ["/"],
      },
    ],
    ...(base ? { sitemap: [`${base}/sitemap.xml`], host: base } : {}),
  };
}
