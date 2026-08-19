import { NextResponse } from "next/server";
import sql from "@/lib/sql";

export const dynamic = "force-dynamic";

/** GET — PP bag damage reports with their photos and AI verdicts (Asset Management). */
export async function GET() {
  try {
    const rows = await sql<Record<string, unknown>[]>`
      select r.id as _id, r.date, r.reason, r.quantity, r.reported_by as "reportedBy",
             r.trust_score as "trustScore", r.flags, r.ai, r.created_at as "createdAt",
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
