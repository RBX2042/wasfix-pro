"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="nl">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", textAlign: "center" }}>
        <h1 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>Er is iets misgegaan</h1>
        <p style={{ color: "#666", marginBottom: "1rem" }}>De applicatie kon niet geladen worden.</p>
        <button
          onClick={reset}
          style={{
            background: "#1a6b6b",
            color: "white",
            padding: "0.5rem 1rem",
            border: "none",
            borderRadius: "0.375rem",
            cursor: "pointer",
          }}
        >
          Opnieuw proberen
        </button>
      </body>
    </html>
  );
}
