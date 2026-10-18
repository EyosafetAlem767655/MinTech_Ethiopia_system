import sql from "@/lib/sql";
import { FINANCE_RAW_MATERIALS } from "@/lib/products";

/**
 * What raw material a month OPENS with.
 *
 * FIRST, what was COUNTED — the daily report is the main reference. The last
 * 📦 Stock figure counted before the 1st, moved on by every daily report filed
 * after that count (received − issued) up to the month's start. September 30's
 * count is October's opening; if the last count was on the 25th, the 26th–30th
 * movements are added to it. A count is the ground itself, so it wins over a
 * typed balance: the October balance first submitted was the stock AFTER the
 * 2 October issue, and opening on it took that issue off twice. Looked for up
 * to a year back, per material, so one never counted falls through to the
 * rule below instead of opening at zero.
 *
 * A count day's own received/issued are already inside its stock figure, so
 * only the days AFTER it move it.
 *
 * Otherwise a beginning balance submitted for the month (monthly_base_balances)
 * is the opening, as it always was. A month with neither no longer opens at nothing: it
 * opens with the month before's CLOSING — that month's opening plus everything
 * the daily raw-material reports received, less everything they issued — and
 * so on back to the newest month that was submitted. Before this, a balance
 * filed for September was never carried into October, so an issue on the 2nd
 * of October came off the wrong figure.
 *
 * With no submission anywhere, the chain starts from zero at the first daily
 * report.
 */

export interface RawMaterialOpening {
  /** Tonnes per finance material name. */
  values: Record<string, number>;
  /**
   * "counted": the daily report's last stock count before the 1st, plus what moved after it.
   * "submitted": filed for this month. "carried": last month's closing.
   * "none": nothing to go on.
   */
  source: "counted" | "submitted" | "carried" | "none";
  /** The submitted month the carried figure starts from, if any. */
  fromMonth: string | null;
  /** The day of the count the opening was read from ("counted" only). */
  countedOn?: string | null;
}

const n = (v: unknown) => Number(v) || 0;
const round3 = (v: number) => Math.round(v * 1000) / 1000;
const missing = (e: unknown) => (e as { code?: string })?.code === "42P01";

/** "2026-10" → "2025-10": how far back a count is looked for. */
function yearBefore(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${y - 1}-${String(m).padStart(2, "0")}`;
}

/** `month` is 'YYYY-MM'. */
export async function rawMaterialOpening(month: string): Promise<RawMaterialOpening> {
  // Every daily report in the year before the 1st, newest first.
  const days = await sql<{
    date_label: string;
    received: Record<string, number> | null;
    issued: Record<string, number> | null;
    stock: Record<string, number> | null;
  }[]>`
    select date_label, received, issued, stock from raw_material_daily
     where date_label >= ${`${yearBefore(month)}-01`} and date_label < ${`${month}-01`}
     order by date_label desc
  `.catch((e) => {
    if (!missing(e)) throw e;
    return [];
  });

  // Per material, walking back from the 1st: add up what moved until the
  // newest day that counted it; that count plus those movements is the opening.
  const counted: Record<string, number> = {};
  let countedOn: string | null = null;
  for (const m of FINANCE_RAW_MATERIALS) {
    let moved = 0;
    for (const r of days) {
      if (n(r.stock?.[m]) > 0) {
        counted[m] = round3(n(r.stock?.[m]) + moved);
        if (!countedOn || r.date_label > countedOn) countedOn = r.date_label;
        break;
      }
      moved += n(r.received?.[m]) - n(r.issued?.[m]);
    }
  }
  if (Object.keys(counted).length === 0) return fromBalances(month);

  // A material not counted that month opens by the balance rule.
  const rest = FINANCE_RAW_MATERIALS.every((m) => counted[m] !== undefined) ? null : await fromBalances(month);
  const values: Record<string, number> = {};
  for (const m of FINANCE_RAW_MATERIALS) values[m] = counted[m] ?? rest?.values[m] ?? 0;
  return { values, source: "counted", fromMonth: null, countedOn };
}

/** The submitted balance, or last month's closing carried from it. */
async function fromBalances(month: string): Promise<RawMaterialOpening> {
  const bases = await sql<{ month: string; raw_materials: Record<string, number> | null }[]>`
    select month, raw_materials from monthly_base_balances
     where month <= ${month}
     order by month desc
     limit 1
  `.catch((e) => {
    if (!missing(e)) throw e;
    return [];
  });
  const base = bases[0];

  const values: Record<string, number> = {};
  for (const m of FINANCE_RAW_MATERIALS) values[m] = round3(n(base?.raw_materials?.[m]));
  if (base && base.month === month) return { values, source: "submitted", fromMonth: month };

  // The daily reports from the submitted month (or the very first one) up to
  // the end of the month before this one.
  const from = base ? `${base.month}-01` : "0000-01-01";
  const daily = await sql<{ received: Record<string, number> | null; issued: Record<string, number> | null }[]>`
    select received, issued from raw_material_daily
     where date_label >= ${from} and date_label < ${`${month}-01`}
  `.catch((e) => {
    if (!missing(e)) throw e;
    return [];
  });

  if (!base && daily.length === 0) return { values, source: "none", fromMonth: null };
  for (const r of daily) {
    for (const m of FINANCE_RAW_MATERIALS) {
      values[m] = round3(values[m] + n(r.received?.[m]) - n(r.issued?.[m]));
    }
  }
  return { values, source: "carried", fromMonth: base?.month ?? null };
}
