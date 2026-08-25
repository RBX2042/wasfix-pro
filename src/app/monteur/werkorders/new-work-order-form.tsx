"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Plus } from "lucide-react";

type CustomerOption = {
  id: string;
  name: string;
  machines: { id: string; brand: string; model: string }[];
};

export function NewWorkOrderForm({ customers, defaultCustomerId }: { customers: CustomerOption[]; defaultCustomerId?: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(!!defaultCustomerId);
  const [submitting, setSubmitting] = React.useState(false);
  const [customerId, setCustomerId] = React.useState(defaultCustomerId ?? customers[0]?.id ?? "");

  const selectedCustomer = customers.find((c) => c.id === customerId);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const formData = new FormData(e.currentTarget);
    const machineId = formData.get("machineId");
    const scheduledAt = formData.get("scheduledAt");

    try {
      const res = await fetch("/api/work-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          machineId: machineId || undefined,
          complaint: formData.get("complaint"),
          scheduledAt: scheduledAt ? new Date(scheduledAt as string).toISOString() : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Werkorder aanmaken mislukt");
        return;
      }
      toast.success(`Werkorder ${data.workOrder.number} aangemaakt`);
      setOpen(false);
      router.push(`/monteur/werkorders/${data.workOrder.id}`);
    } catch {
      toast.error("Er ging iets mis");
    } finally {
      setSubmitting(false);
    }
  }

  if (customers.length === 0) {
    return (
      <Button asChild>
        <Link href="/monteur/klanten">Eerst een klant toevoegen</Link>
      </Button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4" /> Nieuwe werkorder
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nieuwe werkorder</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="customerId">Klant *</Label>
            <select
              id="customerId"
              name="customerId"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              required
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="machineId">Apparaat</Label>
            <select
              id="machineId"
              name="machineId"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              disabled={!selectedCustomer || selectedCustomer.machines.length === 0}
            >
              <option value="">— geen / onbekend —</option>
              {selectedCustomer?.machines.map((m) => (
                <option key={m.id} value={m.id}>{m.brand} {m.model}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="complaint">Klacht *</Label>
            <Textarea id="complaint" name="complaint" required minLength={3} maxLength={2000} placeholder="Bijv. Foutcode E18, wasmachine voert niet af" />
          </div>
          <div>
            <Label htmlFor="scheduledAt">Inplannen (optioneel)</Label>
            <input
              id="scheduledAt"
              name="scheduledAt"
              type="datetime-local"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Bezig..." : "Werkorder aanmaken"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
