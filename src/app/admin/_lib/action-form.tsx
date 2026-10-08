"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { ActionState } from "./guard";

type Action = (prev: ActionState | null, fd: FormData) => Promise<ActionState>;

/** Submit button that disables itself while the action runs: the first line of defence against a double click. */
export function Submit({ children, variant = "default", size = "sm", className }: {
  children: React.ReactNode;
  variant?: "default" | "outline" | "destructive" | "ghost";
  size?: "sm" | "default";
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size={size} variant={variant} disabled={pending} className={className}>
      {pending ? "Bezig…" : children}
    </Button>
  );
}

/**
 * A form bound to a server action. The result is shown as a toast AND inline.
 *
 * The toast is raised right after the action returns, from this function, not from an effect
 * of the component: when the action changes an order's status the refreshed page replaces this
 * very form in the same render (the card moves to another list or shows other buttons), and an
 * effect of an unmounted component never runs. The first version used useActionState with an
 * effect and the success message of "betaling geboekt" was never shown (seen in the browser).
 * A form action that is a client function keeps useFormStatus (the pending button) working.
 */
export function ActionForm({ action, children, className }: { action: Action; children: React.ReactNode; className?: string }) {
  const [state, setState] = React.useState<ActionState | null>(null);
  const run = async (fd: FormData) => {
    let res: ActionState;
    try {
      res = await action(null, fd);
    } catch {
      res = { ok: false, error: "Er ging iets mis. Ververs de pagina en probeer het opnieuw." };
    }
    if (res.ok) toast.success(res.message ?? "Gelukt", { duration: 12000 });
    else toast.error(res.error ?? "Mislukt", { duration: 12000 });
    setState(res);
  };
  return (
    <form action={run} className={className}>
      {children}
      {state && !state.ok && state.error && (
        <p role="alert" className="mt-2 text-sm text-destructive break-words">{state.error}</p>
      )}
      {state?.ok && state.message && (
        <p role="status" className="mt-2 text-sm text-emerald-700 dark:text-emerald-400 break-words">{state.message}</p>
      )}
    </form>
  );
}

export const inputCls = "w-full min-w-0 rounded-md border bg-background px-3 py-2 text-sm";
