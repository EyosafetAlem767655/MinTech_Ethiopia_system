"use client";

import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ScrollTable } from "@/components/panels/TableChart";
import { HOURS_KINDS, HOURS_LABEL, LOST_KINDS, fmtHours, type HoursCell, type HoursKind } from "@/lib/downtime-sheet";

/**
 * The monthly Production Hours Report, as the plant's own sheet lays it out.
 *
 * One row per production line: hours (h:mm) and days working, stopped by a
 * power interruption, stopped for mechanical or electrical maintenance, short
 * of raw material, and the month's total. The table is the sheet; the chart
 * under it is where each line's month went, so "Line 2 lost a week to
 * mechanical maintenance" is visible without adding columns up.
 */

interface Line {
  line: number;
  cells: Record<HoursKind, HoursCell>;
}
interface Month {
  month: string;
  reportedBy: string;
  lines: Line[];
}

/* Working time is the background the stoppages are read against, so it is a
   recessive grey; the four ways time is lost take the first four slots of the
   validated categorical order (adjacent pairs pass CVD and normal-vision
   separation). Yellow sits under 3:1 contrast, which the table above relieves. */
const TONE: Record<HoursKind, string> = {
  working: "#d6d3d1",
  power: "#2a78d6",
  mech: "#eb6834",
  elec: "#1baf7a",
  raw: "#eda100",
  total: "#57534e",
};

const GRID = "#f3e3dd";
const TICK = { fontSize: 10, fill: "#a8a29e" };
const monthName = (m: string) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

export default function DowntimePanel() {
  const [months, setMonths] = useState<Month[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [pick, setPick] = useState("");

  useEffect(() => {
    let alive = true;
    fetch("/api/downtime")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        const list: Month[] = Array.isArray(d?.months) ? d.months : [];
        setMonths(list);
        setUnavailable(Boolean(d?.unavailable));
        setPick((p) => p || list[0]?.month || "");
      })
      .catch(() => alive && setMonths([]));
    return () => {
      alive = false;
    };
  }, []);

  const current = useMemo(() => months?.find((m) => m.month === pick) ?? months?.[0] ?? null, [months, pick]);

  // Hours, not minutes, on the chart: the axis reads as the sheet does.
  const chart = useMemo(
    () =>
      (current?.lines ?? []).map((l) => ({
        name: `Line ${l.line}`,
        ...Object.fromEntries(HOURS_KINDS.filter((k) => k !== "total").map((k) => [k, Math.round((l.cells[k].minutes / 60) * 100) / 100])),
      })),
    [current]
  );

  if (months === null) return <div className="card h-48 animate-pulse bg-clay-50" />;

  const lostTotal = (current?.lines ?? []).reduce((a, l) => a + LOST_KINDS.reduce((b, k) => b + l.cells[k].minutes, 0), 0);
  const allTotal = (current?.lines ?? []).reduce((a, l) => a + l.cells.total.minutes, 0);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
        <h2 className="font-display text-lg font-bold">⏱ Production hours</h2>
        {months.length > 0 && (
          <select
            className="rounded-lg border border-clay-100 bg-white px-2 py-1 text-xs font-bold text-clay-800"
            value={current?.month ?? ""}
            onChange={(e) => setPick(e.target.value)}
            aria-label="Month"
          >
            {months.map((m) => (
              <option key={m.month} value={m.month}>
                {monthName(m.month)}
              </option>
            ))}
          </select>
        )}
      </div>

      {unavailable && (
        <p className="card p-3 text-xs text-amber-700">
          The production hours table is not in the database yet — apply migration 0040.
        </p>
      )}

      {months.length === 0 ? (
        <p className="card p-4 text-sm text-stone-400">
          No Production Hours Report filed yet. It is filed once a month from the bot (⏱), from a photo of the sheet.
        </p>
      ) : (
        current && (
          <>
            <div className="card flex flex-wrap items-center justify-between gap-3 p-3">
              <div>
                <p className="font-display text-2xl font-bold text-clay-900">{fmtHours(lostTotal)} h</p>
                <p className="text-[10px] uppercase tracking-wide text-stone-400">
                  lost across {current.lines.length} line{current.lines.length === 1 ? "" : "s"} ·{" "}
                  {allTotal ? Math.round((lostTotal / allTotal) * 1000) / 10 : 0}% of {fmtHours(allTotal)} h
                </p>
              </div>
              <p className="text-[11px] text-stone-400">{monthName(current.month)} · filed by {current.reportedBy}</p>
            </div>

            {/* The sheet itself. */}
            <ScrollTable minWidth={760} empty={current.lines.length === 0} emptyLabel="No lines on this month's sheet.">
              <thead className="sticky top-0 z-10 bg-clay-50 text-[10px] uppercase tracking-wide text-stone-500 shadow-[0_1px_0_#f3e3dd]">
                <tr>
                  <th className="p-2 text-left font-bold" rowSpan={2}>Line</th>
                  {HOURS_KINDS.map((k) => (
                    <th key={k} className="p-2 text-center font-bold" colSpan={2}>
                      {k === "mech" || k === "elec" ? `Maint. ${HOURS_LABEL[k].toLowerCase()}` : HOURS_LABEL[k]}
                    </th>
                  ))}
                </tr>
                <tr>
                  {HOURS_KINDS.flatMap((k) => [
                    <th key={`${k}h`} className="px-2 pb-1 font-semibold normal-case">Hours</th>,
                    <th key={`${k}d`} className="px-2 pb-1 font-semibold normal-case">Days</th>,
                  ])}
                </tr>
              </thead>
              <tbody>
                {current.lines.map((l) => (
                  <tr key={l.line} className="border-t border-clay-50">
                    <td className="p-2 text-left font-bold text-stone-800">{l.line}</td>
                    {HOURS_KINDS.flatMap((k) => [
                      <td key={`${k}h`} className={`p-2 tabular-nums ${k === "total" ? "font-bold text-clay-900" : "text-stone-700"}`}>
                        {fmtHours(l.cells[k].minutes)}
                      </td>,
                      <td key={`${k}d`} className="p-2 tabular-nums text-stone-500">
                        {l.cells[k].days || (l.cells[k].minutes ? "0" : "-")}
                      </td>,
                    ])}
                  </tr>
                ))}
              </tbody>
            </ScrollTable>

            {/* Where each line's month went. */}
            <div className="card p-4">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-clay-500">Hours by line</p>
              <div style={{ height: 44 * chart.length + 70 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chart} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 4 }} barCategoryGap={10}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
                    <XAxis type="number" tick={TICK} tickLine={false} axisLine={false} unit=" h" />
                    <YAxis type="category" dataKey="name" width={52} tick={{ ...TICK, fill: "#57534e" }} tickLine={false} axisLine={false} />
                    <Tooltip
                      cursor={{ fill: "rgba(0,0,0,0.04)" }}
                      contentStyle={{ borderRadius: 12, border: "1px solid #f3e3dd", fontSize: 12 }}
                      formatter={(v: number, key) => [`${fmtHours(Math.round(v * 60))} h`, HOURS_LABEL[key as HoursKind] ?? String(key)]}
                    />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} formatter={(k) => HOURS_LABEL[k as HoursKind] ?? k} />
                    {HOURS_KINDS.filter((k) => k !== "total").map((k, i, all) => (
                      <Bar
                        key={k}
                        dataKey={k}
                        stackId="h"
                        fill={TONE[k]}
                        stroke="#fff"
                        strokeWidth={2}
                        maxBarSize={26}
                        radius={i === all.length - 1 ? [0, 4, 4, 0] : 0}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </>
        )
      )}
    </section>
  );
}
