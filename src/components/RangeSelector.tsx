"use client";

import { RANGE_LIST, isMonthRange, monthRangeLabel, recentMonthRanges, type RangeKey } from "@/lib/ranges";

/**
 * The global six-window time-range control shared by every department report,
 * plus a "📅 Month" pick for one calendar month on its own.
 *
 * `keys` narrows the rolling windows to a subset, in RANGES order — the sales
 * analytics offer only the windows long enough to show a pattern. The month
 * pick is always offered: a whole month is long enough everywhere.
 */
export default function RangeSelector({
  value,
  onChange,
  keys,
  labels,
}: {
  value: RangeKey;
  onChange: (key: RangeKey) => void;
  keys?: RangeKey[];
  /**
   * Override a window's wording for one screen.
   *
   * "Daily" reads correctly beside a trend chart and wrongly beside a list of
   * readings, where the same window means "today only". The windows, their
   * order and this control stay one implementation; only the word changes.
   */
  labels?: Partial<Record<RangeKey, string>>;
}) {
  const list = keys ? RANGE_LIST.filter((r) => keys.includes(r.key)) : RANGE_LIST;
  const months = recentMonthRanges();
  const monthOn = isMonthRange(value);
  return (
    <div className="flex items-center gap-1 rounded-full bg-clay-50 p-0.5 overflow-x-auto no-scrollbar">
      {list.map((r) => (
        <button
          key={r.key}
          onClick={() => onChange(r.key)}
          aria-current={value === r.key ? "true" : undefined}
          className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold transition-all duration-300 ${
            value === r.key ? "bg-white text-clay-800 shadow" : "text-clay-400 hover:text-clay-600"
          }`}
        >
          {labels?.[r.key] ?? r.label}
        </button>
      ))}
      <select
        aria-label="Pick a month"
        value={monthOn ? value : ""}
        onChange={(e) => e.target.value && onChange(e.target.value as RangeKey)}
        className={`shrink-0 cursor-pointer appearance-none rounded-full border-0 px-3 py-1.5 text-[11px] font-bold outline-none transition-all duration-300 ${
          monthOn ? "bg-white text-clay-800 shadow" : "bg-transparent text-clay-400 hover:text-clay-600"
        }`}
      >
        <option value="">📅 Month</option>
        {months.map((m) => (
          <option key={m} value={m}>
            {monthRangeLabel(m)}
          </option>
        ))}
      </select>
    </div>
  );
}
