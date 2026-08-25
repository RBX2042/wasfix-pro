import { prisma } from "./prisma";
import type { DemoUser } from "./auth";

const MONTEUR_PLANS = ["MONTEUR_PRO", "BEDRIJF", "API"];
const MONTEUR_ROLES = ["TECHNICIAN", "BUSINESS", "ADMIN"];

/** Whether this user is allowed to use the monteur/CRM/work-order tooling. */
export function hasMonteurAccess(user: Pick<DemoUser, "role" | "plan">): boolean {
  return MONTEUR_PLANS.includes(user.plan) || MONTEUR_ROLES.includes(user.role);
}

/**
 * Returns the Company this user belongs to, creating one (as OWNER) on
 * first access. There is no standalone company-signup flow yet — a
 * monteur's first visit to the dashboard lazily provisions their tenant.
 *
 * Callers MUST check hasMonteurAccess() first; this does not gate access,
 * it only resolves/creates the tenant record.
 */
export async function getOrCreateCompanyForUser(user: Pick<DemoUser, "id" | "name" | "email">) {
  const existing = await prisma.membership.findFirst({
    where: { userId: user.id },
    include: { company: true },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing.company;

  const companyName = user.name ? `${user.name}` : user.email.split("@")[0];
  const company = await prisma.company.create({
    data: {
      name: companyName,
      email: user.email,
      memberships: {
        create: { userId: user.id, role: "OWNER" },
      },
    },
  });
  return company;
}

/** Generates the next sequential work order number for a company, e.g. WO-2026-0001. */
export async function nextWorkOrderNumber(companyId: string): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.workOrder.count({
    where: { companyId, number: { startsWith: `WO-${year}-` } },
  });
  return `WO-${year}-${String(count + 1).padStart(4, "0")}`;
}

/** Generates the next sequential invoice number for a company, e.g. F-2026-0001. */
export async function nextInvoiceNumber(companyId: string): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.invoice.count({
    where: { companyId, number: { startsWith: `F-${year}-` } },
  });
  return `F-${year}-${String(count + 1).padStart(4, "0")}`;
}

// Standard NL VAT rate for repair labor/parts. Not configurable yet —
// tracked in WASFIX_ROADMAP.md P2 (admin-configurable pricing).
export const NL_VAT_RATE = 0.21;
