"use client";

import * as React from "react";
import { track } from "@/lib/analytics";

// "Was deze diagnose nuttig?" widget — shown after AI diagnose completes.
// Sends rating + optional comment to /api/diagnose/feedback for AI quality loop.

export function DiagnoseFeedback({ diagnoseId }: { diagnoseId?: string }) {
  const [rating, setRating] = React.useState<"up" | "down" | null>(null);
  const [comment, setComment] = React.useState("");
  const [submitted, setSubmitted] = React.useState(false);

  async function submit(r: "up" | "down", c?: string) {
    setRating(r);
    if (!c && r === "up") {
      // Single click on 👍 = submit immediately
      await send(r, "");
    }
  }

  async function send(r: "up" | "down", c: string) {
    try {
      await fetch("/api/diagnose/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ diagnoseId, rating: r, comment: c }),
      });
      track("diagnose_feedback", { rating: r, hasComment: !!c });
    } catch { /* ignore */ }
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div style={{ padding: 14, background: "rgba(60,200,140,0.06)", border: "1px solid var(--ok)", borderRadius: 10, textAlign: "center", fontSize: 13 }}>
        🙏 Bedankt voor je feedback — je helpt onze AI beter te worden.
      </div>
    );
  }

  return (
    <div style={{ padding: 16, background: "var(--surf-2)", border: "1px solid var(--border)", borderRadius: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 12 }}>
        Was deze diagnose nuttig?
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: rating === "down" ? 12 : 0 }}>
        <button
          onClick={() => submit("up")}
          aria-label="Diagnose was nuttig"
          style={{
            background: rating === "up" ? "rgba(60,200,140,0.15)" : "transparent",
            border: `1px solid ${rating === "up" ? "var(--ok)" : "var(--border)"}`,
            borderRadius: 8,
            padding: "8px 16px",
            cursor: "pointer",
            color: "var(--text)",
            fontSize: 14,
          }}
        >
          👍 Ja
        </button>
        <button
          onClick={() => submit("down")}
          aria-label="Diagnose was niet nuttig"
          style={{
            background: rating === "down" ? "rgba(255,80,80,0.15)" : "transparent",
            border: `1px solid ${rating === "down" ? "var(--danger)" : "var(--border)"}`,
            borderRadius: 8,
            padding: "8px 16px",
            cursor: "pointer",
            color: "var(--text)",
            fontSize: 14,
          }}
        >
          👎 Nee
        </button>
      </div>

      {rating === "down" && (
        <form onSubmit={(e) => { e.preventDefault(); send("down", comment); }}>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Wat klopte er niet? (optioneel — helpt ons enorm)"
            rows={3}
            style={{
              width: "100%",
              padding: "10px 12px",
              background: "var(--surf)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              color: "var(--text)",
              fontSize: 13,
              fontFamily: "inherit",
              resize: "vertical",
              outline: "none",
            }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button type="submit" className="btn btn-sm btn-primary">
              Verstuur feedback
            </button>
            <button type="button" onClick={() => send("down", "")} className="btn btn-sm btn-ghost">
              Sla over
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
