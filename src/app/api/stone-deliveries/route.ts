import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/db";
import { StoneDelivery, StoredFile } from "@/lib/models";
import { scoreStonePhoto, type StoneScore } from "@/lib/llm";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const grades = ["good", "fair", "dark/weathered"] as const;

export async function GET() {
  await dbConnect();
  const [deliveries, summary] = await Promise.all([
    StoneDelivery.find().sort({ date: -1 }).limit(150).lean(),
    StoneDelivery.aggregate([{ $group: { _id: "$qualityGrade", loads: { $sum: "$loads" }, count: { $sum: 1 } } }]),
  ]);
  return NextResponse.json({ deliveries, summary });
}

export async function POST(req: NextRequest) {
  await dbConnect();
  const form = await req.formData();
  const truckPlate = String(form.get("truckPlate") || "").trim().toUpperCase();
  if (!truckPlate) return NextResponse.json({ error: "truckPlate is required" }, { status: 400 });

  let photoFileId;
  let aiScore: StoneScore | undefined;
  const photo = form.get("photo") as File | null;
  if (photo && photo.size > 0) {
    const buffer = Buffer.from(await photo.arrayBuffer());
    const stored = await StoredFile.create({
      data: buffer,
      contentType: photo.type || "image/jpeg",
      filename: photo.name,
      kind: "raw_material_photo",
    });
    photoFileId = stored._id;
    aiScore = await scoreStonePhoto(buffer.toString("base64"), stored.contentType);
  }

  const manualGrade = String(form.get("qualityGrade") || "");
  const qualityGrade = grades.includes(manualGrade as any)
    ? (manualGrade as (typeof grades)[number])
    : aiScore?.qualityGrade || "good";

  const delivery = await StoneDelivery.create({
    truckPlate,
    supplier: String(form.get("supplier") || "") || undefined,
    quarry: String(form.get("quarry") || "") || undefined,
    driverName: String(form.get("driverName") || "") || undefined,
    gateClerk: String(form.get("gateClerk") || "") || undefined,
    loads: Number(form.get("loads")) || 1,
    qualityGrade,
    photoFileId,
    aiScore,
    notes: String(form.get("notes") || "") || aiScore?.recommendation || undefined,
    date: new Date(),
  });

  return NextResponse.json({ ok: true, delivery });
}
