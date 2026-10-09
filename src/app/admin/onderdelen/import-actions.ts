"use server";

import { refreshPath as revalidatePath } from "../_lib/revalidate";
import { logger } from "@/lib/logger";
import { revalidateCatalog } from "@/lib/cache-tags";
import { adminGuard } from "../_lib/guard";
import { MAX_IMPORT_BYTES, applyPartsImport, decodeCsvBytes, planPartsImport, type PlanRow } from "../_lib/catalog-csv";

export type ImportState = {
  ok: boolean;
  error?: string;
  message?: string;
  preview?: {
    csv: string;
    token: string;
    counts: { create: number; update: number; unchanged: number; error: number; stockChanges: number };
    rows: PlanRow[];
    truncated: boolean;
    /** Set when the file was not UTF-8 and had to be read as Windows-1252 (Excel's plain "CSV"). */
    notice?: string;
  };
};

const PREVIEW_ROWS = 300;

/** Step 1: read the file and show what WOULD change. Writes nothing. */
export async function previewImportAction(_prev: ImportState | null, fd: FormData): Promise<ImportState> {
  const g = await adminGuard();
  if (!g.ok) return { ok: false, error: g.error };
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Kies eerst een CSV-bestand." };
  if (file.size > MAX_IMPORT_BYTES) return { ok: false, error: "Het bestand is groter dan 500 KB." };
  const { text: csv, encoding } = decodeCsvBytes(new Uint8Array(await file.arrayBuffer()));
  try {
    const plan = await planPartsImport(csv);
    if (plan.fatal) return { ok: false, error: plan.fatal };
    // Show the rows that need attention first, and cap what goes to the browser.
    const interesting = plan.rows.filter((r) => r.action !== "unchanged");
    const order = { error: 0, create: 1, update: 2, unchanged: 3 } as const;
    interesting.sort((a, b) => order[a.action] - order[b.action] || a.line - b.line);
    return { ok: true, preview: { csv, token: plan.token, counts: plan.counts, rows: interesting.slice(0, PREVIEW_ROWS), truncated: interesting.length > PREVIEW_ROWS, notice: encoding === "windows-1252" ? "Dit bestand is niet als UTF-8 opgeslagen; het is gelezen als Windows-1252 (zoals Excel een gewone CSV bewaart). Controleer namen met accenten in het voorbeeld. Beter: opslaan als 'CSV UTF-8'." : undefined } };
  } catch (err) {
    logger.error("[catalog-import] preview failed", err);
    return { ok: false, error: "Het bestand kon niet worden gelezen." };
  }
}

/** Step 2: apply exactly the previewed plan, all or nothing. */
export async function applyImportAction(_prev: ImportState | null, fd: FormData): Promise<ImportState> {
  const g = await adminGuard();
  if (!g.ok) return { ok: false, error: g.error };
  const csv = String(fd.get("csv") ?? "");
  const token = String(fd.get("token") ?? "");
  if (!csv || !token) return { ok: false, error: "Het voorbeeld is verlopen. Kies het bestand opnieuw." };
  const res = await applyPartsImport(csv, { token, allowCreate: fd.get("allowCreate") === "on", actor: g.email });
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath("/admin/onderdelen");
  revalidatePath("/onderdelen");
  revalidateCatalog();
  return {
    ok: true,
    message: `Klaar: ${res.created} nieuw, ${res.updated} bijgewerkt${res.stockChanged ? `, voorraad van ${res.stockChanged} onderdelen gezet` : ""}. Onderdelen die niet in het bestand stonden zijn niet aangeraakt.`,
  };
}
