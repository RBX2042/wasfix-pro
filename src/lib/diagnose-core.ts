/**
 * The diagnosis itself, as a function. /api/diagnose (the website) and
 * /api/v1/diagnose (the paid B2B API) both call runDiagnosis() in-process.
 *
 * The B2B route used to call the website route over HTTP with a shared secret
 * and an "already metered" header. That made every B2B call two function
 * invocations, depended on NEXT_PUBLIC_APP_URL and INTERNAL_API_KEY being right,
 * and - when the secret was missing - dropped every API customer into the
 * anonymous visitor's 3-per-month bucket. Here there is no header to trust and no
 * shared bucket: the caller states who it is (`Caller`) and the quota that
 * applies follows from that.
 *
 * WHAT IS COUNTED (consumer callers)
 *   One "diagnose" unit per CONVERSATION, not per message. The unit is taken up
 *   front, before the model is paid, with the FIRST message of a conversation
 *   (also when that message is only "Hallo" and the model asks a question): the
 *   monthly allowance counts conversations that reached the model, not finished
 *   results. Later messages of the same conversation (same sessionId) take no
 *   further unit. A conversation that is already known is recognised by a marker
 *   row (scope "diagnose-conv") that is only written AFTER a unit was secured, so
 *   an exhausted visitor cannot ride on a fresh sessionId. Every unit is refunded
 *   when the model fails, because the visitor got no answer for it. A fallback
 *   answer never takes a unit: it is not an AI call.
 *
 * WHAT IS BOUNDED, whatever the plan (all enforced here, on the server; nothing
 * is read from what the client claims about its own conversation)
 *   - model calls per identity per rolling day (FREE_DAILY_CALLS, PAID_DAILY_CALLS;
 *     for a B2B account apiAccountDailyCalls(monthly allowance));
 *   - model calls per conversation (MAX_USER_TURNS, counted per sessionId in
 *     scope "diagnose-turns"), and photos per conversation;
 *   - the daily budget of the caller's tier (ai-guard.ts).
 * The plans sell "onbeperkt" diagnoses; the daily bound for paid plans is a
 * fair-use limit and its refusal message says so.
 */
import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { isDatabaseConfigured } from "./env";
import { logger } from "./logger";
import { consumeUsage, refundUsage } from "./entitlements";
import {
  FALLBACK_LABEL,
  GEMINI_IMAGE_TIMEOUT_MS,
  GEMINI_TEXT_TIMEOUT_MS,
  IMAGE_SYSTEM_PROMPT,
  INDICATION_NOTICE,
  FALLBACK_BRANDS,
  buildSystemPrompt,
  getAiBackend,
  parseDiagnosisFromResponse,
  parseFallbackQuery,
  parseImageDiagnosis,
  type DiagnosisResult,
  type ImageDiagnosis,
} from "./gemini";
import {
  aiAvailability,
  apiAccountDailyCalls,
  failureMayHaveCost,
  releaseAiCall,
  reportModelFailure,
  reportModelSuccess,
  reserveAiCall,
  tierCapReached,
  type AiTier,
} from "./ai-guard";
import * as staticData from "./static-db";

const { categoriesForCauses, partFitsBrand, toPublicPart } = staticData;
type PublicPart = staticData.PublicPart;

export const MAX_USER_TURNS = 12;
export const MAX_PHOTOS_PER_CONVERSATION = 3;
/**
 * Model calls one identity (account, or IP for visitors) may start per rolling
 * day. A free visitor gets 3 conversations a month of at most MAX_USER_TURNS
 * messages, so 25 a day is generous for a person and small for a script.
 */
export const FREE_DAILY_CALLS = 25;
/** Paid plans are sold as unlimited; this is the fair-use bound, about 25 full conversations a day. */
export const PAID_DAILY_CALLS = 300;

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type Caller =
  | {
      kind: "consumer";
      userId: string | null;
      /** user:<id> for an account, ip:<hash> for a visitor. */
      quotaKey: string;
      /** Conversations per month the plan includes; -1 = unlimited. */
      monthlyLimit: number;
    }
  | {
      kind: "api";
      /** The account whose allowance the call spends (acct:<id>). Without it no per-account daily bound can be applied. */
      quotaKey?: string;
      /** That account's monthly allowance, from its current plan. */
      monthlyCalls?: number;
    };

/** Which daily budget a caller draws from (see ai-guard.ts). */
export function tierOf(caller: Caller): AiTier {
  if (caller.kind === "api") return "api";
  return caller.monthlyLimit === -1 ? "paid" : "free";
}

