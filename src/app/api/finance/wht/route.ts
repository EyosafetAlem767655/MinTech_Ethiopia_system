import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/sql";
import { normalisePhone, smsGatewayConfigured } from "@/lib/sms";

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
      rows: rows.map((r) => ({ ...r, smsSent: Number(r.smsSent) || 0 })),
    });
  } catch (e) {
    if ((e as { code?: string })?.code === "42P01") {
      return NextResponse.json({ smsConfigured: smsGatewayConfigured(), rows: [] });
    }
    throw e;
  }
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
  return NextResponse.json({ ok: true, id: row.id });
}
