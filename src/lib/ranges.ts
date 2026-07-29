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

export type RangeKey = "daily" | "weekly" | "monthly" | "d90" | "d180" | "yearly";
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

export const RANGES: Record<RangeKey, RangeDef> = {
  daily: { key: "daily", label: "Daily", short: "1D", days: 1, bucket: "day" },
  weekly: { key: "weekly", label: "Weekly", short: "7D", days: 7, bucket: "day" },
  monthly: { key: "monthly", label: "Monthly", short: "30D", days: 30, bucket: "day" },
  d90: { key: "d90", label: "90 days", short: "90D", days: 90, bucket: "week" },
  d180: { key: "d180", label: "6 months", short: "6M", days: 182, bucket: "week" },
  yearly: { key: "yearly", label: "Yearly", short: "1Y", days: 365, bucket: "month" },
};

export const RANGE_KEYS = Object.keys(RANGES) as RangeKey[];
export const RANGE_LIST = RANGE_KEYS.map((k) => RANGES[k]);

export function isRangeKey(value: unknown): value is RangeKey {
  return typeof value === "string" && value in RANGES;
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
  const { days, bucket } = RANGES[key];
  const end = addDays(eatDayStart(now), 1); // start of tomorrow, EAT
  const start = addDays(end, -days);
  return { start, end, bucket, days };
}
