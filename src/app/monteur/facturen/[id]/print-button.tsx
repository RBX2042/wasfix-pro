"use client";

import { Printer } from "lucide-react";

export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="inline-flex items-center gap-1 text-sm border rounded-md px-3 py-1.5 hover:bg-muted"
    >
      <Printer className="h-3 w-3" /> Print / Bewaar als PDF
    </button>
  );
}
