/**
 * Make an e-mail address an ADMIN, before (or without) that person ever signing in.
 *
 *   npx tsx scripts/make-admin.ts you@example.com
 *
 * Why it exists: a production database has no users (the seed never creates
 * any), and /admin, the only place to mark a bank transfer paid or edit stock,
 * needs an ADMIN. Setting ADMIN_EMAILS on the host also works (the first
 * VERIFIED sign-in with a listed address is promoted); this is the direct route
 * for the owner who wants it settled before the first login.
 *
 * What it does:
 *   - connects with DIRECT_URL, falling back to DATABASE_URL (the pooled URL
 *     works too for these two statements), read from the environment or from
 *     .env.local / .env in the repository root;
 *   - finds the row for the address (case-insensitive) and sets role ADMIN, or
 *     creates a row with role ADMIN and no Clerk account. The first sign-in with
 *     that address CLAIMS the row, but only when Clerk reports the address as
 *     verified (src/lib/auth.ts), so a stranger who types the address without
 *     verifying it gets nothing.
 *   - prints what it did, never the connection string.
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

/** Rows for unverified addresses carry this suffix (src/lib/auth.ts); it is not an address anybody can sign in with. */
const PLACEHOLDER_SUFFIX = "@unverified.wasfix.invalid";

export type MakeAdminResult =
  | { outcome: "promoted" | "already_admin"; userId: string; linkedToClerk: boolean }
  | { outcome: "created"; userId: string; linkedToClerk: false };

export function normaliseAdminEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error(`"${raw}" is geen geldig e-mailadres`);
  if (email.endsWith(PLACEHOLDER_SUFFIX)) throw new Error("Dit is een intern placeholder-adres, geen echt e-mailadres");
  return email;
}

export async function makeAdmin(db: Pick<PrismaClient, "user">, rawEmail: string): Promise<MakeAdminResult> {
  const email = normaliseAdminEmail(rawEmail);
  const existing = await db.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
  if (existing) {
    if (existing.role === "ADMIN") return { outcome: "already_admin", userId: existing.id, linkedToClerk: !!existing.clerkId };
    await db.user.update({ where: { id: existing.id }, data: { role: "ADMIN" } });
    return { outcome: "promoted", userId: existing.id, linkedToClerk: !!existing.clerkId };
  }
  const created = await db.user.create({ data: { email, role: "ADMIN", plan: "FREE" } });
  return { outcome: "created", userId: created.id, linkedToClerk: false };
}

/** Minimal .env reader so the script works from a fresh checkout without extra tooling. */
function loadEnvFiles(): void {
  for (const name of [".env.local", ".env"]) {
    const file = path.join(process.cwd(), name);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m || process.env[m[1]] !== undefined) continue;
      process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
    }
  }
}

async function main() {
  const arg = process.argv[2];
  if (!arg || arg.startsWith("-")) {
    console.error("Gebruik: npx tsx scripts/make-admin.ts <e-mailadres>");
    process.exit(2);
  }
  loadEnvFiles();
  const url = process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("Geen DIRECT_URL of DATABASE_URL gevonden (omgeving, .env.local of .env).");
    process.exit(2);
  }
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    const result = await makeAdmin(db, arg);
    const email = normaliseAdminEmail(arg);
    const text = {
      promoted: `${email} is nu ADMIN.`,
      already_admin: `${email} was al ADMIN; niets gewijzigd.`,
      created: `${email} bestond nog niet: een ADMIN-rij is aangemaakt. De eerste inlog met dit adres, mits door Clerk bevestigd (verified), neemt die rij over.`,
    }[result.outcome];
    console.log(text);
    if (result.outcome !== "created" && !result.linkedToClerk) {
      console.log("Dit account heeft nog geen Clerk-koppeling; die komt bij de eerste inlog met dit (bevestigde) adres.");
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && /make-admin\.[cm]?[tj]s$/.test(process.argv[1])) {
  void main();
}
