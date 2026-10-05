import { NextResponse } from "next/server";
import sql from "@/lib/sql";
import { BANKS } from "@/lib/banks";

export const dynamic = "force-dynamic";

/**
 * GET — what came in through each bank, month by month.
 *
 * The columns are the bank list, not whatever keys happen to be in the data: a
 * bank that collected nothing this month must keep its column, or the table
 * silently changes shape from one month to the next and two months stop being
 * comparable by eye.
 */
export async function GET() {
  const rows = await sql<
    {
      month: string;
      banks: Record<string, number>;
      total: string | null;
      tg_file_ids: string[];
      reported_by: string;
      created_at: string;
    }[]
  >`
    select month, banks, total, tg_file_ids, reported_by, created_at
      from bank_collections
     order by month desc
     limit 36
  `.catch((e) => {
    // The table arrives in 0035. An empty tab that says so beats a 500 that
    // takes the whole Finance page down with it.
    if ((e as { code?: string })?.code !== "42P01") throw e;
    return null;
  });

  if (rows === null) return NextResponse.json({ months: [], banks: BANKS, unavailable: true });

  const months = rows.map((r) => ({
    month: r.month,
    banks: r.banks || {},
    total: Number(r.total) || Object.values(r.banks || {}).reduce((a, b) => a + (Number(b) || 0), 0),
    photoIds: r.tg_file_ids || [],
    reportedBy: r.reported_by,
    filedAt: r.created_at,
  }));

  // Only the banks that have ever carried money, in the canonical order. All
  // nineteen columns with sixteen of them permanently empty is a table nobody
  // can read across.
  const used = BANKS.filter((b) => months.some((m) => (Number(m.banks[b]) || 0) > 0));

  return NextResponse.json({ months, banks: used.length > 0 ? used : BANKS.slice(0, 4) });
}
