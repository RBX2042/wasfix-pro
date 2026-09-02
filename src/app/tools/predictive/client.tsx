"use client";

import * as React from "react";
import { Icon } from "@/components/redesign/SharedLayout";
import { computePredictive, type RiskItem } from "@/lib/predictive";
import { useCart } from "@/components/cart-provider";
import { toast } from "sonner";

const BRANDS = ["Miele", "Bosch", "Siemens", "Samsung", "LG", "AEG", "Electrolux", "Zanussi", "Whirlpool", "Indesit", "Hotpoint", "Beko", "Haier", "Candy", "Panasonic"];

export function PredictiveClient() {
  const [brand, setBrand] = React.useState("");
  const [purchaseYear, setPurchaseYear] = React.useState("");
  const [result, setResult] = React.useState<RiskItem[] | null>(null);
  const add = useCart((s) => s.add);

  function calculate(e: React.FormEvent) {
    e.preventDefault();
    if (!brand || !purchaseYear) return;
    const ageMonths = (new Date().getFullYear() - parseInt(purchaseYear, 10)) * 12;
    setResult(computePredictive(brand, ageMonths));
  }

  function reset() {
    setResult(null);
    setBrand("");
    setPurchaseYear("");
  }

  async function addPreventiveBundle(top3: RiskItem[]) {
    // Fetch real part data for the top SKUs and add to cart
    try {
      const skus = top3.flatMap((r) => r.recommendedSkus.slice(0, 1));
      const added: string[] = [];
      for (const sku of skus) {
        const res = await fetch(`/api/parts/${sku}`);
        if (!res.ok) continue;
        const data = await res.json();
        const p = data.data ?? data.part ?? data;
        if (!p?.sku) continue;
        add({
          partId: p.id ?? p.sku,
          sku: p.sku,
          name: p.name,
          brand: p.brand,
          priceEur: p.priceEur,
          imageUrl: p.imageUrl ?? null,
        }, 1);
        added.push(p.name);
      }
      if (added.length) {
        toast.success(`${added.length} onderdelen toegevoegd aan winkelmand`);
      } else {
        toast.error("Geen onderdelen gevonden");
      }
    } catch {
      toast.error("Kon onderdelen niet ophalen");
    }
  }

  if (result) {
    const top3 = result.slice(0, 3);
    const overall = Math.round(result.reduce((sum, r) => sum + r.healthPct, 0) / result.length);
    return (
      <div>
        {/* Overall health */}
        <div style={{
          background: overall > 70 ? "rgba(60,200,140,0.08)" : overall > 40 ? "rgba(255,170,0,0.08)" : "rgba(255,80,80,0.08)",
          border: `1px solid ${overall > 70 ? "var(--ok)" : overall > 40 ? "var(--warn)" : "var(--danger)"}`,
          borderRadius: 12,
          padding: 24,
          marginBottom: 24,
          textAlign: "center",
        }}>
          <div className="mono" style={{ fontSize: 11, color: "var(--muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>
            Algemene health-score
          </div>
          <div style={{ fontSize: 56, fontWeight: 300, color: overall > 70 ? "var(--ok)" : overall > 40 ? "var(--warn)" : "var(--danger)", letterSpacing: "-0.03em", lineHeight: 1 }}>
            {overall}%
          </div>
          <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 8 }}>
            {overall > 70 ? "Je machine is in goede staat. Continueer regelmatig onderhoud." : overall > 40 ? "Aandacht nodig — overweeg preventief de top-3 risico's te vervangen." : "Verhoogd risico — proactief vervangen voorkomt totale uitval."}
          </div>
        </div>

        {/* Per-category bar list */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
          {result.map((r) => {
            const color = r.healthPct > 70 ? "var(--ok)" : r.healthPct > 40 ? "var(--warn)" : "var(--danger)";
            return (
              <div key={r.category} style={{ background: "var(--surf)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 18px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8, gap: 12 }}>
                  <div style={{ fontWeight: 500, fontSize: 14 }}>{r.label}</div>
                  <div style={{ fontSize: 16, fontWeight: 500, color, fontVariantNumeric: "tabular-nums" }}>{r.healthPct}%</div>
                </div>
                <div style={{ height: 6, background: "var(--surf-2)", borderRadius: 3, overflow: "hidden", marginBottom: 8 }}>
                  <div style={{ height: "100%", background: color, width: `${r.healthPct}%`, transition: "width 0.3s" }} />
                </div>
                <div className="muted" style={{ fontSize: 12, lineHeight: 1.55 }}>
                  {r.monthsToLikelyFailure != null && (
                    <span style={{ color: "var(--warn)", marginRight: 8 }}>⚠ ~{r.monthsToLikelyFailure} maanden tot waarschijnlijk falen.</span>
                  )}
                  {r.preventiveTip}
                </div>
              </div>
            );
          })}
        </div>

        {/* Top-3 preventive bundle */}
        <div style={{ background: "linear-gradient(135deg, rgba(79,140,255,0.08), rgba(0,212,255,0.04))", border: "1px solid var(--border-ac)", borderRadius: 14, padding: 24, marginBottom: 24 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Preventief bestel-pakket</div>
          <h3 style={{ fontSize: 18, fontWeight: 500, marginBottom: 8 }}>Top 3 onderdelen om eerst aan te pakken</h3>
          <ol style={{ paddingLeft: 22, color: "var(--text-2)", lineHeight: 1.7, fontSize: 14, marginBottom: 16 }}>
            {top3.map((r) => (
              <li key={r.category}>
                <strong style={{ color: "var(--text)" }}>{r.label}</strong> — health {r.healthPct}%
              </li>
            ))}
          </ol>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            <button className="btn btn-primary" onClick={() => addPreventiveBundle(top3)}>
              <Icon name="cart" size={13} /> Voeg pakket toe aan winkelmand
            </button>
            <button className="btn btn-ghost btn-sm" onClick={reset}>
              <Icon name="repeat" size={12} /> Andere machine
            </button>
          </div>
        </div>

        <div style={{ padding: 18, background: "var(--surf-2)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.6 }}>
          <strong style={{ color: "var(--text)" }}>Hoe komen we aan deze score?</strong><br />
          We combineren je merk + leeftijd met statistische MTTF-data per onderdeelcategorie. Brand-betrouwbaarheid is gebaseerd op publieke betrouwbaarheidsonderzoeken (Consumentenbond, Stiftung Warentest) en onze interne diagnose-data (50K+ samples). De score is een waarschijnlijkheid, geen voorspelling — sommige machines gaan jaren langer, sommige korter mee.
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={calculate} style={{ background: "var(--surf)", border: "1px solid var(--border)", borderRadius: 12, padding: 28 }}>
      <div style={{ display: "grid", gap: 16 }}>
        <div>
          <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
            Merk <span style={{ color: "var(--danger)" }}>*</span>
          </label>
          <select value={brand} onChange={(e) => setBrand(e.target.value)} required style={inputStyle}>
            <option value="">— Selecteer merk —</option>
            {BRANDS.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>

        <div>
          <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
            Aankoopjaar <span style={{ color: "var(--danger)" }}>*</span>
          </label>
          <input
            type="number"
            value={purchaseYear}
            onChange={(e) => setPurchaseYear(e.target.value)}
            placeholder="bv. 2018"
            min="1990"
            max={new Date().getFullYear()}
            required
            style={inputStyle}
          />
          <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>Bouwjaar / jaar van aanschaf — exacte datum hoeft niet</div>
        </div>

        <button type="submit" className="btn btn-primary" style={{ marginTop: 4, justifyContent: "center" }}>
          <Icon name="pulse" size={14} /> Bereken health-score
        </button>
      </div>

      <div style={{ marginTop: 18, padding: 14, background: "var(--surf-2)", borderRadius: 8, fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.55 }}>
        <strong style={{ color: "var(--text)" }}>Wat krijg je?</strong> Score per onderdeel (pomp, lagers, motor, etc.), preventief bestel-pakket voor top-3 risico&apos;s, en tips om levensduur te verlengen.
      </div>
    </form>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  background: "var(--surf-2)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--text)",
  fontSize: 14,
  fontFamily: "inherit",
};
