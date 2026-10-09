/**
 * Catalogue CSV: export, and import with a dry-run preview.
 *
 * COLUMNS  sku;name;brand;category;price;cost;costSource;stock;supplier
 *   price        selling price incl. btw, euro ("28,50" or "28.50")
 *   cost         purchase price excl. btw
 *   costSource   ESTIMATE or QUOTE (schatting / offerte). A changed cost needs it.
 *   stock        the COUNTED stock; see below
 *   brand, category: needed for a part that does not exist yet (category defaults to OTHER)
 *
 * There is no "active" column because Part has no such field (the schema is not
 * this module's to change). A file that has one is refused with that explanation
 * instead of the column being ignored in silence.
 *
 * RULES
 *   - The file is the only source of change: a part that is not in the file is never
 *     touched, created, zeroed or deleted. A new SKU is only created when the caller
 *     confirms (allowCreate) after seeing it listed as NEW in the preview.
 *   - An empty cell means "leave as it is". It never clears a value.
 *   - Every error is reported per row with its line number. If any row has an error,
 *     NOTHING is applied (all or nothing, one transaction).
 *   - Preview and apply compute the same plan. The plan has a token (SHA-256 over the
 *     planned changes and the database values they were computed against). Apply
 *     recomputes the plan under row locks and refuses when the token differs, i.e.
 *     when an order, a price edit or another import changed any of those parts since the
 *     preview. So what is applied is exactly what was shown.
 *   - stock in the file overwrites the stock, deliberately: it is the result of a count.
 *     The token check is what makes that safe against orders placed in between.
 */
import { decimalNl } from "@/lib/emails/money";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { csvCell, parseCsv, parseIntStrict, parseMoney, toCsv } from "@/lib/export-csv";
import { PART_CATEGORIES } from "./catalog-constants";

export const PART_CSV_COLUMNS = ["sku", "name", "brand", "category", "price", "cost", "costSource", "stock", "supplier"] as const;
export const MAX_IMPORT_ROWS = 2000;
// Half of the 1 MB Next.js allows for a server-action body: the apply step posts the whole file again as a form field.
export const MAX_IMPORT_BYTES = 500_000;

type Db = Prisma.TransactionClient | typeof prisma;

export async function exportPartsCsv(): Promise<string> {
  const parts = await prisma.part.findMany({ orderBy: { sku: "asc" } });
  return toCsv(
    [...PART_CSV_COLUMNS],
    parts.map((p) => [p.sku, p.name, p.brand, p.category, p.priceEur, p.costEur ?? "", p.costEur == null ? "" : p.costSource, p.stock, p.supplier ?? ""]),
  );
}

type PartData = {
  name: string;
  brand: string;
  category: string;
  priceEur: number;
  costEur: number | null;
  costSource: string;
  stock: number;
  supplier: string | null;
};

export type PlanRow = {
  line: number;
  sku: string;
  action: "create" | "update" | "unchanged" | "error";
  /** Human readable "field: before -> after". */
  changes: string[];
  errors: string[];
  /** Fields to write; only for create/update. */
  data?: Partial<PartData> & { sku?: string };
  stockDelta?: number;
};

export type ImportPlan = {
  fatal?: string;
  rows: PlanRow[];
  counts: { create: number; update: number; unchanged: number; error: number; stockChanges: number };
  token: string;
};

const emptyPlan = (fatal: string): ImportPlan => ({ fatal, rows: [], counts: { create: 0, update: 0, unchanged: 0, error: 0, stockChanges: 0 }, token: "" });

function normaliseSource(raw: string): "ESTIMATE" | "QUOTE" | null {
  const v = raw.trim().toLowerCase();
  if (["estimate", "schatting"].includes(v)) return "ESTIMATE";
  if (["quote", "offerte"].includes(v)) return "QUOTE";
  return null;
}

const same = (a: number | null, b: number | null) => (a === null || b === null ? a === b : Math.round(a * 100) === Math.round(b * 100));
/** Dutch notation in the preview: money always with two decimals and a comma ("7,20", never "7,2" or "7.2"), counts as integers. */
const show = (v: unknown, money = false) =>
  v === null || v === undefined || v === "" ? "leeg" : typeof v === "number" ? (money ? decimalNl(v) : Number.isInteger(v) ? String(v) : decimalNl(v)) : String(v);
