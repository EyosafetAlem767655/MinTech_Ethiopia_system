import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/sql";
import { eatDateKey } from "@/lib/bot-auth";
import { requiresDailyReport, submissionTablesFor } from "@/lib/positions";
import { daysFor, reporterDaysByTable } from "@/lib/compliance";

export const dynamic = "force-dynamic";

/** The last `n` EAT date keys, newest first: [today, yesterday, …]. */
function recentDateKeys(n: number): string[] {
  return Array.from({ length: n }, (_, i) => eatDateKey(new Date(Date.now() - i * 86400000)));
}

export async function GET(req: NextRequest) {
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit")) || 60, 200);
  const today = eatDateKey();
  const window7 = recentDateKeys(7);
  const cutoff30 = eatDateKey(new Date(Date.now() - 30 * 86400000));

  const [daily, hr, materials, activeEmployees] = await Promise.all([
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
      select id, full_name, positions from telegram_users where active = true order by full_name
    `,
  ]);

  // Only employees whose role obliges a daily report are held to compliance.
  // Purchase-only, monthly-only and HR/Admin recipients are excluded.
  const expected = activeEmployees.filter((u) => requiresDailyReport(u.positions));

  // Compliance is measured against each role's OWN submission tables. Counting
  // `daily_reports` alone meant roles that report through the guided flows could
  // never register a submission and sat at 0/7 forever.
  const historyTables = [...new Set(expected.flatMap((u) => submissionTablesFor(u.positions)))];
  const history = await reporterDaysByTable(cutoff30, historyTables);

  const compliance = expected.map((u) => {
    const days = daysFor(history, u.full_name, u.positions);
    const submitted7 = window7.filter((d) => days.has(d)).length;
    // Missed days ending today (a streak): count leading days with no submission.
    let missedStreak = 0;
    for (const d of window7) {
      if (days.has(d)) break;
      missedStreak++;
    }
    return {
      _id: u.id,
      fullName: u.full_name,
      positions: u.positions,
      submittedToday: days.has(today),
      // Newest day inside the 30-day window; older than that reads as "never",
      // which is the same horizon the rest of this panel works over.
      lastSubmitted: days.size > 0 ? [...days].sort().reverse()[0] : null,
      submitted7,
      missed7: 7 - submitted7,
      missedStreak,
    };
  });

  const missingToday = compliance
    .filter((c) => !c.submittedToday)
    .map((c) => ({ _id: c._id, fullName: c.fullName, positions: c.positions }));

  return NextResponse.json({
    today,
    daily,
    hr,
    materials,
    missingToday,
    compliance,
    summary: {
      total: expected.length,
      submittedToday: expected.length - missingToday.length,
      missingToday: missingToday.length,
    },
  });
}
