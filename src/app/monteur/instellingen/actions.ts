"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, hasProAccess } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/env";
import { logger } from "@/lib/logger";

export type ProfileResult = { ok: boolean; error?: string; saved?: boolean };

const ProfileSchema = z.object({
  companyName: z.string().trim().min(2, "Bedrijfsnaam is verplicht").max(120),
  contactName: z.string().trim().max(100).optional().nullable(),
  kvkNumber: z.string().trim().regex(/^\d{8}$/, "KvK-nummer is 8 cijfers"),
  vatNumber: z.string().trim().regex(/^NL\d{9}B\d{2}$/i, "Btw-nummer ziet eruit als NL123456789B01").optional().nullable(),
  street: z.string().trim().min(2, "Adres is verplicht").max(120),
  postalCode: z.string().trim().regex(/^[1-9][0-9]{3}\s?[A-Za-z]{2}$/, "Postcode ziet eruit als 1234 AB"),
  city: z.string().trim().min(2, "Plaats is verplicht").max(80),
  iban: z.string().trim().regex(/^NL\d{2}[A-Z]{4}\d{10}$/i, "IBAN ziet eruit als NL00BANK0123456789").optional().nullable(),
  email: z.string().email("Ongeldig e-mailadres").optional().nullable(),
  phone: z.string().trim().max(30).optional().nullable(),
  vatRate: z.number().min(0).max(0.3),
  hourlyRateEur: z.number().min(0).max(500).optional().nullable(),
  paymentTerms: z.number().int().min(0).max(90),
  invoiceFooter: z.string().trim().max(300).optional().nullable(),
});

function str(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s : null;
}
function num(fd: FormData, key: string): number | null {
  const s = str(fd, key);
  if (s === null) return null;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export async function saveMonteurProfile(_prev: ProfileResult | null, fd: FormData): Promise<ProfileResult> {
  const user = await getCurrentUser().catch(() => null);
  if (!user) return { ok: false, error: "Niet ingelogd" };
  if (!hasProAccess(user)) return { ok: false, error: "Facturen zijn onderdeel van Monteur Pro" };
  if (!isDatabaseConfigured()) return { ok: false, error: "Zonder database kunnen gegevens niet worden opgeslagen" };

  const parsed = ProfileSchema.safeParse({
    companyName: str(fd, "companyName") ?? "",
    contactName: str(fd, "contactName"),
    kvkNumber: str(fd, "kvkNumber") ?? "",
    vatNumber: str(fd, "vatNumber"),
    street: str(fd, "street") ?? "",
    postalCode: str(fd, "postalCode") ?? "",
    city: str(fd, "city") ?? "",
    iban: str(fd, "iban"),
    email: str(fd, "email"),
    phone: str(fd, "phone"),
    vatRate: (num(fd, "vatRatePct") ?? 21) / 100,
    hourlyRateEur: num(fd, "hourlyRateEur"),
    paymentTerms: num(fd, "paymentTerms") ?? 14,
    invoiceFooter: str(fd, "invoiceFooter"),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Ongeldige gegevens" };

  const data = {
    ...parsed.data,
    postalCode: parsed.data.postalCode.toUpperCase().replace(/\s+/g, " "),
    vatNumber: parsed.data.vatNumber?.toUpperCase() ?? null,
    iban: parsed.data.iban?.toUpperCase() ?? null,
  };

  try {
    await prisma.monteurProfile.upsert({
      where: { userId: user.id },
      update: data,
      create: { userId: user.id, ...data },
    });
    revalidatePath("/monteur/instellingen");
    revalidatePath("/monteur/werkorders");
    return { ok: true, saved: true };
  } catch (err) {
    logger.error("[monteur-profile] save failed", err);
    return { ok: false, error: "Opslaan mislukt" };
  }
}
