import { env } from "@/lib/env";
import { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
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
    sitemap: [
      `${env.APP_URL}/sitemap.xml`,
      // Future: per-language sitemap-index when i18n ships
    ],
    host: env.APP_URL,
  };
}