/** Will a model answer this caller right now? Used by the page before the first message. */
export async function aiServiceState(caller: Caller): Promise<{ available: boolean; reason: "not_configured" | "model_unavailable" | "daily_cap" | null }> {
  const a = aiAvailability();
  if (!a.available) return { available: false, reason: a.reason };
  if (await tierCapReached(tierOf(caller))) return { available: false, reason: "daily_cap" };
  return { available: true, reason: null };
}
export type Quota = { limit: number; used: number; remaining: number };

export type RecommendedGuide = { id: string; slug: string; title: string; difficulty: string; timeMinutes: number; summary: string };

export type Failure = { ok: false; status: number; code: string; error: string; details?: Record<string, unknown> };

export type DiagnoseSuccess = {
  ok: true;
  /** "ai": a model answered. "fallback": a lookup in our error-code table, labelled as such. */
  mode: "ai" | "fallback";
  /** The model that really ran; null for a fallback answer. */
  model: string | null;
  /** Set on a fallback answer: the label to show with it. */
  label: string | null;
  /** Why the fallback answered ("not_configured" | "model_unavailable" | "daily_cap" | "error"), for the UI and logs. */
  fallbackReason: string | null;
  message: string;
  diagnosis: DiagnosisResult | null;
  recommendedParts: PublicPart[];
  recommendedGuides: RecommendedGuide[];
  sessionId: string;
  /** Always present: a diagnosis is an indication, not a guarantee. */
  notice: string;
  /** Consumer callers only. */
  quota: Quota | null;
  /**
   * False when the call produced nothing a customer should pay for. The B2B route
   * gives the call back then: a one-shot request that ended without a diagnosis.
   */
  billable: boolean;
};

export type DiagnoseOutcome = DiagnoseSuccess | Failure;

const DAY = { windowDays: 1 };

const fail = (status: number, code: string, error: string, details?: Record<string, unknown>): Failure => ({ ok: false, status, code, error, details });

// ─── Quota plumbing ─────────────────────────────────────────────────────────

class Undo {
  private fns: Array<() => Promise<void>> = [];
  add(fn: () => Promise<void>) {
    this.fns.push(fn);
  }
  /** Give everything back, newest first. Never throws. */
  async run() {
    const todo = this.fns.reverse();
    this.fns = [];
    for (const fn of todo) {
      try {
        await fn();
      } catch (err) {
        logger.warn("[diagnose] could not undo a reservation", err);
      }
    }
  }
}

const convKey = (c: Extract<Caller, { kind: "consumer" }>, sessionId: string) => `${c.quotaKey}|${sessionId}`;

export async function peekQuota(caller: Extract<Caller, { kind: "consumer" }>): Promise<Quota> {
  if (caller.monthlyLimit === -1) return { limit: -1, used: 0, remaining: -1 };
  const r = await consumeUsage("diagnose", caller.quotaKey, caller.monthlyLimit, { commit: false });
  return { limit: caller.monthlyLimit, used: r.used, remaining: Math.max(0, caller.monthlyLimit - r.used) };
}

/** Has a unit already been paid for this conversation? (peek on a limit-1 counter: not allowed = exists) */
async function conversationPaid(key: string): Promise<boolean> {
  const r = await consumeUsage("diagnose-conv", key, 1, { commit: false, ...DAY });
  return !r.allowed;
}

type Reserved = { ok: true; day: string; tier: AiTier };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Has a parallel request for this very conversation paid in the meantime? It
 * secures the unit first and writes the marker a few queries later, so a
 * request that was just refused looks again briefly before it concludes that
 * nobody paid.
 */
async function conversationPaidSoon(key: string): Promise<boolean> {
  for (let i = 0; i < 4; i++) {
    if (await conversationPaid(key)) return true;
    await sleep(40);
  }
  return false;
}

function dailyBound(caller: Caller): { key: string; limit: number } | null {
  if (caller.kind === "consumer") return { key: caller.quotaKey, limit: caller.monthlyLimit === -1 ? PAID_DAILY_CALLS : FREE_DAILY_CALLS };
  if (caller.quotaKey && caller.monthlyCalls) return { key: caller.quotaKey, limit: apiAccountDailyCalls(caller.monthlyCalls) };
  return null;
}

function dailyLimitFailure(caller: Caller, limit: number): Failure {
  if (caller.kind === "api") {
    return fail(429, "daily_limit", `Daily fair-use limit reached: ${limit} AI diagnoses per day for this account (a twentieth of the monthly allowance). Try again within 24 hours.`, { code: "daily_limit" });
  }
  if (caller.monthlyLimit === -1) {
    return fail(429, "daily_limit", `Je hebt de grens voor eerlijk gebruik bereikt: maximaal ${limit} AI-berichten per dag. Over maximaal 24 uur kun je weer verder.`, { code: "daily_limit" });
  }
  return fail(429, "daily_limit", "Je hebt vandaag veel vragen gesteld. Probeer het over maximaal 24 uur opnieuw of neem contact met ons op als je er niet uitkomt.", { code: "daily_limit" });
}

