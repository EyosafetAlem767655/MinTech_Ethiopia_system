export interface SmsResult {
  ok: boolean;
  skipped: boolean;
  status?: number;
  error?: string;
}

export function smsGatewayConfigured(): boolean {
  return Boolean(process.env.SMS_GATEWAY_URL);
}

export async function sendSms(to: string, message: string): Promise<SmsResult> {
  const url = process.env.SMS_GATEWAY_URL;
  if (!url) return { ok: false, skipped: true, error: "SMS_GATEWAY_URL is not set" };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.SMS_GATEWAY_TOKEN
          ? { Authorization: `Bearer ${process.env.SMS_GATEWAY_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({
        to,
        message,
        sender: process.env.SMS_SENDER_ID || "MinTech",
      }),
    });

    return { ok: res.ok, skipped: false, status: res.status, error: res.ok ? undefined : await res.text() };
  } catch (e) {
    return { ok: false, skipped: false, error: e instanceof Error ? e.message : String(e) };
  }
}
