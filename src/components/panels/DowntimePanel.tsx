"use client";

import { useEffect, useMemo, useState } from "react";
import RangeSelector from "@/components/RangeSelector";
import { ScrollTable } from "@/components/panels/TableChart";
import { RANGES, type RangeKey } from "@/lib/ranges";
import { HOURS_PER_DAY, MAINTENANCE_LABEL, REASON_LABEL } from "@/lib/downtime";

/**
 * Hours the plant was stopped, and why.
 *
 * Every figure here is read against the twelve-hour day — "4 hours down" means
 * nothing on its own, and a third of a day is what it actually says. The same
 * constant divides on the Brief, so the two cannot quote different percentages.
 *
 * Two stoppages on one day are two rows, because they had two reasons. The
 * totals add them; the table does not pretend they were one event.
 */

interface Row {
  _id: string;
  date: string;
  dateLabel: string;
  hours: string | number;
  reason: string;
  maintenanceKind: string | null;
  note: string | null;
  reportedBy: string;
}

const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const hrs = (n: number) => `${Math.round(n * 100) / 100} h`;
const pct = (n: number) => `${Math.round((n / HOURS_PER_DAY) * 1000) / 10}%`;

/* The reasons carry their own colour so the split reads at a glance. Checked as
   a set against the light surface, like the chart palettes. */
const REASON_TONE: Record<string, string> = {
  power: "bg-amber-100 text-amber-800",
  maintenance: "bg-blue-100 text-blue-800",
  raw_material: "bg-clay-100 text-clay-800",
};

export default function DowntimePanel() {
  const [range, setRange] = useState<RangeKey>("weekly");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let alive = true;
    setRows(null);
    fetch(`/api/downtime?range=${range}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        setRows(Array.isArray(d?.rows) ? d.rows : []);
        setUnavailable(Boolean(d?.unavailable));
      })
      .catch(() => {
        if (alive) setRows([]);
      });
    return () => {
      alive = false;
    };
  }, [range]);

  const summary = useMemo(() => {
    const list = rows ?? [];
    const total = list.reduce((a, r) => a + (Number(r.hours) || 0), 0);
    const byReason = new Map<string, number>();
    const days = new Set<string>();
    for (const r of list) {
      byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + (Number(r.hours) || 0));
      days.add(r.dateLabel);
    }
    return {
      total,
      days: days.size,
      // Share of the working hours in the days that actually lost time. Dividing
      // by every day in the window instead would bury a bad day in a good month.
      shareOfLostDays: days.size > 0 ? total / (days.size * HOURS_PER_DAY) : 0,
      byReason: [...byReason.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [rows]);

  if (rows === null) return <div className="card h-48 animate-pulse bg-clay-50" />;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
        <h2 className="font-display text-lg font-bold">⏱ Downtime</h2>
        <p className="text-[11px] text-stone-400">against a {HOURS_PER_DAY}-hour day</p>
      </div>

      <RangeSelector value={range} onChange={setRange} />

      {unavailable && (
        <p className="card p-3 text-xs text-amber-700">
          The downtime table is not in the database yet — apply migration 0035.
        </p>
      )}

      {rows.length > 0 && (
        <div className="card flex flex-wrap items-center justify-between gap-3 p-3">
          <div>
            <p className="font-display text-2xl font-bold text-clay-900">{hrs(summary.total)}</p>
            <p className="text-[10px] uppercase tracking-wide text-stone-400">
              lost over {summary.days} day{summary.days === 1 ? "" : "s"} ·{" "}
              {Math.round(summary.shareOfLostDays * 1000) / 10}% of those days
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {summary.byReason.map(([reason, hours]) => (
              <span
                key={reason}
                className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                  REASON_TONE[reason] || "bg-stone-100 text-stone-600"
                }`}
              >
                {REASON_LABEL[reason] || reason} · {hrs(hours)}
              </span>
            ))}
          </div>
        </div>
      )}

      <ScrollTable
        minWidth={620}
        empty={rows.length === 0}
        emptyLabel={`No downtime reported in the ${RANGES[range].label.toLowerCase()} window.`}
      >
        <thead className="sticky top-0 z-10 bg-clay-50 text-[10px] uppercase tracking-wide text-stone-500 shadow-[0_1px_0_#f3e3dd]">
          <tr>
            <th className="p-2 text-left font-bold">Date</th>
            <th className="p-2 font-bold">Hours</th>
            <th className="p-2 font-bold">Of day</th>
            <th className="p-2 text-left font-bold">Reason</th>
            <th className="p-2 text-left font-bold">Note</th>
            <th className="p-2 text-left font-bold">By</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const hours = Number(r.hours) || 0;
            return (
              <tr key={r._id} className="border-t border-clay-50">
                <td className="p-2 text-left font-semibold text-stone-800">{fmtDate(r.date)}</td>
                <td className="p-2 font-bold tabular-nums text-clay-900">{hrs(hours)}</td>
                <td className="p-2 tabular-nums text-stone-500">{pct(hours)}</td>
                <td className="p-2 text-left">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      REASON_TONE[r.reason] || "bg-stone-100 text-stone-600"
                    }`}
                  >
                    {REASON_LABEL[r.reason] || r.reason}
                  </span>
                  {r.maintenanceKind && (
                    <span className="ml-1 text-[10px] text-stone-500">
                      {MAINTENANCE_LABEL[r.maintenanceKind] || r.maintenanceKind}
                    </span>
                  )}
                </td>
                <td className="max-w-[16rem] p-2 text-left text-stone-600">{r.note || "—"}</td>
                <td className="p-2 text-left text-stone-500">{r.reportedBy}</td>
              </tr>
            );
          })}
        </tbody>
      </ScrollTable>
    </section>
  );
}
