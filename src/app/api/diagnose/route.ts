import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  getDiagnosisModel,
  parseDiagnosisFromResponse,
  demoModeReply,
} from "@/lib/gemini";
import { getCurrentUser, getPlanLimits } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { apiError, apiSuccess } from "@/lib/api-response";
import { rateLimit, getClientKey } from "@/lib/ratelimit";
import { staticErrorCodeByCode, staticParts, staticGuides } from "@/lib/static-db";

export const runtime = "nodejs";

const MessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(4000),
});

const DiagnoseSchema = z.object({
  messages: z.array(MessageSchema).min(1).max(40),
  sessionId: z.string().min(1).max(100).optional(),
  brand: z.string().max(50).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return apiError("Ongeldige JSON", 400);

    const parsed = DiagnoseSchema.safeParse(body);
    if (!parsed.success) {
      return apiError("Ongeldige invoer", 400, parsed.error.flatten());
    }
    const { messages } = parsed.data;
    const sessionId = parsed.data.sessionId ?? `anon-${Date.now()}`;

    // Auth + quota: skip silently if DB unreachable so demo mode still works
    let user: Awaited<ReturnType<typeof getCurrentUser>> = null;
    try {
      user = await getCurrentUser();
    } catch {
      // ignore — diagnose still works anonymously
    }

    // IP rate-limit (separate from monthly quota): 60/min/IP
    const ipKey = getClientKey(req, user?.id);
    if (!(await rateLimit(`diagnose:ip:${ipKey}`, 60, 60_000))) {
      return apiError("Te veel verzoeken. Probeer het over een minuut opnieuw.", 429);
    }

    // Monthly quota for non-paid users
    if (user) {
      try {
        const limits = getPlanLimits(user.plan);
        if (limits.diagnosesPerMonth !== -1) {
          const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
          if (dbUser) {
            const resetAt = new Date(dbUser.diagnosesResetAt);
            const now = new Date();
            const monthMs = 30 * 24 * 60 * 60 * 1000;
            if (now.getTime() - resetAt.getTime() > monthMs) {
              await prisma.user.update({
                where: { id: user.id },
                data: { diagnosesUsed: 0, diagnosesResetAt: now },
              });
            } else if (dbUser.diagnosesUsed >= limits.diagnosesPerMonth) {
              return apiError(
                "Je hebt je gratis diagnoses voor deze maand opgebruikt. Upgrade voor onbeperkte diagnoses.",
                429,
                { code: "limit_reached" }
              );
            }
          }
        }
      } catch {
        // DB unreachable — skip quota check
      }
    }

    // Try real Gemini, fall back to demo mode on error
    const geminiModel = getDiagnosisModel();
    let assistantText: string;
    let diagResult: ReturnType<typeof parseDiagnosisFromResponse>["result"] | null = null;

    if (geminiModel) {
      try {
        // Gemini chat: history must alternate user/model and exclude the new message we send.
        // Map "assistant" -> "model" (Gemini's terminology).
        const history = messages.slice(0, -1).map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        }));
        const lastMessage = messages[messages.length - 1];

        const chat = geminiModel.startChat({ history });
        const result = await chat.sendMessage(lastMessage.content);
        assistantText = result.response.text() ?? "";
        diagResult = parseDiagnosisFromResponse(assistantText).result;
      } catch (err: unknown) {
        // Gemini errors: status is in message or .status field
        const errMsg = err instanceof Error ? err.message : String(err);
        const status = (err as { status?: number })?.status;

        // Log the failure type but always fall back to demo so the user sees a useful answer
        if (status === 401 || status === 403 || /API key|unauthorized|forbidden/i.test(errMsg)) {
          logger.error("Gemini auth failure — falling back to demo", errMsg);
        } else if (status === 429 || /quota|rate limit|429/i.test(errMsg)) {
          logger.warn("Gemini quota exceeded — falling back to demo", errMsg);
        } else if (status === 503 || /unavailable|overloaded/i.test(errMsg)) {
          logger.warn("Gemini overloaded — falling back to demo", errMsg);
        } else {
          logger.error("Gemini error — falling back to demo", err);
        }
        const demo = demoModeReply(messages);
        assistantText = demo.text;
        diagResult = demo.result;
      }
    } else {
      const demo = demoModeReply(messages);
      assistantText = demo.text;
      diagResult = demo.result;
    }

    // Match recommended parts/guides
    let recommendedParts: Array<{ id: string; sku: string; name: string; brand: string; priceEur: number; imageUrl: string | null; stock: number }> = [];
    let recommendedGuides: Array<{ id: string; slug: string; title: string; difficulty: string; timeMinutes: number; summary: string }> = [];

    if (diagResult) {
      // Static-DB lookups: instant, no DB dependency
      const brand = diagResult.brand
        ? diagResult.brand.charAt(0).toUpperCase() + diagResult.brand.slice(1).toLowerCase()
        : undefined;
      const code = diagResult.errorCode;

      const matchedErrorCode = code ? staticErrorCodeByCode(code, brand) : null;

      if (matchedErrorCode) {
        recommendedParts = matchedErrorCode.parts.map((ep) => ep.part);
        recommendedGuides = matchedErrorCode.guides.map((eg) => eg.guide);
      }

      if (recommendedParts.length === 0) {
        const cause = diagResult.mainCause?.toLowerCase() ?? "";
        const categories: string[] = [];
        if (/(pomp|afvoer|filter)/.test(cause)) categories.push("PUMP", "FILTER", "HOSE");
        if (/(verwarm|element|ntc)/.test(cause)) categories.push("HEATING", "ELECTRONICS");
        if (/(motor|lager|koolborstel)/.test(cause)) categories.push("MOTOR", "BEARING");
        if (/(deur|slot|pakking)/.test(cause)) categories.push("DOOR");
        if (/(ventiel|inlaat|water)/.test(cause)) categories.push("VALVE", "HOSE");
        if (categories.length > 0) {
          recommendedParts = staticParts({
            where: { categories, minStock: 0 },
            orderBy: "price-asc",
            take: 4,
          });
        }
      }

      if (recommendedGuides.length === 0) {
        const cause = diagResult.mainCause?.toLowerCase() ?? "";
        const slugs: string[] = [];
        if (/(pomp|afvoer|filter)/.test(cause)) slugs.push("filter-reinigen", "afvoerpomp-reinigen-vervangen");
        if (/(verwarm|element)/.test(cause)) slugs.push("verwarmingselement-vervangen");
        if (/(lager|trommel)/.test(cause)) slugs.push("trommellager-vervangen");
        if (/(deur|pakking)/.test(cause)) slugs.push("deurpakking-vervangen");
        if (/(ventiel|inlaat)/.test(cause)) slugs.push("waterinlaatventiel-vervangen");
        if (slugs.length > 0) {
          recommendedGuides = staticGuides({ where: { slugs }, take: 3 });
        }
      }
    }

    // Save the diagnosis
    const newMessages = [...messages, { role: "assistant" as const, content: assistantText }];
    const lastBrand =
      diagResult?.brand ??
      messages.find((m) =>
        /^(miele|bosch|samsung|lg|aeg|whirlpool|electrolux|siemens|beko|indesit)/i.test(m.content)
      )?.content.split(/\s+/)[0] ??
      "Onbekend";

    if (diagResult) {
      try {
        await prisma.diagnosis.create({
          data: {
            sessionId,
            userId: user?.id ?? null,
            brand: lastBrand,
            model: diagResult.model ?? null,
            symptoms: messages[messages.length - 1]?.content ?? "",
            messages: JSON.stringify(newMessages),
            result: JSON.stringify(diagResult),
          },
        });

        if (user) {
          await prisma.user.update({
            where: { id: user.id },
            data: { diagnosesUsed: { increment: 1 } },
          });
        }
      } catch (dbErr) {
        // Don't fail the request — log and continue
        logger.warn("Failed to persist diagnosis", dbErr);
      }
    }

    return apiSuccess({
      message: assistantText,
      diagnosis: diagResult,
      recommendedParts,
      recommendedGuides,
      sessionId,
    });
  } catch (err) {
    logger.error("Diagnose error", err);
    return apiError("Er is een fout opgetreden bij de diagnose", 500);
  }
}
