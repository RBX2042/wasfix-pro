"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { FormDialog, Field, Select, SubmitButton, TextArea, useActionForm } from "@/app/monteur/_lib/forms";
import {
  deleteErrorCode,
  deleteGuide,
  deletePart,
  saveErrorCode,
  saveGuide,
  savePart,
} from "./catalog-actions";
import { DIFFICULTIES, PART_CATEGORIES, SEVERITIES, type ActionResult } from "./catalog-constants";

const opts = (values: readonly string[]) => values.map((v) => ({ value: v, label: v }));

function Actions({ close }: { close: () => void }) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <Button type="button" variant="outline" onClick={close}>Annuleren</Button>
      <SubmitButton>Opslaan</SubmitButton>
    </div>
  );
}

function Checkbox({ name, label, defaultChecked }: { name: string; label: string; defaultChecked?: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm pb-2">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="h-4 w-4" />
      <span>{label}</span>
    </label>
  );
}

// ─── Parts ────────────────────────────────────────────────────────
export type PartRow = {
  id: string;
  sku: string;
  name: string;
  brand: string;
  category: string;
  priceEur: number;
  costEur?: number | null;
  stock: number;
  description: string | null;
  imageUrl: string | null;
  supplier: string | null;
  isOriginal: boolean;
};

function PartFields({ part, close }: { part?: PartRow; close: () => void }) {
  const formAction = useActionForm(savePart, close);
  return (
    <form action={formAction} className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
      {part && <input type="hidden" name="id" value={part.id} />}
      <div className="grid grid-cols-2 gap-3">
        <Field label="SKU" name="sku" defaultValue={part?.sku} required placeholder="WF-PUMP-01" />
        <Field label="Merk" name="brand" defaultValue={part?.brand} required placeholder="Bosch of Universeel" />
      </div>
      <Field label="Naam" name="name" defaultValue={part?.name} required placeholder="Afvoerpomp universeel" />
      <div className="grid grid-cols-3 gap-3">
        <Select label="Categorie" name="category" options={opts(PART_CATEGORIES)} defaultValue={part?.category} />
        <Field label="Verkoopprijs (€, incl. btw)" name="priceEur" type="number" defaultValue={part ? String(part.priceEur) : ""} required placeholder="28.50" />
        <Field label="Inkoopprijs (€, excl. btw)" name="costEur" type="number" defaultValue={part?.costEur != null ? String(part.costEur) : ""} placeholder="12.00" />
        <Field label="Voorraad" name="stock" type="number" defaultValue={part ? String(part.stock) : "0"} required />
      </div>
      <TextArea label="Omschrijving" name="description" defaultValue={part?.description} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Afbeelding-URL" name="imageUrl" defaultValue={part?.imageUrl} placeholder="https://…" />
        <Field label="Leverancier" name="supplier" defaultValue={part?.supplier} />
      </div>
      <Checkbox name="isOriginal" label="Origineel onderdeel (geen universele vervanger)" defaultChecked={part?.isOriginal ?? true} />
      <Actions close={close} />
    </form>
  );
}

export function NewPartButton() {
  return (
    <FormDialog title="Nieuw onderdeel" trigger={<Button><Plus className="h-4 w-4" /> Nieuw onderdeel</Button>}>
      {(close) => <PartFields close={close} />}
    </FormDialog>
  );
}

