"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Submit, inputCls } from "../_lib/action-form";
import { applyImportAction, previewImportAction, type ImportState } from "./import-actions";

const ACTION_LABEL = { create: "NIEUW", update: "wijzigt", unchanged: "gelijk", error: "FOUT" } as const;

export function ImportPanel() {
  const [preview, previewAction] = React.useActionState<ImportState | null, FormData>(previewImportAction, null);
  const [applied, applyAction] = React.useActionState<ImportState | null, FormData>(applyImportAction, null);
  const seen = React.useRef<ImportState | null>(null);
  React.useEffect(() => {
    if (!applied || seen.current === applied) return;
    seen.current = applied;
    if (applied.ok) toast.success(applied.message ?? "Geïmporteerd", { duration: 12000 });
    else if (applied.error) toast.error(applied.error, { duration: 12000 });
  }, [applied]);

  // After a successful apply the preview is stale: hide it until a new one is made.
  const [stale, setStale] = React.useState(false);
  React.useEffect(() => setStale(false), [preview]);
  React.useEffect(() => {
    if (applied?.ok) setStale(true);
  }, [applied]);
  const p = preview?.preview;
  const showPreview = p && !stale;

  return (
    <details className="mb-4 rounded-lg border p-4">
      <summary className="cursor-pointer font-medium select-none">CSV importeren of exporteren</summary>
      <div className="mt-4 space-y-4">
        <p className="text-sm text-muted-foreground">
          Download de huidige catalogus, vul prijzen, inkoop en voorraad aan in Excel en laad het bestand terug.
          Regels die niet in het bestand staan worden niet aangeraakt, een lege cel laat de waarde zoals hij is, en je ziet eerst een voorbeeld.
          Kolommen: <code>sku;name;brand;category;price;cost;costSource;stock;supplier</code>. <code>stock</code> is het aantal dat je nog kunt VERKOPEN en overschrijft de voorraad: tel je de plank, trek er dan de stuks van af die al verkocht maar nog niet verzonden zijn (zie kolom &ldquo;Gereserveerd&rdquo;), anders verkoop je ze dubbel.
        </p>
        <Button asChild variant="outline" size="sm"><a href="/api/admin/parts/export" download>Download CSV</a></Button>

        <form action={previewAction} className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="block text-muted-foreground mb-1">Bestand (.csv)</span>
            <input name="file" type="file" accept=".csv,text/csv" required className={inputCls} />
          </label>
          <Submit variant="outline">Voorbeeld bekijken</Submit>
        </form>
        {preview?.ok && preview.preview?.notice && <p role="status" className="text-sm text-amber-700 dark:text-amber-400">{preview.preview.notice}</p>}
        {preview && !preview.ok && <p role="alert" className="text-sm text-destructive">{preview.error}</p>}
        {applied?.ok && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">{applied.message}</p>}

        {showPreview && p && (
          <div className="space-y-3">
            <p className="text-sm">
              <strong>{p.counts.create}</strong> nieuw · <strong>{p.counts.update}</strong> wijzigen · {p.counts.unchanged} ongewijzigd ·{" "}
              <strong className={p.counts.error ? "text-destructive" : ""}>{p.counts.error} met fout</strong>
              {p.counts.stockChanges > 0 && <> · voorraad verandert bij {p.counts.stockChanges}</>}
            </p>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted text-left"><tr><th className="p-2">Regel</th><th className="p-2">SKU</th><th className="p-2">Wat</th><th className="p-2">Details</th></tr></thead>
                <tbody>
                  {p.rows.map((r) => (
                    <tr key={`${r.line}-${r.sku}`} className={`border-t align-top ${r.action === "error" ? "bg-red-50 dark:bg-red-950/20" : r.action === "create" ? "bg-emerald-50 dark:bg-emerald-950/20" : ""}`}>
                      <td className="p-2 tabular-nums">{r.line}</td>
                      <td className="p-2 font-mono">{r.sku || "(leeg)"}</td>
                      <td className="p-2 font-medium">{ACTION_LABEL[r.action]}</td>
                      <td className="p-2 break-words">{(r.action === "error" ? r.errors : r.changes).join("; ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {p.truncated && <p className="text-xs text-muted-foreground">Alleen de eerste {p.rows.length} regels met een wijziging of fout worden getoond; bij toepassen gaan ze allemaal mee.</p>}
            {p.counts.error > 0 ? (
              <p className="text-sm text-destructive">Er is niets toegepast. Verbeter de regels met een fout in je bestand en bekijk het voorbeeld opnieuw.</p>
            ) : p.counts.create + p.counts.update === 0 ? (
              <p className="text-sm text-muted-foreground">Het bestand bevat geen wijzigingen.</p>
            ) : (
              <form action={applyAction} className="space-y-2">
                <input type="hidden" name="csv" value={p.csv} />
                <input type="hidden" name="token" value={p.token} />
                {p.counts.create > 0 && (
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="allowCreate" required /> Ja, maak de {p.counts.create} nieuwe onderdelen aan
                  </label>
                )}
                <Submit>Pas {p.counts.create + p.counts.update} wijzigingen toe</Submit>
              </form>
            )}
          </div>
        )}
      </div>
    </details>
  );
}
