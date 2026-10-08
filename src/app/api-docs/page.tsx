import { WasFixShell } from "@/components/redesign/SharedLayout";
import Link from "next/link";
import { PLAN_API_HOURLY_BURST, PLAN_API_MONTHLY_CALLS } from "@/lib/api-auth";
import { PLANS, type PlanId } from "@/lib/plans";

export const metadata = {
  title: "API Documentatie — Public REST API · WasFix Pro",
  description: "REST API voor diagnose, onderdelen-lookup en foutcode-lookup. Voor monteurs en eigen integraties. Inclusief limieten per plan.",
  alternates: { canonical: "/api-docs" },
};

// The limits are the constants the API enforces (src/lib/api-auth.ts), not
// numbers typed here: a page that promised 1.000 calls per hour while the code
// allowed 10 is how this section went wrong before. scripts/qa-plans.ts calls the
// real routes with these same constants.
const nl = (n: number) => n.toLocaleString("nl-NL");
const LIMIT_PLANS: PlanId[] = ["MONTEUR_PRO", "BEDRIJF"];
const LIMITS = LIMIT_PLANS.map((id) => ({
  name: PLANS[id].name,
  monthly: PLAN_API_MONTHLY_CALLS[id],
  hourly: PLAN_API_HOURLY_BURST[id],
}));
const RATE_LIMIT_TEXT = LIMITS.map((l) => `${l.name}: ${nl(l.hourly)}/uur`).join(" · ");

const ENDPOINTS = [
  {
    method: "POST",
    path: "/api/v1/diagnose",
    desc: "AI-diagnose op basis van brand, model, foutcode + symptomen",
    scope: "read:errorcodes",
    rateLimit: RATE_LIMIT_TEXT,
    body: `{
  "brand": "Bosch",
  "model": "WAU28T40NL",          // optioneel
  "errorCode": "E18",              // optioneel
  "symptoms": "Water blijft staan in de trommel na centrifugeren",
  "language": "nl"                  // nl|en|de|fr, default nl
}`,
    response: `{
  "data": {
    "diagnosis": {
      "mainCause": "Verstopte pluizenfilter of afvoerpomp",
      "confidence": 87,
      "alternativeCauses": ["Geknikte afvoerslang", "Defecte drukschakelaar"],
      "diyFriendly": true,
      "urgency": "medium",
      "recommendedAction": "Open het pluizenfilter en verwijder pluis + muntjes"
    },
    "recommendedParts": [
      { "sku": "WF-PUMP-04", "name": "Afvoerpomp", "priceEur": 38.50, "buyUrl": "https://wasfix.nl/onderdelen/WF-PUMP-04" }
    ],
    "recommendedGuides": [
      { "slug": "afvoerpomp-reinigen-vervangen", "title": "Afvoerpomp reinigen", "url": "https://wasfix.nl/gidsen/afvoerpomp-reinigen-vervangen" }
    ]
  },
  "meta": { "version": "v1", "language": "nl", "model_used": "gemini-2.0-flash" }
}`,
  },
  {
    method: "GET",
    path: "/api/v1/parts/{sku}",
    desc: "Onderdeel-detail op SKU",
    scope: "read:parts",
    rateLimit: RATE_LIMIT_TEXT,
    body: "n/a (GET)",
    response: `{
  "data": {
    "sku": "WF-FILTER-09",
    "name": "Pluizenfilter Bosch ZV-446",
    "category": "FILTER",
    "brand": "Bosch",
    "isOriginal": true,
    "priceEur": 12.50,
    "stock": 60,
    "description": "Origineel pluizenfilter Bosch met knipsluiting",
    "imageUrl": "https://...",
    "oemNumbers": ["00614351"],
    "productUrl": "https://wasfix.nl/onderdelen/WF-FILTER-09"
  },
  "meta": { "version": "v1" }
}`,
  },
  {
    method: "GET",
    path: "/api/v1/errorcodes/{brand}/{code}",
    desc: "Foutcode-detail per merk",
    scope: "read:errorcodes",
    rateLimit: RATE_LIMIT_TEXT,
    body: "n/a (GET)",
    response: `{
  "data": {
    "brand": "Bosch",
    "model": "WAU28T40NL",
    "code": "E18",
    "title": "Afvoer te langzaam",
    "description": "...",
    "likelyCauses": ["Pluizenfilter verstopt", "Afvoerpomp gedeeltelijk verstopt", ...],
    "severity": "MEDIUM",
    "diyFriendly": true,
    "relatedParts": [{ "sku": "WF-PUMP-01", "name": "Afvoerpomp", "priceEur": 32.50 }],
    "relatedGuides": [{ "slug": "afvoerpomp-reinigen-vervangen", "title": "Afvoerpomp...", "difficulty": "EASY" }],
    "detailUrl": "https://wasfix.nl/foutcodes/Bosch-E18"
  },
  "meta": { "version": "v1" }
}`,
  },
  {
    method: "GET",
    path: "/api/v1/health",
    desc: "API-status + endpoint overzicht",
    scope: "none (public)",
    rateLimit: "geen key nodig",
    body: "n/a",
    response: `{
  "status": "ok",
  "version": "v1",
  "timestamp": "2026-05-26T..."
}`,
  },
];