export function EditPartButton({ part }: { part: PartRow }) {
  return (
    <FormDialog title={`Onderdeel — ${part.sku}`} trigger={<Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Bewerken"><Pencil className="h-3 w-3" /></Button>}>
      {(close) => <PartFields part={part} close={close} />}
    </FormDialog>
  );
}

// ─── Guides ───────────────────────────────────────────────────────
export type GuideRow = {
  id: string;
  title: string;
  slug: string;
  summary: string;
  difficulty: string;
  timeMinutes: number;
  steps: string;
  tools: string;
  warnings: string | null;
  isPremium: boolean;
};

function GuideFields({ guide, close }: { guide?: GuideRow; close: () => void }) {
  const formAction = useActionForm(saveGuide, close);
  return (
    <form action={formAction} className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
      {guide && <input type="hidden" name="id" value={guide.id} />}
      <Field label="Titel" name="title" defaultValue={guide?.title} required placeholder="Afvoerpomp reinigen en vervangen" />
      <Field label="Slug" name="slug" defaultValue={guide?.slug} required placeholder="afvoerpomp-reinigen-vervangen" />
      <TextArea label="Samenvatting" name="summary" defaultValue={guide?.summary} required rows={2} />
      <div className="grid grid-cols-2 gap-3">
        <Select label="Moeilijkheid" name="difficulty" options={opts(DIFFICULTIES)} defaultValue={guide?.difficulty} />
        <Field label="Tijd (minuten)" name="timeMinutes" type="number" defaultValue={guide ? String(guide.timeMinutes) : "30"} required />
      </div>
      <Field label="Gereedschap (gescheiden door |)" name="tools" defaultValue={guide?.tools} placeholder="Schroevendraaier|Emmer|Doek" />
      <TextArea label="Waarschuwingen" name="warnings" defaultValue={guide?.warnings} rows={2} />
      <label className="block text-sm">
        <span className="text-muted-foreground">Stappen (JSON-array)</span>
        <textarea
          name="steps"
          rows={6}
          defaultValue={guide?.steps ?? '[{"stepNum":1,"title":"","description":""}]'}
          className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-xs font-mono"
        />
      </label>
      <Checkbox name="isPremium" label="Premium gids (alleen voor abonnees)" defaultChecked={guide?.isPremium} />
      <Actions close={close} />
    </form>
  );
}

export function NewGuideButton() {
  return (
    <FormDialog title="Nieuwe gids" trigger={<Button><Plus className="h-4 w-4" /> Nieuwe gids</Button>}>
      {(close) => <GuideFields close={close} />}
    </FormDialog>
  );
}

export function EditGuideButton({ guide }: { guide: GuideRow }) {
  return (
    <FormDialog title={`Gids — ${guide.slug}`} trigger={<Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Bewerken"><Pencil className="h-3 w-3" /></Button>}>
      {(close) => <GuideFields guide={guide} close={close} />}
    </FormDialog>
  );
}

// ─── Error codes ──────────────────────────────────────────────────
export type ErrorCodeRow = {
  id: string;
  code: string;
  machineId: string;
  title: string;
  description: string;
  likelyCauses: string;
  severity: string;
  diyFriendly: boolean;
  provenance: string;
  sourceUrl: string | null;
  sourceName: string | null;
};

export type MachineOption = { id: string; label: string };

function ErrorCodeFields({ errorCode, machines, close }: { errorCode?: ErrorCodeRow; machines: MachineOption[]; close: () => void }) {
  const formAction = useActionForm(saveErrorCode, close);
  return (
    <form action={formAction} className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
      {errorCode && <input type="hidden" name="id" value={errorCode.id} />}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Code" name="code" defaultValue={errorCode?.code} required placeholder="E18" />
        <Select label="Ernst" name="severity" options={opts(SEVERITIES)} defaultValue={errorCode?.severity} />
      </div>
      <Select
        label="Machine"
        name="machineId"
        options={machines.map((m) => ({ value: m.id, label: m.label }))}
        defaultValue={errorCode?.machineId}
      />
      <Field label="Titel" name="title" defaultValue={errorCode?.title} required placeholder="Afvoerprobleem" />
      <TextArea label="Omschrijving" name="description" defaultValue={errorCode?.description} required />
      <Field label="Waarschijnlijke oorzaken (gescheiden door |)" name="likelyCauses" defaultValue={errorCode?.likelyCauses} required placeholder="Verstopt filter|Defecte pomp" />
      <Checkbox name="diyFriendly" label="Zelf op te lossen (DIY)" defaultChecked={errorCode?.diyFriendly ?? true} />
      <Select
        label="Bron gecontroleerd?"
        name="provenance"
        options={[
          { value: "REPORTED", label: "Nee — gemeld, niet nagelopen" },
          { value: "VERIFIED", label: "Ja — gecontroleerd tegen een bron" },
        ]}
        defaultValue={errorCode?.provenance ?? "REPORTED"}
      />
      <Field label="Bron-URL" name="sourceUrl" defaultValue={errorCode?.sourceUrl ?? ""} placeholder="https://www.bosch-home.be/..." />
      <Field label="Bron-naam" name="sourceName" defaultValue={errorCode?.sourceName ?? ""} placeholder="Bosch Home — E18 op display" />
      <Actions close={close} />
    </form>
  );
}

export function NewErrorCodeButton({ machines }: { machines: MachineOption[] }) {
  return (
    <FormDialog title="Nieuwe foutcode" trigger={<Button><Plus className="h-4 w-4" /> Nieuwe foutcode</Button>}>
      {(close) => <ErrorCodeFields machines={machines} close={close} />}
    </FormDialog>
  );
}

export function EditErrorCodeButton({ errorCode, machines }: { errorCode: ErrorCodeRow; machines: MachineOption[] }) {
  return (
    <FormDialog title={`Foutcode — ${errorCode.code}`} trigger={<Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Bewerken"><Pencil className="h-3 w-3" /></Button>}>
      {(close) => <ErrorCodeFields errorCode={errorCode} machines={machines} close={close} />}
    </FormDialog>
  );
}

// ─── Shared delete ────────────────────────────────────────────────
export function DeleteButton({
  id,
  label,
  action,
}: {
  id: string;
  label: string;
  action: (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;
}) {
  const formAction = useActionForm(action);
  return (
    <form action={formAction} onSubmit={(e) => { if (!confirm(`${label} verwijderen?`)) e.preventDefault(); }}>
      <input type="hidden" name="id" value={id} />
      <Button type="submit" size="icon" variant="ghost" className="h-7 w-7 text-destructive" aria-label="Verwijderen">
        <Trash2 className="h-3 w-3" />
      </Button>
    </form>
  );
}

export { deletePart, deleteGuide, deleteErrorCode };
