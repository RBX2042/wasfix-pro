"use client";

import * as React from "react";
import Link from "next/link";
import { Icon } from "@/components/redesign/SharedLayout";
import { toast } from "sonner";

export function RmaForm() {
  const [submitting, setSubmitting] = React.useState(false);
  const [done, setDone] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);

    const fd = new FormData(e.currentTarget);
    const payload = Object.fromEntries(fd.entries());

    try {
      const res = await fetch("/api/retour", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Er ging iets mis — probeer opnieuw");
        setSubmitting(false);
        return;
      }
      setDone(data.rmaNumber ?? "RMA-aanvraag verstuurd");
      toast.success("Retour-aanvraag ontvangen");
    } catch {
      toast.error("Verbindingsfout — probeer opnieuw");
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div style={{ background: "var(--surf-2)", border: "1px solid var(--acc-2)", borderRadius: 12, padding: 28, textAlign: "center" }}>
        <Icon name="check" size={32} className="dim" />
        <h2 style={{ marginTop: 14, marginBottom: 8, fontSize: 22, fontWeight: 500 }}>Aanvraag ontvangen!</h2>
        <p className="muted" style={{ marginBottom: 8 }}>
          Je RMA-nummer is: <strong className="mono" style={{ color: "var(--acc-2)" }}>{done}</strong>
        </p>
        <p style={{ color: "var(--text-2)", fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
          Binnen 24 uur (op werkdagen) ontvang je een e-mail met retour-instructies + verzendlabel (indien gratis retour).
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center" }}>
          <Link className="btn btn-primary" href="/">
            Terug naar home
          </Link>
          <Link className="btn" href="/help">
            Help-centrum
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ background: "var(--surf)", border: "1px solid var(--border)", borderRadius: 12, padding: 28 }}>
      <div style={{ display: "grid", gap: 16 }}>
        <Field label="Bestelnummer" name="orderId" required placeholder="Bv. WF-2026-001234" help="Vind je in je bevestigingsmail" />
        <Field label="Naam" name="name" required placeholder="Voor- en achternaam" />
        <Field label="E-mailadres" name="email" required type="email" placeholder="je@email.nl" />

        <div>
          <label style={labelStyle}>Reden van retour <span style={{ color: "var(--danger)" }}>*</span></label>
          <select name="reason" required style={inputStyle}>
            <option value="">— Selecteer reden —</option>
            <option value="DEFECT">Defect of beschadigd ontvangen</option>
            <option value="WRONG_PART">Verkeerd onderdeel ontvangen</option>
            <option value="WRONG_ORDER">Verkeerd besteld</option>
            <option value="WITHDRAWAL">Bedenktijd (binnen 30 dagen)</option>
            <option value="OTHER">Anders</option>
          </select>
        </div>

        <div>
          <label style={labelStyle}>Toelichting <span style={{ color: "var(--danger)" }}>*</span></label>
          <textarea
            name="notes"
            required
            rows={4}
            placeholder="Beschrijf het probleem zo duidelijk mogelijk. Bij defecten: foto's helpen — die kun je later per e-mail nasturen."
            style={{ ...inputStyle, resize: "vertical", minHeight: 100 }}
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="btn btn-primary"
          style={{ marginTop: 4, width: "100%", justifyContent: "center" }}
        >
          {submitting ? "Versturen..." : "Retour aanvragen"} <Icon name="send" size={13} />
        </button>

        <p className="muted" style={{ fontSize: 12, lineHeight: 1.5, marginTop: 0 }}>
          Door dit formulier in te dienen ga je akkoord met onze{" "}
          <Link href="/retourvoorwaarden" style={{ color: "var(--acc-2)", textDecoration: "underline" }}>retourvoorwaarden</Link>{" "}
          en de{" "}
          <Link href="/privacy" style={{ color: "var(--acc-2)", textDecoration: "underline" }}>verwerking van je gegevens</Link>{" "}
          (uitsluitend voor het afhandelen van je retour).
        </p>
      </div>
    </form>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 500,
  color: "var(--text)",
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  background: "var(--surf-2)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--text)",
  fontSize: 14,
  fontFamily: "inherit",
  outline: "none",
};

function Field({ label, name, required, type = "text", placeholder, help }: {
  label: string;
  name: string;
  required?: boolean;
  type?: string;
  placeholder?: string;
  help?: string;
}) {
  return (
    <div>
      <label style={labelStyle}>
        {label} {required && <span style={{ color: "var(--danger)" }}>*</span>}
      </label>
      <input
        type={type}
        name={name}
        required={required}
        placeholder={placeholder}
        style={inputStyle}
      />
      {help && <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>{help}</div>}
    </div>
  );
}
