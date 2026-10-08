/**
 * Cost control and health of the model behind the diagnosis.
 *
 *  1. A daily ceiling on model calls PER TIER (free visitors, paying consumers,
 *     API customers), kept in UsageCounter (scope "gemini-day", one row per
 *     Europe/Amsterdam day and tier) so it holds across serverless instances. No
 *     new table, no new variable. The tiers are separate on purpose: with one
 *     shared ceiling, one API key or a handful of free addresses could use up the
 *     day's budget and switch the AI off for everyone who pays.
 *  2. A circuit for failures that will not heal by themselves (a retired model, a
 *     rejected key, a Gemini quota that stays exhausted): the owner is told once a
 *     day and for the next minutes the routes answer from the labelled fallback
 *     instead of paying a doomed round trip per request. Transient failures
 *     (a single 429 or 503, a timeout) trip nothing. The circuit lives in the
 *     memory of one server instance, so on serverless each instance finds out for
 *     itself; the owner notice is deduplicated across instances through the
 *     database.
 *
 * The owner messages carry no customer data (decision D1): counts, the model
 * name and an admin link.
 */
import { consumeUsage, refundUsage } from "./entitlements";
import { PLAN_API_MONTHLY_CALLS } from "./api-auth";
import { DIAGNOSIS_MODEL, classifyGeminiError, isAiConfigured, type GeminiFailure } from "./gemini";
import { env } from "./env";
import { logger } from "./logger";
import { notifyOwner } from "./notify";

/** Share of a tier's daily cap at which the owner gets a heads-up (once per day and tier). */
export const DAILY_WARN_FRACTION = 0.8;
/** How long a rejected key or a retired model keeps the model switched off before it is tried again. */
export const CIRCUIT_OPEN_MS = 5 * 60_000;
/** A Gemini quota that stays exhausted switches the model off for a shorter time: it can come back by itself. */
export const QUOTA_CIRCUIT_OPEN_MS = 60_000;
/** This many quota (429) failures in a row, with no success in between, count as "stays exhausted". */
export const QUOTA_STREAK_TO_OPEN = 3;

// ─── Tiers and their budgets ────────────────────────────────────────────────

export type AiTier = "free" | "paid" | "api";

/** Model calls one B2B account may make per rolling day: a twentieth of its monthly allowance, at least 50. */
export const API_DAILY_DIVISOR = 20;
export const apiAccountDailyCalls = (monthlyCalls: number): number =>
  monthlyCalls <= 0 ? 0 : Math.max(50, Math.ceil(monthlyCalls / API_DAILY_DIVISOR));

/**
 * Daily ceilings per tier. Starting values, not a price calculation: nobody has
 * measured what a call costs in production yet, so these bound the day's spend
 * to a known NUMBER OF CALLS and the owner can change them here.
 *  - free: anonymous visitors and free accounts. Their abuse is bounded first.
 *  - paid: consumers on a paid plan.
 *  - api: room for four Bedrijf customers at their full per-account daily bound.
 */
export const GEMINI_TIER_DAILY_CAPS: Record<AiTier, number> = {
  free: 150,
  paid: 600,
  api: 4 * apiAccountDailyCalls(PLAN_API_MONTHLY_CALLS.BEDRIJF),
};

const DAY_SCOPE = "gemini-day";
const ALERT_SCOPE = "gemini-alert";
const TIER_LABEL: Record<AiTier, string> = { free: "gratis bezoekers", paid: "betalende klanten", api: "API-klanten" };

