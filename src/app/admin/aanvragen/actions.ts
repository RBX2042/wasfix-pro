"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/env";
import { logger } from "@/lib/logger";

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") throw new Error("Geen toegang");
  if (!isDatabaseConfigured()) throw new Error("Geen database geconfigureerd");
  return user;
}

export async function setReviewStatus(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !["APPROVED", "REJECTED", "PENDING"].includes(status)) return;
  await prisma.review.update({ where: { id }, data: { status } }).catch((e) => logger.warn("review status update failed", e));
  revalidatePath("/admin/aanvragen");
}

export async function setRmaStatus(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !["RECEIVED", "APPROVED", "REJECTED", "REFUNDED"].includes(status)) return;
  await prisma.rmaRequest.update({ where: { id }, data: { status } }).catch((e) => logger.warn("rma status update failed", e));
  revalidatePath("/admin/aanvragen");
}

export async function setApplicationStatus(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !["PENDING", "APPROVED", "REJECTED"].includes(status)) return;
  const app = await prisma.monteurApplication.update({ where: { id }, data: { status } }).catch((e) => {
    logger.warn("application status update failed", e);
    return null;
  });
  // Approving a monteur upgrades the matching user account (if it exists) to MONTEUR_PRO.
  if (app && status === "APPROVED") {
    await prisma.user
      .updateMany({ where: { email: app.email }, data: { role: "TECHNICIAN", plan: "MONTEUR_PRO" } })
      .catch((e) => logger.warn("monteur upgrade failed", e));
  }
  revalidatePath("/admin/aanvragen");
  revalidatePath("/admin/gebruikers");
}