/**
 * Everything a model call must have secured before it is made. On a refusal
 * nothing stays reserved. `undo` holds what to give back if the model then fails.
 */
async function reserveFor(
  caller: Caller,
  sessionId: string,
  undo: Undo,
  opts: { photo?: boolean } = {},
): Promise<Reserved | Failure | { capReached: true }> {
  const bound = dailyBound(caller);
  if (bound) {
    const ident = await consumeUsage("diagnose-calls", bound.key, bound.limit, DAY);
    if (!ident.allowed) return dailyLimitFailure(caller, bound.limit);
    undo.add(() => refundUsage("diagnose-calls", bound.key));
  }

  if (caller.kind === "consumer") {
    const key = convKey(caller, sessionId);

    // Messages per conversation, counted here: the client's own `messages` array says nothing about
    // how many requests it has made under one sessionId. Photos have their own, smaller limit below.
    if (!opts.photo) {
      const turn = await consumeUsage("diagnose-turns", key, MAX_USER_TURNS, DAY);
      if (!turn.allowed) {
        await undo.run();
        return fail(422, "conversation_too_long", "Dit gesprek is erg lang geworden. Start een nieuwe diagnose om verder te gaan.", { code: "conversation_too_long" });
      }
      undo.add(() => refundUsage("diagnose-turns", key));
    }

    if (caller.monthlyLimit !== -1 && !(await conversationPaid(key))) {
      const unit = await consumeUsage("diagnose", caller.quotaKey, caller.monthlyLimit);
      // Denied, but a parallel request for this very conversation may have paid in the meantime
      // (a double-submit): then this message belongs to that paid conversation.
      if (!unit.allowed && !(await conversationPaidSoon(key))) {
        await undo.run();
        const signedIn = Boolean(caller.userId);
        return fail(
          429,
          "limit_reached",
          signedIn
            ? `Je hebt je ${unit.limit} gratis diagnoses van deze maand gebruikt. Met Particulier stel je onbeperkt vragen, de eerste 14 dagen gratis.`
            : `Je hebt je ${unit.limit} gratis diagnoses van deze maand gebruikt. Maak een gratis account om je diagnoses te bewaren, of ga voor onbeperkt met Particulier, de eerste 14 dagen gratis.`,
          { code: "limit_reached", signedIn, used: unit.used, limit: unit.limit },
        );
      }
      if (unit.allowed) {
        const marker = await consumeUsage("diagnose-conv", key, 1, DAY);
        if (marker.allowed) {
          undo.add(() => refundUsage("diagnose", caller.quotaKey));
          undo.add(() => refundUsage("diagnose-conv", key));
        } else {
          // A parallel request for the same conversation paid first; ours is surplus.
          await refundUsage("diagnose", caller.quotaKey);
        }
      }
    }

    if (opts.photo) {
      const photos = await consumeUsage("diagnose-photo", key, MAX_PHOTOS_PER_CONVERSATION, DAY);
      if (!photos.allowed) {
        await undo.run();
        return fail(429, "photo_limit", `Je hebt in dit gesprek al ${MAX_PHOTOS_PER_CONVERSATION} foto's laten beoordelen. Start een nieuwe diagnose voor meer foto's.`, { code: "photo_limit" });
      }
      undo.add(() => refundUsage("diagnose-photo", key));
    }
  }

  const tier = tierOf(caller);
  const cap = await reserveAiCall(tier);
  if (!cap.ok) {
    await undo.run();
    return { capReached: true };
  }
  return { ok: true, day: cap.day, tier };
}

// ─── Catalogue access (live, uncached, never exposes cost or supplier) ──────

const PART_SELECT = {
  id: true,
  sku: true,
  name: true,
  description: true,
  brand: true,
  category: true,
  priceEur: true,
  stock: true,
  imageUrl: true,
  isOriginal: true,
  machines: { select: { machine: { select: { brand: true } } } },
} satisfies Prisma.PartSelect;

type PartRow = Prisma.PartGetPayload<{ select: typeof PART_SELECT }>;

type CatalogCode = {
  id: string;
  code: string;
  brand: string;
  title: string;
  description: string;
  likelyCauses: string;
  severity: string;
  diyFriendly: boolean;
  provenance: string;
  sourceUrl: string | null;
  sourceName: string | null;
};

function fitting(rows: PartRow[], brand: string | null): PublicPart[] {
  return rows
    .filter((r) => (brand ? partFitsBrand({ part: r, compatBrands: r.machines.map((m) => m.machine.brand) }, brand) : r.brand === "Universeel"))
    .map((r) => toPublicPart(r));
}

