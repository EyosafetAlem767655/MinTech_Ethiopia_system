import { waitUntil } from "@vercel/functions";

/**
 * Keep work running after the response has been sent.
 *
 * This exists because the obvious version does not work. A serverless function
 * that fires an un-awaited promise and then returns has no guarantee the promise
 * ever finishes: Vercel freezes the instance the moment the response goes out,
 * and whatever was still in flight is simply gone. That is exactly what happened
 * to the sales flow — it answered Telegram, fired an un-awaited fetch at its own
 * scan worker, returned, and the read never started. The bot went silent and
 * nothing anywhere recorded why.
 *
 * `waitUntil` is the supported way to say "hold the invocation open for this".
 * The response is still sent immediately — which is what keeps Telegram from
 * redelivering the update — but the work is allowed to finish, up to the route's
 * `maxDuration`.
 *
 * Off Vercel (local `next dev`, a script) there is no request context and
 * `waitUntil` throws rather than doing nothing. The promise runs anyway there,
 * because the process is not going anywhere, so the throw is swallowed.
 */
export function runAfter(work: Promise<unknown>): void {
  // A rejection here must never surface as an unhandled rejection: background
  // work failing is a thing to log, not a thing to crash the invocation with.
  const guarded = Promise.resolve(work).catch((e) => {
    console.error("runAfter: background work failed:", e);
  });

  try {
    waitUntil(guarded);
  } catch {
    // No request context — nothing to extend. `guarded` is already running.
  }
}
