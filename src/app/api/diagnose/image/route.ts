import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getGemini,
  DIAGNOSIS_MODEL,
  IMAGE_SYSTEM_PROMPT,
  demoModeImageReply,
  type ImageDiagnosis,
} from "@/lib/gemini";
import { logger } from "@/lib/logger";
import { apiError, apiSuccess } from "@/lib/api-response";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
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
      const ec = await prisma.errorCode.findFirst({
        where: {
          code: { contains: parsed.detectedCode },
          ...(parsed.detectedBrand ? { machine: { brand: parsed.detectedBrand } } : {}),
        },
        include: {
          machine: true,
          parts: { include: { part: true } },
          guides: { include: { guide: true } },
        },
      });
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