/** The Europe/Amsterdam calendar day, "YYYY-MM-DD": the day the owner thinks in. */
export function amsterdamDay(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

const dayKey = (day: string, tier: AiTier) => `${day}:${tier}`;

// ─── Daily cap ──────────────────────────────────────────────────────────────

export type CapReservation = { ok: true; day: string; tier: AiTier; used: number } | { ok: false; day: string; tier: AiTier };

/** Alert at most once per (day, kind) across instances: the first caller to claim the marker row sends it. */
async function claimAlert(kind: string, day: string): Promise<boolean> {
  const r = await consumeUsage(ALERT_SCOPE, `${day}:${kind}`, 1, { windowDays: 2 });
  return r.allowed;
}

/**
 * Take one call from today's budget of this tier, committed up front
 * (peek-then-commit would let parallel requests all pass the check). Pair with
 * releaseAiCall() when the provider rejected the call without doing the work.
 */
export async function reserveAiCall(tier: AiTier): Promise<CapReservation> {
  const day = amsterdamDay();
  const cap = GEMINI_TIER_DAILY_CAPS[tier];
  const r = await consumeUsage(DAY_SCOPE, dayKey(day, tier), cap, { windowDays: 2 });
  if (!r.allowed) {
    if (await claimAlert(`cap:${tier}`, day)) {
      logger.error("[ai-guard] daily Gemini call cap reached - answering from the fallback until tomorrow", { day, tier, cap });
      await notifyOwner({
        event: "ai.daily_cap_reached",
        title: `AI-diagnose staat uit voor ${TIER_LABEL[tier]}: dagelijks limiet bereikt`,
        lines: [
          `Limiet: ${cap} AI-aanroepen per dag voor ${TIER_LABEL[tier]} (GEMINI_TIER_DAILY_CAPS in src/lib/ai-guard.ts). De andere groepen hebben een eigen limiet en merken hier niets van.`,
          tier === "api"
            ? "API-klanten krijgen nu een 503 en worden niet belast. Morgen om 00:00 (Amsterdam) gaat het vanzelf weer aan."
            : "Deze bezoekers krijgen nu de snelle zoekhulp op foutcodes, zonder AI. Morgen om 00:00 (Amsterdam) gaat het vanzelf weer aan.",
          "Is dit ongewoon veel verkeer of misbruik? Kijk bij AI-kwaliteit.",
        ],
        url: "/admin/ai-quality",
        level: "warn",
      });
    }
    return { ok: false, day, tier };
  }
  const warnAt = Math.ceil(cap * DAILY_WARN_FRACTION);
  if (r.used >= warnAt && (await claimAlert(`warn:${tier}`, day))) {
    await notifyOwner({
      event: "ai.daily_cap_warning",
      title: `AI-aanroepen vandaag voor ${TIER_LABEL[tier]}: ${r.used} van ${cap}`,
      lines: ["Bij het limiet schakelt de AI-diagnose voor deze groep over op de snelle zoekhulp zonder AI."],
      url: "/admin/ai-quality",
      level: "info",
    });
  }
  return { ok: true, day, tier, used: r.used };
}

export async function releaseAiCall(day: string, tier: AiTier): Promise<void> {
  await refundUsage(DAY_SCOPE, dayKey(day, tier));
}

/** Read-only: is today's budget of this tier used up? (For the page that asks before the first message.) */
export async function tierCapReached(tier: AiTier): Promise<boolean> {
  const r = await consumeUsage(DAY_SCOPE, dayKey(amsterdamDay(), tier), GEMINI_TIER_DAILY_CAPS[tier], { commit: false, windowDays: 2 });
  return !r.allowed;
}

// ─── Circuit ────────────────────────────────────────────────────────────────

let openUntil = 0;
let openReason: GeminiFailure | null = null;
let quotaStreak = 0;

/** For tests only. */
export function _resetAiGuardForTests(): void {
  openUntil = 0;
  openReason = null;
  quotaStreak = 0;
}

export type AiAvailability = { available: true } | { available: false; reason: "not_configured" | "model_unavailable" };

/** Is there a model to call right now? Says nothing about the daily cap, which needs the database. */
export function aiAvailability(now: number = Date.now()): AiAvailability {
  if (!isAiConfigured()) return { available: false, reason: "not_configured" };
  if (now < openUntil) return { available: false, reason: "model_unavailable" };
  return { available: true };
}

/** Keep a key out of the logs: the SDK or a proxy may echo the URL or a header that carries it. */
export function redactSecrets(text: string): string {
  let out = text.replace(/AIza[0-9A-Za-z_-]{20,}/g, "[redacted-key]");
  const key = env.GEMINI_API_KEY;
  if (key && key.length >= 8) out = out.split(key).join("[redacted-key]");
  return out;
}

/** A model call succeeded: a run of 429s is over. */
export function reportModelSuccess(): void {
  quotaStreak = 0;
}

/**
 * Record a failed model call: log it at the right level, open the circuit for
 * failures that need a human, and tell the owner once a day. Returns the
 * classification so the caller can decide whether the daily budget unit is
 * given back.
 */
export async function reportModelFailure(err: unknown, where: "text" | "photo"): Promise<GeminiFailure> {
  const kind = classifyGeminiError(err);
  const message = redactSecrets(err instanceof Error ? err.message : String(err));
  if (kind !== "quota") quotaStreak = 0;

  if (kind === "model_not_found" || kind === "auth") {
    openUntil = Date.now() + CIRCUIT_OPEN_MS;
    openReason = kind;
    logger.error(
      kind === "model_not_found"
        ? `[ai-guard] Gemini model "${DIAGNOSIS_MODEL}" was not found or is retired - set GEMINI_MODEL to a current model. Answering from the fallback.`
        : "[ai-guard] Gemini rejected the API key - check GEMINI_API_KEY. Answering from the fallback.",
      { where, message: message.slice(0, 300) },
    );
    if (await claimAlert(kind, amsterdamDay())) {
      await notifyOwner({
        event: `ai.${kind}`,
        title: kind === "model_not_found" ? "AI-diagnose valt terug op zoekhulp: model niet gevonden" : "AI-diagnose valt terug op zoekhulp: API-sleutel geweigerd",
        lines:
          kind === "model_not_found"
            ? [
                `Het model "${DIAGNOSIS_MODEL}" bestaat niet meer of is niet beschikbaar.`,
                "Zet GEMINI_MODEL op een actueel Gemini-model en deploy opnieuw. Tot die tijd krijgen bezoekers de snelle zoekhulp op foutcodes, zonder AI.",
              ]
            : [
                "Google weigert de GEMINI_API_KEY (ongeldig, ingetrokken of zonder rechten).",
                "Controleer de sleutel en deploy opnieuw. Tot die tijd krijgen bezoekers de snelle zoekhulp op foutcodes, zonder AI.",
              ],
        url: "/admin/ai-quality",
        level: "error",
      });
    }
  } else if (kind === "quota") {
    quotaStreak++;
    logger.warn(`[ai-guard] Gemini quota (${where}), ${quotaStreak} in a row`, { message: message.slice(0, 200) });
    if (quotaStreak >= QUOTA_STREAK_TO_OPEN) {
      // One 429 is a busy moment. Several in a row, with no answer in between, is a key without
      // billing or a quota set to zero: every visitor would otherwise pay a round trip to Google for nothing.
      openUntil = Date.now() + QUOTA_CIRCUIT_OPEN_MS;
      openReason = kind;
      logger.error("[ai-guard] Gemini keeps answering 'quota exhausted' - check billing and limits of the GEMINI_API_KEY. Answering from the fallback.", {
        where,
        inARow: quotaStreak,
      });
      if (await claimAlert("quota", amsterdamDay())) {
        await notifyOwner({
          event: "ai.quota",
          title: "AI-diagnose valt terug op zoekhulp: Gemini-quotum bereikt",
          lines: [
            `Google meldt ${quotaStreak} keer achter elkaar dat het quotum van de GEMINI_API_KEY op is of dat de limiet op nul staat.`,
            "Controleer in je Google-account of facturering is ingesteld en of het quotum niet is bereikt. Tot die tijd krijgen bezoekers de snelle zoekhulp op foutcodes, zonder AI; elke minuut wordt het opnieuw geprobeerd.",
          ],
          url: "/admin/ai-quality",
          level: "error",
        });
      }
    }
  } else if (kind === "overloaded" || kind === "timeout") {
    logger.warn(`[ai-guard] Gemini ${kind} (${where})`, { message: message.slice(0, 200) });
  } else {
    logger.error(`[ai-guard] Gemini call failed (${where}, ${kind})`, { message: message.slice(0, 300) });
  }
  return kind;
}

/** Whether a failed call may have been billed anyway, so its budget unit stays spent. */
export function failureMayHaveCost(kind: GeminiFailure): boolean {
  return kind === "timeout" || kind === "other" || kind === "blocked";
}

export function circuitReason(): GeminiFailure | null {
  return Date.now() < openUntil ? openReason : null;
}
