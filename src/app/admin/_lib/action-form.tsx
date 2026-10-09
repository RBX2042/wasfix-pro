"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { ActionState } from "./guard";

type Action = (prev: ActionState | null, fd: FormData) => Promise<ActionState>;

/** Set by ActionForm while its action runs, so the submit button knows even though the form has no `action` prop. */
const PendingContext = React.createContext(false);

/**
 * False until ActionForm has hydrated. The form has no `action` prop, so before React attaches its
 * onSubmit a click (or Enter, or a browser with scripting off) would submit it natively: a GET to the
 * current page with every field, amounts and cancellation reasons included, in the address bar and the
 * history. A disabled submit button also blocks implicit submission with Enter. Outside an ActionForm
 * the default is true: those forms are bound with `action` and React blocks the native submit itself.
 */
const HydratedContext = React.createContext(true);

/** Submit button that disables itself while the action runs: the first line of defence against a double click. */
export function Submit({ children, variant = "default", size = "sm", className }: {
  children: React.ReactNode;
  variant?: "default" | "outline" | "destructive" | "ghost";
  size?: "sm" | "default";
  className?: string;
}) {
  const status = useFormStatus();
  const running = React.useContext(PendingContext);
  const hydrated = React.useContext(HydratedContext);
  const pending = status.pending || running;
  return (
    <Button type="submit" size={size} variant={variant} disabled={pending || !hydrated} className={className}>
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
 *
 * The form is submitted with onSubmit and NOT through the `action` prop. React 19 resets an
 * uncontrolled form after every action, failed ones included, so a refused "markeer betaald"
 * (one cent off) wiped the amount the owner had just typed and made them type it again from the
 * bank statement. Here the form is only reset when the action SUCCEEDED.
 */
export function ActionForm({ action, children, className }: { action: Action; children: React.ReactNode; className?: string }) {
  const [state, setState] = React.useState<ActionState | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [hydrated, setHydrated] = React.useState(false);
  React.useEffect(() => setHydrated(true), []);
  const run = async (fd: FormData): Promise<ActionState> => {
    let res: ActionState;
    try {
      res = await action(null, fd);
    } catch {
      res = { ok: false, error: "Er ging iets mis. Ververs de pagina en probeer het opnieuw." };
    }
    if (res.ok) toast.success(res.message ?? "Gelukt", { duration: 12000 });
    else toast.error(res.error ?? "Mislukt", { duration: 12000 });
    setState(res);
    return res;
  };
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending || !hydrated) return;
    const form = e.currentTarget;
    const fd = new FormData(form);
    startTransition(async () => {
      const res = await run(fd);
      if (res.ok) form.reset();
    });
  };
  return (
    <form onSubmit={onSubmit} className={className}>
      <HydratedContext.Provider value={hydrated}>
        <PendingContext.Provider value={pending}>{children}</PendingContext.Provider>
      </HydratedContext.Provider>
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
