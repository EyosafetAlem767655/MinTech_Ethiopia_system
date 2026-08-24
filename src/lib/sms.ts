import { envValue } from "@/lib/env";

/**
 * Outbound SMS through SMS Gateway for Android (sms-gate.app).
 *
 * The gateway is the company's own Android handset running the app, reached
 * through the vendor's cloud relay. It authenticates with HTTP Basic using the
 * username and password the app displays on setup — not a bearer token — and
 * takes a list of recipients rather than a single `to`, which is why this module
 * does not look like a typical REST client.
 *
 * Every send is bounded by an AbortController: this runs inside a cron with a
 * function time limit, and one unresponsive handset must not be able to stall
 * the whole run before the remaining recipients are reached.
 */

const DEFAULT_URL = "https://api.sms-gate.app/3rdparty/v1/message";
const TIMEOUT_MS = Number(envValue("SMS_GATEWAY_TIMEOUT_MS")) || 15000;

export interface SmsResult {
  ok: boolean;
  /** True when the gateway is not configured at all — not a failure to report. */
  skipped: boolean;
  status?: number;
  error?: string;
  /** The gateway's own id for the message, when it returns one. */
  messageId?: string;
}

export function smsGatewayConfigured(): boolean {
  return Boolean(envValue("SMS_GATEWAY_USER") && envValue("SMS_GATEWAY_PASSWORD"));
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

export async function sendSms(to: string, message: string): Promise<SmsResult> {
  const user = envValue("SMS_GATEWAY_USER");
  const password = envValue("SMS_GATEWAY_PASSWORD");
  if (!user || !password) {
    return { ok: false, skipped: true, error: "SMS_GATEWAY_USER / SMS_GATEWAY_PASSWORD are not set" };
  }

  const phone = normalisePhone(to);
  if (!phone) return { ok: false, skipped: false, error: `unusable phone number: ${to}` };

  // Overridable so the same code works against a self-hosted or on-device
  // server, which the app also offers.
  const url = envValue("SMS_GATEWAY_URL") || DEFAULT_URL;
  const auth = Buffer.from(`${user}:${password}`).toString("base64");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
      body: JSON.stringify({ message, phoneNumbers: [phone] }),
      signal: ctrl.signal,
    });

    if (!res.ok) {
      const body = (await res.text().catch(() => "")).slice(0, 300);
      return { ok: false, skipped: false, status: res.status, error: body || `HTTP ${res.status}` };
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { ok: true, skipped: false, status: res.status, messageId: data?.id };
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
