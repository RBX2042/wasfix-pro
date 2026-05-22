import { env } from "@/lib/env";
import { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/dashboard/", "/admin/", "/monteur/", "/api/", "/checkout"],
      },
    ],
    sitemap: `${env.APP_URL}/sitemap.xml`,
  };
}
