"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/env";
import { logger } from "@/lib/logger";
import { DIFFICULTIES, PART_CATEGORIES, SEVERITIES, type ActionResult } from "./catalog-constants";

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

// ─── Parts ────────────────────────────────────────────────────────
const PartSchema = z.object({
  sku: z.string().trim().regex(/^[A-Z0-9-]{3,32}$/i, "SKU: 3-32 tekens, letters/cijfers/streepje"),
  name: z.string().trim().min(3, "Naam is te kort").max(160),
  brand: z.string().trim().min(2, "Merk is verplicht").max(60),
  category: z.enum(PART_CATEGORIES),
  priceEur: z.number({ message: "Prijs is verplicht" }).min(0).max(10000),
  stock: z.number().int().min(0).max(100000),
});

export async function savePart(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const auth = await requireAdmin();
  if ("error" in auth) return { ok: false, error: auth.error };

  const parsed = PartSchema.safeParse({
    sku: str(fd, "sku") ?? "",
    name: str(fd, "name") ?? "",
    brand: str(fd, "brand") ?? "",
    category: str(fd, "category") ?? "OTHER",
    priceEur: num(fd, "priceEur"),
    stock: num(fd, "stock") ?? 0,
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Ongeldige gegevens" };

  const data = {
    ...parsed.data,
    sku: parsed.data.sku.toUpperCase(),
    description: str(fd, "description") ?? null,
    imageUrl: str(fd, "imageUrl") ?? null,
    supplier: str(fd, "supplier") ?? null,
    isOriginal: fd.get("isOriginal") === "on" || fd.get("isOriginal") === "true",
  };

  const id = str(fd, "id");
  try {
    if (id) {
      await prisma.part.update({ where: { id }, data });
    } else {
      await prisma.part.create({ data });
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
      return { ok: false, error: "Onderdeel staat op bestellingen — voorraad op 0 gezet in plaats van verwijderd." };
    }
    await prisma.part.delete({ where: { id } });
  } catch (err) {
    logger.error("[admin] part delete failed", err);
    return { ok: false, error: "Verwijderen mislukt" };
  }
  revalidatePath("/admin/onderdelen");
  revalidatePath("/onderdelen");
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
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Ongeldige gegevens" };

  const data = {
    ...parsed.data,
    code: parsed.data.code.toUpperCase(),
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
