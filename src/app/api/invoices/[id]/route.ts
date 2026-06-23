import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/db";
import { Invoice } from "@/lib/models";
import { sendSms } from "@/lib/sms";

export const dynamic = "force-dynamic";

function outstandingFor(inv: any) {
  const paid = (inv.payments || []).reduce((sum: number, p: any) => sum + (Number(p.amount) || 0), 0);
  return Math.max(0, Number(inv.amount) - paid);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  await dbConnect();
  const body = await req.json();
  const invoice = await Invoice.findById(params.id);
  if (!invoice) return NextResponse.json({ error: "not found" }, { status: 404 });

  switch (body.action) {
    case "add_payment":
      if (!body.amount) return NextResponse.json({ error: "amount is required" }, { status: 400 });
      invoice.payments = invoice.payments || [];
      invoice.payments.push({
        amount: Number(body.amount),
        date: body.date ? new Date(String(body.date)) : new Date(),
        method: body.method ? String(body.method) : "bank",
      });
      break;
    case "mark_wht":
      invoice.withholdingReceiptReceived = body.received !== false;
      invoice.withholdingReceiptReceivedAt = invoice.withholdingReceiptReceived ? new Date() : undefined;
      break;
    case "send_sms": {
      const to = String(body.to || invoice.clientPhone || "");
      if (!to) return NextResponse.json({ error: "client phone is required" }, { status: 400 });
      const outstanding = outstandingFor(invoice);
      const message =
        body.message ||
        `MinTech reminder: invoice ${invoice.invoiceNumber} has ETB ${Math.round(outstanding).toLocaleString()} outstanding. Please settle payment and send the 3% WHT receipt.`;
      const result = await sendSms(to, String(message));
      invoice.clientPhone = to;
      invoice.reminders = [
        ...(invoice.reminders || []),
        {
          channel: "sms",
          to,
          sentAt: new Date(),
          status: result.ok ? "sent" : result.skipped ? "skipped" : `failed:${result.status || "network"}`,
        },
      ];
      await invoice.save();
      return NextResponse.json({ ok: result.ok, sms: result, reminders: invoice.reminders });
    }
    default:
      return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }

  await invoice.save();
  return NextResponse.json({ ok: true });
}
