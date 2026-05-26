"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { locales, localeNames, localeFlags, defaultLocale, type Locale } from "@/i18n/config";

// Language switcher dropdown — visible in nav once i18n is enabled.
// Reads current locale from pathname (first segment if any).
export function LanguageSwitcher() {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  // Detect current locale
  const segments = pathname.split("/").filter(Boolean);
  const firstSegment = segments[0];
  const currentLocale: Locale = (locales as readonly string[]).includes(firstSegment)
    ? (firstSegment as Locale)
    : defaultLocale;

  // Strip locale prefix from path to get the base path
  const basePath = (locales as readonly string[]).includes(firstSegment)
    ? "/" + segments.slice(1).join("/")
    : pathname;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="btn btn-ghost btn-sm"
        style={{ display: "flex", alignItems: "center", gap: 6 }}
        aria-label="Verander taal"
      >
        <span style={{ fontSize: 16 }}>{localeFlags[currentLocale]}</span>
        <span style={{ fontSize: 11.5, textTransform: "uppercase", letterSpacing: "0.08em" }}>{currentLocale}</span>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            background: "var(--surf)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: 6,
            minWidth: 180,
            zIndex: 100,
            boxShadow: "0 12px 32px -6px rgba(0,0,0,0.5)",
          }}
        >
          {locales.map((loc) => {
            const target = loc === defaultLocale ? basePath : `/${loc}${basePath}`;
            const isActive = loc === currentLocale;
            return (
              <Link
                key={loc}
                href={target}
                onClick={() => setOpen(false)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 12px",
                  borderRadius: 6,
                  textDecoration: "none",
                  color: "var(--text)",
                  fontSize: 13,
                  background: isActive ? "rgba(79,140,255,0.1)" : "transparent",
                }}
              >
                <span style={{ fontSize: 18 }}>{localeFlags[loc]}</span>
                <span style={{ flex: 1 }}>{localeNames[loc]}</span>
                {isActive && <span style={{ color: "var(--acc-2)", fontSize: 12 }}>•</span>}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