const inStockFirst = (a: PublicPart, b: PublicPart, brand: string | null) =>
  Number(b.stock > 0) - Number(a.stock > 0) || Number(b.brand === brand) - Number(a.brand === brand) || a.sku.localeCompare(b.sku);

/** Exact (case-insensitive) match on the code, never "contains": "E1" must not find "E18". One row per brand. */
async function lookupCodes(code: string, brand: string | null): Promise<CatalogCode[]> {
  try {
    if (isDatabaseConfigured()) {
      const rows = await prisma.errorCode.findMany({
        where: { code: { equals: code, mode: "insensitive" }, ...(brand ? { machine: { brand } } : {}) },
        include: { machine: { select: { brand: true, model: true } } },
        orderBy: [{ machine: { brand: "asc" } }, { machine: { model: "asc" } }],
        take: 60,
      });
      const seen = new Set<string>();
      const out: CatalogCode[] = [];
      for (const r of rows) {
        if (seen.has(r.machine.brand)) continue;
        seen.add(r.machine.brand);
        out.push({ ...r, brand: r.machine.brand });
      }
      return out;
    }
    const seen = new Set<string>();
    const out: CatalogCode[] = [];
    for (const e of staticData.errorCodes) {
      if (e.code.toLowerCase() !== code.toLowerCase()) continue;
      const m = staticData.machines.find((x) => x.id === e.machineId);
      if (!m || (brand && m.brand !== brand) || seen.has(m.brand)) continue;
      seen.add(m.brand);
      out.push({ ...e, brand: m.brand, sourceUrl: e.sourceUrl ?? null, sourceName: e.sourceName ?? null } as CatalogCode);
    }
    return out;
  } catch (err) {
    logger.warn("[diagnose] error-code lookup failed", err);
    return [];
  }
}

async function partsLinkedTo(ec: CatalogCode): Promise<PublicPart[]> {
  if (isDatabaseConfigured()) {
    const links = await prisma.errorCodeParts.findMany({ where: { errorCodeId: ec.id }, include: { part: { select: PART_SELECT } } });
    return fitting(links.map((l) => l.part), ec.brand).sort((a, b) => inStockFirst(a, b, ec.brand));
  }
  const ids = new Set(staticData.errorCodeParts.filter((l) => l.errorCodeId === ec.id).map((l) => l.partId));
  return staticData.parts.filter((p) => ids.has(p.id)).map((p) => toPublicPart(p));
}

async function guidesLinkedTo(ec: CatalogCode): Promise<RecommendedGuide[]> {
  if (isDatabaseConfigured()) {
    const links = await prisma.errorCodeGuides.findMany({
      where: { errorCodeId: ec.id },
      include: { guide: { select: { id: true, slug: true, title: true, difficulty: true, timeMinutes: true, summary: true } } },
    });
    return links.map((l) => l.guide).sort((a, b) => a.title.localeCompare(b.title));
  }
  const ids = new Set(staticData.errorCodeGuides.filter((l) => l.errorCodeId === ec.id).map((l) => l.guideId));
  return staticData.guides.filter((g) => ids.has(g.id)).map(({ id, slug, title, difficulty, timeMinutes, summary }) => ({ id, slug, title, difficulty, timeMinutes, summary }));
}

/** Parts that MIGHT be needed, from the categories the causes point at. Brand-fitting only (or universal when the brand is unknown). */
async function suggestedParts(causes: string, brand: string | null, take = 3): Promise<PublicPart[]> {
  const cats = categoriesForCauses(causes);
  if (cats.length === 0) return [];
  if (isDatabaseConfigured()) {
    const rows = await prisma.part.findMany({ where: { category: { in: cats } }, select: PART_SELECT });
    const pool = fitting(rows, brand);
    const picked: PublicPart[] = [];
    // One per category in cause order first, so the first cause is not drowned out by the last.
    for (const cat of cats) {
      const best = pool.filter((p) => p.category === cat).sort((a, b) => inStockFirst(a, b, brand))[0];
      if (best && !picked.some((p) => p.id === best.id)) picked.push(best);
      if (picked.length >= take) break;
    }
    return picked;
  }
  return staticData.parts.filter((p) => cats.includes(p.category) && (brand ? partFitsBrand({ part: p, compatBrands: [] }, brand) : p.brand === "Universeel")).slice(0, take).map((p) => toPublicPart(p));
}

const GUIDE_SLUGS: Record<string, string[]> = {
  PUMP: ["afvoerpomp-reinigen-vervangen"],
  FILTER: ["filter-reinigen"],
  HEATING: ["verwarmingselement-vervangen"],
  HEATER: ["verwarmingselement-vervangen"],
  BEARING: ["trommellager-vervangen"],
  DOOR: ["deurpakking-vervangen"],
  SEAL: ["deurpakking-vervangen"],
  VALVE: ["waterinlaatventiel-vervangen"],
};

