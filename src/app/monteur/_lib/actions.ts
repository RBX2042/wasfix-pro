"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, hasProAccess } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/env";
import { logger } from "@/lib/logger";
import { WORK_ORDER_STATUSES, type ActionResult } from "./constants";

async function requireMonteur() {
  const user = await getCurrentUser();
  if (!user) return { error: "Inloggen vereist" as const };
  if (!hasProAccess(user)) return { error: "Monteur Pro vereist" as const };
  if (!isDatabaseConfigured()) return { error: "Geen database geconfigureerd — klanten en werkorders kunnen niet worden opgeslagen." as const };
  return { user };
}

const CustomerSchema = z.object({
  name: z.string().trim().min(2, "Naam is te kort").max(120),
  email: z.string().trim().email("Ongeldig e-mailadres").optional().or(z.literal("")),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  street: z.string().trim().max(120).optional().or(z.literal("")),
  postalCode: z.string().trim().max(12).optional().or(z.literal("")),
  city: z.string().trim().max(80).optional().or(z.literal("")),
  machine: z.string().trim().max(120).optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

function blankToNull(value: FormDataEntryValue | null): string | undefined {
  const s = typeof value === "string" ? value.trim() : "";
  return s.length > 0 ? s : undefined;
}

export async function saveCustomer(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await requireMonteur();
  if ("error" in auth) return { ok: false, error: auth.error };

  const parsed = CustomerSchema.safeParse({
    name: formData.get("name") ?? "",
    email: formData.get("email") ?? "",
    phone: formData.get("phone") ?? "",
    street: formData.get("street") ?? "",
    postalCode: formData.get("postalCode") ?? "",
    city: formData.get("city") ?? "",
    machine: formData.get("machine") ?? "",
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Ongeldige gegevens" };
  }

  const data = {
    name: parsed.data.name,
    email: blankToNull(formData.get("email")) ?? null,
    phone: blankToNull(formData.get("phone")) ?? null,
    street: blankToNull(formData.get("street")) ?? null,
    postalCode: blankToNull(formData.get("postalCode")) ?? null,
    city: blankToNull(formData.get("city")) ?? null,
    machine: blankToNull(formData.get("machine")) ?? null,
    notes: blankToNull(formData.get("notes")) ?? null,
  };

  const id = blankToNull(formData.get("id"));
  try {
    if (id) {
      // updateMany scopes by ownerId so one monteur can never edit another's customer.
      const res = await prisma.customer.updateMany({ where: { id, ownerId: auth.user.id }, data });
      if (res.count === 0) return { ok: false, error: "Klant niet gevonden" };
    } else {
      await prisma.customer.create({ data: { ...data, ownerId: auth.user.id } });
    }
  } catch (err) {
    logger.error("[monteur] customer save failed", err);
    return { ok: false, error: "Opslaan mislukt" };
  }

  revalidatePath("/monteur/klanten");
  revalidatePath("/monteur/dashboard");
  return { ok: true };
}

export async function deleteCustomer(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await requireMonteur();
  if ("error" in auth) return { ok: false, error: auth.error };

  const id = blankToNull(formData.get("id"));
  if (!id) return { ok: false, error: "id ontbreekt" };
  try {
    const res = await prisma.customer.deleteMany({ where: { id, ownerId: auth.user.id } });
    if (res.count === 0) return { ok: false, error: "Klant niet gevonden" };
  } catch (err) {
    logger.error("[monteur] customer delete failed", err);
    return { ok: false, error: "Verwijderen mislukt" };
  }
  revalidatePath("/monteur/klanten");
  revalidatePath("/monteur/werkorders");
  revalidatePath("/monteur/dashboard");
  return { ok: true };
}

const WorkOrderSchema = z.object({
  problem: z.string().trim().min(3, "Omschrijf het probleem").max(500),
  status: z.enum(WORK_ORDER_STATUSES),
  priceEur: z.number().min(0).max(100000).optional(),
});

/** Sequential per-monteur reference: WO-001, WO-002, … */
async function nextReference(ownerId: string): Promise<string> {
  const last = await prisma.workOrder.findFirst({
    where: { ownerId },
    orderBy: { createdAt: "desc" },
    select: { reference: true },
  });
  const lastNum = Number.parseInt(last?.reference?.replace(/\D/g, "") ?? "0", 10);
  const next = Number.isFinite(lastNum) ? lastNum + 1 : 1;
  return `WO-${String(next).padStart(3, "0")}`;
}

export async function saveWorkOrder(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await requireMonteur();
  if ("error" in auth) return { ok: false, error: auth.error };

  const rawPrice = blankToNull(formData.get("priceEur"));
  const parsed = WorkOrderSchema.safeParse({
    problem: formData.get("problem") ?? "",
    status: formData.get("status") ?? "OPEN",
    priceEur: rawPrice ? Number(rawPrice.replace(",", ".")) : undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Ongeldige gegevens" };
  }

  const scheduledRaw = blankToNull(formData.get("scheduledAt"));
  const scheduledAt = scheduledRaw ? new Date(scheduledRaw) : null;
  if (scheduledAt && Number.isNaN(scheduledAt.getTime())) {
    return { ok: false, error: "Ongeldige datum" };
  }

  const customerId = blankToNull(formData.get("customerId")) ?? null;
  if (customerId) {
    const owned = await prisma.customer.count({ where: { id: customerId, ownerId: auth.user.id } });
    if (owned === 0) return { ok: false, error: "Klant niet gevonden" };
  }

  const data = {
    customerId,
    machine: blankToNull(formData.get("machine")) ?? null,
    errorCode: blankToNull(formData.get("errorCode"))?.toUpperCase() ?? null,
    problem: parsed.data.problem,
    status: parsed.data.status,
    urgent: formData.get("urgent") === "on" || formData.get("urgent") === "true",
    scheduledAt,
    priceEur: parsed.data.priceEur ?? null,
    notes: blankToNull(formData.get("notes")) ?? null,
  };

  const id = blankToNull(formData.get("id"));
  try {
    if (id) {
      const res = await prisma.workOrder.updateMany({ where: { id, ownerId: auth.user.id }, data });
      if (res.count === 0) return { ok: false, error: "Werkorder niet gevonden" };
    } else {
      await prisma.workOrder.create({
        data: { ...data, ownerId: auth.user.id, reference: await nextReference(auth.user.id) },
      });
    }
  } catch (err) {
    logger.error("[monteur] work order save failed", err);
    return { ok: false, error: "Opslaan mislukt" };
  }

  revalidatePath("/monteur/werkorders");
  revalidatePath("/monteur/dashboard");
  return { ok: true };
}

/** Status change straight from the list, without opening the form. */
export async function setWorkOrderStatus(formData: FormData): Promise<void> {
  const auth = await requireMonteur();
  if ("error" in auth) return;

  const id = blankToNull(formData.get("id"));
  const status = String(formData.get("status") ?? "");
  if (!id || !(WORK_ORDER_STATUSES as readonly string[]).includes(status)) return;

  await prisma.workOrder
    .updateMany({ where: { id, ownerId: auth.user.id }, data: { status } })
    .catch((err) => logger.warn("[monteur] status update failed", err));

  revalidatePath("/monteur/werkorders");
  revalidatePath("/monteur/dashboard");
}

export async function deleteWorkOrder(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await requireMonteur();
  if ("error" in auth) return { ok: false, error: auth.error };

  const id = blankToNull(formData.get("id"));
  if (!id) return { ok: false, error: "id ontbreekt" };
  try {
    const res = await prisma.workOrder.deleteMany({ where: { id, ownerId: auth.user.id } });
    if (res.count === 0) return { ok: false, error: "Werkorder niet gevonden" };
  } catch (err) {
    logger.error("[monteur] work order delete failed", err);
    return { ok: false, error: "Verwijderen mislukt" };
  }
  revalidatePath("/monteur/werkorders");
  revalidatePath("/monteur/dashboard");
  return { ok: true };
}
