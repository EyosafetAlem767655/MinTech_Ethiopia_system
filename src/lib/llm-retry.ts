import { isProviderBusy } from "@/lib/errors";

/**
 * Ask again when the AI provider is busy — after a minute, up to three times.
 *
 * Gemini's "high demand" 503 clears itself within a minute or two, which is
 * what the owner found by hand: wait a minute, press again, and it reads. This
 * does the waiting for them, so a receipt sent at a busy moment is read on the
 * second or third try instead of handing the person a blank form.
 *
 * Only a busy-ONLY failure is retried (`isProviderBusy`). A wrong key, a missing
 * model or an unreadable photo fails the same way a minute later, so those come
 * back at once.
 *
 * The caller runs this after Telegram has been answered (runAfter), inside the
 * webhook's maxDuration. `deadlineMs` keeps the last wait from starting when the
 * try after it could not finish before the function is cut off.
 */

export const BUSY_RETRIES = 3;
export const BUSY_WAIT_MS = 60_000;

export type Retryable<T> = { ok: true; data: T } | { ok: false; error: string };

export interface BusyRetryResult<T> {
  result: Retryable<T>;
  /** The last failure was "busy" and every retry was spent: the server is down for now. */
  gaveUp: boolean;
  attempts: number;
}

export async function readWithBusyRetry<T>(
  work: () => Promise<Retryable<T>>,
  opts: {
    /** Told before each wait — "busy, trying again in a minute (n/3)". */
    onWait?: (retry: number, of: number) => Promise<unknown> | unknown;
    /** Epoch ms after which no further wait starts. */
    deadlineMs?: number;
    /** How long one try can take, for the deadline check. */
    attemptMs?: number;
    waitMs?: number;
    retries?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {}
): Promise<BusyRetryResult<T>> {
  const retries = opts.retries ?? BUSY_RETRIES;
  const waitMs = opts.waitMs ?? BUSY_WAIT_MS;
  const attemptMs = opts.attemptMs ?? 45_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let result = await work();
  let attempts = 1;
  for (let retry = 1; retry <= retries; retry++) {
    if (result.ok || !isProviderBusy(result.error)) return { result, gaveUp: false, attempts };
    if (opts.deadlineMs !== undefined && Date.now() + waitMs + attemptMs > opts.deadlineMs) break;
    try {
      await opts.onWait?.(retry, retries);
    } catch (e) {
      console.warn("readWithBusyRetry: onWait failed:", e);
    }
    await sleep(waitMs);
    result = await work();
    attempts++;
  }
  return { result, gaveUp: !result.ok && isProviderBusy(result.error), attempts };
}
