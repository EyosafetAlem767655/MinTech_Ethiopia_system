import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/sql";
import { putFile } from "@/lib/storage";
import { eatMonthRange, monthlySalesReport } from "@/lib/reports";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get("month") || undefined;
  const { start, end } = eatMonthRange(month);
  const [receipts, monthly] = await Promise.all([
    sql`
      select id as _id, vendor, client, amount, category,
             receipt_date as "receiptDate", tax_invoice_number as "taxInvoiceNumber",
             photo_file_id as "photoFileId", submitted_by as "submittedBy",
             source, legitimacy, created_at as "createdAt"
        from receipts
       where receipt_date >= ${start} and receipt_date < ${end}
       order by receipt_date desc, created_at desc
       limit 200
    `,
    monthlySalesReport(month),
  ]);
  return NextResponse.json({
    receipts: receipts.map((r: any) => ({ ...r, amount: Number(r.amount) })),
    monthly,
  });
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const vendor = String(form.get("vendor") || "");
  const amount = Number(form.get("amount"));
  if (!vendor || !amount) {
    return NextResponse.json({ error: "vendor and amount are required" }, { status: 400 });
  }

  let photoFileId: string | null = null;
  const photo = form.get("photo") as File | null;
  if (photo && photo.size > 0) {
    const stored = await putFile(Buffer.from(await photo.arrayBuffer()), photo.type || "image/jpeg", {
      kind: "receipt",
      filename: photo.name,
    });
    photoFileId = stored.id;
  }

  const [receipt] = await sql<{ id: string }[]>`
    insert into receipts
      (vendor, client, amount, category, receipt_date, tax_invoice_number, photo_file_id, submitted_by, source)
    values
      (${vendor}, ${String(form.get("client") || "") || null}, ${amount},
       ${String(form.get("category") || "") || null},
       ${form.get("receiptDate") ? new Date(String(form.get("receiptDate"))) : new Date()},
       ${String(form.get("taxInvoiceNumber") || "") || null}, ${photoFileId},
       ${String(form.get("submittedBy") || "accountant")}, 'app')
    returning id
  `;
  return NextResponse.json({ ok: true, id: receipt.id });
}
