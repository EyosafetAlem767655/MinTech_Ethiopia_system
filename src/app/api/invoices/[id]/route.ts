import { NextRequest, NextResponse } from "next/server";
import sql, { first, isUuid } from "@/lib/sql";
import { sendSms } from "@/lib/sms";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isUuid(params.id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json();

  const invoice = first(await sql<{ id: string; invoice_number: string; amount: string; client_phone: string | null }[]>`
    select id, invoice_number, amount, client_phone from invoices where id = ${params.id}
  `);
  if (!invoice) return NextResponse.json({ error: "not found" }, { status: 404 });

  switch (body.action) {
    case "add_payment": {
      if (!body.amount) return NextResponse.json({ error: "amount is required" }, { status: 400 });
      await sql`
        insert into payments (invoice_id, amount, date, method)
        values (${invoice.id}, ${Number(body.amount)},
                ${body.date ? new Date(String(body.date)) : new Date()},
                ${body.method ? String(body.method) : "bank"})
      `;
      return NextResponse.json({ ok: true });
    }
    case "mark_wht": {
      const received = body.received !== false;
      await sql`
        update invoices set
          withholding_receipt_received = ${received},
          withholding_receipt_received_at = ${received ? new Date() : null}
        where id = ${invoice.id}
      `;
      return NextResponse.json({ ok: true });
    }
    case "send_sms": {
      const to = String(body.to || invoice.client_phone || "");
      if (!to) return NextResponse.json({ error: "client phone is required" }, { status: 400 });

      const [{ outstanding }] = await sql<{ outstanding: string }[]>`
        select ${invoice.amount}::numeric - coalesce(sum(p.amount), 0) as outstanding
          from payments p where p.invoice_id = ${invoice.id}
      `;
      const message =
        body.message ||
        `MinTech reminder: invoice ${invoice.invoice_number} has ETB ${Math.round(
          Number(outstanding)
        ).toLocaleString()} outstanding. Please settle payment and send the 3% WHT receipt.`;
      const result = await sendSms(to, String(message));
      const status = result.ok ? "sent" : result.skipped ? "skipped" : `failed:${result.status || "network"}`;

      await sql`update invoices set client_phone = ${to} where id = ${invoice.id}`;
      await sql`
        insert into invoice_reminders (invoice_id, channel, to_addr, sent_at, status)
        values (${invoice.id}, 'sms', ${to}, now(), ${status})
      `;
      const reminders = await sql`
        select channel, to_addr as "to", sent_at as "sentAt", status
          from invoice_reminders where invoice_id = ${invoice.id} order by sent_at
      `;
      return NextResponse.json({ ok: result.ok, sms: result, reminders });
    }
    default:
      return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }
}
