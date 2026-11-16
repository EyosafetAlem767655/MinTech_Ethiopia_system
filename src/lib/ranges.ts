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
/**
 * Any dates, "c:2026-11-01_2026-11-15": from the first day to the last, both
 * included, in EAT. One day is "c:2026-11-09_2026-11-09".
 */
export type CustomRangeKey = `c:${string}`;
export type RangeKey = FixedRangeKey | MonthRangeKey | CustomRangeKey;
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

const ISO_DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function isCustomRange(value: unknown): value is CustomRangeKey {
  if (typeof value !== "string" || !value.startsWith("c:")) return false;
  const [from, to] = value.slice(2).split("_");
  if (!ISO_DAY.test(from ?? "") || !ISO_DAY.test(to ?? "") || from > to) return false;
  // A real calendar day (no 31 Feb), and no more than ten years at once.
  const ok = (d: string) => new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
  return ok(from) && ok(to) && Number(to.slice(0, 4)) - Number(from.slice(0, 4)) <= 10;
}

/** "2026-11-01", "2026-11-15" → "c:2026-11-01_2026-11-15" (swapped if backwards). */
export function customRangeKey(from: string, to: string): CustomRangeKey {
  return from <= to ? `c:${from}_${to}` : `c:${to}_${from}`;
}

/** The two days of a custom range. */
export function customRangeDays(key: CustomRangeKey): { from: string; to: string } {
  const [from, to] = key.slice(2).split("_");
  return { from, to };
}

export function isRangeKey(value: unknown): value is RangeKey {
  return typeof value === "string" && (value in RANGES || isMonthRange(value) || isCustomRange(value));
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "m:2026-10" → "Oct 2026". */
export function monthRangeLabel(key: MonthRangeKey): string {
  const [y, m] = key.slice(2).split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** "2026-11-09" → "9 Nov 2026". */
function dayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return `${d} ${MONTH_NAMES[m - 1]} ${y}`;
}

/** "9 Nov 2026", or "1 Nov – 15 Nov 2026", or "28 Dec 2025 – 3 Jan 2026". */
export function customRangeLabel(key: CustomRangeKey): string {
  const { from, to } = customRangeDays(key);
  if (from === to) return dayLabel(from);
  if (from.slice(0, 4) === to.slice(0, 4)) return `${dayLabel(from).replace(/ \d{4}$/, "")} – ${dayLabel(to)}`;
  return `${dayLabel(from)} – ${dayLabel(to)}`;
}

/** [start, end) of custom dates in EAT: the first day 00:00 to the day after the last. */
function customBoundsEat(key: CustomRangeKey): { start: Date; end: Date } {
  const { from, to } = customRangeDays(key);
  const start = new Date(`${from}T00:00:00+03:00`);
  const end = new Date(new Date(`${to}T00:00:00+03:00`).getTime() + 86_400_000);
  return { start, end };
}

/** Day buckets up to three months, weeks up to about six, months beyond. */
function bucketFor(days: number): Bucket {
  return days <= 92 ? "day" : days <= 200 ? "week" : "month";
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
  if (isCustomRange(key)) {
    const { start, end } = customBoundsEat(key);
    const days = Math.round((end.getTime() - start.getTime()) / 86_400_000);
    const label = customRangeLabel(key);
    return { key, label, short: label, days, bucket: bucketFor(days) };
  }
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
  if (isCustomRange(key)) {
    const { start, end } = customBoundsEat(key);
    const { days, bucket } = rangeDef(key);
    return { start, end, bucket, days };
  }
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
