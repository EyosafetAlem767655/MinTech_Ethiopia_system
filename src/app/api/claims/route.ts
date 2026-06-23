import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/db";
import { BagLot, DamageClaim } from "@/lib/models";
import { processClaimPhoto } from "@/lib/claims";
import { recomputeLotBalances } from "@/lib/metrics";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  await dbConnect();
  const claims = await DamageClaim.find()
    .populate("lotId", "lotCode supplier bagType")
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  return NextResponse.json(claims);
}

/**
 * Worker submits a damage claim from the PWA. The client enforces live
 * camera capture (no gallery), watermarks the photo, and attaches GPS,
 * timestamp, device id and worker identity. Server runs the full evidence
 * pipeline: gpt-4o-mini inspection, perceptual-hash duplicate detection
 * against all prior claims, and EXIF sanity checks.
 */
export async function POST(req: NextRequest) {
  await dbConnect();
  const form = await req.formData();
  const lotId = String(form.get("lotId") || "");
  const quantity = Number(form.get("quantity"));
  const worker = String(form.get("worker") || "");
  if (!lotId || !quantity || !worker) {
    return NextResponse.json({ error: "lotId, quantity and worker are required" }, { status: 400 });
  }
  const lot = await BagLot.findById(lotId);
  if (!lot) return NextResponse.json({ error: "lot not found" }, { status: 404 });

  const photos = [];
  const flags = new Set<string>();
  for (const entry of form.getAll("photos")) {
    const file = entry as File;
    if (!file || file.size === 0) continue;
    const processed = await processClaimPhoto(
      Buffer.from(await file.arrayBuffer()),
      file.type || "image/jpeg",
      lot.bagType
    );
    photos.push(processed.photo);
    processed.flags.forEach((f) => flags.add(f));
  }
  if (photos.length === 0) {
    return NextResponse.json({ error: "at least one live photo is required" }, { status: 400 });
  }

  const lat = Number(form.get("lat"));
  const lng = Number(form.get("lng"));

  const claim = await DamageClaim.create({
    lotId: lot._id,
    quantity,
    source: "app",
    worker,
    shift: String(form.get("shift") || "") || undefined,
    gps: Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : undefined,
    deviceId: String(form.get("deviceId") || "") || undefined,
    capturedAt: new Date(),
    photos,
    flags: Array.from(flags),
    status: "pending",
  });

  if (!lot.handlers.includes(worker)) {
    lot.handlers.push(worker);
    await lot.save();
  }
  await recomputeLotBalances();

  return NextResponse.json({
    ok: true,
    id: claim._id,
    flags: claim.flags,
    ai: photos[0]?.ai,
  });
}
