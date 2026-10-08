"use client";

import * as React from "react";
import { reportClientError } from "@/lib/report-client-error";

// Replaces the whole document when the root layout itself fails, so it cannot use
// the site shell. Same rules as error.tsx: calm text and a code for the visitor,
// the cause goes to the owner (server errors via src/instrumentation.ts, browser
// errors via reportClientError).
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  React.useEffect(() => {
    console.error("[WasFix global error]", error);
    reportClientError(error);
  }, [error]);

  return (
    <html lang="nl">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", textAlign: "center" }}>
        <h1 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>Er is iets misgegaan</h1>
        <p style={{ color: "#666", marginBottom: "1rem" }}>De pagina kon niet geladen worden. Probeer het opnieuw; blijft het misgaan, neem dan contact met ons op.</p>
        {error.digest && <p style={{ color: "#888", fontSize: "0.75rem", marginBottom: "1rem" }}>Foutcode: {error.digest}</p>}
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
