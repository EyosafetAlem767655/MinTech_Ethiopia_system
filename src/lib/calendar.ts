/**
 * Inline-keyboard date picker for the Telegram bot.
 *
 * Asset reports are routinely filed a day or two late, and asking an Amharic
 * speaker to type "2026-08-17" invites both format mistakes and silent
 * off-by-one errors. A month grid removes the ambiguity entirely.
 *
 * Callback data is deliberately terse — Telegram caps callback_data at 64 bytes:
 *   cal:<flow>:d:<YYYY-MM-DD>   a day was chosen
 *   cal:<flow>:m:<YYYY-MM>      navigate to another month
 *   cal:<flow>:x                ignore (spacers and the header)
 */

const EAT_OFFSET_MS = 3 * 3600_000;

export interface CalendarSelection {
  flow: string;
  /** "YYYY-MM-DD" when a day was tapped. */
  date?: string;
  /** "YYYY-MM" when the user paged to another month. */
  month?: string;
  /** True for the inert spacer buttons. */
  ignore?: boolean;
}

/** Today's date in EAT, as "YYYY-MM-DD". */
export function eatToday(now = new Date()): string {
  return new Date(now.getTime() + EAT_OFFSET_MS).toISOString().slice(0, 10);
}

/** Parse a `cal:` callback. Returns null for anything that is not ours. */
export function parseCalendarCallback(data: string): CalendarSelection | null {
  if (!data.startsWith("cal:")) return null;
  const [, flow, kind, value] = data.split(":");
  if (!flow || !kind) return null;
  if (kind === "d" && /^\d{4}-\d{2}-\d{2}$/.test(value || "")) return { flow, date: value };
  if (kind === "m" && /^\d{4}-\d{2}$/.test(value || "")) return { flow, month: value };
  return { flow, ignore: true };
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function shiftMonth(year: number, monthIndex0: number, delta: number): { y: number; m: number } {
  // Date normalises out-of-range months, so December + 1 rolls the year rather
  // than producing month 12.
  const d = new Date(Date.UTC(year, monthIndex0 + delta, 1));
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
}

/**
 * Build the month grid. `month` is "YYYY-MM"; defaults to the current EAT month.
 * The chosen day, and today, are marked so the common case is one confident tap.
 */
export function buildCalendar(flow: string, month?: string, selected?: string, now = new Date()) {
  const today = eatToday(now);
  const [ty, tm] = [Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1];
  const year = month ? Number(month.slice(0, 4)) : ty;
  const mon = month ? Number(month.slice(5, 7)) - 1 : tm;

  const pad = (n: number) => String(n).padStart(2, "0");
  const ymd = (d: number) => `${year}-${pad(mon + 1)}-${pad(d)}`;
  const nav = (y: number, m: number) => `cal:${flow}:m:${y}-${pad(m + 1)}`;

  const daysInMonth = new Date(Date.UTC(year, mon + 1, 0)).getUTCDate();
  // Monday-first, matching how Ethiopian work weeks are written down.
  const firstDow = (new Date(Date.UTC(year, mon, 1)).getUTCDay() + 6) % 7;

  const prev = shiftMonth(year, mon, -1);
  const next = shiftMonth(year, mon, 1);

  const rows: { text: string; callback_data: string }[][] = [
    [
      { text: "‹", callback_data: nav(prev.y, prev.m) },
      { text: `${MONTH_NAMES[mon]} ${year}`, callback_data: `cal:${flow}:x` },
      { text: "›", callback_data: nav(next.y, next.m) },
    ],
    ["M", "T", "W", "T", "F", "S", "S"].map((d) => ({ text: d, callback_data: `cal:${flow}:x` })),
  ];

  let week: { text: string; callback_data: string }[] = [];
  for (let i = 0; i < firstDow; i++) week.push({ text: " ", callback_data: `cal:${flow}:x` });

  for (let day = 1; day <= daysInMonth; day++) {
    const iso = ymd(day);
    const label = iso === selected ? `✅${day}` : iso === today ? `•${day}•` : String(day);
    week.push({ text: label, callback_data: `cal:${flow}:d:${iso}` });
    if (week.length === 7) {
      rows.push(week);
      week = [];
    }
  }
  if (week.length > 0) {
    while (week.length < 7) week.push({ text: " ", callback_data: `cal:${flow}:x` });
    rows.push(week);
  }

  // A one-tap shortcut for the overwhelmingly common case.
  rows.push([{ text: "📅 ዛሬ", callback_data: `cal:${flow}:d:${today}` }]);

  return { inline_keyboard: rows };
}
