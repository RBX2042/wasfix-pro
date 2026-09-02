import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, hasProAccess } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/env";
import { apiError, apiSuccess } from "@/lib/api-response";
import { DEFAULT_SCOPES, PLAN_API_RATE_LIMIT, generateApiKey, hashApiKey, keyPrefix } from "@/lib/api-auth";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const MAX_KEYS_PER_USER = 10;

const CreateSchema = z.object({
  name: z.string().trim().min(2).max(60),
  environment: z.enum(["live", "test"]).default("live"),
});

function serialize(k: { id: string; name: string; prefix: string; createdAt: Date; lastUsedAt: Date | null; usageCount: number; scopes: string; rateLimit: number }) {
  return {
    id: k.id,
    name: k.name,
    prefix: k.prefix,
    createdAt: k.createdAt.toISOString(),
    lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
    usageCount: k.usageCount,
    scopes: k.scopes.split(","),
    rateLimit: k.rateLimit,
  };
}

async function requireProUser() {
  const user = await getCurrentUser();
  if (!user) return { error: apiError("Niet ingelogd", 401) } as const;
  if (!hasProAccess(user)) return { error: apiError("API toegang vereist Monteur Pro of hoger", 403) } as const;
  return { user } as const;
}

// GET — list the caller's active keys
export async function GET() {
  const r = await requireProUser();
  if ("error" in r) return r.error;
  if (!isDatabaseConfigured()) return apiSuccess({ keys: [], demo: true });

  try {
    const keys = await prisma.apiKey.findMany({
      where: { userId: r.user.id, revokedAt: null },
      orderBy: { createdAt: "desc" },
    });
    return apiSuccess({ keys: keys.map(serialize) });
  } catch (err) {
    logger.error("[api-keys] list failed", err);
    return apiError("Keys konden niet worden geladen", 503);
  }
}

// POST — create a key; the full key is returned exactly once
export async function POST(req: NextRequest) {
  const r = await requireProUser();
  if ("error" in r) return r.error;

  const body = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body ?? {});
  if (!parsed.success) return apiError("Ongeldige naam (2-60 tekens)", 400, parsed.error.flatten());

  const fullKey = generateApiKey(parsed.data.environment);
  const prefix = keyPrefix(fullKey);

  if (!isDatabaseConfigured()) {
    // Demo: hand out a key that only works for the current process lifetime — nothing to persist.
    return apiSuccess({
      demo: true,
      fullKey,
      key: { id: `demo-${Date.now()}`, name: parsed.data.name, prefix, createdAt: new Date().toISOString(), lastUsedAt: null, usageCount: 0, scopes: DEFAULT_SCOPES, rateLimit: 1000 },
    });
  }

  try {
    const activeCount = await prisma.apiKey.count({ where: { userId: r.user.id, revokedAt: null } });
    if (activeCount >= MAX_KEYS_PER_USER) {
      return apiError(`Maximaal ${MAX_KEYS_PER_USER} actieve keys. Revoke er eerst één.`, 400);
    }
    const created = await prisma.apiKey.create({
      data: {
        userId: r.user.id,
        name: parsed.data.name,
        prefix,
        hash: hashApiKey(fullKey),
        scopes: DEFAULT_SCOPES.join(","),
        rateLimit: PLAN_API_RATE_LIMIT[r.user.plan] ?? 1000,
      },
    });
    return apiSuccess({ fullKey, key: serialize(created) }, 201);
  } catch (err) {
    logger.error("[api-keys] create failed", err);
    return apiError("Key kon niet worden aangemaakt", 500);
  }
}

// DELETE ?id=… — revoke (soft) so audit history stays intact
export async function DELETE(req: NextRequest) {
  const r = await requireProUser();
  if ("error" in r) return r.error;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return apiError("id is verplicht", 400);
  if (!isDatabaseConfigured() || id.startsWith("demo-")) return apiSuccess({ revoked: true, demo: true });

  try {
    const result = await prisma.apiKey.updateMany({
      where: { id, userId: r.user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count === 0) return apiError("Key niet gevonden", 404);
    return apiSuccess({ revoked: true });
  } catch (err) {
    logger.error("[api-keys] revoke failed", err);
    return apiError("Key kon niet worden gerevoceerd", 500);
  }
}
