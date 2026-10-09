"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";

/** Copies a payment detail (IBAN, reference) so nobody has to retype it in their banking app. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = React.useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (insecure origin, old browser): the value stays selectable on the page.
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Kopieer ${label}`}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {copied ? <Check className="h-4 w-4 text-emerald-600" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
      <span className="sr-only" role="status">{copied ? `${label} gekopieerd` : ""}</span>
    </button>
  );
}
