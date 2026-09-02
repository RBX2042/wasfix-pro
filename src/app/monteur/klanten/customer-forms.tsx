"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { deleteCustomer, saveCustomer } from "../_lib/actions";
import { Field, FormDialog, SubmitButton, TextArea, useActionForm } from "../_lib/forms";

export type CustomerRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  machine: string | null;
  notes: string | null;
};

function CustomerFields({ customer, close }: { customer?: CustomerRow; close: () => void }) {
  const formAction = useActionForm(saveCustomer, close);
  return (
    <form action={formAction} className="space-y-3">
      {customer && <input type="hidden" name="id" value={customer.id} />}
      <Field label="Naam" name="name" defaultValue={customer?.name} required placeholder="Familie de Vries" />
      <div className="grid grid-cols-2 gap-3">
        <Field label="E-mail" name="email" type="email" defaultValue={customer?.email} placeholder="klant@example.nl" />
        <Field label="Telefoon" name="phone" defaultValue={customer?.phone} placeholder="06-12345678" />
      </div>
      <div className="grid grid-cols-[1fr_120px] gap-3">
        <Field label="Straat en huisnummer" name="street" defaultValue={customer?.street} placeholder="Hoofdstraat 12" />
        <Field label="Postcode" name="postalCode" defaultValue={customer?.postalCode} placeholder="1234 AB" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Plaats" name="city" defaultValue={customer?.city} placeholder="Amsterdam" />
        <Field label="Wasmachine" name="machine" defaultValue={customer?.machine} placeholder="Bosch WAU28T40NL" />
      </div>
      <TextArea label="Notities" name="notes" defaultValue={customer?.notes} />
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={close}>Annuleren</Button>
        <SubmitButton>Opslaan</SubmitButton>
      </div>
    </form>
  );
}

export function NewCustomerButton() {
  return (
    <FormDialog title="Nieuwe klant" trigger={<Button><Plus className="h-4 w-4" /> Klant toevoegen</Button>}>
      {(close) => <CustomerFields close={close} />}
    </FormDialog>
  );
}

export function EditCustomerButton({ customer }: { customer: CustomerRow }) {
  return (
    <FormDialog
      title={`Klant bewerken — ${customer.name}`}
      trigger={
        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Bewerken">
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      }
    >
      {(close) => <CustomerFields customer={customer} close={close} />}
    </FormDialog>
  );
}

export function DeleteCustomerButton({ id, name }: { id: string; name: string }) {
  const formAction = useActionForm(deleteCustomer);
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!confirm(`Klant "${name}" verwijderen? Werkorders blijven bestaan zonder klantkoppeling.`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="ghost" size="icon" className="h-8 w-8 text-destructive" aria-label="Verwijderen">
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </form>
  );
}
