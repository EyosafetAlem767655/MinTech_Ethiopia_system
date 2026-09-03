import { envValue } from "@/lib/env";

/**
 * Outbound SMS through the Traccar SMS gateway app.
 *
 * The gateway is the company's own Android handset. It is reachable two ways and
 * they are NOT interchangeable:
 *
 *   cloud  https://www.traccar.org/sms/  with LONG_TOKEN
 *          Traccar's relay. The only route a serverless cron can use, because it
 *          is the only one on the public internet.
 *
 *   local  LOCAL_URL                     with SHORT_TOKEN
 *          The phone's own address on the office Wi-Fi. Unreachable from Vercel;
 *          useful when this code runs on the same network.
 *
 * Each has its OWN token — a long one for the relay, a short one for the device
 * — so the pairs are never mixed. Sending the wrong token to the wrong URL comes
 * back as a 401, which is why the two are kept together in one place.
 *
 * Auth is the raw token in the Authorization header, not Basic and not Bearer.
 * The body is a single `{ to, message }`.
 */

const CLOUD_URL = envValue("TRACCAR_CLOUD_URL") || "https://www.traccar.org/sms/";
const TIMEOUT_MS = Number(envValue("SMS_GATEWAY_TIMEOUT_MS")) || 15000;

export type SmsRoute = "cloud" | "local";

export interface SmsResult {
  ok: boolean;
  /** True when the gateway is not configured at all — not a failure to report. */
  skipped: boolean;
  status?: number;
  error?: string;
  /** Which endpoint delivered it. Recorded, so "it sent but nothing arrived" is answerable. */
  route?: SmsRoute;
}

export function smsGatewayConfigured(): boolean {
  return Boolean(envValue("LONG_TOKEN") || (envValue("LOCAL_URL") && envValue("SHORT_TOKEN")));
}

/** Which routes are actually usable right now, in the order they are tried. */
export function smsRoutes(): { route: SmsRoute; url: string; token: string }[] {
  const out: { route: SmsRoute; url: string; token: string }[] = [];
  const longToken = envValue("LONG_TOKEN");
  if (longToken) out.push({ route: "cloud", url: CLOUD_URL, token: longToken });
  const localUrl = envValue("LOCAL_URL");
  const shortToken = envValue("SHORT_TOKEN");
  if (localUrl && shortToken) out.push({ route: "local", url: localUrl, token: shortToken });
  return out;
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

async function postOnce(
  url: string,
  token: string,
  to: string,
  message: string
): Promise<{ ok: boolean; status?: number; error?: string }> {
  // Its own controller per attempt, so a local endpoint this host cannot see
  // costs one timeout rather than eating the budget for the whole run.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token },
      body: JSON.stringify({ to, message }),
      signal: ctrl.signal,
    });
    if (res.ok) return { ok: true, status: res.status };
    const body = (await res.text().catch(() => "")).slice(0, 300);
    // 401 here almost always means the token belongs to the other endpoint,
    // which is worth saying rather than leaving as a bare status code.
    const hint = res.status === 401 ? " (wrong token for this URL?)" : "";
    return { ok: false, status: res.status, error: `${body || `HTTP ${res.status}`}${hint}` };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return {
      ok: false,
      error: aborted ? `timed out after ${TIMEOUT_MS}ms` : e instanceof Error ? e.message : String(e),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Send one SMS, cloud first and local only as a fallback.
 *
 * The order is not arbitrary: from Vercel the local address is on a network the
 * function has never heard of, so trying it first would spend a timeout on every
 * single message before reaching the route that works.
 */
export async function sendSms(to: string, message: string): Promise<SmsResult> {
  const routes = smsRoutes();
  if (routes.length === 0) {
    return { ok: false, skipped: true, error: "LONG_TOKEN (or LOCAL_URL + SHORT_TOKEN) is not set" };
  }

  const phone = normalisePhone(to);
  if (!phone) return { ok: false, skipped: false, error: `unusable phone number: ${to}` };

  const failures: string[] = [];
  for (const { route, url, token } of routes) {
    const res = await postOnce(url, token, phone, message);
    if (res.ok) return { ok: true, skipped: false, status: res.status, route };
    failures.push(`${route}: ${res.error}`);
  }

  // Every route's reason is kept. "It failed" is not actionable; "cloud said 401
  // and local timed out" tells you which token to look at.
  return { ok: false, skipped: false, error: failures.join(" · ") };
}
