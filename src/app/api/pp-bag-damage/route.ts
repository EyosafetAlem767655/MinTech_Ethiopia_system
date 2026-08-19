import { NextResponse } from "next/server";
import sql from "@/lib/sql";

export const dynamic = "force-dynamic";

/** GET — PP bag damage reports with their photos, AI verdicts and review status. */
export async function GET() {
  try {
    const rows = await sql<Record<string, unknown>[]>`
      select r.id as _id, r.date, r.reason, r.quantity, r.reported_by as "reportedBy",
             r.trust_score as "trustScore", r.flags, r.ai, r.created_at as "createdAt",
             -- 0015 adds the review columns; a deployment ahead of its migrations
             -- reads every report as still awaiting a decision rather than 500ing.
             coalesce(to_jsonb(r) ->> 'status', 'pending') as status,
             to_jsonb(r) ->> 'decided_by' as "decidedBy",
             to_jsonb(r) ->> 'decided_at' as "decidedAt",
             coalesce(
               (select jsonb_agg(jsonb_build_object(
                   'fileId', p.file_id,
                   'duplicateOfReportId', p.duplicate_of_report_id,
                   'ai', p.ai,
                   'exifCheck', p.exif_check
                 ) order by p.created_at)
                  from pp_bag_damage_photos p where p.report_id = r.id),
               '[]'::jsonb
             ) as photos
        from pp_bag_damage_reports r
       order by r.date desc, r.created_at desc
       limit 200
    `;
    return NextResponse.json(
      rows.map((r) => ({
        ...r,
        quantity: r.quantity == null ? null : Number(r.quantity),
        trustScore: r.trustScore == null ? null : Number(r.trustScore),
      }))
    );
  } catch (e) {
    // Table not created yet — render an empty panel rather than a 500.
    if ((e as { code?: string })?.code === "42P01") return NextResponse.json([]);
    throw e;
  }
}
