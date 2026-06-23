import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/db";
import { DamageClaim, StoredFile } from "@/lib/models";
import { recomputeLotBalances } from "@/lib/metrics";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  await dbConnect();
  const claim = await DamageClaim.findById(params.id)
    .populate("lotId", "lotCode supplier bagType")
    .lean();
  if (!claim) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(claim);
}

/**
 * Review actions on a claim:
 *  - { action: "verify" | "reject", by }      → supervisor verdict
 *  - { action: "cosign", by }                 → co-sign a Telegram claim
 *  - { action: "disposal", disposal: { action, amount }, by } → assign outcome
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  await dbConnect();

  let body: Record<string, unknown> = {};
  let disposalPhoto: File | null = null;
  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    body = Object.fromEntries(Array.from(form.entries()).filter(([, v]) => typeof v === "string"));
    if (body.disposal && typeof body.disposal === "string") body.disposal = JSON.parse(body.disposal as string);
    disposalPhoto = (form.get("photo") as File) || null;
  } else {
    body = await req.json();
  }

  const claim = await DamageClaim.findById(params.id);
  if (!claim) return NextResponse.json({ error: "not found" }, { status: 404 });
  const by = String(body.by || "supervisor");

  switch (body.action) {
    case "cosign":
      claim.cosignedBy = by;
      if (claim.status === "cosign_required") claim.status = "pending";
      claim.flags = claim.flags.filter((f) => f !== "telegram_needs_cosign");
      break;
    case "verify":
      if (claim.source === "telegram" && !claim.cosignedBy) {
        return NextResponse.json({ error: "Telegram claims must be co-signed before verification" }, { status: 400 });
      }
      claim.status = "verified";
      claim.reviewedBy = by;
      claim.reviewedAt = new Date();
      break;
    case "reject":
      claim.status = "rejected";
      claim.reviewedBy = by;
      claim.reviewedAt = new Date();
      break;
    case "disposal": {
      const d = body.disposal as { action?: string; amount?: number } | undefined;
      if (!d?.action || !["returned_to_supplier", "destroyed", "sold_as_scrap"].includes(d.action)) {
        return NextResponse.json({ error: "disposal.action invalid" }, { status: 400 });
      }
      let photoFileId;
      if (disposalPhoto && disposalPhoto.size > 0) {
        const stored = await StoredFile.create({
          data: Buffer.from(await disposalPhoto.arrayBuffer()),
          contentType: disposalPhoto.type || "image/jpeg",
          kind: "disposal",
        });
        photoFileId = stored._id;
      }
      claim.disposal = {
        action: d.action as "returned_to_supplier" | "destroyed" | "sold_as_scrap",
        amount: d.action === "sold_as_scrap" ? Number(d.amount) || 0 : undefined,
        photoFileId,
        recordedBy: by,
        recordedAt: new Date(),
      };
      break;
    }
    default:
      return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }

  await claim.save();
  await recomputeLotBalances();
  return NextResponse.json({ ok: true, status: claim.status, disposal: claim.disposal });
}
