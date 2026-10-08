"use client";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { WITHDRAWAL_WAIVER_TEXT } from "./consent";
import { supportHint } from "@/lib/support-hint";

/**
 * Starts the Stripe subscription for `plan`. Every outcome is visible: a signed-out
 * visitor is sent to register (and back here), a refusal shows the server's own
 * reason (503 "tijdelijk niet beschikbaar" is a real answer, not a silent reset),
 * and a consumer plan cannot be started without the consent the law asks for.
 */
export function UpgradeButton({ plan, requiresWaiver = false, supportEmail = null }: { plan: string; requiresWaiver?: boolean; supportEmail?: string | null }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUpgrade() {
    setError(null);
    if (requiresWaiver && !consent) {
      setError("Vink eerst aan dat je wilt dat de dienst direct begint. Zonder die bevestiging kunnen we je abonnement niet starten.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/stripe/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, ...(requiresWaiver ? { withdrawalWaiver: consent } : {}) }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 401) {
        // Not signed in (the page normally catches this first; a session can also expire on the page).
        toast.info("Maak eerst een gratis account om verder te gaan.");
        router.push(`/registreren?plan=${encodeURIComponent(plan.toLowerCase())}`);
        return;
      }

      if (res.ok && data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return;
      }

      if (res.ok && data.demo) {
        toast.success("Upgrade voltooid (demo modus)");
        setTimeout(() => (window.location.href = "/dashboard"), 1500);
        return;
      }

      const message =
        typeof data.error === "string" && data.error
          ? data.error
          : `Het afsluiten van je abonnement is niet gelukt. Probeer het zo opnieuw of ${supportHint(supportEmail)}.`;
      setError(message);
      toast.error(message);
    } catch {
      const message = "Geen verbinding met de server. Controleer je internetverbinding en probeer het opnieuw.";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {requiresWaiver && (
        <label className="flex items-start gap-3 rounded-md border p-3 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-1 h-5 w-5 shrink-0"
            data-testid="withdrawal-waiver"
          />
          <span>{WITHDRAWAL_WAIVER_TEXT}</span>
        </label>
      )}
      <Button onClick={handleUpgrade} size="lg" className="w-full" disabled={loading}>
        {loading ? "Bezig..." : "Upgrade nu"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive text-center">
          {error}
        </p>
      )}
    </div>
  );
}
