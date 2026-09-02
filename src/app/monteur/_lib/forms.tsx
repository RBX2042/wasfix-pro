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

export function Field({
  label,
  name,
  defaultValue,
  type = "text",
  required,
  placeholder,
  className,
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  type?: string;
  required?: boolean;
  placeholder?: string;
  className?: string;
}) {
  return (
    <label className={`block text-sm ${className ?? ""}`}>
      <span className="text-muted-foreground">{label}</span>
      <input
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        defaultValue={defaultValue ?? ""}
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