async function suggestedGuides(causes: string, take = 3): Promise<RecommendedGuide[]> {
  const slugs = [...new Set(categoriesForCauses(causes).flatMap((c) => GUIDE_SLUGS[c] ?? []))].slice(0, take);
  if (slugs.length === 0) return [];
  if (isDatabaseConfigured()) {
    return prisma.repairGuide.findMany({ where: { slug: { in: slugs } }, select: { id: true, slug: true, title: true, difficulty: true, timeMinutes: true, summary: true }, orderBy: { title: "asc" } });
  }
  return staticData.guides.filter((g) => slugs.includes(g.slug)).map(({ id, slug, title, difficulty, timeMinutes, summary }) => ({ id, slug, title, difficulty, timeMinutes, summary }));
}

const canonicalBrand = (b: string | null | undefined): string | null => FALLBACK_BRANDS.find((x) => x.toLowerCase() === (b ?? "").trim().toLowerCase()) ?? null;

async function recommendationsFor(ec: CatalogCode | null, causes: string, brand: string | null) {
  let parts: PublicPart[] = [];
  let guides: RecommendedGuide[] = [];
  try {
    if (ec) {
      parts = await partsLinkedTo(ec);
      guides = await guidesLinkedTo(ec);
    }
    if (parts.length === 0) parts = await suggestedParts(causes, brand);
    if (guides.length === 0) guides = await suggestedGuides(causes);
  } catch (err) {
    logger.warn("[diagnose] could not look up recommendations", err);
  }
  return { parts: parts.slice(0, 4), guides: guides.slice(0, 3) };
}

// ─── The fallback: a lookup, labelled as one ────────────────────────────────

const URGENCY: Record<string, DiagnosisResult["urgency"]> = { LOW: "low", MEDIUM: "medium", HIGH: "high" };

const GENERIC_TIP: Record<NonNullable<ReturnType<typeof parseFallbackQuery>["symptom"]>, string> = {
  afvoer: "Maak het pluizenfilter schoon en kijk of de afvoerslang niet geknikt of verstopt is.",
  verwarming: "Kies een programma met temperatuur en kijk of de was echt koud blijft. Blijft dat zo, dan kunnen het verwarmingselement of de temperatuursensor de oorzaak zijn.",
  water: "Controleer of de waterkraan open staat en of het zeefje in de inlaatslang niet verstopt is.",
  deur: "Kijk of er niets tussen de deur klemt en of de deur goed dichtgaat.",
  trillen: "Controleer of de machine waterpas staat, of de transportbouten zijn verwijderd en of de lading gelijkmatig in de trommel zit.",
  lekkage: "Controleer de slangaansluitingen, het deksel van het pluizenfilter en de deurrubber op lekkage.",
};

const REASON_LINE =
  "De AI-diagnose is op dit moment niet beschikbaar. Dit is een opzoeking in onze foutcodedatabase, geen analyse van jouw situatie.";

function sourceLine(ec: CatalogCode): string {
  if (ec.provenance !== "VERIFIED") return "Bron: deze betekenis is nog niet bevestigd door een tweede bron.";
  const name = ec.sourceName ?? "gecontroleerde bron";
  const safeUrl = ec.sourceUrl && /^https:\/\//i.test(ec.sourceUrl) ? ec.sourceUrl : null;
  return `Bron: ${safeUrl ? `[${name}](${safeUrl})` : name} (gecontroleerd).`;
}

