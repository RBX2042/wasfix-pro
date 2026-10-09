"use client";

import { ActionForm, Submit, inputCls } from "../_lib/action-form";
import { cancelOrderAction, correctTrackingAction, issueInvoiceAction, markDeliveredAction, markPaidAction, markShippedAction, recordRefundAction, resendOrderMailAction } from "./actions";
import { decimalNl } from "@/lib/emails/money";

const CARRIER_OPTIONS = [
  { value: "POSTNL", label: "PostNL" },
  { value: "DHL", label: "DHL" },
  { value: "DPD", label: "DPD" },
  { value: "UPS", label: "UPS" },
  { value: "GLS", label: "GLS" },
  { value: "OTHER", label: "Andere vervoerder" },
];

function Details({ summary, children, open }: { summary: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details open={open} className="rounded-md border bg-muted/20 p-3 min-w-0">
      <summary className="cursor-pointer text-sm font-medium select-none">{summary}</summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

/**
 * The amount field has no default on purpose: the owner types what the bank
 * statement says. A pre-filled total would turn the check into a rubber stamp.
 *
 * Only for an order that still waits for the wire (OPENSTAAND). A wire that
 * arrives for an order that was already cancelled cannot be booked: that order
 * has been credited and its units released (terms 7.1), so the card says
 * "betaal terug of laat de klant opnieuw bestellen" instead of offering a form.
 */
export function MarkPaidForm({ orderId, totalLabel }: { orderId: string; totalLabel: string }) {
  return (
    <Details summary="Betaling ontvangen" open>
      <ActionForm action={markPaidAction} className="space-y-2">
        <input type="hidden" name="orderId" value={orderId} />
        <label className="block text-sm">
          <span className="text-muted-foreground">Ontvangen bedrag volgens de bank (factuurbedrag {totalLabel})</span>
          <input name="received" required inputMode="decimal" autoComplete="off" placeholder="bijv. 34,45" className={`${inputCls} mt-1`} />
        </label>
        <Submit>Boek betaling</Submit>
      </ActionForm>
    </Details>
  );
}

export type ResendKind = "bank-instructions" | "order-paid" | "payment-received";

const RESEND_LABEL: Record<ResendKind, string> = {
  "bank-instructions": "Stuur betaalinstructies opnieuw",
  "order-paid": "Stuur bevestiging opnieuw",
  "payment-received": "Stuur betaling-ontvangen opnieuw",
};

/** Sends one customer mail again from what is stored. Never changes the order. */
export function ResendMailForm({ orderId, kind }: { orderId: string; kind: ResendKind }) {
  return (
    <ActionForm action={resendOrderMailAction} className="inline-block">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="kind" value={kind} />
      <Submit variant="outline">{RESEND_LABEL[kind]}</Submit>
    </ActionForm>
  );
}

/** For a paid order that never got its invoice (company details were incomplete when it was paid). */
export function IssueInvoiceForm({ orderId }: { orderId: string }) {
  return (
    <ActionForm action={issueInvoiceAction} className="rounded-md border border-amber-500/60 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-2">
      <input type="hidden" name="orderId" value={orderId} />
      <p className="text-sm">Deze bestelling is betaald maar heeft nog geen factuur. De factuur krijgt de datum van vandaag.</p>
      <Submit>Factuur aanmaken</Submit>
    </ActionForm>
  );
}

export function ShipForm({ orderId }: { orderId: string }) {
  return (
    <Details summary="Verzenden" open>
      <ActionForm action={markShippedAction} className="space-y-2">
        <input type="hidden" name="orderId" value={orderId} />
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-muted-foreground">Vervoerder</span>
            <select name="carrier" defaultValue="POSTNL" className={`${inputCls} mt-1`}>
              {CARRIER_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">Trackingcode</span>
            <input name="trackingCode" required minLength={3} maxLength={64} autoComplete="off" className={`${inputCls} mt-1 font-mono`} />
          </label>
        </div>
        <label className="block text-sm">
          <span className="text-muted-foreground">Naam vervoerder (alleen bij &ldquo;Andere&rdquo;)</span>
          <input name="carrierOther" maxLength={40} className={`${inputCls} mt-1`} />
        </label>
        <Submit>Verzonden: mail de klant</Submit>
      </ActionForm>
    </Details>
  );
}

export function TrackingForm({ orderId, carrier, trackingCode }: { orderId: string; carrier: string | null; trackingCode: string | null }) {
  const known = CARRIER_OPTIONS.some((c) => c.value === carrier);
  return (
    <Details summary="Trackinggegevens aanpassen">
      <ActionForm action={correctTrackingAction} className="space-y-2">
        <input type="hidden" name="orderId" value={orderId} />
        <div className="grid gap-2 sm:grid-cols-2">
          <select name="carrier" defaultValue={known ? (carrier as string) : "OTHER"} className={inputCls}>
            {CARRIER_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <input name="trackingCode" required defaultValue={trackingCode ?? ""} className={`${inputCls} font-mono`} />
        </div>
        <input name="carrierOther" defaultValue={known ? "" : (carrier ?? "")} placeholder="Naam vervoerder (bij Andere)" className={inputCls} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="resend" /> Stuur de klant de gecorrigeerde link</label>
        <Submit variant="outline">Opslaan</Submit>
      </ActionForm>
    </Details>
  );
}

export function DeliverForm({ orderId }: { orderId: string }) {
  return (
    <ActionForm action={markDeliveredAction}>
      <input type="hidden" name="orderId" value={orderId} />
      <Submit>Aflevering bevestigen</Submit>
    </ActionForm>
  );
}

export function CancelForm({ orderId, status, consequences }: { orderId: string; status: string; consequences: string[] }) {
  return (
    <Details summary="Annuleren…">
      <ActionForm action={cancelOrderAction} className="space-y-2">
        <input type="hidden" name="orderId" value={orderId} />
        {/* The status the owner is looking at: the cancellation is refused when the order has moved on since. */}
        <input type="hidden" name="expectedStatus" value={status} />
        <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 p-3 text-sm">
          <p className="font-medium mb-1">Wat er gebeurt:</p>
          <ul className="list-disc pl-5 space-y-0.5">{consequences.map((c) => <li key={c}>{c}</li>)}</ul>
        </div>
        <label className="block text-sm">
          <span className="text-muted-foreground">Reden (staat ook in de e-mail aan de klant)</span>
          <input name="reason" required minLength={3} maxLength={200} className={`${inputCls} mt-1`} />
        </label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="confirm" required /> Ja, annuleer deze bestelling</label>
        <Submit variant="destructive">Bestelling annuleren</Submit>
      </ActionForm>
    </Details>
  );
}

/** `quantity` is what can still be put back on the shelf (ordered minus earlier restocks), `ordered` what was ordered. */
export type RefundItem = { partId: string; sku: string; quantity: number; ordered?: number };

export function RefundForm({
  orderId,
  remainingEur,
  expectedRefundedEur,
  idempotencyKey,
  items,
  how,
  canRestock,
}: {
  orderId: string;
  remainingEur: number;
  expectedRefundedEur: number;
  /** Generated when the page rendered: submitting the same rendered form twice is one refund. */
  idempotencyKey: string;
  items: RefundItem[];
  how: string;
  /** Only goods that shipped can come back. For an unshipped order cancelling is the tool: it puts everything back. */
  canRestock: boolean;
}) {
  return (
    <Details summary="Terugbetaling vastleggen (retour of coulance)">
      <ActionForm action={recordRefundAction} className="space-y-2">
        <input type="hidden" name="orderId" value={orderId} />
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
        <input type="hidden" name="expectedRefundedEur" value={String(expectedRefundedEur)} />
        <p className="text-sm text-muted-foreground">{how}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-muted-foreground">Bedrag incl. btw (maximaal € {decimalNl(remainingEur)})</span>
            <input name="amount" required inputMode="decimal" autoComplete="off" defaultValue={decimalNl(remainingEur)} className={`${inputCls} mt-1`} />
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">Reden</span>
            <input name="reason" required minLength={3} maxLength={200} className={`${inputCls} mt-1`} />
          </label>
        </div>
        {canRestock && items.some((i) => i.quantity > 0) && (
          <fieldset className="rounded-md border p-2">
            <legend className="px-1 text-xs text-muted-foreground">Terug op voorraad (alleen onderdelen die in goede staat terugkomen)</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {items.filter((i) => i.quantity > 0).map((i) => (
                <label key={i.partId} className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-mono truncate">{i.sku}</span>
                  <input name={`restock_${i.partId}`} type="number" min={0} max={i.quantity} step={1} placeholder={`0 van ${i.quantity}`} className="w-24 rounded-md border bg-background px-2 py-1 text-sm" />
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {!canRestock && <p className="text-xs text-muted-foreground">Nog niet verzonden, dus er komt niets terug: wil je de hele bestelling stopzetten, annuleer haar dan. Dat zet alles terug op voorraad.</p>}
        <Submit variant="outline">Boek terugbetaling</Submit>
      </ActionForm>
    </Details>
  );
}
