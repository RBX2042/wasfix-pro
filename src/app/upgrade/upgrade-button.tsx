"use client";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { toast } from "sonner";

export function UpgradeButton({ plan }: { plan: string }) {
  const [loading, setLoading] = useState(false);

  async function handleUpgrade() {
    setLoading(true);
    try {
      const res = await fetch("/api/stripe/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json();

      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return;
      }

      if (data.demo) {
        toast.success("Upgrade voltooid (demo modus)");
        setTimeout(() => (window.location.href = "/dashboard"), 1500);
      }
    } catch {
      toast.error("Upgrade mislukt");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button onClick={handleUpgrade} size="lg" className="w-full" disabled={loading}>
      {loading ? "Bezig..." : "Upgrade nu"}
    </Button>
  );
}
