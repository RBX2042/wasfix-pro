"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CalendarClock } from "lucide-react";

type Props = {
  workOrderId: string;
  status: string;
  scheduledAt: string | null;
};

function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function RescheduleForm({ workOrderId, status, scheduledAt }: Props) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [value, setValue] = React.useState(toLocalInputValue(scheduledAt));
  const [submitting, setSubmitting] = React.useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!value) return;
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = { scheduledAt: new Date(value).toISOString() };
      if (status === "NEW" || status === "PRE_DIAGNOSIS") body.status = "SCHEDULED";

      const res = await fetch(`/api/work-orders/${workOrderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Inplannen mislukt");
        return;
      }
      toast.success("Ingepland");
      setOpen(false);
      router.refresh();
    } catch {
      toast.error("Er ging iets mis");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <CalendarClock className="h-3 w-3" /> {scheduledAt ? "Verplaatsen" : "Inplannen"}
      </Button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <input
        type="datetime-local"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        required
        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
      />
      <Button type="submit" size="sm" disabled={submitting}>{submitting ? "..." : "Opslaan"}</Button>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>Annuleren</Button>
    </form>
  );
}
