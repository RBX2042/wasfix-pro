"use client";

import * as React from "react";
import { Icon } from "@/components/redesign/SharedLayout";

const BRANDS = ["Miele", "Bosch", "Siemens", "Samsung", "LG", "AEG", "Electrolux", "Zanussi", "Whirlpool", "Indesit", "Hotpoint", "Beko", "Haier", "Candy", "Panasonic"];

export function QrStickerClient() {
  const [brand, setBrand] = React.useState("");
  const [model, setModel] = React.useState("");
  const [generated, setGenerated] = React.useState(false);

  const stickerUrl = brand
    ? `/api/qr/generate?brand=${encodeURIComponent(brand)}${model ? `&model=${encodeURIComponent(model)}` : ""}`
    : "";

  function generate(e: React.FormEvent) {
    e.preventDefault();
    if (!brand) return;
    setGenerated(true);
  }

  function reset() {
    setGenerated(false);
    setBrand("");
    setModel("");
  }

  if (generated && stickerUrl) {
    return (
      <div>
        <div style={{ background: "var(--surf)", border: "1px solid var(--border)", borderRadius: 12, padding: 20, marginBottom: 20, textAlign: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={stickerUrl}
            alt="QR sticker preview"
            style={{ maxWidth: "100%", width: 400, height: "auto", borderRadius: 8, border: "1px solid var(--border)" }}
          />
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center", marginBottom: 24 }}>
          <a className="btn btn-primary" href={stickerUrl} download={`wasfix-qr-${brand}.png`}>
            <Icon name="package" size={13} /> Download PNG
          </a>
          <button className="btn" onClick={() => window.print()}>
            <Icon name="qr" size={13} /> Print direct
          </button>
          <button className="btn btn-ghost btn-sm" onClick={reset}>
            <Icon name="repeat" size={12} /> Andere machine
          </button>
        </div>

        <div style={{ padding: 20, background: "var(--surf-2)", border: "1px solid var(--border)", borderRadius: 12 }}>
          <h3 style={{ fontSize: 15, fontWeight: 500, marginBottom: 10 }}>Print-instructies</h3>
          <ol style={{ paddingLeft: 22, color: "var(--text-2)", lineHeight: 1.7, fontSize: 13.5 }}>
            <li>Download de PNG of klik &ldquo;Print direct&rdquo;</li>
            <li>Druk af op <strong>adhesive label paper</strong> (Avery 6005, 100×140 mm — €8 voor 10 vel bij Bruna/Office Depot)</li>
            <li>Of: gewoon papier + plakband — werkt ook prima</li>
            <li>Plak op de zijkant of bovenkant van de machine</li>
            <li>Test: scan met je telefoon-camera — zou direct naar deze pagina moeten gaan</li>
          </ol>
        </div>

        <div style={{ marginTop: 16, padding: 18, background: "rgba(79,140,255,0.06)", border: "1px solid var(--border-ac)", borderRadius: 10, fontSize: 13, color: "var(--text-2)", lineHeight: 1.6 }}>
          <strong style={{ color: "var(--text)" }}>Voor monteurs:</strong> bij elke klant een unieke sticker plakken = klantenbinding + 1-click pre-diagnose volgende keer. Vraag <a href="/monteur" style={{ color: "var(--acc-2)", textDecoration: "underline" }}>Monteur Pro</a> voor batch-generatie + custom branding.
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={generate} style={{ background: "var(--surf)", border: "1px solid var(--border)", borderRadius: 12, padding: 28 }}>
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
            Model
          </label>
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="bv. WAU28T40NL (optioneel)"
            style={inputStyle}
          />
          <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
            Optioneel — staat op type-plaatje achterkant of in deuropening
          </div>
        </div>

        <button type="submit" className="btn btn-primary" style={{ marginTop: 4, justifyContent: "center" }}>
          <Icon name="qr" size={14} /> Genereer QR sticker
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
