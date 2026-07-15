import { NextRequest, NextResponse } from "next/server";
import sql, { first, isUuid } from "@/lib/sql";
import { findClaims, insertClaimPhotos, processClaimPhoto, type ClaimPhotoData } from "@/lib/claims";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  return NextResponse.json(await findClaims({ limit: 100 }));
}

/**
 * Worker submits a damage claim from the PWA. The client enforces live camera
 * capture, watermarks the photo, and attaches GPS/timestamp/device/worker.
 * Server runs the full evidence pipeline (AI inspection, perceptual-hash
 * duplicate detection, EXIF checks) via processClaimPhoto.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const lotId = String(form.get("lotId") || "");
  const quantity = Number(form.get("quantity"));
  const worker = String(form.get("worker") || "");
  if (!lotId || !quantity || !worker) {
    return NextResponse.json({ error: "lotId, quantity and worker are required" }, { status: 400 });
  }
  if (!isUuid(lotId)) return NextResponse.json({ error: "lot not found" }, { status: 404 });

  const lot = first(await sql<{ id: string; bag_type: string }[]>`
    select id, bag_type from bag_lots where id = ${lotId}
  `);
  if (!lot) return NextResponse.json({ error: "lot not found" }, { status: 404 });

  const photos: ClaimPhotoData[] = [];
  const flags = new Set<string>();
  for (const entry of form.getAll("photos")) {
    const file = entry as File;
    if (!file || file.size === 0) continue;
    const processed = await processClaimPhoto(
      Buffer.from(await file.arrayBuffer()),
      file.type || "image/jpeg",
      lot.bag_type
    );
    photos.push(processed.photo);
    processed.flags.forEach((f) => flags.add(f));
  }
  if (photos.length === 0) {
    return NextResponse.json({ error: "at least one live photo is required" }, { status: 400 });
  }

  const lat = Number(form.get("lat"));
  const lng = Number(form.get("lng"));
  const shift = String(form.get("shift") || "") || null;
  const deviceId = String(form.get("deviceId") || "") || null;

  const [claim] = await sql<{ id: string }[]>`
    insert into damage_claims
      (lot_id, quantity, source, worker, shift, gps_lat, gps_lng, device_id, captured_at, flags, status)
    values
      (${lot.id}, ${quantity}, 'app', ${worker}, ${shift},
       ${Number.isFinite(lat) ? lat : null}, ${Number.isFinite(lng) ? lng : null},
       ${deviceId}, now(), ${Array.from(flags)}, 'pending')
    returning id
  `;

  await insertClaimPhotos(claim.id, photos);

  await sql`
    update bag_lots
       set handlers = (select array(select distinct unnest(handlers || array[${worker}])))
     where id = ${lot.id}
  `;

  return NextResponse.json({ ok: true, id: claim.id, flags: Array.from(flags), ai: photos[0]?.ai });
}
