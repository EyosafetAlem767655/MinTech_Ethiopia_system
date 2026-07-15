import { NextRequest, NextResponse } from "next/server";
import sql, { jsonb } from "@/lib/sql";
import { putFile } from "@/lib/storage";
import { scoreStonePhoto, type StoneScore } from "@/lib/llm";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const grades = ["good", "fair", "dark/weathered"] as const;

export async function GET() {
  const [deliveries, summary] = await Promise.all([
    sql`
      select id as _id, truck_plate as "truckPlate", supplier, quarry, driver_name as "driverName",
             gate_clerk as "gateClerk", loads, quality_grade as "qualityGrade",
             photo_file_id as "photoFileId", ai_score as "aiScore", notes, date, created_at as "createdAt"
        from stone_deliveries
       order by date desc
       limit 150
    `,
    sql`select quality_grade as _id, sum(loads)::int as loads, count(*)::int as count
          from stone_deliveries group by quality_grade`,
  ]);
  return NextResponse.json({ deliveries, summary });
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const truckPlate = String(form.get("truckPlate") || "").trim().toUpperCase();
  if (!truckPlate) return NextResponse.json({ error: "truckPlate is required" }, { status: 400 });

  let photoFileId: string | null = null;
  let aiScore: StoneScore | undefined;
  const photo = form.get("photo") as File | null;
  if (photo && photo.size > 0) {
    const buffer = Buffer.from(await photo.arrayBuffer());
    const contentType = photo.type || "image/jpeg";
    const stored = await putFile(buffer, contentType, { kind: "raw_material_photo", filename: photo.name });
    photoFileId = stored.id;
    aiScore = await scoreStonePhoto(buffer.toString("base64"), contentType);
  }

  const manualGrade = String(form.get("qualityGrade") || "");
  const qualityGrade = grades.includes(manualGrade as any)
    ? (manualGrade as (typeof grades)[number])
    : aiScore?.qualityGrade || "good";

  const [delivery] = await sql`
    insert into stone_deliveries
      (truck_plate, supplier, quarry, driver_name, gate_clerk, loads, quality_grade, photo_file_id, ai_score, notes)
    values
      (${truckPlate}, ${String(form.get("supplier") || "") || null}, ${String(form.get("quarry") || "") || null},
       ${String(form.get("driverName") || "") || null}, ${String(form.get("gateClerk") || "") || null},
       ${Number(form.get("loads")) || 1}, ${qualityGrade}, ${photoFileId},
       ${aiScore ? jsonb(aiScore) : null},
       ${String(form.get("notes") || "") || aiScore?.recommendation || null})
    returning id as _id, truck_plate as "truckPlate", quality_grade as "qualityGrade", loads
  `;
  return NextResponse.json({ ok: true, delivery });
}
