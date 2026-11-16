"use client";

import { useState } from "react";
import {
  RANGE_LIST,
  customRangeDays,
  customRangeKey,
  customRangeLabel,
  isCustomRange,
  isMonthRange,
  monthRangeLabel,
  rangeWindow,
  recentMonthRanges,
  type RangeKey,
} from "@/lib/ranges";

/** Today in EAT as "YYYY-MM-DD". */
function todayEat(): string {
  return new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
}

/** The EAT day a window instant falls on, as "YYYY-MM-DD". */
function eatDay(d: Date): string {
  return new Date(d.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * The global six-window time-range control shared by every department report,
 * plus a "📅 Month" pick for one calendar month on its own, and "🗓 Dates" for
 * any from–to range or one single day.
 *
 * `keys` narrows the rolling windows to a subset, in RANGES order — the sales
 * analytics offer only the windows long enough to show a pattern. The month
 * and date picks are always offered.
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
  const customOn = isCustomRange(value);

  const [open, setOpen] = useState(false);
  const [oneDay, setOneDay] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const openDates = () => {
    if (open) return setOpen(false);
    // Start from what is showing, so "the same, but a week shorter" is one edit.
    if (customOn) {
      const d = customRangeDays(value);
      setFrom(d.from);
      setTo(d.to);
      setOneDay(d.from === d.to);
    } else {
      const w = rangeWindow(value);
      setFrom(eatDay(w.start));
      setTo(eatDay(new Date(w.end.getTime() - 1)));
    }
    setOpen(true);
  };

  const valid = Boolean(from) && (oneDay || Boolean(to));
  const apply = () => {
    if (!valid) return;
    onChange(customRangeKey(from, oneDay ? from : to));
    setOpen(false);
  };

  const today = todayEat();

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1 rounded-full bg-clay-50 p-0.5 overflow-x-auto no-scrollbar">
        {list.map((r) => (
          <button
            key={r.key}
            onClick={() => {
              setOpen(false);
              onChange(r.key);
            }}
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
          onChange={(e) => {
            setOpen(false);
            if (e.target.value) onChange(e.target.value as RangeKey);
          }}
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
        <button
          onClick={openDates}
          aria-expanded={open}
          aria-current={customOn ? "true" : undefined}
          className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] font-bold transition-all duration-300 ${
            customOn || open ? "bg-white text-clay-800 shadow" : "text-clay-400 hover:text-clay-600"
          }`}
        >
          🗓 {customOn ? customRangeLabel(value) : "Dates"}
        </button>
      </div>

      {open && (
        <div className="mt-2 flex flex-wrap items-end gap-2 rounded-xl border border-clay-100 bg-white p-3 shadow-sm">
          <label className="flex items-center gap-1.5 text-[11px] font-bold text-stone-600">
            <input type="checkbox" checked={oneDay} onChange={(e) => setOneDay(e.target.checked)} />
            One day
          </label>
          <label className="text-[11px] font-bold text-stone-500">
            {oneDay ? "Day" : "From"}
            <input
              type="date"
              value={from}
              max={today}
              onChange={(e) => setFrom(e.target.value)}
              className="mt-0.5 block rounded-lg border border-clay-200 px-2 py-1 text-xs text-stone-800"
            />
          </label>
          {!oneDay && (
            <label className="text-[11px] font-bold text-stone-500">
              To
              <input
                type="date"
                value={to}
                min={from || undefined}
                max={today}
                onChange={(e) => setTo(e.target.value)}
                className="mt-0.5 block rounded-lg border border-clay-200 px-2 py-1 text-xs text-stone-800"
              />
            </label>
          )}
          <button
            onClick={apply}
            disabled={!valid}
            className="rounded-lg bg-clay-700 px-3 py-1.5 text-xs font-bold text-white transition active:scale-[0.98] disabled:opacity-40"
          >
            Apply
          </button>
          <button onClick={() => setOpen(false)} className="px-2 py-1.5 text-xs font-bold text-stone-400">
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
