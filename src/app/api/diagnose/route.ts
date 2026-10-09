import { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser, getPlanLimits } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { apiError, apiSuccess } from "@/lib/api-response";
import { rateLimit, getClientKey } from "@/lib/ratelimit";
import { anonymousKey } from "@/lib/entitlements";
import { runDiagnosis, peekQuota, isValidSessionId, aiServiceState, MAX_USER_TURNS, type Caller } from "@/lib/diagnose-core";
import { FALLBACK_LABEL } from "@/lib/gemini";

export const runtime = "nodejs";
// The model call has its own 25 s deadline; the rest of the minute is for the fallback answer and the database.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const MessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(4000),
});

const DiagnoseSchema = z.object({
  messages: z.array(MessageSchema).min(1).max(40),
  sessionId: z.string().max(100).optional(),
  brand: z.string().max(50).optional(),
});

/** Who is asking, and what their plan includes. */
async function consumerCaller(req: NextRequest): Promise<Extract<Caller, { kind: "consumer" }>> {
  // Resolving the user needs the database and the identity provider; if either is down the visitor
  // still gets an answer, just as an anonymous one.
  let user: Awaited<ReturnType<typeof getCurrentUser>> = null;
  try {
    user = await getCurrentUser();
  } catch {
    // anonymous
  }
  return {
    kind: "consumer",
    userId: user?.id ?? null,
    // The visitor cookie is deliberately not read: it is unsigned, so a caller could mint a new bucket per request.
    quotaKey: user ? `user:${user.id}` : anonymousKey(req),
    monthlyLimit: getPlanLimits(user ?? "FREE").diagnosesPerMonth,
  };
}

/**
 * What the chat page needs before the first message: is a model going to answer
 * (so the header may say "AI"), and how many free diagnoses are left.
 */
export async function GET(req: NextRequest) {
  const caller = await consumerCaller(req);
  const quota = await peekQuota(caller);
  // Includes the daily budget of this caller's tier, so the header does not promise an AI that the first message cannot get.
  const ai = await aiServiceState(caller);
  return apiSuccess(
    {
      aiAvailable: ai.available,
      fallbackLabel: ai.available ? null : FALLBACK_LABEL,
      quota,
      signedIn: Boolean(caller.userId),
      maxUserTurns: MAX_USER_TURNS,
    },
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return apiError("Ongeldige JSON", 400);

    const parsed = DiagnoseSchema.safeParse(body);
    if (!parsed.success) {
      return apiError("Ongeldige invoer", 400, parsed.error.flatten());
    }
    const { messages } = parsed.data;
    if (messages[messages.length - 1].role !== "user") return apiError("Het laatste bericht moet van de gebruiker zijn", 400);
    if (parsed.data.sessionId && !isValidSessionId(parsed.data.sessionId)) return apiError("Ongeldige sessie", 400);

    const caller = await consumerCaller(req);

    // Request-rate bound, separate from the allowance: 60/min per account or IP.
    const ipKey = getClientKey(req, caller.userId ?? undefined);
    if (!(await rateLimit(`diagnose:ip:${ipKey}`, 60, 60_000))) {
      return apiError("Te veel verzoeken. Probeer het over een minuut opnieuw.", 429);
    }

    const outcome = await runDiagnosis({ messages, sessionId: parsed.data.sessionId, caller });
    if (!outcome.ok) return apiError(outcome.error, outcome.status, { code: outcome.code, ...outcome.details });

    return apiSuccess({
      message: outcome.message,
      diagnosis: outcome.diagnosis,
      recommendedParts: outcome.recommendedParts,
      recommendedGuides: outcome.recommendedGuides,
      sessionId: outcome.sessionId,
      mode: outcome.mode,
      model: outcome.model,
      label: outcome.label,
      fallbackReason: outcome.fallbackReason,
      notice: outcome.notice,
      quota: outcome.quota,
    });
  } catch (err) {
    logger.error("Diagnose error", err);
    return apiError("Er is een fout opgetreden bij de diagnose", 500);
  }
}
