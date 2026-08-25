"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus } from "lucide-react";

export function AddItemForm({ workOrderId }: { workOrderId: string }) {
  const router = useRouter();
  const [submitting, setSubmitting] = React.useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const formData = new FormData(e.currentTarget);

    try {
      const res = await fetch(`/api/work-orders/${workOrderId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: formData.get("description"),
          quantity: Number(formData.get("quantity") ?? 1),
          unitPrice: Number(formData.get("unitPrice") ?? 0),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Regel toevoegen mislukt");
        return;
      }
      toast.success("Regel toegevoegd");
      (e.target as HTMLFormElement).reset();
      router.refresh();
    } catch {
      toast.error("Er ging iets mis");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2 pt-3 border-t">
      <div className="flex-1 min-w-[160px]">
        <Label htmlFor="description" className="text-xs">Omschrijving</Label>
        <Input id="description" name="description" required maxLength={200} placeholder="Bijv. Afvoerpomp WF-PUMP-01 of arbeidsloon" />
      </div>
      <div className="w-20">
        <Label htmlFor="quantity" className="text-xs">Aantal</Label>
        <Input id="quantity" name="quantity" type="number" min={1} max={99} defaultValue={1} />
      </div>
      <div className="w-28">
        <Label htmlFor="unitPrice" className="text-xs">Prijs (€)</Label>
        <Input id="unitPrice" name="unitPrice" type="number" min={0} step="0.01" defaultValue={0} />
      </div>
      <Button type="submit" size="sm" disabled={submitting}>
        <Plus className="h-4 w-4" /> Toevoegen
      </Button>
    </form>
  );
}
