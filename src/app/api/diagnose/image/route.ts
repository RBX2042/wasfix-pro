import { NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import { apiError, apiSuccess } from "@/lib/api-response";
import { getCurrentUser, getPlanLimits } from "@/lib/auth";
import { rateLimit, getClientKey } from "@/lib/ratelimit";
import { anonymousKey } from "@/lib/entitlements";
import { runPhotoDiagnosis, isValidSessionId, sniffImageType, MAX_IMAGE_BYTES, type Caller } from "@/lib/diagnose-core";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Photo diagnosis. Metered with the same per-conversation unit as the text chat
 * (a photo and the text around it are one diagnosis), capped at a few photos per
 * conversation. Without a model there is NO result: the previous version answered
 * with a canned "Bosch E18, 78%" for any bytes at all, including random ones.
 */
export async function POST(req: NextRequest) {
  try {
    let user: Awaited<ReturnType<typeof getCurrentUser>> = null;
    try {
      user = await getCurrentUser();
    } catch {
      // anonymous
    }

    const ipKey = getClientKey(req, user?.id);
    if (!(await rateLimit(`diagnose:image:${ipKey}`, 20, 60_000))) {
      return apiError("Te veel verzoeken. Probeer het over een minuut opnieuw.", 429);
    }

    // Reject oversized uploads before buffering them into memory.
    const declared = Number(req.headers.get("content-length") ?? 0);
    if (declared > MAX_IMAGE_BYTES + 64 * 1024) {
      return apiError("De foto is te groot (maximaal 4 MB). Maak de foto kleiner en probeer het opnieuw.", 413);
    }

    const formData = await req.formData().catch(() => null);
    const imageFile = formData?.get("image");
    if (!formData || !imageFile || typeof imageFile === "string") return apiError("Geen foto ontvangen", 400);
    if (imageFile.size > MAX_IMAGE_BYTES) {
      return apiError("De foto is te groot (maximaal 4 MB). Maak de foto kleiner en probeer het opnieuw.", 413);
    }
    const bytes = new Uint8Array(await imageFile.arrayBuffer());
    const mimeType = sniffImageType(bytes);
    if (!mimeType) return apiError("Alleen JPEG-, PNG- of WebP-foto's zijn toegestaan", 415);

    const sessionRaw = formData.get("sessionId");
    const sessionId = typeof sessionRaw === "string" && sessionRaw ? sessionRaw : undefined;
    if (sessionId && !isValidSessionId(sessionId)) return apiError("Ongeldige sessie", 400);

    const caller: Extract<Caller, { kind: "consumer" }> = {
      kind: "consumer",
      userId: user?.id ?? null,
      quotaKey: user ? `user:${user.id}` : anonymousKey(req),
      monthlyLimit: getPlanLimits(user ?? "FREE").diagnosesPerMonth,
    };

    const outcome = await runPhotoDiagnosis({ base64: Buffer.from(bytes).toString("base64"), mimeType, sessionId, caller });
    if (!outcome.ok) return apiError(outcome.error, outcome.status, { code: outcome.code, ...outcome.details });

    return apiSuccess({
      mode: outcome.mode,
      model: outcome.model,
      sessionId: outcome.sessionId,
      recognised: outcome.analysis.recognised,
      detectedCode: outcome.analysis.detectedCode,
      detectedBrand: outcome.analysis.detectedBrand,
      detectedSymptom: outcome.analysis.detectedSymptom,
      description: outcome.analysis.description,
      suggestedQuery: outcome.analysis.suggestedQuery,
      matchedErrorCode: outcome.matchedErrorCode,
      recommendedParts: outcome.recommendedParts,
      recommendedGuides: outcome.recommendedGuides,
      notice: outcome.notice,
      quota: outcome.quota,
    });
  } catch (err) {
    logger.error("Image diagnose error", err);
    return apiError("De foto kon niet worden beoordeeld. Probeer het opnieuw of typ de foutcode.", 500);
  }
}
