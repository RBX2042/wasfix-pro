"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "./constants";

export function SubmitButton({ children, size = "default" }: { children: React.ReactNode; size?: "default" | "sm" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size={size} disabled={pending}>
      {pending ? "Bezig…" : children}
    </Button>
  );
}

/**
 * Wraps a server action so the result surfaces as a toast and the dialog
 * closes on success. Keeps every form on the page consistent.
 */
export function useActionForm(action: (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>, onSuccess?: () => void) {
  const [state, formAction] = React.useActionState(action, null);
  const seen = React.useRef<ActionResult | null>(null);

  React.useEffect(() => {
    if (!state || state === seen.current) return;
    seen.current = state;
    if (state.ok) {
      toast.success("Opgeslagen");
      onSuccess?.();
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state, onSuccess]);

  return formAction;
}

/**
 * AMOUNTS ARE TEXT INPUTS. A browser number input reads the decimal separator
 * by the browser's language, and that goes wrong in both directions:
 *   - no step (default 1): every price with cents is refused ("valid values are
 *     28 and 29", measured in Chromium on the admin part form);
 *   - an English browser (en-US) does not reject the Dutch comma, it MISREADS it
 *     as a thousands separator: typing "89,50" gives the valid value 8950, a
 *     silent 100x price (measured in Chromium en-US on the work-order price).
 * So type="decimal" renders a text input with inputMode="decimal" that accepts
 * "28,50" and "28.50" whatever the browser language and sends the text as typed;
 * the server actions read both notations (num() in admin/_lib/catalog-actions.ts,
 * priceEur in monteur/_lib/actions.ts).
 *
 * For safety type="number" WITHOUT an explicit integer step is treated as
 * "decimal" too: a caller that forgets the type can no longer reintroduce the
 * 100x trap. Whole-number fields say so with step="1" (stock, minutes).
 */
function isAmountField(type: string, step: string | undefined) {
  return type === "decimal" || (type === "number" && (step === undefined || step === "any"));
}

export function Field({
  label,
  name,
  defaultValue,
  type = "text",
  required,
  placeholder,
  className,
  step,
  min,
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  type?: string;
  required?: boolean;
  placeholder?: string;
  className?: string;
  step?: string;
  min?: string;
}) {
  const decimal = isAmountField(type, step);
  return (
    <label className={`block text-sm ${className ?? ""}`}>
      <span className="text-muted-foreground">{label}</span>
      <input
        name={name}
        type={decimal ? "text" : type}
        required={required}
        placeholder={placeholder}
        defaultValue={defaultValue ?? ""}
        step={!decimal && type === "number" ? step : undefined}
        min={!decimal && type === "number" ? min : undefined}
        inputMode={decimal ? "decimal" : undefined}
        pattern={decimal ? "[0-9]+([.,][0-9]{1,2})?" : undefined}
        title={decimal ? "Een bedrag zoals 28,50" : undefined}
        autoComplete={decimal ? "off" : undefined}
        className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
      />
    </label>
  );
}

export function TextArea({ label, name, defaultValue, required, rows = 3 }: { label: string; name: string; defaultValue?: string | null; required?: boolean; rows?: number }) {
  return (
    <label className="block text-sm">
      <span className="text-muted-foreground">{label}</span>
      <textarea
        name={name}
        rows={rows}
        required={required}
        defaultValue={defaultValue ?? ""}
        className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
      />
    </label>
  );
}

export function Select({
  label,
  name,
  options,
  defaultValue,
}: {
  label: string;
  name: string;
  options: Array<{ value: string; label: string }>;
  defaultValue?: string | null;
}) {
  return (
    <label className="block text-sm">
      <span className="text-muted-foreground">{label}</span>
      <select name={name} defaultValue={defaultValue ?? options[0]?.value} className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm">
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

/** Minimal dialog — native <dialog> keeps this dependency-free and accessible. */
export function FormDialog({
  trigger,
  title,
  children,
}: {
  trigger: React.ReactNode;
  title: string;
  children: (close: () => void) => React.ReactNode;
}) {
  const ref = React.useRef<HTMLDialogElement>(null);
  const open = () => ref.current?.showModal();
  const close = React.useCallback(() => ref.current?.close(), []);

  return (
    <>
      <span onClick={open} className="contents">{trigger}</span>
      <dialog
        ref={ref}
        className="w-[min(92vw,560px)] rounded-lg border bg-background p-0 text-foreground backdrop:bg-black/50"
        onClick={(e) => { if (e.target === ref.current) close(); }}
      >
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-heading text-lg font-semibold">{title}</h2>
            <button type="button" onClick={close} aria-label="Sluiten" className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
          </div>
          {children(close)}
        </div>
      </dialog>
    </>
  );
}
