import { NextRequest, NextResponse } from "next/server";
import sql, { isUuid } from "@/lib/sql";
import { creditFigures, customerExposure, type CreditRowLike } from "@/lib/credit";

export const dynamic = "force-dynamic";

/**
 * Credit sales and their collection.
 *
 * The rows come from `sales_invoices` — every sale with something on credit —
 * and the payments from `sales_credit_payments`. What is outstanding, when it
 * falls due and whether it is late are all computed in `src/lib/credit.ts`, by
 * the same code the panel uses, so the table and its totals cannot disagree.
 */

interface PaymentRow {
  id: string;
  amount: number;
  collectedOn: string;
  note: string | null;
  recordedBy: string;
}

/** One invoice with its payment history, ready for the panel. */
async function loadRows() {
  const invoices = await sql<Record<string, unknown>[]>`
    select i.id as "_id", i.date, i.customer, i.qty, i.invoice_credit as "invoiceCredit",
           i.invoice_cash as "invoiceCash", i.delivery_no as "deliveryNo", i.bank,
           i.reported_by as "reportedBy",
           coalesce((select sum(p.amount) from sales_credit_payments p where p.invoice_id = i.id), 0) as "paid"
      from sales_invoices i
     where i.invoice_credit > 0
     order by i.date desc
     limit 500
  `;
  if (invoices.length === 0) return [];

  const ids = invoices.map((r) => String(r._id));
  const payments = await sql<Record<string, unknown>[]>`
    select id, invoice_id as "invoiceId", amount, collected_on as "collectedOn",
           note, recorded_by as "recordedBy"
      from sales_credit_payments
     where invoice_id = any(${ids})
     order by collected_on, created_at
  `;

  const byInvoice = new Map<string, PaymentRow[]>();
  for (const p of payments) {
    const key = String(p.invoiceId);
    byInvoice.set(key, [
      ...(byInvoice.get(key) ?? []),
      {
        id: String(p.id),
        amount: Number(p.amount) || 0,
        collectedOn: String(p.collectedOn).slice(0, 10),
        note: (p.note as string) ?? null,
        recordedBy: String(p.recordedBy),
      },
    ]);
  }

  return invoices.map((r) => {
    const f = creditFigures(
      { date: String(r.date), invoiceCredit: Number(r.invoiceCredit) || 0, paid: Number(r.paid) || 0 },
      new Date()
    );
    return {
      _id: String(r._id),
      date: String(r.date),
      customer: String(r.customer || ""),
      qty: Number(r.qty) || 0,
      invoiceCash: Number(r.invoiceCash) || 0,
      deliveryNo: (r.deliveryNo as string) ?? null,
      bank: (r.bank as string) ?? null,
      reportedBy: String(r.reportedBy || ""),
      credit: f.credit,
      paid: f.paid,
      outstanding: f.outstanding,
      dueDate: f.dueDate.toISOString().slice(0, 10),
      daysLeft: f.daysLeft,
      status: f.status,
      payments: byInvoice.get(String(r._id)) ?? [],
    };
  });
}

const EMPTY = { rows: [], customers: [], totals: { outstanding: 0, overdue: 0, dueSoon: 0, alarms: 0 }, unavailable: true };

export async function GET() {
  try {
    const rows = await loadRows();
    const customers = customerExposure(rows as CreditRowLike[]);
    const totals = {
      outstanding: Math.round(rows.reduce((a, r) => a + r.outstanding, 0) * 100) / 100,
      overdue: rows.filter((r) => r.status === "overdue").length,
      dueSoon: rows.filter((r) => r.status === "due_soon").length,
      alarms: customers.filter((c) => c.alarm).length,
    };
    return NextResponse.json({ rows, customers, totals, unavailable: false });
  } catch (e) {
    // sales_credit_payments arrives in 0029 and sales_invoices in 0027. Either
    // missing is an empty tab with a note, never a 500 that takes the whole
    // Finance page down with it.
    if ((e as { code?: string })?.code === "42P01") return NextResponse.json(EMPTY);
    throw e;
  }
}

/** POST — record money collected against one credit sale. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const invoiceId = String(body.invoiceId || "");
  const amount = Math.round((Number(body.amount) || 0) * 100) / 100;

  if (!isUuid(invoiceId)) return NextResponse.json({ error: "Unknown invoice." }, { status: 400 });
  if (!(amount > 0)) return NextResponse.json({ error: "Enter an amount greater than zero." }, { status: 400 });

  // The date the money came in, which is not always today. Validated rather
  // than trusted: a malformed date would land as a Postgres error the panel
  // could only report as "something went wrong".
  const collectedOn = String(body.collectedOn || "").trim();
  if (collectedOn && !/^\d{4}-\d{2}-\d{2}$/.test(collectedOn)) {
    return NextResponse.json({ error: "The collection date must look like 2026-09-23." }, { status: 400 });
  }

  try {
    const invoice = await sql<{ id: string }[]>`select id from sales_invoices where id = ${invoiceId}`;
    if (invoice.length === 0) return NextResponse.json({ error: "That sale no longer exists." }, { status: 404 });

    // The date is always sent rather than left to the column default, so the
    // statement is one fixed shape. Building a variable column list here would
    // mean interpolating an identifier into an insert, which is exactly the
    // postgres.js trap `insertRow` exists to avoid.
    const day = collectedOn || new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);

    await sql`
      insert into sales_credit_payments (invoice_id, amount, collected_on, note, recorded_by)
      values (${invoiceId}, ${amount}, ${day}::date,
              ${String(body.note || "").trim() || null},
              ${String(body.recordedBy || "Dashboard").trim() || "Dashboard"})
    `;
    return NextResponse.json({ ok: true });
  } catch (e) {
    if ((e as { code?: string })?.code === "42P01") {
      return NextResponse.json({ error: "Run migration 0029 — the payments table is not there yet." }, { status: 503 });
    }
    throw e;
  }
}

/**
 * DELETE ?paymentId= — undo a payment that was keyed wrongly.
 *
 * The only correction path, deliberately. A payment row is three fields; fixing
 * a mistake by removing it and entering it again leaves a history anyone can add
 * up, where an edited amount leaves one that no longer explains itself.
 */
export async function DELETE(req: NextRequest) {
  const paymentId = req.nextUrl.searchParams.get("paymentId") || "";
  if (!isUuid(paymentId)) return NextResponse.json({ error: "Unknown payment." }, { status: 400 });

  try {
    const gone = await sql<{ id: string }[]>`
      delete from sales_credit_payments where id = ${paymentId} returning id
    `;
    if (gone.length === 0) return NextResponse.json({ error: "That payment is already gone." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if ((e as { code?: string })?.code === "42P01") return NextResponse.json({ error: "Nothing to delete." }, { status: 404 });
    throw e;
  }
}
