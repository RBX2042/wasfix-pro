import { revalidatePath } from "next/cache";
import { logger } from "@/lib/logger";

/**
 * revalidatePath that cannot undo a committed change. Inside a Next.js request it
 * behaves exactly like revalidatePath. Outside one (the scripts/qa-admin.ts suite,
 * scripts/orders.ts) Next throws "static generation store missing"; the database
 * write has already happened by then, so a failed cache hint is logged, not thrown.
 */
export function refreshPath(path: string, type?: "page" | "layout"): void {
  try {
    revalidatePath(path, type);
  } catch (err) {
    logger.warn("[admin] revalidatePath skipped", { path, reason: err instanceof Error ? err.message.slice(0, 80) : "unknown" });
  }
}
