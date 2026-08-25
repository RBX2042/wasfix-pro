"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FileText } from "lucide-react";

export function GenerateInvoiceButton({ workOrderId }: { workOrderId: string }) {
  const router = useRouter();
  const [submitting, setSubmitting] = React.useState(false);

  async function handleClick() {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/work-orders/${workOrderId}/invoice`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Factuur aanmaken mislukt");
        return;
      }
      toast.success(`Factuur ${data.invoice.number} aangemaakt`);
      router.push(`/monteur/facturen/${data.invoice.id}`);
    } catch {
      toast.error("Er ging iets mis");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Button onClick={handleClick} disabled={submitting}>
      <FileText className="h-4 w-4" /> {submitting ? "Bezig..." : "Genereer factuur"}
    </Button>
  );
}
