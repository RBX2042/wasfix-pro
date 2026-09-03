import { NextRequest } from "next/server";
import {
  getGemini,
  DIAGNOSIS_MODEL,
  IMAGE_SYSTEM_PROMPT,
  demoModeImageReply,
  type ImageDiagnosis,
} from "@/lib/gemini";
import { staticErrorCodeByCode } from "@/lib/static-db";
import { logger } from "@/lib/logger";
import { apiError, apiSuccess } from "@/lib/api-response";
import { getCurrentUser } from "@/lib/auth";
import { rateLimit, getClientKey } from "@/lib/ratelimit";
import { anonymousKey, consumeUsage } from "@/lib/entitlements";
import { VISITOR_COOKIE } from "@/lib/visitor";
import { getPlan } from "@/lib/plans";

export const runtime = "nodejs";

/** Photo diagnosis costs the same Gemini call as the text one, so it is
 *  metered the same way. Previously this route had no auth, no rate limit and
 *  no quota at all: an anonymous caller could upload 10 MB repeatedly and bill
 *  us for every analysis, while the text route next door enforced 3/month. */
export async function POST(req: NextRequest) {
  try {
    let user: Awaited<ReturnType<typeof getCurrentUser>> = null;
    try {
      user = await getCurrentUser();
    } catch {
      // ignore — photo diagnose still works anonymously, within quota
    }

    const ipKey = getClientKey(req, user?.id);
    if (!(await rateLimit(`diagnose:image:${ipKey}`, 20, 60_000))) {
      return apiError("Te veel verzoeken. Probeer het over een minuut opnieuw.", 429);
    }

    // Reject oversized uploads before buffering them into memory.
    const declared = Number(req.headers.get("content-length") ?? 0);
    if (declared > 10 * 1024 * 1024) {
      return apiError("Afbeelding mag maximaal 10MB zijn", 413);
    }

    // Commit the quota up front rather than peeking and committing after the
    // model call — the gap between the two is the whole Gemini round-trip, and
    // parallel requests all pass a peek.
    const plan = getPlan(user?.plan ?? "FREE");
    if (plan.diagnosesPerMonth !== -1) {
      const visitorId = req.cookies.get(VISITOR_COOKIE)?.value ?? null;
      const quotaKey = user ? `user:${user.id}` : anonymousKey(req, visitorId);
      const quota = await consumeUsage("diagnose", quotaKey, plan.diagnosesPerMonth);
      if (!quota.allowed) {
        return apiError(
          user
            ? "Je hebt je gratis diagnoses voor deze maand opgebruikt. Upgrade voor onbeperkte diagnoses."
            : "Je gratis diagnoses zijn op. Maak een account aan of upgrade voor onbeperkte diagnoses.",
          429
        );
      }
    }

    const formData = await req.formData();
    const imageFile = formData.get("image");

    if (!imageFile || !(imageFile instanceof File)) {
      return apiError("Geen afbeelding ontvangen", 400);
    }
    if (!imageFile.type.startsWith("image/")) {
      return apiError("Alleen afbeeldingen zijn toegestaan", 400);
    }
    if (imageFile.size > 10 * 1024 * 1024) {
      return apiError("Afbeelding mag maximaal 10MB zijn", 400);
    }

    const gemini = getGemini();
    let parsed: ImageDiagnosis;

    if (gemini) {
      try {
        const bytes = await imageFile.arrayBuffer();
        const base64 = Buffer.from(bytes).toString("base64");
        const mimeType = imageFile.type;

        const model = gemini.getGenerativeModel({
          model: DIAGNOSIS_MODEL,
          systemInstruction: IMAGE_SYSTEM_PROMPT,
          generationConfig: {
            responseMimeType: "application/json",
          },
        });

        const response = await model.generateContent([
          { text: "Analyseer deze foto van mijn wasmachine en geef me de diagnose JSON." },
          { inlineData: { mimeType, data: base64 } },
        ]);

        const text = response.response.text() ?? "{}";
        // Strip optional markdown fences just in case the model returns them
        const cleanJson = text.replace(/```json\n?|\n?```/g, "").trim();
        parsed = JSON.parse(cleanJson) as ImageDiagnosis;
      } catch (err) {
        logger.warn("Gemini image analysis failed, falling back to demo", err);
        parsed = demoModeImageReply();
      }
    } else {
      parsed = demoModeImageReply();
    }

    // If error code detected, find matching data in database
    let matchedErrorCode = null;
    let recommendedParts: Array<{ id: string; sku: string; name: string; brand: string; priceEur: number; imageUrl: string | null; stock: number }> = [];
    let recommendedGuides: Array<{ id: string; slug: string; title: string; difficulty: string; timeMinutes: number; summary: string }> = [];

    if (parsed.detectedCode) {
      const ec = staticErrorCodeByCode(parsed.detectedCode, parsed.detectedBrand ?? undefined);
      if (ec) {
        matchedErrorCode = {
          id: ec.id,
          code: ec.code,
          title: ec.title,
          description: ec.description,
        };
        recommendedParts = ec.parts.map((ep) => ep.part);
        recommendedGuides = ec.guides.map((eg) => eg.guide);
      }
    }

    return apiSuccess({
      ...parsed,
      matchedErrorCode,
      recommendedParts,
      recommendedGuides,
    });
  } catch (err) {
    logger.error("Image diagnose error", err);
    return apiError("Foto analyse mislukt — probeer een duidelijkere foto", 500);
  }
}
