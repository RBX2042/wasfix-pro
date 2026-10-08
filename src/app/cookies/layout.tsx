import type { ReactNode } from "react";

// cookies/page.tsx is a client component (it resets the consent cookie), and a
// client component cannot export metadata; this layout carries it.
export const metadata = {
  title: "Cookiebeleid",
  description: "Welke cookies WasFix Pro gebruikt, waarvoor, en hoe je je keuze wijzigt of intrekt.",
  alternates: { canonical: "/cookies" },
};

export default function CookiesLayout({ children }: { children: ReactNode }) {
  return children;
}
