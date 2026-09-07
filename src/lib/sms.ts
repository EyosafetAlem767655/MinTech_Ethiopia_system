import { envValue } from "@/lib/env";

/**
 * Outbound SMS through httpSMS.
 *
 * The gateway is still the company's own Android handset, but it now works the
 * other way round. Traccar's relay had to reach the phone at the moment of
 * sending, so a message could only go out while the handset happened to be
 * reachable — and from a serverless cron that was often not true. httpSMS
 * accepts the message onto its own queue and the handset pulls it down the next
 * time it has internet.
 *
 * That is the whole reason for the move: a WHT holder registered at 4pm gets
 * their text at 4pm rather than at whatever hour a cron next ran and found the
 * phone awake.
 *
 *   POST {SERVER_URL}/v1/messages/send
 *   x-api-key: HTTPSMS_API_KEY
 *   { "from": PHONE_NUMBER, "to": "+2519…", "content": "…" }
 *
 * `from` must be the number registered in the httpSMS app on the handset — the
 * API rejects anything else, and it rejects a local-format number outright,
 * which is why it goes through normalisePhone like every recipient does.
 */

const DEFAULT_BASE = "https://api.httpsms.com";
const TIMEOUT_MS = Number(envValue("SMS_GATEWAY_TIMEOUT_MS")) || 15000;

/**
 * Kept as a type so `wht_sms_log.route` keeps meaning "which gateway delivered
 * this". There is one route now; the column still answers the question when the
 * next gateway arrives.
 */
export type SmsRoute = "httpsms";

export interface SmsResult {
  ok: boolean;
  /** True when the gateway is not configured at all — not a failure to report. */
  skipped: boolean;
  status?: number;
  error?: string;
  /** Which endpoint delivered it. Recorded, so "it sent but nothing arrived" is answerable. */
  route?: SmsRoute;
  /** httpSMS's own message id, for looking a message up in their dashboard. */
  messageId?: string;
}

export function smsGatewayConfigured(): boolean {
  return Boolean(envValue("HTTPSMS_API_KEY") && envValue("PHONE_NUMBER"));
}

/**
 * The send endpoint.
 *
 * SERVER_URL is accepted as either the API base or the full send path, because
 * both are plausible things to have put in the variable and guessing wrong is a
 * 404 that looks like an outage.
 */
export function smsEndpoint(): string {
  const raw = (envValue("SERVER_URL") || DEFAULT_BASE).trim().replace(/\/+$/, "");
  if (/\/messages\/send$/.test(raw)) return raw;
  if (/\/v1$/.test(raw)) return `${raw}/messages/send`;
  return `${raw}/v1/messages/send`;
}

/**
 * Normalise an Ethiopian number to E.164.
 *
 * The gateway rejects local formats, and a number stored two ways would look
 * like two different customers to anything counting how often we have chased
 * them.
 */
export function normalisePhone(raw: string): string | null {
  const cleaned = (raw || "").replace(/[\s\-()]/g, "");
  if (/^0\d{9}$/.test(cleaned)) return `+251${cleaned.slice(1)}`;
  if (/^251\d{9}$/.test(cleaned)) return `+${cleaned}`;
  if (/^\+251\d{9}$/.test(cleaned)) return cleaned;
  // Any other country code that already looks like E.164 is passed through.
  if (/^\+\d{8,15}$/.test(cleaned)) return cleaned;
  return null;
}

/**
 * Send one SMS.
 *
 * A 200 here means httpSMS accepted the message onto its queue, NOT that it has
 * been delivered — the handset sends it when it next has a connection. That
 * distinction is worth keeping in mind when reading `wht_sms_log`: `ok` records
 * that the request was accepted.
 */
export async function sendSms(to: string, message: string): Promise<SmsResult> {
  const apiKey = envValue("HTTPSMS_API_KEY");
  const fromRaw = envValue("PHONE_NUMBER");
  if (!apiKey || !fromRaw) {
    return { ok: false, skipped: true, error: "HTTPSMS_API_KEY and PHONE_NUMBER are not set" };
  }

  const from = normalisePhone(fromRaw);
  if (!from) {
    return { ok: false, skipped: false, error: `PHONE_NUMBER is not a usable sender: ${fromRaw}` };
  }

  const phone = normalisePhone(to);
  if (!phone) return { ok: false, skipped: false, error: `unusable phone number: ${to}` };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(smsEndpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({ from, to: phone, content: message }),
      signal: ctrl.signal,
    });

    const body = await res.text().catch(() => "");
    if (res.ok) {
      let messageId: string | undefined;
      try {
        messageId = JSON.parse(body)?.data?.id;
      } catch {
        // The id is a convenience for looking the message up later, not
        // something the send depends on.
      }
      return { ok: true, skipped: false, status: res.status, route: "httpsms", messageId };
    }

    // 401 is the wrong API key, 422 is almost always a `from` that is not the
    // number registered on the handset. Both are worth saying rather than
    // leaving as a bare status code.
    const hint =
      res.status === 401
        ? " (check HTTPSMS_API_KEY)"
        : res.status === 422
        ? " (is PHONE_NUMBER the number registered in the httpSMS app?)"
        : "";
    return { ok: false, skipped: false, status: res.status, error: `${body.slice(0, 300) || `HTTP ${res.status}`}${hint}` };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return {
      ok: false,
      skipped: false,
      error: aborted ? `timed out after ${TIMEOUT_MS}ms` : e instanceof Error ? e.message : String(e),
    };
  } finally {
    clearTimeout(timer);
  }
}
