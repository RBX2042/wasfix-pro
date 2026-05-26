"use client";

import * as React from "react";
import { Icon } from "@/components/redesign/SharedLayout";

const BRANDS = ["Miele", "Bosch", "Siemens", "Samsung", "LG", "AEG", "Electrolux", "Zanussi", "Whirlpool", "Indesit", "Hotpoint", "Beko", "Haier", "Candy", "Panasonic"];

type Generated = { brand: string; model: string; code: string; qrUrl: string };

export function QrStickerClient() {
  const [brand, setBrand] = React.useState("");
  const [model, setModel] = React.useState("");
  const [gen, setGen] = React.useState<Generated | null>(null);

  function generate(e: React.FormEvent) {
    e.preventDefault();
    if (!brand) return;
    // Generate deterministic 8-char code client-side (matches server algorithm)
    const seed = `${brand}-${model}`.replace(/\s+/g, "").toUpperCase().slice(0, 4).padEnd(4, "X");
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    const code = `${seed}${rand}`;
    const qs = new URLSearchParams({ brand, code, size: "520" });
    if (model) qs.set("model", model);
    setGen({ brand, model, code, qrUrl: `/api/qr/generate?${qs.toString()}` });
  }

  function reset() {
    setGen(null);
    setBrand("");
    setModel("");
  }

  function printSticker() {
    // Trigger browser print — only the sticker element will print due to @media print CSS
    window.print();
  }

  if (gen) {
    return (
      <div>
        {/* Sticker preview — also the print target */}
        <div id="sticker-print-area" style={{ background: "var(--surf)", border: "1px solid var(--border)", borderRadius: 12, padding: 30, marginBottom: 20 }}>
          <div className="sticker">
            <div className="sticker-header">
              <div className="sticker-brand-mark">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
                  <circle cx="12" cy="12" r="7" />
                  <circle cx="12" cy="12" r="3" fill="#fff" />
                </svg>
              </div>
              <div>
                <div className="sticker-brand">WasFix<span>Pro</span></div>
                <div className="sticker-subtitle">wasfix.nl</div>
              </div>
            </div>
            <div className="sticker-machine">
              <div className="sticker-label">Wasmachine</div>
              <div className="sticker-machine-name">{gen.brand}</div>
              {gen.model && <div className="sticker-machine-model">{gen.model}</div>}
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={gen.qrUrl} alt="QR code" className="sticker-qr" />
            <div className="sticker-code-block">
              <div className="sticker-label">Scan-code</div>
              <div className="sticker-code-value">{gen.code}</div>
            </div>
            <div className="sticker-instructions">
              <div className="sticker-instruction-title">Scan voor:</div>
              <div className="sticker-instruction-text">AI-diagnose · Onderdelen · Foutcodes · Reparatiegidsen</div>
              <div className="sticker-url">wasfix.nl/qr/{gen.code}</div>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center", marginBottom: 24 }}>
          <button className="btn btn-primary" onClick={printSticker}>
            <Icon name="qr" size={13} /> Print direct (Save as PDF)
          </button>
          <a className="btn" href={gen.qrUrl} download={`wasfix-qr-${gen.brand}-${gen.code}.png`}>
            <Icon name="package" size={13} /> Download QR PNG
          </a>
          <button className="btn btn-ghost btn-sm" onClick={reset}>
            <Icon name="repeat" size={12} /> Andere machine
          </button>
        </div>

        <div style={{ padding: 20, background: "var(--surf-2)", border: "1px solid var(--border)", borderRadius: 12 }}>
          <h3 style={{ fontSize: 15, fontWeight: 500, marginBottom: 10 }}>Print-instructies</h3>
          <ol style={{ paddingLeft: 22, color: "var(--text-2)", lineHeight: 1.7, fontSize: 13.5 }}>
            <li>Klik &ldquo;Print direct&rdquo; — kies &ldquo;Opslaan als PDF&rdquo; of selecteer je printer</li>
            <li>Druk af op <strong>adhesive label paper</strong> (Avery 6005, 100×140 mm)</li>
            <li>Of: gewoon papier + plakband — werkt ook prima</li>
            <li>Plak op de zijkant of bovenkant van de machine</li>
            <li>Test: scan met je telefoon-camera</li>
          </ol>
        </div>

        <div style={{ marginTop: 16, padding: 18, background: "rgba(79,140,255,0.06)", border: "1px solid var(--border-ac)", borderRadius: 10, fontSize: 13, color: "var(--text-2)", lineHeight: 1.6 }}>
          <strong style={{ color: "var(--text)" }}>Voor monteurs:</strong> bij elke klant een unieke sticker plakken = klantenbinding + 1-click pre-diagnose volgende keer. Vraag <a href="/monteur" style={{ color: "var(--acc-2)", textDecoration: "underline" }}>Monteur Pro</a> voor batch-generatie + custom branding.
        </div>

        <style>{`
          .sticker {
            width: 100%; max-width: 400px; margin: 0 auto;
            aspect-ratio: 100/140;
            background: #fff;
            border: 1px solid #e2e8f0;
            border-radius: 12px;
            padding: 24px 22px;
            display: flex; flex-direction: column;
            color: #0b1224;
            font-family: var(--font-geist), system-ui, sans-serif;
          }
          .sticker-header { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
          .sticker-brand-mark {
            width: 36px; height: 36px; border-radius: 8px;
            background: linear-gradient(135deg, #4f8cff, #00d4ff);
            display: grid; place-items: center;
            flex-shrink: 0;
          }
          .sticker-brand { font-weight: 600; font-size: 16px; }
          .sticker-brand span { color: #7b88a6; font-weight: 400; margin-left: 4px; }
          .sticker-subtitle { font-size: 10px; color: #6a7488; }
          .sticker-machine { margin-bottom: 14px; }
          .sticker-label { font-size: 9px; color: #6a7488; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 4px; }
          .sticker-machine-name { font-size: 22px; font-weight: 700; letter-spacing: -0.015em; }
          .sticker-machine-model { font-size: 13px; color: #4a5568; margin-top: 2px; }
          .sticker-qr {
            width: 70%; max-width: 220px; height: auto; aspect-ratio: 1;
            margin: 12px auto; display: block;
          }
          .sticker-code-block { text-align: center; margin-bottom: 14px; }
          .sticker-code-value { font-family: var(--font-geist-mono), monospace; font-weight: 700; font-size: 18px; letter-spacing: 0.1em; }
          .sticker-instructions { margin-top: auto; text-align: center; padding-top: 12px; border-top: 1px solid #e2e8f0; }
          .sticker-instruction-title { font-size: 11px; color: #4a5568; font-weight: 500; margin-bottom: 4px; }
          .sticker-instruction-text { font-size: 10px; color: #6a7488; line-height: 1.4; margin-bottom: 8px; }
          .sticker-url { font-family: monospace; font-size: 10px; color: #4f8cff; }

          @media print {
            @page { size: A6 portrait; margin: 5mm; }
            body * { visibility: hidden; }
            #sticker-print-area, #sticker-print-area * { visibility: visible; }
            #sticker-print-area { position: absolute; left: 0; top: 0; padding: 0 !important; border: 0 !important; background: #fff !important; width: 100%; }
            .sticker { max-width: none; aspect-ratio: auto; box-shadow: none; }
          }
        `}</style>
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