export default function ApiDocsPage() {
  return (
    <WasFixShell>
      <section className="section" style={{ paddingTop: 56 }}>
        <div className="container" style={{ maxWidth: 920 }}>
          <div className="eyebrow">Voor developers + monteurs</div>
          <h1 className="h-display" style={{ fontSize: "clamp(30px, 4.5vw, 48px)", marginBottom: 14 }}>
            REST <em>API</em> v1
          </h1>
          <p className="lead" style={{ marginBottom: 32 }}>
            Integreer WasFix diagnose, onderdelen en foutcodes in jouw planning-software of werkorder-systeem. JSON over HTTPS, authenticatie met een API key.
          </p>

          {/* Quick start */}
          <section style={{ marginBottom: 48 }}>
            <h2 className="h-section" style={{ fontSize: 22, marginBottom: 16 }}>
              Quick start
            </h2>
            <div style={{ background: "var(--surf-2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
              <pre className="mono" style={{ fontSize: 12.5, color: "var(--text-2)", overflowX: "auto", lineHeight: 1.7, margin: 0 }}>
{`# 1. Get your API key
#    → /dashboard/api-keys (Monteur Pro of Bedrijf)

# 2. Test connection
curl https://wasfix.nl/api/v1/health

# 3. Look up a part
curl -H "Authorization: Bearer wf_live_YOUR_KEY" \\
     https://wasfix.nl/api/v1/parts/WF-FILTER-09

# 4. Look up a foutcode
curl -H "Authorization: Bearer wf_live_YOUR_KEY" \\
     https://wasfix.nl/api/v1/errorcodes/Bosch/E18

# 5. Run a diagnose
curl -X POST -H "Authorization: Bearer wf_live_YOUR_KEY" \\
     -H "Content-Type: application/json" \\
     -d '{ "brand": "Bosch", "errorCode": "E18", "symptoms": "Water blijft staan" }' \\
     https://wasfix.nl/api/v1/diagnose`}
              </pre>
            </div>
          </section>

          {/* Auth */}
          <section style={{ marginBottom: 48 }}>
            <h2 className="h-section" style={{ fontSize: 22, marginBottom: 16 }}>
              Authentication
            </h2>
            <p style={{ color: "var(--text-2)", marginBottom: 14, lineHeight: 1.65, fontSize: 14 }}>
              Alle endpoints (behalve <code className="mono" style={{ background: "var(--surf-2)", padding: "1px 6px", borderRadius: 3 }}>/health</code>) vereisen een API key. Drie manieren om de key mee te sturen:
            </p>
            <ol style={{ paddingLeft: 22, color: "var(--text-2)", lineHeight: 1.8, fontSize: 14 }}>
              <li><strong style={{ color: "var(--text)" }}>HTTP header</strong> (aanbevolen): <code className="mono" style={{ background: "var(--surf-2)", padding: "1px 6px", borderRadius: 3 }}>Authorization: Bearer wf_live_XXXX</code></li>
              <li><strong style={{ color: "var(--text)" }}>Custom header</strong>: <code className="mono" style={{ background: "var(--surf-2)", padding: "1px 6px", borderRadius: 3 }}>X-API-Key: wf_live_XXXX</code></li>
              <li><strong style={{ color: "var(--text)" }}>Query parameter</strong> (alleen voor browser-test): <code className="mono" style={{ background: "var(--surf-2)", padding: "1px 6px", borderRadius: 3 }}>?api_key=wf_live_XXXX</code></li>
            </ol>
            <div style={{ marginTop: 16, padding: 14, background: "rgba(255,170,0,0.06)", border: "1px solid var(--warn)", borderRadius: 8 }}>
              <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 4 }}>⚠ Bewaar je API key veilig</div>
              <div style={{ color: "var(--text-2)", fontSize: 12.5, lineHeight: 1.55 }}>
                Geen versie in git commits. Geen client-side JavaScript. Gebruik environment variables in je backend.
              </div>
            </div>
          </section>

          {/* Endpoints */}
          <section style={{ marginBottom: 48 }}>
            <h2 className="h-section" style={{ fontSize: 22, marginBottom: 16 }}>
              Endpoints
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              {ENDPOINTS.map((ep, i) => (
                <article key={i} style={{ background: "var(--surf)", border: "1px solid var(--border)", borderRadius: 12, padding: 22 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                    <span className="mono" style={{
                      padding: "3px 9px",
                      background: ep.method === "GET" ? "rgba(60,200,140,0.12)" : "rgba(79,140,255,0.12)",
                      color: ep.method === "GET" ? "var(--ok)" : "var(--acc-2)",
                      borderRadius: 5,
                      fontSize: 11,
                      fontWeight: 500,
                      letterSpacing: "0.04em",
                    }}>{ep.method}</span>
                    <code className="mono" style={{ fontSize: 13, color: "var(--text)" }}>{ep.path}</code>
                  </div>
                  <p style={{ color: "var(--text-2)", fontSize: 13.5, marginBottom: 14, lineHeight: 1.6 }}>{ep.desc}</p>
                  <div style={{ display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
                    <Meta label="Scope" value={ep.scope} />
                    <Meta label="Rate limit" value={ep.rateLimit} />
                  </div>

                  {ep.body !== "n/a (GET)" && ep.body !== "n/a" && (
                    <>
                      <div className="mono" style={{ fontSize: 11, color: "var(--muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>Request body</div>
                      <pre className="mono" style={{ fontSize: 11.5, color: "var(--text-2)", background: "var(--surf-2)", padding: 12, borderRadius: 8, overflowX: "auto", marginBottom: 12, lineHeight: 1.55 }}>{ep.body}</pre>
                    </>
                  )}
                  <div className="mono" style={{ fontSize: 11, color: "var(--muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>Response 200</div>
                  <pre className="mono" style={{ fontSize: 11.5, color: "var(--text-2)", background: "var(--surf-2)", padding: 12, borderRadius: 8, overflowX: "auto", margin: 0, lineHeight: 1.55 }}>{ep.response}</pre>
                </article>
              ))}
            </div>
          </section>

          {/* Limits */}
          <section style={{ marginBottom: 48 }}>
            <h2 className="h-section" style={{ fontSize: 22, marginBottom: 16 }}>
              Limieten
            </h2>
            <p style={{ color: "var(--text-2)", marginBottom: 14, lineHeight: 1.65, fontSize: 14 }}>
              De limieten volgen het plan van de eigenaar van de key op het moment van de aanvraag, niet het plan van toen de key werd aangemaakt. Na opzeggen of terugvallen naar een plan zonder API antwoordt een key met HTTP 402.
              Het maandtegoed (30 dagen vanaf je eerste call) geldt voor je hele account, niet per key. Een aanvraag die faalt op je invoer (400) of niets vindt (404) telt niet mee voor dat maandtegoed, maar wel voor de limiet per uur.
            </p>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
              <thead>
                <tr style={{ background: "var(--surf-2)" }}>
                  <th style={{ padding: "10px 14px", textAlign: "left", borderBottom: "1px solid var(--border)" }}>Plan</th>
                  <th style={{ padding: "10px 14px", textAlign: "left", borderBottom: "1px solid var(--border)" }}>Calls per maand</th>
                  <th style={{ padding: "10px 14px", textAlign: "left", borderBottom: "1px solid var(--border)" }}>Calls per uur (alle endpoints samen)</th>
                </tr>
              </thead>
              <tbody>
                {LIMITS.map((l) => (
                  <tr key={l.name}>
                    <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", fontWeight: 500 }}>{l.name}</td>
                    <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", color: "var(--text-2)" }}>{nl(l.monthly)}</td>
                    <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", color: "var(--text-2)" }}>{nl(l.hourly)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ color: "var(--text-2)", marginTop: 12, lineHeight: 1.65, fontSize: 13 }}>
              De diagnose is een indicatie van een AI-model, geen garantie. Controleer de oorzaak voordat je een onderdeel vervangt.
            </p>
          </section>

          {/* Error codes */}
          <section style={{ marginBottom: 48 }}>
            <h2 className="h-section" style={{ fontSize: 22, marginBottom: 16 }}>
              HTTP status codes
            </h2>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
              <thead>
                <tr style={{ background: "var(--surf-2)" }}>
                  <th style={{ padding: "10px 14px", textAlign: "left", borderBottom: "1px solid var(--border)" }}>Status</th>
                  <th style={{ padding: "10px 14px", textAlign: "left", borderBottom: "1px solid var(--border)" }}>Betekenis</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["200", "Success"],
                  ["400", "Invalid input (zie response.details)"],
                  ["401", "Missing or invalid API key"],
                  ["402", "Key geschorst: het account achter de key heeft geen plan met API meer (zie je dashboard)"],
                  ["403", "Insufficient scope (key heeft niet juiste rechten)"],
                  ["404", "Resource niet gevonden"],
                  ["429", "Uurlimiet of maandtegoed op (zie response.limit of response.used)"],
                  ["500", "Internal error — probeer opnieuw"],
                  ["502", "Upstream service unavailable (bv. Gemini API)"],
                ].map(([code, meaning]) => (
                  <tr key={code}>
                    <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", fontWeight: 500 }} className="mono">{code}</td>
                    <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", color: "var(--text-2)" }}>{meaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* CTA */}
          <div style={{ padding: 28, background: "linear-gradient(135deg, rgba(79,140,255,0.08), rgba(0,212,255,0.04))", border: "1px solid var(--border-ac)", borderRadius: 14, textAlign: "center" }}>
            <h2 style={{ fontSize: 20, fontWeight: 500, marginBottom: 8 }}>Klaar om te integreren?</h2>
            <p className="muted" style={{ marginBottom: 18, fontSize: 13.5 }}>
              Monteur Pro €29/mnd excl. btw — {nl(LIMITS[0].monthly)} calls per maand inbegrepen. Bedrijf €199/mnd excl. btw — {nl(LIMITS[1].monthly)} calls per maand. Is je maandtegoed op, dan antwoordt de API met HTTP 429 tot de periode is verlopen; er is geen betaald bijkopen. Meer nodig? Neem contact op.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center" }}>
              <Link className="btn btn-primary" href="/monteur">Word Monteur Pro</Link>
              <Link className="btn" href="/api-info">Use cases + technische FAQ</Link>
            </div>
          </div>
        </div>
      </section>
    </WasFixShell>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "var(--surf-2)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 10px", fontSize: 11.5 }}>
      <span className="muted" style={{ marginRight: 6 }}>{label}:</span>
      <span style={{ fontWeight: 500 }}>{value}</span>
    </div>
  );
}
