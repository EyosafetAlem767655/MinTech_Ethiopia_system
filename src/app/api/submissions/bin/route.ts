import { NextRequest, NextResponse } from "next/server";
import { isUuid } from "@/lib/sql";
import { logActivity } from "@/lib/bot-auth";
import { listBin, purgeBinEntry, restoreSubmission } from "@/lib/recycle-bin";
import { isSubmissionCollection, SUBMISSIONS } from "@/lib/submissions";

export const dynamic = "force-dynamic";

const WEB_ACTOR = { chatId: "web", actor: "Dashboard", audience: "internal" as const };

/** GET — what is currently in the recycle bin, newest first. */
export async function GET(req: NextRequest) {
  const collection = req.nextUrl.searchParams.get("collection") || "";
  const limit = Number(req.nextUrl.searchParams.get("limit")) || 100;

  try {
    const rows = await listBin(limit, isSubmissionCollection(collection) ? collection : undefined);
    return NextResponse.json({
      rows: rows.map((r) => ({
        ...r,
        label: isSubmissionCollection(r.collection) ? SUBMISSIONS[r.collection].label : r.collection,
        icon: isSubmissionCollection(r.collection) ? SUBMISSIONS[r.collection].icon : "🗑",
      })),
    });
  } catch (e) {
    // The bin table arrives in 0018. An empty bin beats a 500 on a database one
    // migration behind the deploy.
    if ((e as { code?: string })?.code === "42P01") return NextResponse.json({ rows: [], unavailable: true });
    throw e;
  }
}

/** POST { id } — put a binned submission back where it came from. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const id = String(body.id || "");
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const res = await restoreSubmission(id);
  if (!res.ok) {
    if (res.reason === "exists") {
      return NextResponse.json(
        { error: "A live record already holds that id. Nothing was changed." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await logActivity({
    ...WEB_ACTOR,
    action: "report_edited",
    detail: `restored ${res.collection} ${res.rowId} from the recycle bin`,
    ok: true,
  });
  return NextResponse.json({ ok: true, restored: res.rowId, collection: res.collection });
}

/**
 * DELETE ?id= — empty one entry from the bin, for good.
 *
 * This is the only place a submission's photos are actually released. Up to
 * here the report was restorable; past here it is not.
 */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") || "";
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const res = await purgeBinEntry(id);
  if (!res.ok) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await logActivity({
    ...WEB_ACTOR,
    action: "report_deleted",
    detail: `permanently removed bin entry ${id}`,
    ok: true,
    meta: { photosRemoved: res.photosRemoved },
  });
  return NextResponse.json({ ok: true, photosRemoved: res.photosRemoved });
}
