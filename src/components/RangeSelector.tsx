"use client";

import { RANGE_LIST, type RangeKey } from "@/lib/ranges";

/**
 * The global six-window time-range control shared by every department report.
 *
 * `keys` narrows it to a subset, in RANGES order — the sales analytics offer
 * only the four windows long enough to show a pattern.
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
  return (
    <div className="flex gap-1 rounded-full bg-clay-50 p-0.5 overflow-x-auto no-scrollbar">
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
    </div>
  );
}
