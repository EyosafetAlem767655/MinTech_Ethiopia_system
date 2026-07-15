import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/sql";
import { missingWithholding, receivablesAging } from "@/lib/metrics";

export const dynamic = "force-dynamic";

// Returns invoices with payments/reminders nested (they are child tables now),
// plus the derived paid/outstanding/daysOverdue the receivables page reads.
async function listInvoices() {
  return sql`
    with pay as (
      select invoice_id, coalesce(sum(amount), 0) as paid,
             coalesce(jsonb_agg(jsonb_build_object('amount', amount, 'date', date, 'method', method)
                                order by date), '[]'::jsonb) as payments
        from payments group by invoice_id
    ),
    rem as (
      select invoice_id,
             coalesce(jsonb_agg(jsonb_build_object('channel', channel, 'to', to_addr, 'sentAt', sent_at, 'status', status)
                                order by sent_at), '[]'::jsonb) as reminders
        from invoice_reminders group by invoice_id
    )
    select i.id as _id, i.invoice_number as "invoiceNumber", i.client,
           coalesce(i.client_phone, '') as "clientPhone", i.sacks, i.amount,
           coalesce(pay.paid, 0) as paid,
           greatest(0, i.amount - coalesce(pay.paid, 0)) as outstanding,
           case when i.amount - coalesce(pay.paid, 0) > 0
                then greatest(0, (current_date - i.due_date::date)) else 0 end as "daysOverdue",
           i.invoiced_at as "invoicedAt", i.due_date as "dueDate",
           coalesce(pay.payments, '[]'::jsonb) as payments,
           i.withholding_receipt_received as "withholdingReceiptReceived",
           i.withholding_receipt_received_at as "withholdingReceiptReceivedAt",
           coalesce(rem.reminders, '[]'::jsonb) as reminders,
           coalesce(i.notes, '') as notes
      from invoices i
      left join pay on pay.invoice_id = i.id
      left join rem on rem.invoice_id = i.id
     order by i.due_date asc
     limit 250
  `;
}

export async function GET() {
  const [invoices, aging, withholding] = await Promise.all([
    listInvoices(),
    receivablesAging(),
    missingWithholding(),
  ]);
  return NextResponse.json({
    invoices: invoices.map((inv: any) => ({ ...inv, amount: Number(inv.amount), paid: Number(inv.paid), outstanding: Number(inv.outstanding) })),
    receivables: aging,
    missingWithholding: withholding,
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.invoiceNumber || !body.client || !body.amount || !body.dueDate) {
    return NextResponse.json({ error: "invoiceNumber, client, amount and dueDate are required" }, { status: 400 });
  }
  const bagWeightKg = [25, 40].includes(Number(body.bagWeightKg)) ? Number(body.bagWeightKg) : null;

  const [inv] = await sql<{ id: string }[]>`
    insert into invoices
      (invoice_number, client, client_phone, sacks, bag_weight_kg, amount,
       invoiced_at, due_date, withholding_receipt_received, withholding_receipt_received_at, notes)
    values
      (${String(body.invoiceNumber)}, ${String(body.client)}, ${body.clientPhone ? String(body.clientPhone) : null},
       ${Number(body.sacks) || 0}, ${bagWeightKg}, ${Number(body.amount)},
       ${body.invoicedAt ? new Date(String(body.invoicedAt)) : new Date()}, ${new Date(String(body.dueDate))},
       ${!!body.withholdingReceiptReceived}, ${body.withholdingReceiptReceived ? new Date() : null},
       ${body.notes ? String(body.notes) : null})
    returning id
  `;
  return NextResponse.json({ ok: true, id: inv.id });
}
