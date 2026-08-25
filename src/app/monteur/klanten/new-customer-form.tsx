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

export function NewCustomerForm() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const formData = new FormData(e.currentTarget);

    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.get("name"),
          email: formData.get("email"),
          phone: formData.get("phone"),
          addressLine: formData.get("addressLine"),
          postalCode: formData.get("postalCode"),
          city: formData.get("city"),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Klant toevoegen mislukt");
        return;
      }
      toast.success("Klant toegevoegd");
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
        <Button>
          <Plus className="h-4 w-4" /> Klant toevoegen
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nieuwe klant</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="name">Naam *</Label>
            <Input id="name" name="name" required minLength={2} maxLength={100} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="email">E-mail</Label>
              <Input id="email" name="email" type="email" />
            </div>
            <div>
              <Label htmlFor="phone">Telefoon</Label>
              <Input id="phone" name="phone" />
            </div>
          </div>
          <div>
            <Label htmlFor="addressLine">Adres</Label>
            <Input id="addressLine" name="addressLine" placeholder="Straat + huisnummer" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="postalCode">Postcode</Label>
              <Input id="postalCode" name="postalCode" />
            </div>
            <div>
              <Label htmlFor="city">Plaats</Label>
              <Input id="city" name="city" />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Bezig..." : "Klant toevoegen"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
