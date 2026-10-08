"use server";

import { refreshPath as revalidatePath } from "./revalidate";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/env";
import { logger } from "@/lib/logger";
import { revalidateCatalog } from "@/lib/cache-tags";
import { parseMoney } from "@/lib/export-csv";
import { DIFFICULTIES, PART_CATEGORIES, SEVERITIES, type ActionResult } from "./catalog-constants";
import { adjustStock } from "./stock";

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") return { error: "Geen toegang" as const };
  if (!isDatabaseConfigured()) {
    return { error: "Catalogusbeheer vereist een database. Zonder DATABASE_URL is de catalogus read-only (src/data)." as const };
  }
  return { user };
}

function str(fd: FormData, key: string): string | undefined {
  const v = fd.get(key);
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s : undefined;
}

function num(fd: FormData, key: string): number | undefined {
  const s = str(fd, key);
  if (s === undefined) return undefined;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

/** An amount typed in Dutch or plain notation. undefined when empty; null when filled in but not a valid amount. */
function money(fd: FormData, key: string): number | null | undefined {
  const s = str(fd, key);
  if (s === undefined) return undefined;
  return parseMoney(s);
}

// ─── Parts ────────────────────────────────────────────────────────
const PartSchema = z.object({
  sku: z.string().trim().regex(/^[A-Z0-9-]{3,32}$/i, "SKU: 3-32 tekens, letters/cijfers/streepje"),
  name: z.string().trim().min(3, "Naam is te kort").max(160),
  brand: z.string().trim().min(2, "Merk is verplicht").max(60),
  category: z.enum(PART_CATEGORIES),
  priceEur: z.number({ message: "Prijs is verplicht" }).min(0).max(10000),
  // Purchase price ex btw. Optional, but without it the order carries no
  // margin and drops out of the profit reporting on /admin.
  costEur: z.number().min(0).max(10000).nullable().optional(),
  // ESTIMATE = guessed or derived; QUOTE = a real supplier quote or invoice. Only QUOTE counts
  // in the margin figures (decision D8).
  costSource: z.enum(["ESTIMATE", "QUOTE"]),
});

export async function savePart(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const auth = await requireAdmin();
  if ("error" in auth) return { ok: false, error: auth.error };

  const id = str(fd, "id");
  const price = money(fd, "priceEur");
  const cost = money(fd, "costEur");
  if (price === null) return { ok: false, error: "De verkoopprijs is geen geldig bedrag. Gebruik bijvoorbeeld 28,50." };
  // A typo must not silently clear the cost price: filled in but unreadable is an error.
  if (cost === null) return { ok: false, error: "De inkoopprijs is geen geldig bedrag. Gebruik bijvoorbeeld 12,00, of laat hem leeg." };
  const parsed = PartSchema.safeParse({
    sku: str(fd, "sku") ?? "",
    name: str(fd, "name") ?? "",
    brand: str(fd, "brand") ?? "",
    category: str(fd, "category") ?? "OTHER",
    priceEur: price,
    costEur: cost ?? null,
    costSource: str(fd, "costSource") ?? "ESTIMATE",
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Ongeldige gegevens" };
  if (parsed.data.costSource === "QUOTE" && parsed.data.costEur == null) {
    return { ok: false, error: "Een offerte-inkoopprijs heeft een bedrag nodig. Vul de inkoopprijs in of kies Schatting." };
  }

  const data = {
    ...parsed.data,
    // Without a cost there is nothing to have a source for.
    costSource: parsed.data.costEur == null ? "ESTIMATE" : parsed.data.costSource,
    sku: parsed.data.sku.toUpperCase(),
    description: str(fd, "description") ?? null,
    imageUrl: str(fd, "imageUrl") ?? null,
    supplier: str(fd, "supplier") ?? null,
    isOriginal: fd.get("isOriginal") === "on" || fd.get("isOriginal") === "true",
  };

  try {
    if (id) {
      // Stock is NOT part of an edit. The form shows the number it was rendered with; saving
      // that back would erase every order placed since (see stock.ts). Stock changes only
      // through adjustStockAction.
      await prisma.part.update({ where: { id }, data });
    } else {
      // A new part has no concurrent orders: the opening stock may be set here.
      const opening = num(fd, "stock") ?? 0;
      if (!Number.isInteger(opening) || opening < 0 || opening > 100000) return { ok: false, error: "Beginvoorraad moet een heel getal van 0 of hoger zijn." };
      await prisma.part.create({ data: { ...data, stock: opening } });
    }
  } catch (err) {
    const message = String(err);
    if (message.includes("Unique constraint")) return { ok: false, error: `SKU ${data.sku} bestaat al` };
    logger.error("[admin] part save failed", err);
    return { ok: false, error: "Opslaan mislukt" };
  }

  revalidatePath("/admin/onderdelen");
  revalidatePath("/onderdelen");
  revalidatePath(`/onderdelen/${data.sku}`);
  revalidateCatalog();
  return { ok: true };
}

/** Goods received / count correction: a signed whole number applied to the stock in the database. */
export async function adjustStockAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const auth = await requireAdmin();
  if ("error" in auth) return { ok: false, error: auth.error };
  const partId = str(fd, "id");
  if (!partId) return { ok: false, error: "id ontbreekt" };
  const rawDelta = str(fd, "delta");
  const delta = rawDelta === undefined ? NaN : Number(rawDelta);
  if (!Number.isInteger(delta)) return { ok: false, error: "Vul een heel aantal in, bijvoorbeeld 12 of -3." };
  const reason = str(fd, "reason") === "ONTVANGEN" ? "ONTVANGEN" : "CORRECTIE";
  const res = await adjustStock({ partId, delta, reason, note: str(fd, "note"), actor: auth.user.email });
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath("/admin/onderdelen");
  revalidatePath(`/onderdelen/${res.sku}`);
  revalidateCatalog();
  return { ok: true };
}

export async function deletePart(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const auth = await requireAdmin();
  if ("error" in auth) return { ok: false, error: auth.error };
  const id = str(fd, "id");
  if (!id) return { ok: false, error: "id ontbreekt" };

  try {
    // A part that is already on an order must stay: history would break.
    const ordered = await prisma.orderItem.count({ where: { partId: id } });
    if (ordered > 0) {
      await prisma.part.update({ where: { id }, data: { stock: 0 } });
      revalidatePath("/admin/onderdelen");
      revalidateCatalog();
      return { ok: false, error: "Onderdeel staat op bestellingen — voorraad op 0 gezet in plaats van verwijderd." };
    }
    await prisma.part.delete({ where: { id } });
  } catch (err) {
    logger.error("[admin] part delete failed", err);
    return { ok: false, error: "Verwijderen mislukt" };
  }
  revalidatePath("/admin/onderdelen");
  revalidatePath("/onderdelen");
  revalidateCatalog();
  return { ok: true };
}

// ─── Guides ───────────────────────────────────────────────────────
const GuideSchema = z.object({
  title: z.string().trim().min(4, "Titel is te kort").max(160),
  slug: z.string().trim().regex(/^[a-z0-9-]{3,80}$/, "Slug: kleine letters, cijfers en streepjes"),
  summary: z.string().trim().min(10, "Samenvatting is te kort").max(500),
  difficulty: z.enum(DIFFICULTIES),
  timeMinutes: z.number().int().min(1).max(600),
});

export async function saveGuide(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const auth = await requireAdmin();
  if ("error" in auth) return { ok: false, error: auth.error };

  const parsed = GuideSchema.safeParse({
    title: str(fd, "title") ?? "",
    slug: str(fd, "slug") ?? "",
    summary: str(fd, "summary") ?? "",
    difficulty: str(fd, "difficulty") ?? "MEDIUM",
    timeMinutes: num(fd, "timeMinutes") ?? 30,
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Ongeldige gegevens" };

  // Steps and tools are stored as JSON strings, matching the reader in /gidsen.
  const stepsRaw = str(fd, "steps");
  if (stepsRaw) {
    try {
      const parsedSteps = JSON.parse(stepsRaw);
      if (!Array.isArray(parsedSteps)) return { ok: false, error: "Stappen moeten een JSON-array zijn" };
    } catch {
      return { ok: false, error: "Stappen zijn geen geldige JSON" };
    }
  }

  const data = {
    ...parsed.data,
    steps: stepsRaw ?? "[]",
    tools: str(fd, "tools") ?? "",
    warnings: str(fd, "warnings") ?? null,
    isPremium: fd.get("isPremium") === "on" || fd.get("isPremium") === "true",
  };

  const id = str(fd, "id");
  try {
    if (id) {
      await prisma.repairGuide.update({ where: { id }, data });
    } else {
      await prisma.repairGuide.create({ data });
    }
  } catch (err) {
    const message = String(err);
    if (message.includes("Unique constraint")) return { ok: false, error: `Slug ${data.slug} bestaat al` };
    logger.error("[admin] guide save failed", err);
    return { ok: false, error: "Opslaan mislukt" };
  }

  revalidatePath("/admin/gidsen");
  revalidatePath("/gidsen");
  revalidatePath(`/gidsen/${data.slug}`);
  return { ok: true };
}

export async function deleteGuide(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const auth = await requireAdmin();
  if ("error" in auth) return { ok: false, error: auth.error };
  const id = str(fd, "id");
  if (!id) return { ok: false, error: "id ontbreekt" };
  try {
    await prisma.repairGuide.delete({ where: { id } });
  } catch (err) {
    logger.error("[admin] guide delete failed", err);
    return { ok: false, error: "Verwijderen mislukt" };
  }
  revalidatePath("/admin/gidsen");
  revalidatePath("/gidsen");
  return { ok: true };
}

// ─── Error codes ──────────────────────────────────────────────────
const ErrorCodeSchema = z.object({
  code: z.string().trim().min(1, "Code is verplicht").max(20),
  machineId: z.string().trim().min(1, "Kies een machine"),
  title: z.string().trim().min(3, "Titel is te kort").max(160),
  description: z.string().trim().min(10, "Omschrijving is te kort").max(2000),
  likelyCauses: z.string().trim().min(3, "Geef minstens één oorzaak").max(1000),
  severity: z.enum(SEVERITIES),
  // Provenance is editable so a verification pass can be recorded here rather
  // than in a code change. A code can only be marked VERIFIED with a source
  // URL attached — the whole point is that the claim is checkable.
  provenance: z.enum(["VERIFIED", "REPORTED"]),
  sourceUrl: z.string().trim().url("Bron-URL is geen geldige URL").max(500).optional().or(z.literal("")),
  sourceName: z.string().trim().max(160).optional().or(z.literal("")),
}).refine((v) => v.provenance !== "VERIFIED" || !!v.sourceUrl, {
  message: "Een geverifieerde code heeft een bron-URL nodig",
  path: ["sourceUrl"],
});

export async function saveErrorCode(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const auth = await requireAdmin();
  if ("error" in auth) return { ok: false, error: auth.error };

  const parsed = ErrorCodeSchema.safeParse({
    code: str(fd, "code") ?? "",
    machineId: str(fd, "machineId") ?? "",
    title: str(fd, "title") ?? "",
    description: str(fd, "description") ?? "",
    likelyCauses: str(fd, "likelyCauses") ?? "",
    severity: str(fd, "severity") ?? "MEDIUM",
    provenance: str(fd, "provenance") ?? "REPORTED",
    sourceUrl: str(fd, "sourceUrl") ?? "",
    sourceName: str(fd, "sourceName") ?? "",
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Ongeldige gegevens" };

  const data = {
    ...parsed.data,
    code: parsed.data.code.toUpperCase(),
    sourceUrl: parsed.data.sourceUrl || null,
    sourceName: parsed.data.sourceName || null,
    diyFriendly: fd.get("diyFriendly") === "on" || fd.get("diyFriendly") === "true",
  };

  const id = str(fd, "id");
  try {
    if (id) {
      await prisma.errorCode.update({ where: { id }, data });
    } else {
      await prisma.errorCode.create({ data });
    }
  } catch (err) {
    const message = String(err);
    if (message.includes("Unique constraint")) return { ok: false, error: `${data.code} bestaat al voor deze machine` };
    if (message.includes("Foreign key")) return { ok: false, error: "Onbekende machine" };
    logger.error("[admin] error code save failed", err);
    return { ok: false, error: "Opslaan mislukt" };
  }

  revalidatePath("/admin/foutcodes");
  revalidatePath("/foutcodes");
  return { ok: true };
}

export async function deleteErrorCode(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const auth = await requireAdmin();
  if ("error" in auth) return { ok: false, error: auth.error };
  const id = str(fd, "id");
  if (!id) return { ok: false, error: "id ontbreekt" };
  try {
    await prisma.errorCode.delete({ where: { id } });
  } catch (err) {
    logger.error("[admin] error code delete failed", err);
    return { ok: false, error: "Verwijderen mislukt" };
  }
  revalidatePath("/admin/foutcodes");
  revalidatePath("/foutcodes");
  return { ok: true };
}
