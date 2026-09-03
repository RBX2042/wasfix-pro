"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

const PHRASE = "VERWIJDER MIJN ACCOUNT";

export function DeleteAccountButton() {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  async function deleteAccount() {
    setLoading(true);
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation, reason: reason.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Verwijdering mislukt");
        return;
      }
      if (data.demo) {
        toast.info(data.message);
        setOpen(false);
        return;
      }
      toast.success(data.message ?? "Account verwijderd.");
      // De Clerk-identiteit is weg, dus de sessie is hierna niets meer waard.
      window.location.href = "/";
    } catch {
      toast.error("Verwijdering mislukt — mail privacy@wasfix.nl");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="mt-2 text-destructive border-destructive/40 hover:bg-destructive/10">
          <Trash2 className="h-4 w-4" /> Account verwijderen (AVG)
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Account definitief verwijderen</DialogTitle>
          <DialogDescription>
            Dit kan niet ongedaan gemaakt worden. Download eerst je gegevens — na het verwijderen kunnen wij ze niet meer voor je ophalen.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div>
            <p className="font-medium">Wat we wissen</p>
            <p className="text-muted-foreground">
              Je diagnoses en feedback daarop, opgeslagen wasmachines, API-sleutels, nieuwsbriefinschrijving, je
              aanmelding als monteur, en — als je Monteur Pro gebruikt — je monteursprofiel met je klanten, werkorders
              en de facturen die je aan die klanten stuurde.
            </p>
          </div>
          <div>
            <p className="font-medium">Wat we anonimiseren</p>
            <p className="text-muted-foreground">
              Je reviews en retouraanvragen blijven staan zonder je naam of e-mailadres, en je bestellingen worden
              losgekoppeld van je e-mailadres en bezorgadres.
            </p>
          </div>
          <div>
            <p className="font-medium">Wat we moeten bewaren</p>
            <p className="text-muted-foreground">
              De factuur bij elke bestelling, 7 jaar lang. Art. 35a Wet OB verplicht ons je naam en adres op die factuur
              te vermelden, dus die twee gegevens blijven daar staan. Verwijderen mag pas als de bewaartermijn voorbij is.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="delete-confirmation">Typ ter bevestiging: <span className="font-mono">{PHRASE}</span></Label>
            <Input
              id="delete-confirmation"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              placeholder={PHRASE}
              autoComplete="off"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="delete-reason">Waarom vertrek je? (optioneel)</Label>
            <Textarea
              id="delete-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              placeholder="Helpt ons WasFix beter te maken."
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={loading}>
            Annuleren
          </Button>
          <Button variant="destructive" onClick={deleteAccount} disabled={loading || confirmation !== PHRASE}>
            {loading ? "Bezig…" : "Definitief verwijderen"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
