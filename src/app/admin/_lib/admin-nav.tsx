import Link from "next/link";

const LINKS = [
  { href: "/admin", label: "Overzicht" },
  { href: "/admin/bestellingen", label: "Bestellingen" },
  { href: "/admin/retouren", label: "Retouren" },
  { href: "/admin/onderdelen", label: "Onderdelen" },
  { href: "/admin/economie", label: "Economie & btw" },
  { href: "/admin/aanvragen", label: "Aanvragen" },
  { href: "/admin/gebruikers", label: "Gebruikers" },
  { href: "/admin/analytics", label: "Analytics" },
  { href: "/admin/gidsen", label: "Gidsen" },
  { href: "/admin/foutcodes", label: "Foutcodes" },
  { href: "/admin/ai-quality", label: "AI-kwaliteit" },
];

/** Section links for the admin pages; the shared sidebar only has one "Admin" entry. */
export function AdminNav({ current }: { current: string }) {
  return (
    <nav aria-label="Beheer" className="mb-6 flex flex-wrap gap-1 print:hidden">
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          aria-current={l.href === current ? "page" : undefined}
          className={`rounded-md px-3 py-1.5 text-sm ${l.href === current ? "bg-primary text-primary-foreground" : "bg-muted/60 hover:bg-muted"}`}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
