import * as React from "react";
import { WasFixShell } from "./SharedLayout";

// Shared layout for legal pages — keeps styling consistent across
// /privacy /voorwaarden /cookies /garantie /klachten /disclaimer /retourvoorwaarden
export function LegalPage({
  eyebrow = "Juridisch",
  title,
  emphasis,
  lastUpdate = "23 mei 2026",
  version = "2.1",
  children,
}: {
  eyebrow?: string;
  title: string;
  emphasis: string;
  lastUpdate?: string;
  version?: string;
  children: React.ReactNode;
}) {
  return (
    <WasFixShell>
      <section className="section" style={{ paddingTop: 56 }}>
        <div className="container" style={{ maxWidth: 800 }}>
          <div className="eyebrow">{eyebrow}</div>
          <h1 className="h-display" style={{ fontSize: "clamp(28px, 4vw, 44px)", marginBottom: 8 }}>
            {title} <em>{emphasis}</em>
          </h1>
          <p className="muted mono" style={{ fontSize: 12, marginBottom: 36, letterSpacing: "0.04em" }}>
            Laatste update: {lastUpdate} · Versie {version}
          </p>
          <div className="legal-content">{children}</div>
        </div>
      </section>

      <style>{`
        .legal-content > p:first-of-type { font-size: 16px; }
        .legal-content h2 {
          font-size: 22px; font-weight: 500; letter-spacing: -0.015em;
          margin-top: 36px; margin-bottom: 12px; color: var(--text);
        }
        .legal-content h3 {
          font-size: 16px; font-weight: 500;
          margin-top: 20px; margin-bottom: 8px; color: var(--text);
        }
        .legal-content p { color: var(--text-2); line-height: 1.7; margin: 12px 0; }
        .legal-content ul, .legal-content ol {
          color: var(--text-2); line-height: 1.7; padding-left: 22px; margin: 12px 0;
        }
        .legal-content ul li, .legal-content ol li { margin-bottom: 6px; }
        .legal-content a {
          color: var(--acc-2); text-decoration: underline; text-underline-offset: 2px;
        }
        .legal-content a:hover { color: var(--acc); }
        .legal-content strong { color: var(--text); font-weight: 500; }
        .legal-content .callout {
          background: rgba(79,140,255,0.06);
          border: 1px solid var(--border-ac);
          border-radius: 10px;
          padding: 14px 16px;
          margin: 16px 0;
        }
      `}</style>
    </WasFixShell>
  );
}
