"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { deleteWorkOrder, saveWorkOrder } from "../_lib/actions";
import { WORK_ORDER_STATUSES } from "../_lib/constants";
import { Field, FormDialog, Select, SubmitButton, TextArea, useActionForm } from "../_lib/forms";

export type WorkOrderRow = {
  id: string;
  reference: string;
  customerId: string | null;
  machine: string | null;
  errorCode: string | null;
  problem: string;
  status: string;
  urgent: boolean;
  scheduledAt: string | null;
  priceEur: number | null;
  notes: string | null;
};

export type CustomerOption = { id: string; name: string };

const STATUS_OPTIONS = WORK_ORDER_STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, " ") }));

function WorkOrderFields({ order, customers, close }: { order?: WorkOrderRow; customers: CustomerOption[]; close: () => void }) {
  const formAction = useActionForm(saveWorkOrder, close);
  return (
    <form action={formAction} className="space-y-3">
      {order && <input type="hidden" name="id" value={order.id} />}
      <label className="block text-sm">
        <span className="text-muted-foreground">Klant</span>
        <select name="customerId" defaultValue={order?.customerId ?? ""} className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm">
          <option value="">— geen klant —</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </label>
      <TextArea label="Probleem" name="problem" defaultValue={order?.problem} required rows={2} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Wasmachine" name="machine" defaultValue={order?.machine} placeholder="Bosch WAU28T40NL" />
        <Field label="Foutcode" name="errorCode" defaultValue={order?.errorCode} placeholder="E18" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Select label="Status" name="status" options={STATUS_OPTIONS} defaultValue={order?.status} />
        <Field label="Gepland op" name="scheduledAt" type="date" defaultValue={order?.scheduledAt?.slice(0, 10)} />
      </div>
      <div className="grid grid-cols-2 gap-3 items-end">
        <Field label="Prijs (€)" name="priceEur" type="number" defaultValue={order?.priceEur != null ? String(order.priceEur) : ""} placeholder="89.50" />
        <label className="flex items-center gap-2 text-sm pb-2">
          <input type="checkbox" name="urgent" defaultChecked={order?.urgent} className="h-4 w-4" />
          <span>Urgent</span>
        </label>
      </div>
      <TextArea label="Notities" name="notes" defaultValue={order?.notes} />
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={close}>Annuleren</Button>
        <SubmitButton>Opslaan</SubmitButton>
      </div>
    </form>
  );
}

export function NewWorkOrderButton({ customers }: { customers: CustomerOption[] }) {
  return (
    <FormDialog title="Nieuwe werkorder" trigger={<Button><Plus className="h-4 w-4" /> Nieuwe werkorder</Button>}>
      {(close) => <WorkOrderFields customers={customers} close={close} />}
    </FormDialog>
  );
}

export function EditWorkOrderButton({ order, customers }: { order: WorkOrderRow; customers: CustomerOption[] }) {
  return (
    <FormDialog
      title={`Werkorder ${order.reference}`}
      trigger={
        <Button variant="outline" size="sm">
          <Pencil className="h-3 w-3" /> Open
        </Button>
      }
    >
      {(close) => <WorkOrderFields order={order} customers={customers} close={close} />}
    </FormDialog>
  );
}

export function DeleteWorkOrderButton({ id, reference }: { id: string; reference: string }) {
  const formAction = useActionForm(deleteWorkOrder);
  return (
    <form action={formAction} onSubmit={(e) => { if (!confirm(`Werkorder ${reference} verwijderen?`)) e.preventDefault(); }}>
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="ghost" size="icon" className="h-8 w-8 text-destructive" aria-label="Verwijderen">
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </form>
  );
}
