"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Plus } from "lucide-react";

export function NewMachineForm({ customerId }: { customerId: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const formData = new FormData(e.currentTarget);

    try {
      const res = await fetch(`/api/customers/${customerId}/machines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand: formData.get("brand"),
          model: formData.get("model"),
          serialNumber: formData.get("serialNumber"),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Apparaat toevoegen mislukt");
        return;
      }
      toast.success("Apparaat toegevoegd");
      setOpen(false);
      (e.target as HTMLFormElement).reset();
      router.refresh();
    } catch {
      toast.error("Er ging iets mis");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="h-4 w-4" /> Apparaat toevoegen
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nieuw apparaat</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="brand">Merk *</Label>
              <Input id="brand" name="brand" required maxLength={50} placeholder="Bosch" />
            </div>
            <div>
              <Label htmlFor="model">Model *</Label>
              <Input id="model" name="model" required maxLength={80} placeholder="WAU28T40NL" />
            </div>
          </div>
          <div>
            <Label htmlFor="serialNumber">Serienummer</Label>
            <Input id="serialNumber" name="serialNumber" maxLength={60} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Bezig..." : "Toevoegen"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
