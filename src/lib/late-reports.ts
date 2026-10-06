/**
 * Reports that ARRIVED recently but are DATED outside the window on screen.
 *
 * Every department panel filters its figures by the date the thing happened —
 * tonnage belongs to the day it was produced, not to the day somebody got
 * round to filing it. That is right, and it has one bad consequence: a report
 * filed yesterday for the day before is correctly listed in Settings →
 * Submissions (which sorts by arrival) and correctly absent from "Daily" (which
 * is today). To the person who filed it, the dashboard simply lost their work.
 *
 * So the figures keep their dates and the panel gains a notice: these reports
 * exist, here is when they are dated, here is one tap that widens the window
 * far enough to show them. Nothing filed is ever invisible, and no tonnage is
 * ever counted into a day it did not happen in.
 *
 * Pure: no dates of its own beyond the `now` it is handed, so the boundaries can
 * be tested rather than watched.
 */

import { RANGE_KEYS, rangeWindow, type RangeKey } from "@/lib/ranges";

export interface LateReport {
  /** The date the report is FOR. */
  date: string;
  /** When it reached us. Absent on rows written before this column existed. */
  createdAt?: string | null;
}

/** How far back an arrival still counts as "just filed". */
export const LATE_ARRIVAL_DAYS = 7;

const DAY = 86400000;

/**
 * Rows that arrived within the last `days` and fall outside `win`.
 *
 * A row with no arrival time is never reported: it is old data, and a notice
 * about every historical row outside the window would be noise where this is
 * meant to be news.
 */
export function lateReports<T extends LateReport>(
  rows: T[],
  win: { start: Date; end: Date },
  opts: { days?: number; now?: Date } = {}
): T[] {
  const days = opts.days ?? LATE_ARRIVAL_DAYS;
  const now = (opts.now ?? new Date()).getTime();
  const since = now - days * DAY;
  const from = win.start.getTime();
  const to = win.end.getTime();

  return rows
    .filter((r) => {
      if (!r.createdAt) return false;
      const arrived = new Date(r.createdAt).getTime();
      if (!Number.isFinite(arrived) || arrived < since) return false;
      const forDay = new Date(r.date).getTime();
      if (!Number.isFinite(forDay)) return false;
      // Outside the window on screen — on either side. A report dated into the
      // future is just as hidden as one dated into the past, and is a typo
      // worth seeing rather than hiding.
      return forDay < from || forDay >= to;
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

/**
 * The shortest range that would show every one of these dates.
 *
 * Shortest rather than "yearly": widening to a year to reveal one report dated
 * four days ago would bury it in the figures it was meant to stand out from.
 * Falls back to the longest range when nothing covers them all.
 */
export function smallestRangeCovering(
  dates: (string | Date)[],
  now = new Date(),
  /** The keys the panel actually offers — some show only four of the six. */
  allowed: RangeKey[] = RANGE_KEYS
): RangeKey {
  const keys = RANGE_KEYS.filter((k) => allowed.includes(k));
  const times = dates
    .map((d) => new Date(d).getTime())
    .filter((t) => Number.isFinite(t));
  const last = keys[keys.length - 1] ?? RANGE_KEYS[RANGE_KEYS.length - 1];
  if (times.length === 0) return last;

  for (const key of keys) {
    const win = rangeWindow(key, now);
    const from = win.start.getTime();
    const to = win.end.getTime();
    if (times.every((t) => t >= from && t < to)) return key;
  }
  return last;
}
