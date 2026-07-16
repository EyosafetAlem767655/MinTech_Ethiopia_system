"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface ShiftReport {
  _id: string;
  date: string;
  shift: "day" | "night";
  supervisor: string;
  filledSacks: number;
  bagWeightKg?: number | null;
  downtimeMinutes: number;
  notes?: string | null;
}

/**
 * Two hues only — day and night are one dimension with two members, so they
 * take the first two slots of the validated categorical order.
 */
const DAY = "#2a78d6";
const NIGHT = "#008300";
const DOWNTIME = "#eb6834";

const INK_MUTED = "#a8a29e";
const GRID = "#f3e3dd";

const TIP_STYLE = {
  borderRadius: 12,
  border: "1px solid #f3e3dd",
  fontSize: 11,
  boxShadow: "0 8px 24px rgba(62,22,13,0.12)",
};

const fmtDay = (d: string) => {
  const dt = new Date(d);
  return `${dt.getDate()}/${dt.getMonth() + 1}`;
};

/** Tons only counts reports that recorded a bag weight — the rest contribute 0. */
const tonsOf = (r: ShiftReport) =>
  r.bagWeightKg && r.bagWeightKg > 0 ? (r.filledSacks * r.bagWeightKg) / 1000 : 0;

type View = "output" | "downtime" | "supervisors";

export default function ShiftCharts({ reports }: { reports: ShiftReport[] }) {
  const [view, setView] = useState<View>("output");

  const byDate = useMemo(() => {
    const m = new Map<string, { date: string; day: number; night: number; downtime: number }>();
    // Oldest first so the axis reads left→right in time.
    for (const r of [...reports].reverse()) {
      const key = fmtDay(r.date);
      const row = m.get(key) || { date: key, day: 0, night: 0, downtime: 0 };
      row[r.shift] += tonsOf(r);
      row.downtime += r.downtimeMinutes || 0;
      m.set(key, row);
    }
    return Array.from(m.values());
  }, [reports]);

  const bySupervisor = useMemo(() => {
    const m = new Map<string, { supervisor: string; tons: number; downtime: number; shifts: number }>();
    for (const r of reports) {
      const row = m.get(r.supervisor) || { supervisor: r.supervisor, tons: 0, downtime: 0, shifts: 0 };
      row.tons += tonsOf(r);
      row.downtime += r.downtimeMinutes || 0;
      row.shifts += 1;
      m.set(r.supervisor, row);
    }
    return Array.from(m.values()).sort((a, b) => b.tons - a.tons);
  }, [reports]);

  const totals = useMemo(() => {
    const tons = reports.reduce((a, r) => a + tonsOf(r), 0);
    const downtime = reports.reduce((a, r) => a + (r.downtimeMinutes || 0), 0);
    const sacks = reports.reduce((a, r) => a + (r.filledSacks || 0), 0);
    const unweighed = reports.filter((r) => !r.bagWeightKg).length;
    return { tons, downtime, sacks, unweighed };
  }, [reports]);

  if (reports.length === 0) {
    return (
      <div className="card p-6 text-center">
        <p className="text-sm text-stone-400">No shift reports yet.</p>
        <p className="mt-1 text-xs text-stone-400">
          Supervisors submit these with 🏭 የፈረቃ ሪፖርት in the Telegram bot.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Tons produced" value={totals.tons.toFixed(2)} tone="text-clay-900" />
        <Stat label="Sacks filled" value={totals.sacks.toLocaleString()} tone="text-clay-900" />
        <Stat
          label="Downtime"
          value={`${Math.round(totals.downtime / 60)}h`}
          tone={totals.downtime > 0 ? "text-orange-700" : "text-green-700"}
        />
      </div>

      {totals.unweighed > 0 && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          {totals.unweighed} report{totals.unweighed > 1 ? "s" : ""} recorded no bag weight, so they count as
          0&nbsp;tons. Sacks filled still includes them.
        </p>
      )}

      <div className="card p-4">
        <div className="mb-3 flex gap-1 overflow-x-auto rounded-full bg-clay-50 p-0.5 no-scrollbar">
          {(
            [
              ["output", "Output by shift"],
              ["downtime", "Downtime"],
              ["supervisors", "Supervisors"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setView(k)}
              className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] font-bold transition-all ${
                view === k ? "bg-white text-clay-800 shadow" : "text-clay-400"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {view === "output" && (
          <>
            <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-clay-500">
              Tons produced per day · day vs night
            </p>
            <div className="-ml-3 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byDate} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="28%">
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: INK_MUTED }} tickLine={false} axisLine={false} minTickGap={20} />
                  <YAxis tick={{ fontSize: 10, fill: INK_MUTED }} tickLine={false} axisLine={false} width={34} unit="t" />
                  <Tooltip contentStyle={TIP_STYLE} formatter={(v: number, n: string) => [`${Number(v).toFixed(2)} t`, n === "day" ? "Day shift" : "Night shift"]} />
                  <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v) => (v === "day" ? "Day shift" : "Night shift")} />
                  <Bar dataKey="day" stackId="s" fill={DAY} stroke="#ffffff" strokeWidth={1} animationDuration={400} />
                  <Bar dataKey="night" stackId="s" fill={NIGHT} stroke="#ffffff" strokeWidth={1} radius={[3, 3, 0, 0]} animationDuration={400} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}

        {view === "downtime" && (
          <>
            <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-clay-500">
              Downtime per day · minutes
            </p>
            <div className="-ml-3 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byDate} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="28%">
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: INK_MUTED }} tickLine={false} axisLine={false} minTickGap={20} />
                  <YAxis tick={{ fontSize: 10, fill: INK_MUTED }} tickLine={false} axisLine={false} width={34} unit="m" />
                  <Tooltip contentStyle={TIP_STYLE} formatter={(v: number) => [`${v} min`, "Downtime"]} />
                  <Bar dataKey="downtime" fill={DOWNTIME} radius={[3, 3, 0, 0]} animationDuration={400} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}

        {view === "supervisors" && (
          <>
            <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-clay-500">
              Output by supervisor · tonnes
            </p>
            <div className="space-y-2">
              {bySupervisor.map((s) => {
                const max = bySupervisor[0]?.tons || 1;
                const pct = max > 0 ? Math.round((s.tons / max) * 100) : 0;
                return (
                  <div key={s.supervisor} className="flex items-center gap-2">
                    <span className="w-24 shrink-0 truncate text-right text-[11px] font-bold text-stone-700">
                      {s.supervisor}
                    </span>
                    <div className="h-4 flex-1 overflow-hidden rounded-full bg-clay-50">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: DAY }} />
                    </div>
                    <span className="w-20 shrink-0 text-right text-[11px] font-bold tabular-nums text-clay-900">
                      {s.tons.toFixed(2)} t
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-xl border border-clay-100 bg-white p-3 text-center">
      <p className={`font-display text-lg font-bold ${tone}`}>{value}</p>
      <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400">{label}</p>
    </div>
  );
}
