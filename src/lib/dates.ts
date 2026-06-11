// Ethiopia is UTC+3 (EAT, no DST). All business days are defined in EAT.
const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Start of the given EAT calendar day, as a UTC Date. */
export function eatDayStart(d: Date): Date {
  const shifted = new Date(d.getTime() + EAT_OFFSET_MS);
  const day = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  return new Date(day - EAT_OFFSET_MS);
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86400000);
}

/** [start, end) range covering "yesterday" in Ethiopia time. */
export function yesterdayRange(now = new Date()): { start: Date; end: Date } {
  const todayStart = eatDayStart(now);
  return { start: addDays(todayStart, -1), end: todayStart };
}

/** YYYY-MM-DD label of a date in EAT. */
export function eatDateLabel(d: Date): string {
  const shifted = new Date(d.getTime() + EAT_OFFSET_MS);
  return shifted.toISOString().slice(0, 10);
}

export function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 86400000);
}

export const ETB = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
export function etb(n: number): string {
  return `ETB ${ETB.format(Math.round(n))}`;
}
