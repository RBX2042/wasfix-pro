/**
 * Payment reminders for unpaid bank-transfer invoices.
 *
 *   stage "due":  from the due date (voorwaarden 7.2: a free reminder first)
 *   stage "last": from LAST_REMINDER_AFTER_DAYS after the due date, saying when the order is cancelled
 *
 * The spec asked for the second reminder one week after the due date. The expiry
 * sweep cancels at due date + BANK_TRANSFER_GRACE_DAYS (7), so a "last reminder"
 * at +7 would arrive together with the cancellation mail. It goes out at +5, two
 * days before the cancellation, which is the only moment it can still help.
 *
 * ONE MAIL PER STAGE, EVER. Order has no reminder column and the schema is not
 * this bundle's, so the "already sent" fact is a row in UsageCounter with the
 * unique (scope, key) = ("payment-reminder", "<orderId>:<stage>"). The row is
 * INSERTED BEFORE sending: of two concurrent cron runs exactly one insert wins
 * (unique violation for the other), so a mail is never sent twice. If the send
 * fails the claim is released and a failure row counts the attempt; after
 * MAX_ATTEMPTS the reminder is given up so a broken Resend setup does not
 * produce an hourly stream of failures. windowEnd is far in the future so the
 * retention step, which only removes expired windows, never deletes a marker.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getResend } from "@/lib/email";
import { isPlaceholderValue } from "@/lib/company-validate";
import { BANK_TRANSFER_GRACE_DAYS } from "@/lib/cart-limits";
import { sendPaymentReminderEmail } from "@/app/admin/_lib/mails";

export const REMINDER_SCOPE = "payment-reminder";
export const LAST_REMINDER_AFTER_DAYS = 5;
const MAX_ATTEMPTS = 3;
const DAY = 86_400_000;
const FAR_FUTURE_DAYS = 3650;

export type ReminderResult = {
  examined: number;
  sentDue: number;
  sentLast: number;
  alreadySent: number;
  failed: number;
  gaveUp: number;
  /** Resend is not configured: nothing was attempted and nothing was recorded. */
  skippedNoMail: boolean;
};

async function claim(key: string, now: Date): Promise<boolean> {
  // Look first: an hourly run meets every already-reminded order again, and an insert that fails on the
  // unique index writes a Prisma error to the log each time. The insert below still decides a real race.
  if (await prisma.usageCounter.findUnique({ where: { scope_key: { scope: REMINDER_SCOPE, key } }, select: { id: true } })) return false;
  try {
    await prisma.usageCounter.create({ data: { scope: REMINDER_SCOPE, key, count: 1, windowEnd: new Date(now.getTime() + FAR_FUTURE_DAYS * DAY) } });
    return true;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return false;
    throw err;
  }
}

export async function sendPaymentReminders(opts: { now?: Date; limit?: number } = {}): Promise<ReminderResult> {
  const now = opts.now ?? new Date();
  const result: ReminderResult = { examined: 0, sentDue: 0, sentLast: 0, alreadySent: 0, failed: 0, gaveUp: 0, skippedNoMail: false };
  if (!getResend()) {
    result.skippedNoMail = true;
    return result;
  }
  // Due or past due, and not yet at the cancellation moment (the sweep owns those).
  const orders = await prisma.order.findMany({
    where: {
      status: "OPENSTAAND",
      paymentMethod: "BANK_TRANSFER",
      dueAt: { lte: now, gt: new Date(now.getTime() - BANK_TRANSFER_GRACE_DAYS * DAY) },
      invoice: { isNot: null },
    },
    select: { id: true, email: true, accessToken: true, totalEur: true, dueAt: true, shippingAddress: true, invoice: { select: { number: true, sellerJson: true } } },
    orderBy: { dueAt: "asc" },
    take: opts.limit ?? 50,
  });
  result.examined = orders.length;

  for (const o of orders) {
    if (!o.dueAt || !o.invoice) continue;
    const stage: "due" | "last" = now.getTime() >= o.dueAt.getTime() + LAST_REMINDER_AFTER_DAYS * DAY ? "last" : "due";
    const key = `${o.id}:${stage}`;
    const failKey = `${key}:fail`;
    try {
      const fails = await prisma.usageCounter.findUnique({ where: { scope_key: { scope: REMINDER_SCOPE, key: failKey } } });
      if ((fails?.count ?? 0) >= MAX_ATTEMPTS) {
        result.gaveUp++;
        continue;
      }
      if (!(await claim(key, now))) {
        result.alreadySent++;
        continue;
      }
      let seller: { iban?: string; name?: string } = {};
      try {
        seller = JSON.parse(o.invoice.sellerJson) ?? {};
      } catch {
        /* the mail then simply omits the IBAN block */
      }
      let name = "klant";
      try {
        name = (JSON.parse(o.shippingAddress)?.name as string) || name;
      } catch {
        /* keep default */
      }
      const iban = seller.iban && !isPlaceholderValue(seller.iban) ? seller.iban : null;
      const mail = await sendPaymentReminderEmail(o.email, {
        orderId: o.id,
        name,
        accessToken: o.accessToken,
        invoiceNumber: o.invoice.number,
        totalEur: o.totalEur,
        dueAt: o.dueAt,
        iban,
        ibanName: iban ? (seller.name ?? null) : null,
        stage,
        cancelOn: new Date(o.dueAt.getTime() + BANK_TRANSFER_GRACE_DAYS * DAY),
      });
      if (mail.ok) {
        if (stage === "due") result.sentDue++;
        else result.sentLast++;
        continue;
      }
      // Release the claim so the next run retries; count the attempt.
      await prisma.usageCounter.deleteMany({ where: { scope: REMINDER_SCOPE, key } });
      await prisma.usageCounter.upsert({
        where: { scope_key: { scope: REMINDER_SCOPE, key: failKey } },
        create: { scope: REMINDER_SCOPE, key: failKey, count: 1, windowEnd: new Date(now.getTime() + FAR_FUTURE_DAYS * DAY) },
        update: { count: { increment: 1 } },
      });
      result.failed++;
    } catch (err) {
      result.failed++;
      logger.error("[cron] payment reminder failed", { orderId: o.id, stage, err });
    }
  }
  return result;
}
