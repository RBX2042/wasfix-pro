import type { ReactNode } from "react";
import { pageDescription, pageMetadata, pageTitle } from "@/lib/seo";

// cookies/page.tsx is a client component (it resets the consent cookie), and a
// client component cannot export metadata; this layout carries it.
export const metadata = pageMetadata({
  title: pageTitle("Cookiebeleid"),
  description: pageDescription("Welke cookies WasFix Pro gebruikt, waarvoor, en hoe je je keuze wijzigt of intrekt."),
  path: "/cookies",
});

export default function CookiesLayout({ children }: { children: ReactNode }) {
  return children;
}
