"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/**
 * Review submission. Posts to /api/reviews, which stores the review as
 * PENDING for moderation — it does not appear on the page until approved.
 */
export function ReviewForm({
  targetType,
  targetSku,
  targetSlug,
}: {
  targetType: "part" | "guide";
  targetSku?: string;
  targetSlug?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [rating, setRating] = React.useState(5);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setSubmitting(true);
    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetType,
          targetSku,
          targetSlug,
          rating,
          title: String(fd.get("title") ?? ""),
          body: String(fd.get("body") ?? ""),
          author: String(fd.get("author") ?? ""),
          email: String(fd.get("email") ?? ""),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Review kon niet worden verstuurd");
        return;
      }
      toast.success(data.message ?? "Bedankt — je review wordt na moderatie geplaatst.");
      form.reset();
      setRating(5);
      setOpen(false);
    } catch {
      toast.error("Review kon niet worden verstuurd");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Schrijf een review
      </Button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 border-t pt-5">
      <div>
        <span className="text-sm text-muted-foreground">Beoordeling</span>
        <div className="flex items-center gap-1 mt-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setRating(n)}
              aria-label={`${n} ${n === 1 ? "ster" : "sterren"}`}
              className="text-2xl leading-none"
              style={{ color: n <= rating ? "#f5b643" : "#cbd5e1" }}
            >
              ★
            </button>
          ))}
        </div>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block text-sm">
          <span className="text-muted-foreground">Naam</span>
          <input name="author" required minLength={2} maxLength={60} className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm" placeholder="Jan de Vries" />
        </label>
        <label className="block text-sm">
          <span className="text-muted-foreground">E-mail (niet gepubliceerd)</span>
          <input name="email" type="email" required className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm" placeholder="jouw@email.nl" />
        </label>
      </div>
      <label className="block text-sm">
        <span className="text-muted-foreground">Titel</span>
        <input name="title" required minLength={3} maxLength={80} className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm" placeholder="Past perfect" />
      </label>
      <label className="block text-sm">
        <span className="text-muted-foreground">Je ervaring</span>
        <textarea name="body" required minLength={10} maxLength={2000} rows={4} className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm" placeholder="Wat viel je op bij montage, kwaliteit en levering?" />
      </label>
      <p className="text-xs text-muted-foreground">
        Je review wordt handmatig gecontroleerd voordat hij zichtbaar wordt. Je e-mailadres publiceren we niet.
      </p>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={submitting}>
          {submitting ? "Versturen…" : "Review versturen"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Annuleren
        </Button>
      </div>
    </form>
  );
}
