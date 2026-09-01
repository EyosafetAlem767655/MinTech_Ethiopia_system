import { NextRequest, NextResponse } from "next/server";
import sql, { first, isUuid } from "@/lib/sql";
import { logActivity } from "@/lib/bot-auth";
import { binSubmission } from "@/lib/recycle-bin";
import {
  isSubmissionCollection,
  SUBMISSIONS,
  type SubmissionCollection,
  type SubmissionSpec,
} from "@/lib/submissions";

export const dynamic = "force-dynamic";

/**
 * The dashboard logs in with one shared password, so there is no individual to
 * name in the audit trail — only that the change came from the web app rather
 * than the bot. `bot_activity.chat_id` is NOT NULL, hence the sentinel.
 */
const WEB_ACTOR = { chatId: "web", actor: "Dashboard", audience: "internal" as const };

function resolve(collection: string, id: string): SubmissionSpec | null {
  if (!isSubmissionCollection(collection) || !isUuid(id)) return null;
  return SUBMISSIONS[collection];
}

/** Fetch the row first: acting on an id that does not exist must 404, not report success. */
async function loadRow(spec: SubmissionSpec, id: string) {
  const cols = ["id"];
  if (spec.authorColumn) cols.push(spec.authorColumn);
  if (spec.photosColumn) cols.push(spec.photosColumn);
  if (spec.photoColumn) cols.push(spec.photoColumn);
  return first(await sql<Record<string, unknown>[]>`
    select ${sql(Array.from(new Set(cols)))} from ${sql(spec.table)} where id = ${id}
  `);
}

export async function PATCH(req: NextRequest, { params }: { params: { collection: string; id: string } }) {
  const spec = resolve(params.collection, params.id);
  if (!spec) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const row = await loadRow(spec, params.id);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // Only fields the registry marks editable, and only those actually sent.
  const patch: Record<string, unknown> = {};
  for (const key of spec.editableKeys) {
    if (!(key in body)) continue;
    const field = spec.displayFields.find((f) => f.key === key);
    const raw = body[key];
    if (field?.type === "number") {
      if (raw === "" || raw === null) {
        patch[key] = null;
      } else {
        const n = Number(raw);
        if (!isFinite(n)) return NextResponse.json({ error: `${field.label} must be a number.` }, { status: 400 });
        patch[key] = n;
      }
    } else {
      const s = typeof raw === "string" ? raw.trim() : "";
      // A long-text field is the substance of the report — blanking it is almost
      // certainly a mistake, and a delete is the honest way to remove a record.
      if (field?.type === "longtext" && !s) {
        return NextResponse.json({ error: `${field.label} cannot be empty.` }, { status: 400 });
      }
      patch[key] = s || null;
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  await sql`update ${sql(spec.table)} set ${sql(patch)} where id = ${params.id}`;

  await logActivity({
    ...WEB_ACTOR,
    action: "report_edited",
    detail: `${spec.label} ${params.id} · ${Object.keys(patch).join(", ")}`,
    ok: true,
  });

  return NextResponse.json({ ok: true, updated: Object.keys(patch) });
}

/**
 * DELETE — move the submission to the recycle bin.
 *
 * The row leaves its own table immediately, so it stops counting toward every
 * report and total the moment it is deleted. It is not destroyed: it sits in
 * `deleted_submissions`, restorable, until someone empties it from the bin.
 * Photos stay in the bucket for the same reason — a restore that came back
 * without its evidence would not be one.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { collection: string; id: string } }) {
  const spec = resolve(params.collection, params.id);
  if (!spec) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const row = await loadRow(spec, params.id);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const moved = await binSubmission({
    collection: params.collection as SubmissionCollection,
    id: params.id,
    deletedBy: WEB_ACTOR.actor,
  });
  if (!moved.ok) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await logActivity({
    ...WEB_ACTOR,
    action: "report_deleted",
    detail: `${spec.label} ${params.id} by ${
      spec.authorColumn ? String(row[spec.authorColumn] ?? "unknown") : "unknown"
    } → recycle bin`,
    ok: true,
    meta: { collection: params.collection, table: spec.table, photos: moved.photoIds.length },
  });

  return NextResponse.json({ ok: true, deleted: true, binned: true, photos: moved.photoIds.length });
}