/** The fields whose value is an amount in euro. */
const MONEY_FIELDS = new Set<string>(["priceEur", "costEur"]);

/**
 * Bytes of an uploaded file to text. The export is UTF-8 with a BOM, but Dutch Excel saves a plain
 * "CSV" as Windows-1252: read as UTF-8 that turns "Müller" into "M\uFFFDller", and it used to be applied
 * as an ordinary name change. Valid UTF-8 is read as UTF-8; anything else is read as Windows-1252
 * (what Excel wrote) and the caller is told, so the preview can say so.
 */
export function decodeCsvBytes(bytes: Uint8Array): { text: string; encoding: "utf-8" | "windows-1252" } {
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(bytes), encoding: "windows-1252" };
  }
}

export async function planPartsImport(csvText: string, db: Db = prisma): Promise<ImportPlan> {
  if (Buffer.byteLength(csvText, "utf8") > MAX_IMPORT_BYTES) return emptyPlan("Het bestand is groter dan 500 KB.");
  const parsed = parseCsv(csvText);
  if (parsed.header.length === 0) return emptyPlan("Het bestand is leeg.");

  const header = parsed.header.map((h) => h.replace(/^﻿/, ""));
  const index = new Map<string, number>();
  const unknown: string[] = [];
  const dupes: string[] = [];
  header.forEach((h, i) => {
    const canonical = PART_CSV_COLUMNS.find((c) => c.toLowerCase() === h.toLowerCase());
    if (!canonical) unknown.push(h || "(lege kop)");
    else if (index.has(canonical)) dupes.push(canonical);
    else index.set(canonical, i);
  });
  if (unknown.length > 0) {
    const activeHint = unknown.some((u) => u.toLowerCase() === "active") ? " Een kolom 'active' bestaat nog niet: onderdelen hebben geen actief/inactief-veld in de database." : "";
    return emptyPlan(`Onbekende kolom(men): ${unknown.join(", ")}. Toegestaan: ${PART_CSV_COLUMNS.join(", ")}.${activeHint}`);
  }
  if (dupes.length > 0) return emptyPlan(`Kolom(men) dubbel in de kopregel: ${dupes.join(", ")}.`);
  if (!index.has("sku")) return emptyPlan("De kolom 'sku' ontbreekt in de kopregel.");
  if (parsed.rows.length === 0) return emptyPlan("Het bestand bevat alleen een kopregel.");
  if (parsed.rows.length > MAX_IMPORT_ROWS) return emptyPlan(`Maximaal ${MAX_IMPORT_ROWS} regels per bestand (dit bestand heeft er ${parsed.rows.length}).`);

  const cell = (row: string[], col: (typeof PART_CSV_COLUMNS)[number]) => {
    const i = index.get(col);
    return i === undefined ? "" : (row[i] ?? "").trim();
  };

  const skus = [...new Set(parsed.rows.map((r) => cell(r, "sku").toUpperCase()).filter(Boolean))];
  const existing = await db.part.findMany({ where: { sku: { in: skus } } });
  const bySku = new Map(existing.map((p) => [p.sku, p]));
  const seen = new Set<string>();

  const rows: PlanRow[] = parsed.rows.map((raw, idx) => {
    const line = idx + 2; // header is line 1
    const skuRaw = cell(raw, "sku");
    const sku = skuRaw.toUpperCase();
    const errors: string[] = [];
    const row: PlanRow = { line, sku, action: "unchanged", changes: [], errors };
    // U+FFFD is what a decoder writes for a byte it could not read: the text is already damaged, so refuse the row.
    if (raw.some((c) => c.includes("\uFFFD"))) errors.push("de regel bevat een beschadigd teken (�): sla het bestand in Excel op als 'CSV UTF-8' en probeer opnieuw");

    if (!/^[A-Z0-9-]{3,32}$/.test(sku)) errors.push("sku: 3 tot 32 tekens, letters, cijfers of streepje");
    else if (seen.has(sku)) errors.push(`sku ${sku} staat al eerder in dit bestand`);
    seen.add(sku);

    const current = bySku.get(sku);
    const data: PlanRow["data"] = {};
    const set = <K extends keyof PartData>(key: K, value: PartData[K], before: PartData[K] | undefined, label: string) => {
      data[key] = value;
      if (!current || before !== value) row.changes.push(`${label}: ${current ? show(before, MONEY_FIELDS.has(key)) : "nieuw"} → ${show(value, MONEY_FIELDS.has(key))}`);
    };

    const name = cell(raw, "name");
    if (name) {
      if (name.length < 3 || name.length > 160) errors.push("name: 3 tot 160 tekens");
      else if (!current || name !== current.name) set("name", name, current?.name, "naam");
    } else if (!current) errors.push("name: verplicht voor een nieuw onderdeel");

    const brand = cell(raw, "brand");
    if (brand) {
      if (brand.length < 2 || brand.length > 60) errors.push("brand: 2 tot 60 tekens");
      else if (!current || brand !== current.brand) set("brand", brand, current?.brand, "merk");
    } else if (!current) errors.push("brand: verplicht voor een nieuw onderdeel");

    const category = cell(raw, "category").toUpperCase();
    if (category) {
      // A category the part already has is accepted as is (the seed uses some that the editor does not offer),
      // so an export can always be imported again; a NEW value must be one the editor knows.
      if (current && category === current.category) {
        /* unchanged */
      } else if (!(PART_CATEGORIES as readonly string[]).includes(category)) errors.push(`category: ${category} is onbekend`);
      else set("category", category, current?.category, "categorie");
    } else if (!current) data.category = "OTHER";

    const priceRaw = cell(raw, "price");
    if (priceRaw) {
      const price = parseMoney(priceRaw);
      if (price === null || price < 0 || price > 10000) errors.push(`price: "${priceRaw}" is geen bedrag tussen 0 en 10000 (gebruik 28,50)`);
      else if (!current || !same(price, current.priceEur)) set("priceEur", price, current?.priceEur, "prijs");
    } else if (!current) errors.push("price: verplicht voor een nieuw onderdeel");

    const costRaw = cell(raw, "cost");
    let costChanged = false;
    let nextCost: number | null = current?.costEur ?? null;
    if (costRaw) {
      const cost = parseMoney(costRaw);
      if (cost === null || cost < 0 || cost > 10000) errors.push(`cost: "${costRaw}" is geen bedrag tussen 0 en 10000`);
      else {
        nextCost = cost;
        if (!current || !same(cost, current.costEur)) {
          costChanged = true;
          set("costEur", cost, current?.costEur ?? null, "inkoop");
        }
      }
    }

    const sourceRaw = cell(raw, "costSource");
    let nextSource: string = current?.costSource ?? "ESTIMATE";
    if (sourceRaw) {
      const src = normaliseSource(sourceRaw);
      if (!src) errors.push(`costSource: "${sourceRaw}" moet ESTIMATE of QUOTE zijn`);
      else {
        nextSource = src;
        if (!current || src !== current.costSource) set("costSource", src, current?.costSource, "herkomst inkoop");
      }
    } else if (costChanged) {
      errors.push("costSource: verplicht als de inkoopprijs verandert (ESTIMATE of QUOTE)");
    }
    if (nextSource === "QUOTE" && nextCost === null) errors.push("costSource QUOTE heeft een inkoopprijs nodig");

    const stockRaw = cell(raw, "stock");
    if (stockRaw) {
      const stock = parseIntStrict(stockRaw);
      if (stock === null || stock < 0 || stock > 100000) errors.push(`stock: "${stockRaw}" moet een heel getal van 0 tot 100000 zijn`);
      else if (!current) {
        set("stock", stock, undefined, "voorraad");
      } else if (stock !== current.stock) {
        set("stock", stock, current.stock, "voorraad");
        row.stockDelta = stock - current.stock;
      }
    } else if (!current) data.stock = 0;

    const supplier = cell(raw, "supplier");
    if (supplier) {
      if (supplier.length > 100) errors.push("supplier: maximaal 100 tekens");
      else if (!current || supplier !== current.supplier) set("supplier", supplier, current?.supplier ?? null, "leverancier");
    }

    if (errors.length > 0) row.action = "error";
    else if (!current) {
      row.action = "create";
      row.data = { ...data, sku };
    } else if (row.changes.length > 0) {
      row.action = "update";
      row.data = data;
    }
    return row;
  });

  const counts = {
    create: rows.filter((r) => r.action === "create").length,
    update: rows.filter((r) => r.action === "update").length,
    unchanged: rows.filter((r) => r.action === "unchanged").length,
    error: rows.filter((r) => r.action === "error").length,
    stockChanges: rows.filter((r) => r.stockDelta !== undefined && r.action !== "error").length,
  };
  // What the plan was computed AGAINST is part of the token: if an order changed a stock
  // level after the preview, the same file is a different plan.
  const basis = rows
    .filter((r) => r.action === "create" || r.action === "update")
    .map((r) => {
      const p = bySku.get(r.sku);
      return [r.sku, r.action, r.data, p ? [p.name, p.brand, p.category, p.priceEur, p.costEur, p.costSource, p.stock, p.supplier] : null];
    });
  const token = createHash("sha256").update(JSON.stringify(basis)).digest("hex");
  return { rows, counts, token };
}

