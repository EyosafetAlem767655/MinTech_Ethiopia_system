/**
 * The six reporting windows every department report can be viewed over.
 *
 * A range is a rolling window ending at "now" plus a chart bucket granularity.
 * Short windows bucket by day; 90-day and 6-month bucket by week so the line
 * stays readable; the yearly window buckets by month. All boundaries are
 * Ethiopian calendar days (EAT), reusing the helpers in src/lib/dates.ts.
 *
 * The window is inclusive of the day in progress: `end` is the start of
 * tomorrow (EAT), so "Daily" is today and "Weekly" is the last seven days up to
 * and including today. That is deliberate — the department view is a live board
 * where an employee's submission should appear the moment it lands, unlike the
 * owner's separate "yesterday" brief.
 */

import { addDays, eatDayStart } from "@/lib/dates";

export type FixedRangeKey = "daily" | "weekly" | "monthly" | "d90" | "d180" | "yearly";
/**
 * One calendar month, "m:2026-10": the 1st to the last day, in EAT, bucketed
 * by day. Offered beside the rolling windows so any past month can be looked
 * at on its own, not only "the last 30 days".
 */
export type MonthRangeKey = `m:${string}`;
export type RangeKey = FixedRangeKey | MonthRangeKey;
export type Bucket = "day" | "week" | "month";

export interface RangeDef {
  key: RangeKey;
  /** Full label for the segmented control. */
  label: string;
  /** Compact label for tight layouts. */
  short: string;
  /** Length of the rolling window, in days. */
  days: number;
  /** Chart bucket granularity for this window. */
  bucket: Bucket;
}

export const RANGES: Record<FixedRangeKey, RangeDef> = {
  daily: { key: "daily", label: "Daily", short: "1D", days: 1, bucket: "day" },
  weekly: { key: "weekly", label: "Weekly", short: "7D", days: 7, bucket: "day" },
  monthly: { key: "monthly", label: "Monthly", short: "30D", days: 30, bucket: "day" },
  d90: { key: "d90", label: "90 days", short: "90D", days: 90, bucket: "week" },
  d180: { key: "d180", label: "6 months", short: "6M", days: 182, bucket: "week" },
  yearly: { key: "yearly", label: "Yearly", short: "1Y", days: 365, bucket: "month" },
};

export const RANGE_KEYS = Object.keys(RANGES) as FixedRangeKey[];
export const RANGE_LIST = RANGE_KEYS.map((k) => RANGES[k]);

export function isMonthRange(value: unknown): value is MonthRangeKey {
  return typeof value === "string" && /^m:\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function isRangeKey(value: unknown): value is RangeKey {
  return typeof value === "string" && (value in RANGES || isMonthRange(value));
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "m:2026-10" → "Oct 2026". */
export function monthRangeLabel(key: MonthRangeKey): string {
  const [y, m] = key.slice(2).split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** [start, end) of a calendar month in EAT: 1st 00:00 to the next 1st. */
function monthBoundsEat(key: MonthRangeKey): { start: Date; end: Date } {
  const [y, m] = key.slice(2).split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1) - 3 * 3_600_000);
  const end = new Date(Date.UTC(y, m, 1) - 3 * 3_600_000);
  return { start, end };
}

/** The definition of any range, a calendar month included. */
export function rangeDef(key: RangeKey): RangeDef {
  if (!isMonthRange(key)) return RANGES[key];
  const { start, end } = monthBoundsEat(key);
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  const label = monthRangeLabel(key);
  return { key, label, short: label, days, bucket: "day" };
}

/** The current month and the `count - 1` before it, newest first, as range keys. */
export function recentMonthRanges(count = 24, now = new Date()): MonthRangeKey[] {
  const eat = new Date(now.getTime() + 3 * 3_600_000);
  const out: MonthRangeKey[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(eat.getUTCFullYear(), eat.getUTCMonth() - i, 1));
    out.push(`m:${d.toISOString().slice(0, 7)}`);
  }
  return out;
}

export interface RangeWindow {
  start: Date;
  end: Date;
  bucket: Bucket;
  days: number;
}

/**
 * Resolve a range key to a concrete [start, end) window. `end` is the start of
 * tomorrow (EAT) so the window includes today; `start` is `days` before that.
 */
export function rangeWindow(key: RangeKey, now = new Date()): RangeWindow {
  if (isMonthRange(key)) {
    const { start, end } = monthBoundsEat(key);
    const { days, bucket } = rangeDef(key);
    return { start, end, bucket, days };
  }
  const { days, bucket } = RANGES[key];
  const end = addDays(eatDayStart(now), 1); // start of tomorrow, EAT
  const start = addDays(end, -days);
  return { start, end, bucket, days };
}
