"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/env";
import { markOrderPaidByBankTransfer } from "@/lib/invoicing";

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") throw new Error("Geen toegang");
  if (!isDatabaseConfigured()) throw new Error("Geen database geconfigureerd");
}

/** Confirms a bank-transfer order once the wire has actually arrived — there is no bank feed to detect this automatically. */
export async function confirmBankTransferPaid(formData: FormData) {
  await requireAdmin();
  const orderId = String(formData.get("orderId") ?? "");
  if (!orderId) return;
  await markOrderPaidByBankTransfer(orderId);
  revalidatePath("/admin/bestellingen");
  revalidatePath(`/bestelling/${orderId}`);
}