export type ApplyResult = { ok: true; created: number; updated: number; stockChanged: number } | { ok: false; error: string };

export async function applyPartsImport(csvText: string, opts: { token: string; allowCreate: boolean; actor: string }): Promise<ApplyResult> {
  // Cheap refusals first, outside the transaction.
  const first = await planPartsImport(csvText);
  if (first.fatal) return { ok: false, error: first.fatal };
  if (first.counts.error > 0) return { ok: false, error: `${first.counts.error} regel(s) bevatten fouten. Er is niets opgeslagen; verbeter het bestand en bekijk het voorbeeld opnieuw.` };
  if (first.counts.create > 0 && !opts.allowCreate) return { ok: false, error: `${first.counts.create} nieuwe onderdelen staan in het bestand. Vink aan dat ze aangemaakt mogen worden, of haal ze uit het bestand.` };
  if (first.counts.create + first.counts.update === 0) return { ok: true, created: 0, updated: 0, stockChanged: 0 };

  try {
    return await prisma.$transaction(
      async (tx) => {
        const skus = first.rows.filter((r) => r.action === "update" || r.action === "create").map((r) => r.sku);
        // Lock the rows we are about to change, then plan again on what is really there.
        await tx.$queryRaw`SELECT "id" FROM "Part" WHERE "sku" = ANY(${skus}) FOR UPDATE`;
        const plan = await planPartsImport(csvText, tx);
        if (plan.token !== opts.token || plan.token !== first.token) {
          return { ok: false as const, error: "De gegevens zijn gewijzigd sinds het voorbeeld (een bestelling, een prijswijziging of een andere import). Er is niets opgeslagen: bekijk het voorbeeld opnieuw." };
        }
        let created = 0;
        let updated = 0;
        let stockChanged = 0;
        for (const r of plan.rows) {
          if (r.action === "create" && r.data) {
            await tx.part.create({ data: r.data as Prisma.PartCreateInput & { sku: string } });
            created++;
            logger.info("[catalog-import] part created", { sku: r.sku, by: opts.actor });
          } else if (r.action === "update" && r.data) {
            await tx.part.update({ where: { sku: r.sku }, data: r.data as Prisma.PartUpdateInput });
            updated++;
          }
          if (r.stockDelta !== undefined && r.action !== "error") {
            stockChanged++;
            logger.info("[stock] set by import", { sku: r.sku, delta: r.stockDelta, by: opts.actor });
          }
        }
        return { ok: true as const, created, updated, stockChanged };
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
  } catch (err) {
    logger.error("[catalog-import] apply failed", err);
    return { ok: false, error: "Importeren is mislukt en er is niets opgeslagen. Probeer het opnieuw." };
  }
}

// Re-exported so a test can build a file with the same writer the export uses.
export { csvCell };
