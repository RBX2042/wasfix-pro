"use client";

import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";

/** Opens the browser print dialog; "save as PDF" is the print target. */
export function PrintButton() {
  return (
    <Button size="sm" variant="outline" onClick={() => window.print()}>
      <Printer className="h-4 w-4" /> Print of bewaar als pdf
    </Button>
  );
}
