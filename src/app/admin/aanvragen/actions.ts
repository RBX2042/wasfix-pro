"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/env";
import { logger } from "@/lib/logger";
import { accountForApplication, sendMonteurApprovedEmail } from "@/lib/monteur-approval";

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

/**
 * Vetting decision on a Monteur Pro application.
 *
 * Approving does NOT grant the plan (or a role): see src/lib/monteur-approval.ts.
 * It mails the applicant how to subscribe (no profile is created: the typed
 * address is unverified, see src/lib/monteur-approval.ts); the plan then comes
 * from Stripe like any other customer's. Setting the application back to REJECTED or PENDING
 * therefore has nothing to take away, and says so in no side effect either.
 * The mail goes out once, on the transition into APPROVED (a second click on
 * "APPROVED" is a no-op).
 */
export async function setApplicationStatus(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !["PENDING", "APPROVED", "REJECTED"].includes(status)) return;

  // Conditional on the status actually changing, so concurrent or repeated clicks
  // cannot send the approval mail twice.
  const moved = await prisma.monteurApplication
    .updateMany({ where: { id, status: { not: status } }, data: { status } })
    .catch((e) => {
      logger.warn("application status update failed", e);
      return null;
    });

  let notice = "";
  if (moved && moved.count > 0 && status === "APPROVED") {
    const app = await prisma.monteurApplication.findUnique({ where: { id } });
    if (app) {
      const hasAccount = (await accountForApplication(prisma, app).catch(() => null)) !== null;
      const mail = await sendMonteurApprovedEmail(app, hasAccount);
      notice = mail.ok ? "goedgekeurd-mail-verstuurd" : "goedgekeurd-mail-mislukt";
      logger.info("[monteur] application approved", { applicationId: app.applicationId, mailed: mail.ok });
    }
  }
  revalidatePath("/admin/aanvragen");
  revalidatePath("/admin/gebruikers");
  if (notice) redirect(`/admin/aanvragen?melding=${notice}`);
}
