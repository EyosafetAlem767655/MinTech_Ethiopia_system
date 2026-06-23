import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/db";
import { Receipt, StoredFile } from "@/lib/models";
import { eatMonthRange, monthlySalesReport } from "@/lib/reports";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  await dbConnect();
  const month = req.nextUrl.searchParams.get("month") || undefined;
  const { start, end } = eatMonthRange(month);
  const [receipts, monthly] = await Promise.all([
    Receipt.find({ receiptDate: { $gte: start, $lt: end } }).sort({ receiptDate: -1, createdAt: -1 }).limit(200).lean(),
    monthlySalesReport(month),
  ]);
  return NextResponse.json({ receipts, monthly });
}

export async function POST(req: NextRequest) {
  await dbConnect();
  const form = await req.formData();
  const vendor = String(form.get("vendor") || "");
  const amount = Number(form.get("amount"));
  if (!vendor || !amount) {
    return NextResponse.json({ error: "vendor and amount are required" }, { status: 400 });
  }

  let photoFileId;
  const photo = form.get("photo") as File | null;
  if (photo && photo.size > 0) {
    const stored = await StoredFile.create({
      data: Buffer.from(await photo.arrayBuffer()),
      contentType: photo.type || "image/jpeg",
      filename: photo.name,
      kind: "receipt",
    });
    photoFileId = stored._id;
  }

  const receipt = await Receipt.create({
    vendor,
    client: String(form.get("client") || "") || undefined,
    amount,
    category: String(form.get("category") || "") || undefined,
    receiptDate: form.get("receiptDate") ? new Date(String(form.get("receiptDate"))) : new Date(),
    taxInvoiceNumber: String(form.get("taxInvoiceNumber") || "") || undefined,
    photoFileId,
    submittedBy: String(form.get("submittedBy") || "accountant"),
    source: "app",
  });

  return NextResponse.json({ ok: true, id: receipt._id });
}