async function fallbackAnswer(
  userTexts: string[],
): Promise<{ message: string; diagnosis: DiagnosisResult | null; parts: PublicPart[]; guides: RecommendedGuide[] }> {
  const q = parseFallbackQuery(userTexts);
  const head = `**${FALLBACK_LABEL}.** ${REASON_LINE}`;
  const tip = q.symptom ? `\n\nAlgemene tip, geen diagnose: ${GENERIC_TIP[q.symptom]}` : "";
  const ask = "Staat er een foutcode op het display? Typ die dan samen met het merk, bijvoorbeeld \"Bosch E18\".";

  if (!q.code) {
    return {
      message: `${head}\n\nZonder foutcode kan de zoekhulp geen oorzaak aanwijzen. ${ask}${tip}\n\nAlle codes per merk staan in de [foutcodedatabase](/foutcodes).`,
      diagnosis: null,
      parts: [],
      guides: [],
    };
  }

  const rows = await lookupCodes(q.code, q.brand);
  if (rows.length === 0) {
    return {
      message: `${head}\n\nFoutcode ${q.code.toUpperCase()}${q.brand ? ` bij ${q.brand}` : ""} staat niet in onze database. Controleer de schrijfwijze op het display, of zoek in de [foutcodedatabase](/foutcodes).${tip}`,
      diagnosis: null,
      parts: [],
      guides: [],
    };
  }
  if (rows.length > 1) {
    const list = rows.slice(0, 8).map((r) => `- ${r.brand}: ${r.title}`).join("\n");
    return {
      message: `${head}\n\nFoutcode ${rows[0].code} betekent per merk iets anders:\n${list}\n\nZeg welk merk je hebt, dan zoek ik het juiste antwoord op.`,
      diagnosis: null,
      parts: [],
      guides: [],
    };
  }

  const ec = rows[0];
  const causes = ec.likelyCauses.split("|").map((c) => c.trim()).filter(Boolean);
  const diagnosis: DiagnosisResult = {
    errorCode: ec.code,
    mainCause: ec.title,
    alternativeCauses: causes.slice(0, 6),
    diyFriendly: ec.diyFriendly,
    urgency: URGENCY[ec.severity] ?? "medium",
    recommendedAction: ec.description.slice(0, 600),
    brand: ec.brand,
    // No `confidence`: a table lookup has none, and a made-up number is the claim this replaces.
  };
  const recs = await recommendationsFor(ec, ec.likelyCauses, ec.brand);
  const message =
    `${head}\n\n**Foutcode ${ec.code} (${ec.brand}): ${ec.title}**\n\n${ec.description}\n\n` +
    `Mogelijke oorzaken volgens onze database:\n${causes.map((c) => `- ${c}`).join("\n")}\n\n${sourceLine(ec)}` +
    (q.brand ? "" : `\n\nJe noemde geen merk. In onze database staat deze code alleen bij ${ec.brand}. Heb je een ander merk? Zeg het, dan zoek ik het opnieuw op.`);
  return { message, diagnosis, parts: recs.parts, guides: recs.guides };
}

// ─── Text diagnosis ─────────────────────────────────────────────────────────

const SESSION_ID = /^[A-Za-z0-9_-]{8,100}$/;
export const isValidSessionId = (s: string) => SESSION_ID.test(s);

function groundingFor(rows: CatalogCode[]): string | null {
  if (rows.length === 0) return null;
  return rows
    .slice(0, 4)
    .map((r) => {
      const causes = r.likelyCauses.split("|").map((c) => c.trim()).filter(Boolean).join("; ");
      return `- Foutcode ${r.code} bij ${r.brand}: ${r.title}. ${r.description.slice(0, 240)} Mogelijke oorzaken: ${causes}. Zelf te doen: ${r.diyFriendly ? "ja" : "nee, monteur aanraden"}. ${r.provenance === "VERIFIED" ? "Betekenis gecontroleerd." : "Betekenis niet bevestigd."}`;
    })
    .join("\n")
    .slice(0, 1500);
}

async function fallbackOutcome(caller: Caller, userTexts: string[], sessionId: string, reason: string): Promise<DiagnoseSuccess> {
  const fb = await fallbackAnswer(userTexts);
  return {
    ok: true,
    mode: "fallback",
    model: null,
    label: FALLBACK_LABEL,
    fallbackReason: reason,
    message: fb.message,
    diagnosis: fb.diagnosis,
    recommendedParts: fb.parts,
    recommendedGuides: fb.guides,
    sessionId,
    notice: INDICATION_NOTICE,
    quota: caller.kind === "consumer" ? await peekQuota(caller) : null,
    billable: true,
  };
}

