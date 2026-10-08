"use client";

import { ActionForm, Submit, inputCls } from "../_lib/action-form";
import { approveRmaAction, closeRmaAction, linkRmaAction, refundRmaAction, rejectRmaAction, returnReceivedAction } from "./actions";

function Details({ summary, children, open }: { summary: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details open={open} className="rounded-md border bg-muted/20 p-3 min-w-0">
      <summary className="cursor-pointer text-sm font-medium select-none">{summary}</summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

export function ApproveForm({ id, weBearCosts, hasAddress }: { id: string; weBearCosts: boolean; hasAddress: boolean }) {
  return (
    <Details summary="Goedkeuren en instructies mailen" open>
      <ActionForm action={approveRmaAction} className="space-y-2">
        <input type="hidden" name="id" value={id} />
        {!hasAddress && <p className="text-sm text-destructive">Het retouradres is niet ingesteld (COMPANY_STREET, COMPANY_POSTAL_CODE, COMPANY_CITY). Goedkeuren is geblokkeerd tot het er is.</p>}
        <p className="text-sm text-muted-foreground">
          De klant krijgt het retouradres uit de bedrijfsgegevens en een uiterste verzenddatum.{" "}
          {weBearCosts ? "De retourkosten zijn voor ons: plak hieronder een retourlabel, of laat het leeg dan vragen we de klant de kosten te mailen." : "De retourkosten zijn voor de klant."}
        </p>
        <label className="block text-sm">
          <span className="text-muted-foreground">Link naar retourlabel (optioneel, https://)</span>
          <input name="labelUrl" type="url" inputMode="url" className={`${inputCls} mt-1`} />
        </label>
        <label className="block text-sm">
          <span className="text-muted-foreground">Interne notitie (optioneel)</span>
          <input name="note" maxLength={500} className={`${inputCls} mt-1`} />
        </label>
        <Submit>Keur goed en mail de klant</Submit>
      </ActionForm>
    </Details>
  );
}

export function RejectForm({ id }: { id: string }) {
  return (
    <Details summary="Afwijzen…">
      <ActionForm action={rejectRmaAction} className="space-y-2">
        <input type="hidden" name="id" value={id} />
        <label className="block text-sm">
          <span className="text-muted-foreground">Reden (de klant ziet deze tekst)</span>
          <textarea name="reason" required minLength={5} maxLength={500} rows={3} className={`${inputCls} mt-1`} />
        </label>
        <Submit variant="destructive">Wijs af en mail de klant</Submit>
      </ActionForm>
    </Details>
  );
}

export function ReceivedForm({ id }: { id: string }) {
  return (
    <ActionForm action={returnReceivedAction}>
      <input type="hidden" name="id" value={id} />
      <Submit>Pakket ontvangen</Submit>
    </ActionForm>
  );
}

export function RefundRmaForm({
  id,
  remainingEur,
  expectedRefundedEur,
  items,
  how,
}: {
  id: string;
  remainingEur: number;
  expectedRefundedEur: number;
  items: Array<{ partId: string; sku: string; quantity: number }>;
  how: string;
}) {
  return (
    <Details summary="Terugbetalen" open>
      <ActionForm action={refundRmaAction} className="space-y-2">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="expectedRefundedEur" value={String(expectedRefundedEur)} />
        <p className="text-sm text-muted-foreground">{how} De klant krijgt een e-mail met de creditnota.</p>
        <label className="block text-sm">
          <span className="text-muted-foreground">Bedrag incl. btw (maximaal € {remainingEur.toFixed(2).replace(".", ",")})</span>
          <input name="amount" required inputMode="decimal" autoComplete="off" defaultValue={remainingEur.toFixed(2).replace(".", ",")} className={`${inputCls} mt-1`} />
        </label>
        {items.length > 0 && (
          <fieldset className="rounded-md border p-2">
            <legend className="px-1 text-xs text-muted-foreground">Terug op voorraad (alleen in goede staat)</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {items.map((i) => (
                <label key={i.partId} className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-mono truncate">{i.sku}</span>
                  <input name={`restock_${i.partId}`} type="number" min={0} max={i.quantity} step={1} placeholder={`0 van ${i.quantity}`} className="w-24 rounded-md border bg-background px-2 py-1 text-sm" />
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <Submit>Boek terugbetaling en sluit retour</Submit>
      </ActionForm>
    </Details>
  );
}

export function LinkForm({ id }: { id: string }) {
  return (
    <Details summary="Koppel aan een bestelling">
      <ActionForm action={linkRmaAction} className="flex flex-wrap gap-2">
        <input type="hidden" name="id" value={id} />
        <input name="reference" required placeholder="Bestelnummer of factuurnummer" className={`${inputCls} flex-1`} />
        <Submit variant="outline">Koppel</Submit>
      </ActionForm>
    </Details>
  );
}

export function CloseForm({ id, refundedEur }: { id: string; refundedEur: string }) {
  return (
    <Details summary="Sluit zonder nieuwe terugbetaling" open>
      <ActionForm action={closeRmaAction} className="space-y-2">
        <input type="hidden" name="id" value={id} />
        <p className="text-sm text-muted-foreground">Bij de bestelling is al {refundedEur} terugbetaald. Hier wordt niets meer geboekt of gemaild; de retour verdwijnt alleen uit de open lijst.</p>
        <label className="block text-sm">
          <span className="text-muted-foreground">Notitie (intern)</span>
          <input name="note" required minLength={5} maxLength={500} className={`${inputCls} mt-1`} />
        </label>
        <Submit variant="outline">Sluit retour</Submit>
      </ActionForm>
    </Details>
  );
}
