"use client";

import * as React from "react";
import Link from "next/link";
import { Icon } from "@/components/redesign/SharedLayout";

type Result = {
  brand: string;
  model: string;
  purchaseDate: Date;
  factoryWarrantyMonths: number;
  factoryWarrantyEnds: Date;
  consumerLawEnds: Date;
  partsAvailableUntil: Date;
  yearsOwned: number;
  status: "GREEN" | "YELLOW" | "RED";
};

// Per-brand fabrieksgarantie in maanden (publiek bekend)
const WARRANTY_BY_BRAND: Record<string, number> = {
  "Miele": 24,
  "Bosch": 24,
  "Siemens": 24,
  "Samsung": 24,
  "LG": 24,
  "AEG": 24,
  "Electrolux": 24,
  "Whirlpool": 12,
  "Beko": 24,
  "Indesit": 12,
  "Hotpoint": 12,
  "Zanussi": 24,
};

const BRANDS = Object.keys(WARRANTY_BY_BRAND);

export function WarrantyCheckClient() {
  const [brand, setBrand] = React.useState("");
  const [model, setModel] = React.useState("");
  const [date, setDate] = React.useState("");
  const [result, setResult] = React.useState<Result | null>(null);

  function calculate(e: React.FormEvent) {
    e.preventDefault();
    if (!brand || !date) return;

    const purchaseDate = new Date(date);
    const now = new Date();
    const yearsOwned = (now.getTime() - purchaseDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    const factoryWarrantyMonths = WARRANTY_BY_BRAND[brand] ?? 24;

    const factoryWarrantyEnds = new Date(purchaseDate);
    factoryWarrantyEnds.setMonth(factoryWarrantyEnds.getMonth() + factoryWarrantyMonths);

    // Consumer law (BW 7:17) — redelijke levensduur wasmachine = typisch 8 jaar
    const consumerLawEnds = new Date(purchaseDate);
    consumerLawEnds.setFullYear(consumerLawEnds.getFullYear() + 8);

    // EU Right-to-Repair — onderdelen 10 jaar
    const partsAvailableUntil = new Date(purchaseDate);
    partsAvailableUntil.setFullYear(partsAvailableUntil.getFullYear() + 10);

    let status: Result["status"] = "GREEN";
    if (yearsOwned > 2 && yearsOwned <= 5) status = "YELLOW";
    if (yearsOwned > 5) status = "RED";

    setResult({
      brand, model, purchaseDate, factoryWarrantyMonths,
      factoryWarrantyEnds, consumerLawEnds, partsAvailableUntil, yearsOwned, status,
    });
  }

  function reset() {
    setResult(null);
    setBrand("");
    setModel("");
    setDate("");
  }

  if (result) {
    const fmt = (d: Date) => d.toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });
    const stillUnderFactory = result.factoryWarrantyEnds > new Date();
    const stillUnderConsumer = result.consumerLawEnds > new Date();
    const partsStillAvailable = result.partsAvailableUntil > new Date();

    return (
      <div>
        <div style={{
          background: result.status === "GREEN" ? "rgba(60,200,140,0.08)" : result.status === "YELLOW" ? "rgba(255,170,0,0.08)" : "rgba(255,80,80,0.08)",
          border: `1px solid ${result.status === "GREEN" ? "var(--ok)" : result.status === "YELLOW" ? "var(--warn)" : "var(--danger)"}`,
          borderRadius: 12, padding: 24, marginBottom: 24,
        }}>
          <div className="mono" style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 6 }}>
            Garantiestatus
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 500, margin: 0 }}>
            {result.brand} {result.model || "(model niet ingevuld)"}
          </h2>
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            Aangeschaft op {fmt(result.purchaseDate)} · {result.yearsOwned.toFixed(1)} jaar in bezit
          </div>
        </div>

        <div style={{ display: "grid", gap: 12, marginBottom: 24 }}>
          <Row
            ok={stillUnderFactory}
            label={`Fabrieksgarantie (${result.factoryWarrantyMonths} mnd)`}
            value={stillUnderFactory ? `Loopt tot ${fmt(result.factoryWarrantyEnds)}` : `Verlopen op ${fmt(result.factoryWarrantyEnds)}`}
            hint="Bij defect: direct merk/leverancier benaderen voor kostenloze reparatie of vervanging."
          />
          <Row
            ok={stillUnderConsumer}
            label="Consumentenrechten (BW 7:17)"
            value={stillUnderConsumer ? `Loopt tot ~${fmt(result.consumerLawEnds)}` : `Verlopen rond ${fmt(result.consumerLawEnds)}`}
            hint="Een wasmachine moet redelijkerwijs ~8 jaar meegaan. Bij eerder defect heb je recht op reparatie of compensatie."
          />
          <Row
            ok={partsStillAvailable}
            label="EU Right-to-Repair (onderdelen)"
            value={partsStillAvailable ? `Onderdelen beschikbaar tot ${fmt(result.partsAvailableUntil)}` : "Onderdelen mogelijk uit catalogus"}
            hint="Sinds 2024 zijn fabrikanten verplicht onderdelen 10 jaar beschikbaar te houden. WasFix doet dit ook."
          />
        </div>

        <div style={{ background: "var(--surf-2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
          <h3 style={{ fontSize: 15, fontWeight: 500, margin: 0, marginBottom: 10 }}>Wat nu?</h3>
          {stillUnderFactory ? (
            <p style={{ color: "var(--text-2)", fontSize: 14, lineHeight: 1.6 }}>
              Je machine valt nog onder fabrieksgarantie. Bij defect: contacteer eerst <strong>de winkel waar je hem gekocht hebt</strong> of de fabrikant. Reparatie is gratis. Bewaar je factuur als bewijs.
            </p>
          ) : stillUnderConsumer ? (
            <p style={{ color: "var(--text-2)", fontSize: 14, lineHeight: 1.6 }}>
              Hoewel de fabrieksgarantie is verlopen, biedt de Nederlandse wet (artikel 7:17 BW) je nog conformiteitsgarantie. Een wasmachine van {result.yearsOwned.toFixed(0)} jaar oud die plotseling stuk gaat = ongeschikt = recht op (deel-)vergoeding van reparatie. Bewaar factuur, bewijs van mankement, en eis dit schriftelijk bij de winkel.
            </p>
          ) : (
            <p style={{ color: "var(--text-2)", fontSize: 14, lineHeight: 1.6 }}>
              Je machine is buiten de standaard garantieperiodes. Je kunt nog steeds zelf onderdelen vervangen (onder EU Right-to-Repair) of een monteur inschakelen. Bekijk onze gidsen en bereken of reparatie nog loont.
            </p>
          )}
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 24, justifyContent: "center" }}>
          <Link className="btn btn-primary" href="/diagnose">
            Start AI diagnose <Icon name="arrow" size={14} />
          </Link>
          <Link className="btn" href="/tools/repareren-of-vervangen">
            Repareren of vervangen?
          </Link>
          <button className="btn btn-ghost btn-sm" onClick={reset}>
            <Icon name="repeat" size={13} /> Opnieuw
          </button>
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
          <select
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            required
            style={inputStyle}
          >
            <option value="">— Selecteer merk —</option>
            {BRANDS.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>

        <div>
          <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
            Model
          </label>
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="Bv. WAU28T40NL"
            style={inputStyle}
          />
          <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>Optioneel — staat meestal op type-plaatje achterkant of in deuropening</div>
        </div>

        <div>
          <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
            Aankoopdatum <span style={{ color: "var(--danger)" }}>*</span>
          </label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            max={new Date().toISOString().split("T")[0]}
            required
            style={inputStyle}
          />
        </div>

        <button type="submit" className="btn btn-primary" style={{ marginTop: 4, justifyContent: "center" }}>
          Bereken garantie <Icon name="arrow" size={14} />
        </button>
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

function Row({ ok, label, value, hint }: { ok: boolean; label: string; value: string; hint: string }) {
  return (
    <div style={{ display: "flex", gap: 14, alignItems: "flex-start", padding: 14, background: "var(--surf)", border: "1px solid var(--border)", borderRadius: 10 }}>
      <div style={{
        flexShrink: 0,
        width: 32, height: 32, borderRadius: 16,
        background: ok ? "rgba(60,200,140,0.15)" : "rgba(255,255,255,0.06)",
        color: ok ? "var(--ok)" : "var(--muted)",
        display: "grid", placeItems: "center",
      }}>
        {ok ? <Icon name="check" size={16} /> : <Icon name="close" size={14} />}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 500, fontSize: 14 }}>{label}</div>
        <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>{value}</div>
        <div style={{ color: "var(--text-2)", fontSize: 12.5, marginTop: 6, lineHeight: 1.55 }}>{hint}</div>
      </div>
    </div>
  );
}
