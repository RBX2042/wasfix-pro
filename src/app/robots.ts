import { siteUrl } from "@/lib/site-url";
import { PRIVATE_PATH_PREFIXES, isNonProductionDeployment } from "@/lib/seo";
import { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  // A preview or development deployment is not the shop: nothing on it is for a search engine.
  if (isNonProductionDeployment()) return { rules: [{ userAgent: "*", disallow: ["/"] }] };

  // null = production without a usable NEXT_PUBLIC_APP_URL: say nothing about
  // where the sitemap is rather than name http://localhost:3000 (src/lib/site-url.ts).
  const base = siteUrl();
  return {
    rules: [
      {
        userAgent: "*",
        // No `Allow: /` line: allowed is the default, and emitted before the Disallow lines it made a parser that
        // reads the first matching rule (not the longest, as Google and Bing do) read every private path as open.
        // Exactly the private and transactional paths (src/lib/seo.ts), and nothing a page needs to render:
        // /_next/ (CSS, JS, fonts), /icon, /opengraph-image and the images are crawlable. Tracking parameters
        // (?utm_*, ?ref=) are not blocked: a robots.txt cannot strip a parameter, and a blocked address cannot
        // show its canonical, so a link with ?utm_source=... would sit in the index as an empty entry; the
        // page names itself without the query string and those addresses consolidate onto it.
        disallow: [...PRIVATE_PATH_PREFIXES],
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
    // `host` is a Yandex-only directive that Google ignores. It stays because scripts/qa-platform.ts asserts it;
    // the sitemap line is the one that counts.
    ...(base ? { sitemap: [`${base}/sitemap.xml`], host: base } : {}),
  };
}
