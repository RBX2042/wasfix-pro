/**
 * "Send this order mail again": the rate limit and the call, without Next.js, so
 * scripts can run it against a real database.
 *
 * Why it exists: the instructions mail of a bank-transfer order was sent exactly
 * once, at checkout; the Stripe confirmation once, by the webhook. When Resend
 * refused, the customer had no IBAN and no way to get it short of writing in, and
 * the owner had no button. This only SENDS (sendOrderMailForOrder): it never
 * changes a status, a stock or an invoice.
 *
 * RATE LIMIT. One send per order and kind per minute, kept in UsageCounter
 * (scope "mail-resend", key "<orderId>:<kind>", windowEnd = end of the minute):
 * of two simultaneous clicks exactly one takes the row (an update guarded on the
 * expired window, or the unique insert), the other is told to wait. When the send
 * FAILS the window is given back at once, so the owner can try again straight away.
 * UsageCounter is the table the payment reminders use for the same purpose; the
 * retention job only removes expired windows.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { ORDER_MAIL_LABEL, sendOrderMailForOrder, type OrderMailKind } from "@/lib/email";

export const RESEND_SCOPE = "mail-resend";
export const RESEND_WINDOW_MS = 60_000;

export type ResendOutcome = { ok: true; message: string } | { ok: false; error: string };

async function takeWindow(key: string, now: Date): Promise<boolean> {
  const until = new Date(now.getTime() + RESEND_WINDOW_MS);
  const taken = await prisma.usageCounter.updateMany({ where: { scope: RESEND_SCOPE, key, windowEnd: { lte: now } }, data: { windowEnd: until, count: { increment: 1 } } });
  if (taken.count > 0) return true;
  try {
    await prisma.usageCounter.create({ data: { scope: RESEND_SCOPE, key, count: 1, windowEnd: until } });
    return true;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return false; // the window is still running
    throw err;
  }
}

export async function resendOrderMail(orderId: string, kind: OrderMailKind, now: Date = new Date()): Promise<ResendOutcome> {
  const key = `${orderId}:${kind}`;
  try {
    if (!(await takeWindow(key, now))) {
      return { ok: false, error: "Er is zojuist al een e-mail voor deze bestelling verstuurd. Wacht een minuut en probeer het opnieuw." };
    }
    const res = await sendOrderMailForOrder(orderId, kind);
    if (!res.ok) {
      await prisma.usageCounter.updateMany({ where: { scope: RESEND_SCOPE, key }, data: { windowEnd: now } }).catch(() => undefined);
      if (res.error === "not_applicable") return { ok: false, error: `Deze bestelling staat niet in de toestand waarbij de ${ORDER_MAIL_LABEL[kind]} hoort. Er is niets verstuurd.` };
      if (res.error === "not_found") return { ok: false, error: "Bestelling niet gevonden." };
      return { ok: false, error: `De e-mail kon niet worden verstuurd (${res.error ?? "onbekende fout"}). Controleer de e-mailinstellingen; je kunt het meteen opnieuw proberen.` };
    }
    return { ok: true, message: `De ${ORDER_MAIL_LABEL[kind]} is opnieuw naar de klant verstuurd.` };
  } catch (err) {
    logger.error("[admin] resend order mail failed", { kind, err });
    return { ok: false, error: "Opnieuw versturen is mislukt. Probeer het opnieuw." };
  }
}
