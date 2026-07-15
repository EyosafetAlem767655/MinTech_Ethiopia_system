import { NextRequest, NextResponse } from "next/server";
import sql, { first, isUuid } from "@/lib/sql";
import { putFile } from "@/lib/storage";
import { findClaims } from "@/lib/claims";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!isUuid(params.id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const claim = first(await findClaims({ id: params.id }));
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
  if (!isUuid(params.id)) return NextResponse.json({ error: "not found" }, { status: 404 });

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

  const claim = first(await sql<{ id: string; source: string; cosigned_by: string | null; status: string; flags: string[] }[]>`
    select id, source, cosigned_by, status, flags from damage_claims where id = ${params.id}
  `);
  if (!claim) return NextResponse.json({ error: "not found" }, { status: 404 });
  const by = String(body.by || "supervisor");

  switch (body.action) {
    case "cosign": {
      const [row] = await sql<{ status: string }[]>`
        update damage_claims
           set cosigned_by = ${by},
               status = case when status = 'cosign_required' then 'pending' else status end,
               flags = array_remove(flags, 'telegram_needs_cosign')
         where id = ${claim.id}
         returning status
      `;
      return NextResponse.json({ ok: true, status: row.status });
    }
    case "verify": {
      if (claim.source === "telegram" && !claim.cosigned_by) {
        return NextResponse.json({ error: "Telegram claims must be co-signed before verification" }, { status: 400 });
      }
      const [row] = await sql<{ status: string }[]>`
        update damage_claims set status = 'verified', reviewed_by = ${by}, reviewed_at = now()
         where id = ${claim.id} returning status
      `;
      return NextResponse.json({ ok: true, status: row.status });
    }
    case "reject": {
      const [row] = await sql<{ status: string }[]>`
        update damage_claims set status = 'rejected', reviewed_by = ${by}, reviewed_at = now()
         where id = ${claim.id} returning status
      `;
      return NextResponse.json({ ok: true, status: row.status });
    }
    case "disposal": {
      const d = body.disposal as { action?: string; amount?: number } | undefined;
      if (!d?.action || !["returned_to_supplier", "destroyed", "sold_as_scrap"].includes(d.action)) {
        return NextResponse.json({ error: "disposal.action invalid" }, { status: 400 });
      }
      let photoFileId: string | null = null;
      if (disposalPhoto && disposalPhoto.size > 0) {
        const stored = await putFile(
          Buffer.from(await disposalPhoto.arrayBuffer()),
          disposalPhoto.type || "image/jpeg",
          { kind: "disposal" }
        );
        photoFileId = stored.id;
      }
      const amount = d.action === "sold_as_scrap" ? Number(d.amount) || 0 : null;
      await sql`
        update damage_claims set
          disposal_action = ${d.action},
          disposal_amount = ${amount},
          disposal_photo_file_id = ${photoFileId},
          disposal_recorded_by = ${by},
          disposal_recorded_at = now()
        where id = ${claim.id}
      `;
      return NextResponse.json({
        ok: true,
        status: claim.status,
        disposal: { action: d.action, amount, photoFileId, recordedBy: by },
      });
    }
    default:
      return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }
}
