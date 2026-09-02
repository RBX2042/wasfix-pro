"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export function PortalButton() {
  const [loading, setLoading] = useState(false);

  async function openPortal() {
    setLoading(true);
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      if (data.demo) {
        toast.info("Stripe is niet geconfigureerd — in demo-modus is er geen klantportaal.");
        return;
      }
      toast.error(data.error ?? "Klantportaal kon niet worden geopend");
    } catch {
      toast.error("Klantportaal kon niet worden geopend");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button variant="outline" className="w-full mt-4" onClick={openPortal} disabled={loading}>
      {loading ? "Bezig…" : "Beheer abonnement (Stripe portal)"}
    </Button>
  );
}