export async function runDiagnosis(input: {
  messages: ChatMessage[];
  sessionId?: string;
  caller: Caller;
  language?: string;
}): Promise<DiagnoseOutcome> {
  const { messages, caller } = input;
  const sessionId = input.sessionId ?? randomUUID();
  const userTexts = messages.filter((m) => m.role === "user").map((m) => m.content);

  if (userTexts.length > MAX_USER_TURNS) {
    return fail(422, "conversation_too_long", "Dit gesprek is erg lang geworden. Start een nieuwe diagnose om verder te gaan.", { code: "conversation_too_long" });
  }

  const availability = aiAvailability();
  if (!availability.available) {
    if (caller.kind === "api") {
      // The B2B API sells AI. A keyword lookup is not what the customer pays for.
      if (availability.reason === "not_configured") logger.error("[diagnose] /api/v1/diagnose cannot answer: GEMINI_API_KEY is not configured");
      return fail(503, "ai_unavailable", "AI diagnosis is temporarily unavailable", { retry_after: 300 });
    }
    return fallbackOutcome(caller, userTexts, sessionId, availability.reason);
  }

  const undo = new Undo();
  const reserved = await reserveFor(caller, sessionId, undo);
  if ("capReached" in reserved) {
    if (caller.kind === "api") return fail(503, "ai_unavailable", "AI diagnosis is at its daily capacity", { retry_after: 3600 });
    return fallbackOutcome(caller, userTexts, sessionId, "daily_cap");
  }
  if (!reserved.ok) return reserved;

  const backend = getAiBackend();
  if (!backend) {
    // aiAvailability() said yes a moment ago; give everything back rather than guess.
    await undo.run();
    await releaseAiCall(reserved.day, reserved.tier);
    return caller.kind === "api" ? fail(503, "ai_unavailable", "AI diagnosis is temporarily unavailable") : fallbackOutcome(caller, userTexts, sessionId, "not_configured");
  }

  let assistantText = "";
  let result: DiagnosisResult | null = null;
  let cleanText = "";
  let matched: CatalogCode | null = null;
  try {
    // Hand the model the verified row for a code it was given, so it does not contradict our own table.
    const q = parseFallbackQuery(userTexts);
    const rows = q.code ? await lookupCodes(q.code, q.brand) : [];
    matched = rows.length === 1 ? rows[0] : null;
    const history = messages.slice(0, -1).map((m) => ({ role: m.role === "assistant" ? ("model" as const) : ("user" as const), text: m.content }));
    assistantText = await backend.chat({
      system: buildSystemPrompt({ language: input.language, grounding: groundingFor(rows), brandNamed: Boolean(q.brand), singleShot: caller.kind === "api" }),
      history,
      message: messages[messages.length - 1].content,
      timeoutMs: GEMINI_TEXT_TIMEOUT_MS,
    });
    if (!assistantText.trim()) throw new Error("Gemini returned an empty answer");
    reportModelSuccess();
    const parsed = parseDiagnosisFromResponse(assistantText);
    result = parsed.result;
    cleanText = parsed.cleanText;
  } catch (err) {
    const kind = await reportModelFailure(err, "text");
    // The visitor got nothing for these units: give them back.
    await undo.run();
    if (!failureMayHaveCost(kind)) await releaseAiCall(reserved.day, reserved.tier);
    if (caller.kind === "api") {
      if (kind === "timeout") return fail(504, "ai_timeout", "AI diagnosis timed out", { retry_after: 5 });
      if (kind === "model_not_found" || kind === "auth") return fail(503, "ai_unavailable", "AI diagnosis is temporarily unavailable", { retry_after: 300 });
      return fail(502, "ai_failed", "AI diagnosis failed");
    }
    return fallbackOutcome(caller, userTexts, sessionId, kind === "model_not_found" || kind === "auth" ? "model_unavailable" : "error");
  }

  let parts: PublicPart[] = [];
  let guides: RecommendedGuide[] = [];
  if (result) {
    const brand = canonicalBrand(result.brand) ?? q0Brand(userTexts);
    // Link to the row only when it is the one the model's answer is about.
    const answerBrand = canonicalBrand(result.brand);
    const ec =
      matched &&
      (!result.errorCode || result.errorCode.toLowerCase() === matched.code.toLowerCase()) &&
      (!answerBrand || answerBrand === matched.brand)
        ? matched
        : null;
    const recs = await recommendationsFor(ec, [result.mainCause, ...result.alternativeCauses].join("|"), ec?.brand ?? brand);
    parts = recs.parts;
    guides = recs.guides;

    if (caller.kind === "consumer") await persistDiagnosis(caller, sessionId, messages, assistantText, result, userTexts);
  }

  return {
    ok: true,
    mode: "ai",
    model: backend.name,
    label: null,
    fallbackReason: null,
    message: cleanText || "Hier is de diagnose op basis van jouw omschrijving.",
    diagnosis: result,
    recommendedParts: parts,
    recommendedGuides: guides,
    sessionId,
    notice: INDICATION_NOTICE,
    quota: caller.kind === "consumer" ? await peekQuota(caller) : null,
    // A one-shot API request that ended without a diagnosis (the model still asked a question) is not billed.
    billable: caller.kind !== "api" || result !== null,
  };
}

const q0Brand = (userTexts: string[]) => canonicalBrand(parseFallbackQuery(userTexts).brand);

async function persistDiagnosis(
  caller: Extract<Caller, { kind: "consumer" }>,
  sessionId: string,
  messages: ChatMessage[],
  assistantText: string,
  result: DiagnosisResult,
  userTexts: string[],
) {
  if (!isDatabaseConfigured()) return;
  try {
    await prisma.diagnosis.create({
      data: {
        sessionId,
        userId: caller.userId,
        brand: result.brand ?? q0Brand(userTexts) ?? "Onbekend",
        model: result.model ?? null,
        symptoms: userTexts[userTexts.length - 1] ?? "",
        messages: JSON.stringify([...messages, { role: "assistant", content: assistantText }]),
        result: JSON.stringify(result),
      },
    });
    if (caller.userId) {
      await prisma.user.update({ where: { id: caller.userId }, data: { diagnosesUsed: { increment: 1 } } });
    }
  } catch (err) {
    // The visitor has their answer; a failed history row must not take it away.
    logger.warn("[diagnose] failed to persist diagnosis", err);
  }
}

