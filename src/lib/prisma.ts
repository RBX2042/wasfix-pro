import { Prisma, PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * A bound on how long the app waits for the database (rehearsal R2-17).
 *
 * THE PROBLEM. With warm pooled connections and a Postgres that stops answering (a frozen primary, a pooler that
 * lost its upstream) a query never returned: POST /api/checkout gave no answer in 75+ seconds. The platform kills
 * the request at maxDuration, and nothing reaches the owner because onRequestError does not run when the
 * platform kills a function. A refused connection fails cleanly in 5 s; a FROZEN one does not fail at all.
 *
 * WHAT WAS MEASURED (a TCP proxy that keeps the sockets open and stops forwarding, like the rehearsal used;
 * scripts/qa-platform.ts repeats it):
 *   - Prisma's `socket_timeout` connection parameter bounds a query whose statement is already prepared on the
 *     connection, and NOTHING else: a statement the connection has not seen yet (every first call of a
 *     different query), a raw query and the start of an interactive transaction still hung for the whole
 *     40 s of the test. So it is kept, but it is not the guarantee.
 *   - `maxWait` / `timeout` of an interactive transaction did not end a transaction whose BEGIN was stuck.
 *   - A Postgres `statement_timeout` (connection option) cannot help: the query never reaches the server, and
 *     a pgbouncer transaction pooler (Supabase, port 6543) refuses startup options anyway.
 * So the guarantee is a deadline in the client: a Prisma query extension that rejects every model and raw
 * operation after DB_QUERY_TIMEOUT_MS, plus a wrapper for $transaction (below). The rejection is a
 * PrismaClientKnownRequestError with code P1008 ("operations timed out"), so every route that already maps a
 * Prisma error to a 503 and an owner alert (checkout does: isPrismaError) needs no change.
 *
 * THE COMMIT. COMMIT is not a query (the engine sends it after the callback returned), so the extension never
 * sees it. A freeze that lands exactly on the COMMIT was measured at 30.0 s with checkout's own options
 * (maxWait 8 s + timeout 20 s + 2 s), equal to the platform limit, so neither a 503 nor an owner alert could
 * come out. Now the wrapper arms its own timer when the callback returns, and the total of any transaction is
 * capped at DB_TRANSACTION_CAP_MS, below the 30 s platform limit.
 *
 * WHAT IT DOES NOT DO: it does not cancel the work. The query may still run on the server, or sit on its frozen
 * connection until the socket closes; a write whose answer we gave up waiting for can still land. This
 * includes a COMMIT we stopped waiting for: the caller gets P1008 although the transaction may yet commit
 * (the order may exist). Checkout's Idempotency-Key is what makes the customer's retry safe: the retry finds
 * that order instead of creating a second one. A transaction we gave up on before its callback started does
 * not run its callback later (it is told to abort).
 */
export const DB_QUERY_TIMEOUT_MS = 8_000;
/** No interactive transaction keeps its caller longer than this, whatever options it asks for. Must stay below maxDuration (30 s) of the routes. */
export const DB_TRANSACTION_CAP_MS = 25_000;
/** Prisma's own per-query socket limit, in seconds. Second line of defence; see above for what it does not cover. */
export const DB_SOCKET_TIMEOUT_SECONDS = 10;

/** DATABASE_URL with `socket_timeout` added when it does not carry one. undefined when there is no URL. */
export function databaseUrlWithTimeouts(raw: string | undefined = process.env.DATABASE_URL): string | undefined {
  const url = raw?.trim();
  if (!url) return undefined;
  if (/[?&]socket_timeout=/i.test(url)) return url;
  // String append, not URL(): re-serialising could change how an unusual password is encoded.
  return `${url}${url.includes("?") ? "&" : "?"}socket_timeout=${DB_SOCKET_TIMEOUT_SECONDS}`;
}

function timeoutError(what: string, ms: number): Error {
  return new Prisma.PrismaClientKnownRequestError(`The database did not answer within ${ms} ms (${what})`, {
    code: "P1008",
    clientVersion: Prisma.prismaVersion.client,
  });
}

/** Reject after `ms`, unless `work` settles first. The loser never produces an unhandled rejection. */
export function withDeadline<T>(work: PromiseLike<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(timeoutError(what, ms)), ms);
    work.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

type TxOptions = { maxWait?: number; timeout?: number; isolationLevel?: unknown } | undefined;

/**
 * $transaction with the same guarantee. An interactive transaction (callback form) is abandoned when:
 *   - its callback has not even started after DB_QUERY_TIMEOUT_MS (BEGIN stuck): the callback is then
 *     told to abort if the engine ever gets round to it, so nothing is written late;
 *   - its callback threw and the engine has not finished the ROLLBACK within 2 s: the caller gets the
 *     callback's own error instead of waiting for a frozen connection;
 *   - its callback returned and the engine has not confirmed the COMMIT within DB_QUERY_TIMEOUT_MS (the
 *     write may still land; see the top of this file);
 *   - it lasts longer than its own maxWait + timeout + 2 s (Prisma's defaults: 2 s and 5 s), and in any case
 *     longer than DB_TRANSACTION_CAP_MS.
 * Queries inside the callback are bounded one by one by the query extension.
 */
function boundedTransaction(client: { $transaction: (...a: unknown[]) => Promise<unknown> }, args: unknown[]): Promise<unknown> {
  const [first, options] = args as [unknown, TxOptions];
  if (typeof first !== "function") return withDeadline(client.$transaction(...args), DB_QUERY_TIMEOUT_MS + 2_000, "$transaction");

  const total = Math.min((options?.maxWait ?? 2_000) + (options?.timeout ?? 5_000) + 2_000, DB_TRANSACTION_CAP_MS);
  let entered = false;
  let abandoned = false;
  return new Promise((resolve, reject) => {
    let settled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      for (const t of timers) clearTimeout(t);
      fn();
    };
    timers.push(setTimeout(() => { if (!entered) { abandoned = true; finish(() => reject(timeoutError("$transaction start", DB_QUERY_TIMEOUT_MS))); } }, DB_QUERY_TIMEOUT_MS));
    timers.push(setTimeout(() => { abandoned = true; finish(() => reject(timeoutError("$transaction", total))); }, total));

    const wrapped = async (tx: unknown) => {
      if (abandoned) throw timeoutError("$transaction abandoned before it started", DB_QUERY_TIMEOUT_MS);
      entered = true;
      try {
        const value = await (first as (tx: unknown) => Promise<unknown>)(tx);
        // The callback is done; what is left is the engine's COMMIT, which no query deadline covers.
        timers.push(setTimeout(() => finish(() => reject(timeoutError("$transaction commit", DB_QUERY_TIMEOUT_MS))), DB_QUERY_TIMEOUT_MS));
        return value;
      } catch (err) {
        // Give the engine 2 s to roll back; after that the caller learns what went wrong without waiting for it.
        timers.push(setTimeout(() => finish(() => reject(err)), 2_000));
        throw err;
      }
    };
    client.$transaction(wrapped, options).then(
      (value) => finish(() => resolve(value)),
      (err) => finish(() => reject(err)),
    );
  });
}

function createClient(): PrismaClient {
  const base = new PrismaClient({
    // undefined = Prisma reads DATABASE_URL itself (and complains at the first query when it is missing, as before).
    datasourceUrl: databaseUrlWithTimeouts(),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
  const extended = base.$extends({
    name: "database-deadline",
    query: {
      async $allOperations({ model, operation, args, query }) {
        return withDeadline(query(args), DB_QUERY_TIMEOUT_MS, `${model ?? "raw"}.${operation}`);
      },
    },
  });
  // Typed as the plain PrismaClient on purpose: the rest of the app (Pick<typeof prisma, ...>, Prisma.TransactionClient,
  // functions taking a PrismaClient) was written against that type, and the extension changes behaviour, not the API.
  return new Proxy(extended, {
    get(target, prop) {
      const value = Reflect.get(target, prop);
      if (prop === "$transaction") return (...args: unknown[]) => boundedTransaction(target as never, args);
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  }) as unknown as PrismaClient;
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
