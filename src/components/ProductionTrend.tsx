"use client";

import { useMemo } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { OpsReport } from "@/components/OpsReportCharts";

/**
 * Production trend, driven by the ops reports the dashboard already fetches.
 *
 * Two one-axis lines in tonnes, per report date:
 *   • Delivered — production output  (sum of report.delivered)
 *   • Received  — raw-material input (sum of report.received)
 *
 * It reads the SAME data as OpsReportCharts, so it can never fall out of sync
 * with them or go silent — unlike the rolling-window trend, which reads
 * shift_reports and shows nothing until a shift report exists for the window.
 */

const DELIVERED = "#2a78d6"; // validated categorical slot 1 (blue)
const RECEIVED = "#008300"; // slot 2 (green)
const INK_MUTED = "#a8a29e";
const GRID = "#f3e3dd";

const sumValues = (m?: Record<string, number>) =>
  m ? Object.values(m).reduce((a, b) => a + (Number(b) || 0), 0) : 0;

const fmtDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth() + 1}`;
};

export default function ProductionTrend({ reports }: { reports: OpsReport[] }) {
  const { data, totalDelivered, totalReceived, days } = useMemo(() => {
    // Oldest → newest so the axis reads left-to-right in time.
    const ordered = [...reports].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );
    const rows = ordered.map((r) => ({
      date: fmtDay(r.date),
      delivered: Math.round(sumValues(r.delivered) * 100) / 100,
      received: Math.round(sumValues(r.received) * 100) / 100,
    }));
    return {
      data: rows,
      totalDelivered: rows.reduce((a, r) => a + r.delivered, 0),
      totalReceived: rows.reduce((a, r) => a + r.received, 0),
      days: rows.length,
    };
  }, [reports]);

  if (days === 0) {
    return (
      <div className="card p-6 text-center">
        <p className="text-sm text-stone-400">No operations reports yet.</p>
        <p className="mt-1 text-xs text-stone-400">
          Submit 📊 የዕለታዊ ክንውን ሪፖርት in the Telegram bot to populate this.
        </p>
      </div>
    );
  }

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-end justify-between">
        <p className="text-[11px] font-bold uppercase tracking-widest text-clay-500">
          Production trend · tonnes/day · {days} days
        </p>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <Stat label="Delivered (output)" value={totalDelivered} color={DELIVERED} />
        <Stat label="Received (input)" value={totalReceived} color={RECEIVED} />
      </div>

      <div className="-ml-3 h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: INK_MUTED }}
              tickLine={false}
              axisLine={false}
              minTickGap={24}
            />
            <YAxis
              tick={{ fontSize: 10, fill: INK_MUTED }}
              tickLine={false}
              axisLine={false}
              width={34}
              unit="t"
            />
            <Tooltip
              contentStyle={{
                borderRadius: 12,
                border: "1px solid #f3e3dd",
                fontSize: 11,
                boxShadow: "0 8px 24px rgba(62,22,13,0.12)",
              }}
              formatter={(v: number, name: string) => [
                `${Number(v).toFixed(2)} t`,
                name === "delivered" ? "Delivered" : "Received",
              ]}
            />
            <Legend
              wrapperStyle={{ fontSize: 11 }}
              formatter={(v) => (v === "delivered" ? "Delivered (output)" : "Received (input)")}
            />
            <Line
              type="monotone"
              dataKey="delivered"
              stroke={DELIVERED}
              strokeWidth={2}
              dot={false}
              animationDuration={500}
            />
            <Line
              type="monotone"
              dataKey="received"
              stroke={RECEIVED}
              strokeWidth={2}
              dot={false}
              animationDuration={500}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-xl border border-clay-100 bg-white p-3">
      <div className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
        <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400">{label}</p>
      </div>
      <p className="mt-1 font-display text-lg font-bold text-clay-900 tabular-nums">
        {value.toFixed(2)} <span className="text-xs font-semibold text-stone-400">t</span>
      </p>
    </div>
  );
}
