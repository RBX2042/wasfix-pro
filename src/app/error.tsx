"use client";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
     
    console.error("[WasFix] Page-level error", error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-6">
      <div className="max-w-md text-center">
        <AlertTriangle className="mx-auto h-12 w-12 text-destructive mb-4" />
        <h1 className="font-heading text-2xl font-bold mb-2">Er is iets misgegaan</h1>
        <p className="text-muted-foreground mb-6">
          We hebben de fout gelogd en gaan deze onderzoeken. Probeer de pagina te vernieuwen.
        </p>
        <div className="flex justify-center gap-3">
          <Button onClick={reset}>Opnieuw proberen</Button>
          <Button variant="outline" onClick={() => (window.location.href = "/")}>
            Naar homepage
          </Button>
        </div>
      </div>
    </div>
  );
}
