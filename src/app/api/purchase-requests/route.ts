import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/sql";
import { putFile } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET() {
  const prs = await sql`
    select id as _id, title, amount, requested_by as "requestedBy", justification,
           photo_file_id as "photoFileId", source, status,
           decided_by as "decidedBy", decided_at as "decidedAt",
           legitimacy, created_at as "createdAt"
      from purchase_requests
     order by created_at desc
     limit 100
  `;
  return NextResponse.json(prs.map((p: any) => ({ ...p, amount: Number(p.amount) })));
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const title = String(form.get("title") || "");
  const amount = Number(form.get("amount"));
  const requestedBy = String(form.get("requestedBy") || "");
  if (!title || !amount || !requestedBy) {
    return NextResponse.json({ error: "title, amount and requestedBy are required" }, { status: 400 });
  }

  let photoFileId: string | null = null;
  const photo = form.get("photo") as File | null;
  if (photo && photo.size > 0) {
    const stored = await putFile(Buffer.from(await photo.arrayBuffer()), photo.type || "image/jpeg", {
      kind: "purchase_request",
      filename: photo.name,
    });
    photoFileId = stored.id;
  }

  const [pr] = await sql<{ id: string }[]>`
    insert into purchase_requests (title, amount, requested_by, justification, photo_file_id, source)
    values (${title}, ${amount}, ${requestedBy}, ${String(form.get("justification") || "") || null}, ${photoFileId}, 'app')
    returning id
  `;
  return NextResponse.json({ ok: true, id: pr.id });
}
