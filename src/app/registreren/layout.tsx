import type { Metadata } from "next";
import type { ReactNode } from "react";
import { robotsMeta } from "@/lib/seo";

// A private or transactional area: nothing below this path is for a search engine. The robots tag here, the
// Disallow line in robots.txt and the X-Robots-Tag header from next.config.ts all come from the same list
// (PRIVATE_PATH_PREFIXES in src/lib/seo.ts); scripts/qa-seo.ts fails when one of the three is missing.
export const metadata: Metadata = { robots: robotsMeta(false, false) };

export default function PrivateAreaLayout({ children }: { children: ReactNode }) {
  return children;
}
