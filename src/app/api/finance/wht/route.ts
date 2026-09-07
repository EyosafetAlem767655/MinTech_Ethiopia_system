import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/sql";
import { normalisePhone, sendSms, smsDiagnostics, smsGatewayConfigured, smsSender } from "@/lib/sms";
import { chaseHolder } from "@/lib/wht-sms";

export const dynamic = "force-dynamic";

/** GET — WHT receipt holders, still-pending first, with how often each was chased. */
export async function GET() {
  try {
    const rows = await sql<Record<string, unknown>[]>`
      select h.id as _id, h.company, h.phone, h.description, h.status,
             h.registered_by as "registeredBy", h.resolved_by as "resolvedBy",
             h.resolved_at as "resolvedAt", h.created_at as "createdAt",
             (select count(*) from wht_sms_log l where l.holder_id = h.id and l.ok) as "smsSent",
             (select max(sent_on) from wht_sms_log l where l.holder_id = h.id and l.ok) as "lastSmsOn",
             (select l.error from wht_sms_log l
               where l.holder_id = h.id and not l.ok
               order by l.sent_on desc limit 1) as "lastError"
        from wht_holders h
       order by (h.status = 'pending') desc, h.created_at desc
       limit 200
    `;
    return NextResponse.json({
      smsConfigured: smsGatewayConfigured(),
      // What the gateway will actually use. Shown on the panel so a wrong or
      // half-pasted key is visible without registering a customer to find out.
      sms: smsDiagnostics(),
      rows: rows.map((r) => ({ ...r, smsSent: Number(r.smsSent) || 0 })),
    });
  } catch (e) {
    if ((e as { code?: string })?.code === "42P01") {
      return NextResponse.json({ smsConfigured: smsGatewayConfigured(), sms: smsDiagnostics(), rows: [] });
    }
    throw e;
  }
}

/**
 * PUT — send one test message, to prove the gateway works before a customer
 * depends on it.
 *
 * Deliberately NOT through `chaseHolder`: that claims a holder's day, and a test
 * must never be the reason a real customer goes unchased.
 */
export async function PUT(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { to?: string };
  const to = normalisePhone(String(body.to || "")) || smsSender();
  if (!to) {
    return NextResponse.json({ error: "Enter a number to test with, e.g. 0912345678." }, { status: 400 });
  }

  const res = await sendSms(to, "MinTech Ethiopia: SMS gateway test. No action needed.");
  return NextResponse.json({
    ok: res.ok,
    to,
    status: res.status ?? null,
    error: res.error ?? null,
    messageId: res.messageId ?? null,
    sms: smsDiagnostics(),
  });
}

/** POST — register a holder from the dashboard, the same as the bot flow does. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const company = String(body.company || "").trim();
  const phoneRaw = String(body.phone || "").trim();
  const description = String(body.description || "").trim();

  if (!company) return NextResponse.json({ error: "Company name is required." }, { status: 400 });

  // Normalised here as well as in the bot, so the same customer registered from
  // either side is one row rather than two the chaser treats separately.
  const phone = normalisePhone(phoneRaw);
  if (!phone) {
    return NextResponse.json(
      { error: "Enter a valid phone number, e.g. 0912345678 or +251912345678." },
      { status: 400 }
    );
  }

  const [row] = await sql<{ id: string }[]>`
    insert into wht_holders (company, phone, description, registered_by, source)
    values (${company}, ${phone}, ${description || null}, 'Dashboard', 'app')
    returning id
  `;

  // Chased immediately, not at tomorrow's cron. httpSMS takes the message onto
  // its own queue and the handset delivers it the next time it has internet, so
  // "immediately" holds even when the phone is out of coverage right now.
  //
  // Awaited, so the dashboard can say whether it went — the person registering
  // is standing there and a silent failure would be found days later. The claim
  // inside chaseHolder also takes today's slot, so the cron will skip this
  // holder tomorrow morning rather than texting them a second time.
  const sms = await chaseHolder({ id: row.id, company, phone, description }).catch(() => null);

  return NextResponse.json({
    ok: true,
    id: row.id,
    sms: sms ? { sent: sms.ok, skipped: sms.skipped, error: sms.error ?? null } : null,
  });
}
