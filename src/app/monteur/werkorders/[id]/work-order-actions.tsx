"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { WORK_ORDER_STATUS_LABELS, allowedNextStatuses, type WorkOrderStatus } from "@/lib/work-order";

type Props = {
  workOrderId: string;
  status: WorkOrderStatus;
  technicianNote: string | null;
};

export function WorkOrderActions({ workOrderId, status, technicianNote }: Props) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState(technicianNote ?? "");

  async function patch(body: Record<string, unknown>, successMsg: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/work-orders/${workOrderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Bijwerken mislukt");
        return;
      }
      toast.success(successMsg);
      router.refresh();
    } catch {
      toast.error("Er ging iets mis");
    } finally {
      setBusy(false);
    }
  }

  const nextStatuses = allowedNextStatuses(status);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-3">
          <p className="text-sm font-medium">Status wijzigen</p>
          <div className="flex flex-wrap gap-2">
            {nextStatuses.length === 0 && <p className="text-sm text-muted-foreground">Eindstatus bereikt.</p>}
            {nextStatuses.map((s) => (
              <Button
                key={s}
                size="sm"
                variant={s === "CANCELLED" ? "outline" : "default"}
                disabled={busy}
                onClick={() => patch({ status: s }, `Status gewijzigd naar ${WORK_ORDER_STATUS_LABELS[s]}`)}
              >
                → {WORK_ORDER_STATUS_LABELS[s]}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-3">
          <Label htmlFor="technicianNote">Monteur diagnose / notities</Label>
          <Textarea
            id="technicianNote"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            placeholder="Bevindingen, uitgevoerde werkzaamheden, opmerkingen voor de klant..."
          />
          <Button size="sm" disabled={busy} onClick={() => patch({ technicianNote: note }, "Notities opgeslagen")}>
            Opslaan
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
