"use client";

import * as React from "react";
import Link from "next/link";
import { WasFixShell, Icon } from "@/components/redesign/SharedLayout";
import { reportClientError } from "@/lib/report-client-error";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    // The visitor sees a calm page and a code. The cause goes to the owner:
    // server-side errors were reported where they happened (src/instrumentation.ts)
    // and carry this digest; browser-side ones are posted from here.
    console.error("[WasFix error boundary]", error);
    reportClientError(error);
  }, [error]);

  return (
    <WasFixShell>
      <section className="section" style={{ paddingTop: 64 }}>
        <div className="container" style={{ maxWidth: 720, textAlign: "center" }}>
          <div className="mono" style={{ fontSize: 72, fontWeight: 200, lineHeight: 1, color: "var(--warn)", letterSpacing: "-0.05em", marginBottom: 8 }}>
            500
          </div>
          <h1 className="h-display" style={{ fontSize: "clamp(28px, 4vw, 44px)", marginBottom: 14 }}>
            Er ging iets <em>mis</em>
          </h1>
          <p className="lead" style={{ maxWidth: 480, margin: "0 auto 16px" }}>
            Er ging iets mis aan onze kant. Probeer de pagina opnieuw te laden, vaak helpt dat. Blijft het probleem, neem dan contact op met support en noem de foutcode hieronder.
          </p>
          {error.digest && (
            <div className="mono" style={{ fontSize: 11, color: "var(--muted)", marginBottom: 28, letterSpacing: "0.04em" }}>
              Foutcode: {error.digest}
            </div>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center", marginBottom: 32 }}>
            <button className="btn btn-primary" onClick={() => reset()}>
              <Icon name="repeat" size={14} /> Probeer opnieuw
            </button>
            <Link className="btn" href="/">
              Naar homepage
            </Link>
            <Link className="btn btn-ghost btn-sm" href="/contact">
              Contact support
            </Link>
          </div>
        </div>
      </section>
    </WasFixShell>
  );
}
