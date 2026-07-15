import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/sql";
import { eatDateKey } from "@/lib/bot-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit")) || 60, 200);
  const today = eatDateKey();

  const [daily, hr, materials, activeEmployees, submittedToday] = await Promise.all([
    sql`
      select id as _id, full_name as "fullName", positions, date_key as "dateKey",
             text, photo_file_ids as "photoFileIds", created_at as "createdAt"
        from daily_reports order by created_at desc limit ${limit}
    `,
    sql`
      select id as _id, full_name as "fullName", kind, text,
             photo_file_ids as "photoFileIds", created_at as "createdAt"
        from hr_reports order by created_at desc limit ${limit}
    `,
    sql`
      select id as _id, counted_by as "countedBy", date_key as "dateKey", raw_text as "rawText",
             photo_file_ids as "photoFileIds", created_at as "createdAt"
        from material_counts order by created_at desc limit ${limit}
    `,
    sql<{ id: string; full_name: string; positions: string[] }[]>`
      select id, full_name, positions from telegram_users where active = true
    `,
    sql<{ user_id: string }[]>`
      select distinct user_id from daily_reports where date_key = ${today} and user_id is not null
    `,
  ]);

  const submitted = new Set(submittedToday.map((r) => r.user_id));
  const missingToday = activeEmployees
    .filter((u) => !submitted.has(u.id))
    .map((u) => ({ _id: u.id, fullName: u.full_name, positions: u.positions }));

  return NextResponse.json({ today, daily, hr, materials, missingToday });
}
