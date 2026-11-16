"use client";

import { useState } from "react";
import { EXPORT_DATASETS, type ExportDatasetKey } from "@/lib/export-keys";
import { rangeWindow, type RangeKey } from "@/lib/ranges";

/** A day in EAT as "YYYY-MM-DD". */
const eatDay = (d: Date) => new Date(d.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);

const shift = (day: string, days: number) => eatDay(new Date(new Date(`${day}T12:00:00+03:00`).getTime() + days * 86_400_000));

/** The From / To of a quick pick, ending today (EAT). */
function quick(kind: "today" | "week" | "month" | "lastMonth"): { from: string; to: string } {
  const today = eatDay(new Date());
  if (kind === "today") return { from: today, to: today };
  if (kind === "week") return { from: shift(today, -6), to: today };
  const [y, m] = today.split("-").map(Number);
  if (kind === "month") return { from: `${today.slice(0, 7)}-01`, to: today };
  const first = new Date(Date.UTC(y, m - 2, 1));
  const last = new Date(Date.UTC(y, m - 1, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

/**
 * ⬇ Excel: the section's records for the days picked, as a spreadsheet.
 *
 * Opens on the range the section is showing (`range`), or this month. The
 * download is a plain link, so it works the same on a phone.
 */
export default function ExcelExport({
  dataset,
  range,
  className = "",
}: {
  dataset: ExportDatasetKey;
  range?: RangeKey;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const start = () => {
    if (open) return setOpen(false);
    if (range) {
      const w = rangeWindow(range);
      setFrom(eatDay(w.start));
      setTo(eatDay(new Date(Math.min(w.end.getTime(), Date.now() + 86_400_000) - 1)));
    } else {
      const q = quick("month");
      setFrom(q.from);
      setTo(q.to);
    }
    setOpen(true);
  };

  const valid = Boolean(from && to && from <= to);
  const href = `/api/export/xlsx?dataset=${dataset}&from=${from}&to=${to}`;

  return (
    <div className={`relative inline-block ${className}`}>
      <button
        onClick={start}
        aria-expanded={open}
        title={`Download ${EXPORT_DATASETS[dataset]} as Excel`}
        className="whitespace-nowrap rounded-full bg-green-50 px-3 py-1 text-[11px] font-bold text-green-800 ring-1 ring-green-200 transition hover:bg-green-100"
      >
        ⬇ Excel
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-[17rem] max-w-[calc(100vw-2rem)] rounded-xl border border-clay-100 bg-white p-3 text-left shadow-lg">
          <p className="text-xs font-bold text-stone-800">{EXPORT_DATASETS[dataset]} to Excel</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {([
              ["today", "Today"],
              ["week", "Last 7 days"],
              ["month", "This month"],
              ["lastMonth", "Last month"],
            ] as const).map(([k, label]) => (
              <button
                key={k}
                onClick={() => {
                  const q = quick(k);
                  setFrom(q.from);
                  setTo(q.to);
                }}
                className="rounded-full bg-clay-50 px-2 py-0.5 text-[10px] font-bold text-clay-700 hover:bg-clay-100"
              >
                {label}
              </button>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="text-[11px] font-bold text-stone-500">
              From
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="mt-0.5 block w-full rounded-lg border border-clay-200 px-1.5 py-1 text-xs text-stone-800"
              />
            </label>
            <label className="text-[11px] font-bold text-stone-500">
              To
              <input
                type="date"
                value={to}
                min={from || undefined}
                onChange={(e) => setTo(e.target.value)}
                className="mt-0.5 block w-full rounded-lg border border-clay-200 px-1.5 py-1 text-xs text-stone-800"
              />
            </label>
          </div>
          {!valid && from && to && <p className="mt-1 text-[11px] text-red-700">From must be on or before To.</p>}
          <div className="mt-3 flex items-center justify-between gap-2">
            <button onClick={() => setOpen(false)} className="text-xs font-bold text-stone-400">
              Close
            </button>
            <a
              href={valid ? href : undefined}
              aria-disabled={!valid}
              onClick={(e) => {
                if (!valid) e.preventDefault();
                else setTimeout(() => setOpen(false), 300);
              }}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold text-white ${valid ? "bg-green-700" : "pointer-events-none bg-stone-300"}`}
            >
              Download .xlsx
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
