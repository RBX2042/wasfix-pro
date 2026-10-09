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

/** De standaardformulering voor de kleineondernemersregeling. */
const KOR_FOOTER = "Vrijgesteld van omzetbelasting o.g.v. artikel 25 Wet OB.";

/** Zelfde lezing als de server-actie: leeg of onleesbaar betekent 21%, niet 0%. */
function isKor(vatRatePct: string): boolean {
  const s = vatRatePct.trim();
  if (!s) return false;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) && n === 0;
}

function Field({
  label, name, defaultValue, required, placeholder, type = "text", hint, onChange,
}: {
  label: string; name: string; defaultValue?: string | null; required?: boolean;
  placeholder?: string; type?: string; hint?: string; onChange?: (value: string) => void;
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
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        className="mt-1 w-full rounded-md border px-3 py-2 text-sm bg-background"
      />
      {hint && <span className="text-xs text-muted-foreground mt-1 block">{hint}</span>}
    </label>
  );
}

export function MonteurProfileForm({ values }: { values: ProfileValues }) {
  const [state, action, pending] = useActionState<ProfileResult | null, FormData>(saveMonteurProfile, null);
  const [vatRatePct, setVatRatePct] = React.useState(values.vatRate != null ? String(Math.round(values.vatRate * 100)) : "21");
  const [invoiceFooter, setInvoiceFooter] = React.useState(values.invoiceFooter ?? "");
  // Bij 0% btw is de voettekst de enige plek waar de reden van de vrijstelling
  // op de factuur komt, dus daar is hij verplicht — anders ontdekt de monteur
  // die regel pas als de server het opslaan weigert.
  const kor = isKor(vatRatePct);

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
        <Field label="Btw-tarief (%)" name="vatRatePct" defaultValue={vatRatePct} type="number" onChange={setVatRatePct} hint="21% is het standaardtarief. Kleineondernemersregeling? Zet 0." />
        <Field label="Betaaltermijn (dagen)" name="paymentTerms" defaultValue={values.paymentTerms != null ? String(values.paymentTerms) : "14"} type="number" />
        <Field label="Uurtarief (€, optioneel)" name="hourlyRateEur" defaultValue={values.hourlyRateEur != null ? String(values.hourlyRateEur) : ""} type="number" hint="Alleen ter herinnering bij het invullen van werkorders." />
      </section>

      <div>
        <label className="block">
          <span className="text-sm font-medium">
            Voettekst op de factuur{kor && <span className="text-destructive"> *</span>}
          </span>
          <textarea
            name="invoiceFooter"
            value={invoiceFooter}
            onChange={(e) => setInvoiceFooter(e.target.value)}
            rows={2}
            maxLength={300}
            required={kor}
            placeholder={kor ? KOR_FOOTER : "Betaling binnen 14 dagen op bovenstaand rekeningnummer o.v.v. het factuurnummer."}
            className="mt-1 w-full rounded-md border px-3 py-2 text-sm bg-background"
          />
        </label>
        {kor && (
          <p className="text-xs text-muted-foreground mt-1">
            Bij 0% btw moet de reden van de vrijstelling op de factuur staan.{" "}
            <button
              type="button"
              onClick={() => setInvoiceFooter(KOR_FOOTER)}
              className="underline underline-offset-2 hover:text-foreground"
            >
              Standaardtekst invullen
            </button>
          </p>
        )}
      </div>

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
