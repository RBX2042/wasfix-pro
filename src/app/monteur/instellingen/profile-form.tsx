"use client";

import * as React from "react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { saveMonteurProfile, type ProfileResult } from "./actions";

export type ProfileValues = {
  companyName?: string | null;
  contactName?: string | null;
  kvkNumber?: string | null;
  vatNumber?: string | null;
  street?: string | null;
  postalCode?: string | null;
  city?: string | null;
  iban?: string | null;
  email?: string | null;
  phone?: string | null;
  vatRate?: number | null;
  hourlyRateEur?: number | null;
  paymentTerms?: number | null;
  invoiceFooter?: string | null;
};

function Field({
  label, name, defaultValue, required, placeholder, type = "text", hint,
}: {
  label: string; name: string; defaultValue?: string | null; required?: boolean;
  placeholder?: string; type?: string; hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium">
        {label}{required && <span className="text-destructive"> *</span>}
      </span>
      <input
        name={name}
        type={type}
        step={type === "number" ? "any" : undefined}
        defaultValue={defaultValue ?? ""}
        required={required}
        placeholder={placeholder}
        className="mt-1 w-full rounded-md border px-3 py-2 text-sm bg-background"
      />
      {hint && <span className="text-xs text-muted-foreground mt-1 block">{hint}</span>}
    </label>
  );
}

export function MonteurProfileForm({ values }: { values: ProfileValues }) {
  const [state, action, pending] = useActionState<ProfileResult | null, FormData>(saveMonteurProfile, null);

  return (
    <form action={action} className="space-y-6">
      <section className="grid md:grid-cols-2 gap-4">
        <Field label="Bedrijfsnaam" name="companyName" defaultValue={values.companyName} required placeholder="Mijn Wasmachineservice" />
        <Field label="Contactpersoon" name="contactName" defaultValue={values.contactName} placeholder="Jan de Vries" />
        <Field label="KvK-nummer" name="kvkNumber" defaultValue={values.kvkNumber} required placeholder="12345678" />
        <Field label="Btw-nummer" name="vatNumber" defaultValue={values.vatNumber} placeholder="NL123456789B01" hint="Verplicht op de factuur zodra je btw-plichtig bent." />
      </section>

      <section className="grid md:grid-cols-2 gap-4">
        <Field label="Straat en huisnummer" name="street" defaultValue={values.street} required placeholder="Hoofdstraat 1" />
        <Field label="Postcode" name="postalCode" defaultValue={values.postalCode} required placeholder="1234 AB" />
        <Field label="Plaats" name="city" defaultValue={values.city} required placeholder="Utrecht" />
        <Field label="IBAN" name="iban" defaultValue={values.iban} placeholder="NL00BANK0123456789" hint="Zonder IBAN weet je klant niet waarheen te betalen." />
      </section>

      <section className="grid md:grid-cols-2 gap-4">
        <Field label="E-mail" name="email" defaultValue={values.email} type="email" placeholder="info@mijnservice.nl" />
        <Field label="Telefoon" name="phone" defaultValue={values.phone} placeholder="06-12345678" />
        <Field label="Btw-tarief (%)" name="vatRatePct" defaultValue={values.vatRate != null ? String(Math.round(values.vatRate * 100)) : "21"} type="number" hint="21% is het standaardtarief. Kleineondernemersregeling? Zet 0." />
        <Field label="Betaaltermijn (dagen)" name="paymentTerms" defaultValue={values.paymentTerms != null ? String(values.paymentTerms) : "14"} type="number" />
        <Field label="Uurtarief (€, optioneel)" name="hourlyRateEur" defaultValue={values.hourlyRateEur != null ? String(values.hourlyRateEur) : ""} type="number" hint="Alleen ter herinnering bij het invullen van werkorders." />
      </section>

      <label className="block">
        <span className="text-sm font-medium">Voettekst op de factuur</span>
        <textarea
          name="invoiceFooter"
          defaultValue={values.invoiceFooter ?? ""}
          rows={2}
          maxLength={300}
          placeholder="Betaling binnen 14 dagen op bovenstaand rekeningnummer o.v.v. het factuurnummer."
          className="mt-1 w-full rounded-md border px-3 py-2 text-sm bg-background"
        />
      </label>

      {state?.error && (
        <p className="text-sm text-destructive" role="alert">{state.error}</p>
      )}
      {state?.saved && (
        <p className="text-sm text-emerald-600" role="status">Opgeslagen. Je kunt nu facturen maken vanaf je werkorders.</p>
      )}

      <Button type="submit" disabled={pending}>{pending ? "Opslaan…" : "Gegevens opslaan"}</Button>
    </form>
  );
}
