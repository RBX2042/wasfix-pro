"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Check, Monitor, Moon, Sun, type LucideIcon } from "lucide-react";

/**
 * The switch between Licht, Donker and Systeem (decision D22). Light is the default; this is how a visitor
 * leaves it, goes back, or hands the decision to the operating system.
 *
 * Two shapes of the same control, both keyboard operable, both with 44x44 targets and a visible focus ring
 * (the styles are in globals.css, .theme-toggle):
 *
 *  - variant="menu" (default): one icon button that opens a small panel with the three choices. For headers
 *    and the mobile bottom bar, where room is short. A disclosure, not an ARIA menu: Enter or Space opens it,
 *    focus moves to the current choice, the arrow keys, Home and End move between the choices, Enter or
 *    Space picks one, Escape closes it and gives focus back to the button, and so does picking.
 *  - variant="segmented": the three choices side by side, each a toggle button with aria-pressed. For the
 *    mobile menu, footers, and pages without a header.
 *
 * Hydration: the server cannot know the stored choice (it lives in localStorage), and the first client render
 * must match the server HTML. So until mounted nothing here depends on it: the menu button shows the sun or
 * the moon according to the class on <html> (CSS, set before first paint by next-themes' inline script) and
 * the segmented buttons carry no aria-pressed. The element sizes are identical before and after, so nothing
 * moves when the real state arrives.
 */

export type ThemeChoice = "light" | "dark" | "system";

const CHOICES: ReadonlyArray<{ value: ThemeChoice; label: string; Icon: LucideIcon }> = [
  { value: "light", label: "Licht", Icon: Sun },
  { value: "dark", label: "Donker", Icon: Moon },
  { value: "system", label: "Systeem", Icon: Monitor },
];

/** What the stored value means to the toggle. An unknown value is treated like the default, which is light. */
function choiceOf(theme: string | undefined) {
  return CHOICES.find((c) => c.value === theme) ?? CHOICES[0];
}

function useMounted() {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  return mounted;
}

export function ThemeToggle({
  variant = "menu",
  placement = "bottom-end",
  label,
  className = "",
}: {
  variant?: "menu" | "segmented";
  /** Where the panel of the menu variant opens: below the button (headers) or above it (the bottom bar). */
  placement?: "bottom-end" | "top-end";
  /** Menu variant: a short visible word under the icon (the bottom bar shows "Thema"). */
  label?: string;
  className?: string;
}) {
  return variant === "segmented" ? <ThemeSegments className={className} /> : <ThemeMenu placement={placement} label={label} className={className} />;
}

function ThemeSegments({ className }: { className: string }) {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  return (
    <div role="group" aria-label="Kleurthema" data-theme-toggle="segmented" className={`theme-toggle theme-toggle--segmented ${className}`.trim()}>
      {CHOICES.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          className="theme-toggle__seg"
          data-theme-choice={value}
          aria-pressed={mounted ? choiceOf(theme).value === value : undefined}
          onClick={() => setTheme(value)}
        >
          <Icon aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

function ThemeMenu({ placement, label: visibleLabel, className }: { placement: "bottom-end" | "top-end"; label?: string; className: string }) {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const panelId = React.useId();
  const current = choiceOf(theme);

  // Close on a press outside and on Escape; Escape hands focus back to the button.
  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Opening moves focus to the current choice.
  React.useEffect(() => {
    if (!open) return;
    const options = panelRef.current?.querySelectorAll<HTMLButtonElement>("button");
    const selected = panelRef.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
    (selected ?? options?.[0])?.focus();
  }, [open]);

  const pick = (value: ThemeChoice) => {
    setTheme(value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onPanelKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const options = Array.from(panelRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    const at = options.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    if (e.key === "ArrowDown") next = (at + 1) % options.length;
    else if (e.key === "ArrowUp") next = (at - 1 + options.length) % options.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = options.length - 1;
    if (next < 0) return;
    e.preventDefault();
    options[next]?.focus();
  };

  // Tabbing out of the control closes it. A null relatedTarget (a click on something that cannot take focus,
  // or Safari not focusing buttons on click) is left to the outside-press handler above: closing here would
  // unmount the panel before the click on a choice arrives.
  const onBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    const to = e.relatedTarget as Node | null;
    if (open && to && !rootRef.current?.contains(to)) setOpen(false);
  };

  const label = mounted ? `Kleurthema: ${current.label}` : "Kleurthema";
  // With a visible word the accessible name must contain it (WCAG 2.5.3): "Kleurthema: Licht" contains "thema".

  return (
    <div ref={rootRef} data-theme-toggle="menu" className={`theme-toggle ${className}`.trim()} onBlur={onBlur}>
      <button
        ref={triggerRef}
        type="button"
        className="theme-toggle__trigger"
        data-theme-trigger=""
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        {mounted ? (
          <current.Icon aria-hidden="true" />
        ) : (
          <>
            <Sun className="theme-toggle__sun" aria-hidden="true" />
            <Moon className="theme-toggle__moon" aria-hidden="true" />
          </>
        )}
        {visibleLabel && <span aria-hidden="true">{visibleLabel}</span>}
      </button>
      {open && (
        <div ref={panelRef} id={panelId} role="group" aria-label="Kleurthema" data-placement={placement} className="theme-toggle__panel" onKeyDown={onPanelKeyDown}>
          {CHOICES.map(({ value, label: text, Icon }) => (
            <button key={value} type="button" className="theme-toggle__option" data-theme-choice={value} aria-pressed={current.value === value} onClick={() => pick(value)}>
              <Icon aria-hidden="true" />
              <span>{text}</span>
              <Check className="theme-toggle__check" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
