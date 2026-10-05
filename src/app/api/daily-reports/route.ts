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

/** "YYYY-MM" → the EAT bounds of that month, and how many days it has. */
function monthWindow(month: string): { start: Date; end: Date; days: number } {
  const [y, m] = month.split("-").map(Number);
  // EAT is UTC+3, so the month opens three hours before UTC midnight.
  const start = new Date(Date.UTC(y, m - 1, 1) - 3 * 3600_000);
  const end = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1) - 3 * 3600_000);
  return { start, end, days: new Date(Date.UTC(y, m, 0)).getUTCDate() };
}

const isMonth = (v: string | null): v is string => Boolean(v && /^\d{4}-\d{2}$/.test(v));

export async function GET(req: NextRequest) {
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit")) || 60, 200);
  const monthParam = req.nextUrl.searchParams.get("month");
  const today = eatDateKey();
  const month = isMonth(monthParam) ? monthParam : today.slice(0, 7);
  const window7 = recentDateKeys(7);
  const cutoff30 = eatDateKey(new Date(Date.now() - 30 * 86400000));
  const { start: monthStart, end: monthEnd, days: daysInMonth } = monthWindow(month);

  // The HR and material-count feeds were removed from the Brief, so they are no
  // longer fetched here. Both collections remain fully manageable under
  // Settings → Submissions, which reads /api/submissions instead.
  const [daily, activeEmployees, activityRows, monthRows] = await Promise.all([
    sql`
      select id as _id, full_name as "fullName", positions, date_key as "dateKey",
             text, (photo_file_ids::text[] || tg_file_ids) as "photoFileIds",
             created_at as "createdAt"
        from daily_reports order by created_at desc limit ${limit}
    `,
    sql<{ id: string; full_name: string; positions: string[] }[]>`
      select id, full_name, positions from telegram_users where active = true order by full_name
    `,
    /**
     * WHAT EACH PERSON ACTUALLY FILED, per EAT day.
     *
     * Not the same question as compliance below, and the difference is the bug
     * this fixes: compliance counts only the tables a role is OBLIGED to file
     * into, so somebody filing whiteness checks and bag usage every day matched
     * none of it and read as having done nothing for a week — while the Recent
     * submissions feed beside it listed them all along.
     *
     * `bot_activity` is where that feed reads from, so the two panels now
     * answer from one source and cannot disagree. It counts submissions made
     * through the BOT; the handful filed from the webapp do not pass through
     * it, which is why the panel says so out loud.
     */
    sql<{ who: string; day: string; n: string }[]>`
      select lower(trim(actor)) as who,
             to_char((created_at at time zone 'Africa/Addis_Ababa')::date, 'YYYY-MM-DD') as day,
             count(*) as n
        from bot_activity
       where action = 'submission'
         and created_at >= ${new Date(Date.now() - 30 * 86400000)}
       group by 1, 2
    `.catch(() => []),
    // The same, for whichever month the calendar is showing. A separate query
    // because the month may be any month, not the trailing thirty days.
    sql<{ who: string; day: string; n: string }[]>`
      select lower(trim(actor)) as who,
             to_char((created_at at time zone 'Africa/Addis_Ababa')::date, 'YYYY-MM-DD') as day,
             count(*) as n
        from bot_activity
       where action = 'submission'
         and created_at >= ${monthStart} and created_at < ${monthEnd}
       group by 1, 2
    `.catch(() => []),
  ]);

  /** name → day → submissions. */
  const countsByName = (rows: { who: string; day: string; n: string }[]) => {
    const out = new Map<string, Map<string, number>>();
    for (const r of rows) {
      if (!r.who) continue;
      const byDay = out.get(r.who) ?? new Map<string, number>();
      byDay.set(r.day, (byDay.get(r.day) ?? 0) + Number(r.n));
      out.set(r.who, byDay);
    }
    return out;
  };
  const recentActivity = countsByName(activityRows);
  const monthActivity = countsByName(monthRows);

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

    // Activity: anything at all, from any flow. Kept apart from the obligation
    // above on purpose — a weekly store count must not discharge a daily
    // raw-material report, and the panel shows both rather than choosing.
    const active = recentActivity.get(u.full_name.trim().toLowerCase()) ?? new Map<string, number>();
    const activeDays = [...active.keys()].sort();

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
      activeToday: (active.get(today) ?? 0) > 0,
      activeDays7: window7.filter((d) => (active.get(d) ?? 0) > 0).length,
      submissions7: window7.reduce((a, d) => a + (active.get(d) ?? 0), 0),
      lastActive: activeDays.length > 0 ? activeDays[activeDays.length - 1] : null,
    };
  });

  // Missing means "has not used the bot today". `submittedToday` is still on
  // every row — the morning chase asks a narrower question — but the panel and
  // this summary count any submission, because most of these roles have no
  // single report that could stand for the day.
  const missingToday = compliance
    .filter((c) => !c.activeToday)
    .map((c) => ({ _id: c._id, fullName: c.fullName, positions: c.positions }));

  // The calendar covers EVERY active employee, not just those owing a daily
  // report: "who was busiest this month" is a question about the whole roster.
  const calendar = activeEmployees.map((u) => {
    const byDay = monthActivity.get(u.full_name.trim().toLowerCase()) ?? new Map<string, number>();
    const counts: number[] = [];
    for (let day = 1; day <= daysInMonth; day++) {
      counts.push(byDay.get(`${month}-${String(day).padStart(2, "0")}`) ?? 0);
    }
    return {
      _id: u.id,
      fullName: u.full_name,
      counts,
      total: counts.reduce((a, b) => a + b, 0),
    };
  });

  return NextResponse.json({
    today,
    daily,
    missingToday,
    compliance,
    month,
    daysInMonth,
    calendar,
    summary: {
      total: expected.length,
      submittedToday: expected.length - missingToday.length,
      missingToday: missingToday.length,
    },
  });
}
