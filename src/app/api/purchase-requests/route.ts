import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/db";
import { PurchaseRequest, StoredFile } from "@/lib/models";

export const dynamic = "force-dynamic";

export async function GET() {
  await dbConnect();
  const prs = await PurchaseRequest.find().sort({ createdAt: -1 }).limit(100).lean();
  return NextResponse.json(prs);
}

export async function POST(req: NextRequest) {
  await dbConnect();
  const form = await req.formData();
  const title = String(form.get("title") || "");
  const amount = Number(form.get("amount"));
  const requestedBy = String(form.get("requestedBy") || "");
  if (!title || !amount || !requestedBy) {
    return NextResponse.json({ error: "title, amount and requestedBy are required" }, { status: 400 });
  }
  let photoFileId;
  const photo = form.get("photo") as File | null;
  if (photo && photo.size > 0) {
    const stored = await StoredFile.create({
      data: Buffer.from(await photo.arrayBuffer()),
      contentType: photo.type || "image/jpeg",
      filename: photo.name,
      kind: "purchase_request",
    });
    photoFileId = stored._id;
  }
  const pr = await PurchaseRequest.create({
    title,
    amount,
    requestedBy,
    justification: String(form.get("justification") || "") || undefined,
    photoFileId,
    source: "app",
  });
  return NextResponse.json({ ok: true, id: pr._id });
}