/**
 * The most we accept. The browser downsizes a photo to about 1.5 MB before it is
 * sent (src/components/diagnose/photo.ts); 4 MB leaves room for a client that did
 * not, and stays under the 4.5 MB request-body limit of serverless functions,
 * above which the platform answers 413 before this code runs.
 */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/** The real type of an image, from its first bytes. The Content-Type of an upload is whatever the sender wrote. */
export function sniffImageType(b: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 12 && String.fromCharCode(...b.subarray(0, 4)) === "RIFF" && String.fromCharCode(...b.subarray(8, 12)) === "WEBP") return "image/webp";
  return null;
}

// ─── Photo diagnosis ────────────────────────────────────────────────────────

export type PhotoSuccess = {
  ok: true;
  mode: "ai";
  model: string;
  sessionId: string;
  analysis: ImageDiagnosis;
  matchedErrorCode: { id: string; code: string; brand: string; title: string; description: string } | null;
  recommendedParts: PublicPart[];
  recommendedGuides: RecommendedGuide[];
  notice: string;
  quota: Quota;
};

const PHOTO_UNAVAILABLE =
  "De foto kon niet worden beoordeeld: de AI is nu niet beschikbaar. Typ de foutcode of je klacht in het gesprek, dan zoeken we die voor je op.";

export async function runPhotoDiagnosis(input: {
  base64: string;
  mimeType: string;
  sessionId?: string;
  caller: Extract<Caller, { kind: "consumer" }>;
}): Promise<PhotoSuccess | Failure> {
  const { caller } = input;
  const sessionId = input.sessionId ?? randomUUID();

  const availability = aiAvailability();
  // No model, no result. The old route answered with a canned "Bosch E18, 78%" here.
  if (!availability.available) return fail(503, "photo_unavailable", PHOTO_UNAVAILABLE, { code: "photo_unavailable" });

  const undo = new Undo();
  const reserved = await reserveFor(caller, sessionId, undo, { photo: true });
  if ("capReached" in reserved) return fail(503, "photo_unavailable", PHOTO_UNAVAILABLE, { code: "photo_unavailable" });
  if (!reserved.ok) return reserved;

  const backend = getAiBackend();
  if (!backend) {
    await undo.run();
    await releaseAiCall(reserved.day, reserved.tier);
    return fail(503, "photo_unavailable", PHOTO_UNAVAILABLE, { code: "photo_unavailable" });
  }

  let analysis: ImageDiagnosis | null = null;
  try {
    const text = await backend.describeImage({
      system: IMAGE_SYSTEM_PROMPT,
      prompt: "Bekijk deze foto van mijn wasmachine en geef de JSON.",
      mimeType: input.mimeType,
      base64: input.base64,
      timeoutMs: GEMINI_IMAGE_TIMEOUT_MS,
    });
    reportModelSuccess();
    analysis = parseImageDiagnosis(text);
    if (!analysis) throw new Error("Gemini returned an unreadable image answer");
  } catch (err) {
    const kind = await reportModelFailure(err, "photo");
    await undo.run();
    if (!failureMayHaveCost(kind)) await releaseAiCall(reserved.day, reserved.tier);
    if (kind === "timeout") return fail(504, "photo_timeout", "De foto kon niet worden beoordeeld: het duurde te lang. Probeer het opnieuw of typ de foutcode.", { code: "photo_timeout" });
    return fail(502, "photo_failed", "De foto kon niet worden beoordeeld. Probeer een scherpere foto van het display, of typ de foutcode.", { code: "photo_failed" });
  }

  let matched: CatalogCode | null = null;
  let parts: PublicPart[] = [];
  let guides: RecommendedGuide[] = [];
  if (analysis.recognised && analysis.detectedCode) {
    const rows = await lookupCodes(analysis.detectedCode, canonicalBrand(analysis.detectedBrand));
    matched = rows.length === 1 ? rows[0] : null;
    if (matched) {
      const recs = await recommendationsFor(matched, matched.likelyCauses, matched.brand);
      parts = recs.parts;
      guides = recs.guides;
    }
  }

  return {
    ok: true,
    mode: "ai",
    model: backend.name,
    sessionId,
    analysis,
    matchedErrorCode: matched ? { id: matched.id, code: matched.code, brand: matched.brand, title: matched.title, description: matched.description } : null,
    recommendedParts: parts,
    recommendedGuides: guides,
    notice: INDICATION_NOTICE,
    quota: await peekQuota(caller),
  };
}
