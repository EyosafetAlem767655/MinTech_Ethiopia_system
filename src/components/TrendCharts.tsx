"use client";

import { useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface TrendPoint {
  date: string;
  production: number;
  sales: number;
  collections: number;
}

const METRICS = [
  { key: "production", label: "Production", unit: "sacks", color: "#c64d30" },
  { key: "sales", label: "Sales", unit: "ETB", color: "#8a3622" },
  { key: "collections", label: "Collections", unit: "ETB", color: "#da674c" },
] as const;

const RANGES = [
  { key: "d7", label: "7D" },
  { key: "d30", label: "30D" },
  { key: "d90", label: "90D" },
] as const;

export default function TrendCharts({
  series,
}: {
  series: { d7: TrendPoint[]; d30: TrendPoint[]; d90: TrendPoint[] };
}) {
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("d7");
  const [metric, setMetric] = useState<(typeof METRICS)[number]>(METRICS[0]);
  const data = series[range] || [];

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
          {METRICS.map((m) => (
            <button
              key={m.key}
              onClick={() => setMetric(m)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-300 whitespace-nowrap ${
                metric.key === m.key
                  ? "bg-clay-700 text-white shadow-md shadow-clay-200"
                  : "bg-clay-50 text-clay-800"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1 bg-clay-50 rounded-full p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-all duration-300 ${
                range === r.key ? "bg-white text-clay-800 shadow" : "text-clay-400"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <div className="h-52 -ml-3">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={`grad-${metric.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={metric.color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={metric.color} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3e3dd" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: "#a8a29e" }}
              tickFormatter={(d: string) => d.slice(5)}
              tickLine={false}
              axisLine={false}
              minTickGap={28}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "#a8a29e" }}
              tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
              tickLine={false}
              axisLine={false}
              width={36}
            />
            <Tooltip
              contentStyle={{
                borderRadius: 12,
                border: "1px solid #f3e3dd",
                fontSize: 12,
                boxShadow: "0 8px 24px rgba(62,22,13,0.12)",
              }}
              formatter={(v: number) => [`${v.toLocaleString()} ${metric.unit}`, metric.label]}
            />
            <Area
              type="monotone"
              dataKey={metric.key}
              stroke={metric.color}
              strokeWidth={2.5}
              fill={`url(#grad-${metric.key})`}
              animationDuration={700}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
