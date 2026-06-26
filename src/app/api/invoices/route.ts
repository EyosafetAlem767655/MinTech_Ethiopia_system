import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/db";
import { Invoice } from "@/lib/models";
import { daysBetween } from "@/lib/dates";
import { missingWithholding, receivablesAging } from "@/lib/metrics";

export const dynamic = "force-dynamic";

function serializeInvoice(inv: any, now = new Date()) {
  const paid = (inv.payments || []).reduce((sum: number, p: any) => sum + (Number(p.amount) || 0), 0);
  const outstanding = Math.max(0, Number(inv.amount) - paid);
  return {
    _id: String(inv._id),
    invoiceNumber: inv.invoiceNumber,
    client: inv.client,
    clientPhone: inv.clientPhone || "",
    sacks: inv.sacks || 0,
    amount: inv.amount || 0,
    paid,
    outstanding,
    daysOverdue: outstanding > 0 ? Math.max(0, daysBetween(new Date(inv.dueDate), now)) : 0,
    invoicedAt: inv.invoicedAt,
    dueDate: inv.dueDate,
    payments: inv.payments || [],
    withholdingReceiptReceived: !!inv.withholdingReceiptReceived,
    withholdingReceiptReceivedAt: inv.withholdingReceiptReceivedAt,
    reminders: inv.reminders || [],
    notes: inv.notes || "",
  };
}

export async function GET() {
  await dbConnect();
  const [invoices, aging, withholding] = await Promise.all([
    Invoice.find().sort({ dueDate: 1 }).limit(250).lean(),
    receivablesAging(),
    missingWithholding(),
  ]);
  return NextResponse.json({
    invoices: invoices.map((inv) => serializeInvoice(inv)),
    receivables: aging,
    missingWithholding: withholding,
  });
}

export async function POST(req: NextRequest) {
  await dbConnect();
  const body = await req.json();
  if (!body.invoiceNumber || !body.client || !body.amount || !body.dueDate) {
    return NextResponse.json({ error: "invoiceNumber, client, amount and dueDate are required" }, { status: 400 });
  }

  const bagWeightKg = [25, 40].includes(Number(body.bagWeightKg)) ? Number(body.bagWeightKg) : undefined;
  const invoice = await Invoice.create({
    invoiceNumber: String(body.invoiceNumber),
    client: String(body.client),
    clientPhone: body.clientPhone ? String(body.clientPhone) : undefined,
    sacks: Number(body.sacks) || 0,
    bagWeightKg,
    amount: Number(body.amount),
    invoicedAt: body.invoicedAt ? new Date(String(body.invoicedAt)) : new Date(),
    dueDate: new Date(String(body.dueDate)),
    withholdingReceiptReceived: !!body.withholdingReceiptReceived,
    withholdingReceiptReceivedAt: body.withholdingReceiptReceived ? new Date() : undefined,
    notes: body.notes ? String(body.notes) : undefined,
    payments: [],
    reminders: [],
  });

  return NextResponse.json({ ok: true, invoice: serializeInvoice(invoice.toObject()) });
}
