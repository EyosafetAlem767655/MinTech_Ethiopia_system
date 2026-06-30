"use client";

import { useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface OpsReport {
  dateLabel: string;
  date: string;
  delivered?: Record<string, number>;
  received?: Record<string, number>;
  stock?: Record<string, number>;
  bags?: { kg25?: Record<string, number>; kg40?: Record<string, number> };
}

// Display names: ETL = Ethiopian Talc/Limestone (microns), EC = Ethiopian Calcium Carbonate (microns), EL grades
const LABEL: Record<string, string> = {
  ETL6: "ETL 6μ",
  ETL9: "ETL 9μ",
  ETL15: "ETL 15μ",
  EC15: "EC 15μ",
  EC90: "EC 90μ",
  "2EL": "EL Gr.2",
  "3EL": "EL Gr.3",
  "5EL": "EL Gr.5",
  Talk: "Talc",
};

// Color families: ETL = warm clay, EC = blue, EL = green, Talc = neutral
const COLOR: Record<string, string> = {
  ETL6: "#da674c",
  ETL9: "#c64d30",
  ETL15: "#8a3622",
  EC15: "#2563eb",
  EC90: "#60a5fa",
  "2EL": "#16a34a",
  "3EL": "#4ade80",
  "5EL": "#86efac",
  Talk: "#a8a29e",
};

const BAG_COLORS: Record<string, string> = {
  Yellow: "#eab308",
  White: "#a8a29e",
  Beige: "#d4b896",
  Green: "#16a34a",
};

function pl(p: string) { return LABEL[p] || p; }
function pc(p: string) { return COLOR[p] || "#c64d30"; }

function fmtDate(d: string) {
  const dt = new Date(d);
  return `${dt.getDate()}/${dt.getMonth() + 1}`;
}

const TIP_STYLE = {
  borderRadius: 12,
  border: "1px solid #f3e3dd",
  fontSize: 11,
  boxShadow: "0 8px 24px rgba(62,22,13,0.12)",
};

/* ─── Tab 1: Stock Snapshot — horizontal bar chart, every product visible ─── */
function SnapshotGrid({ latest }: { latest: OpsReport }) {
  const stock = latest.stock || {};
  const entries = Object.entries(stock).sort((a, b) => b[1] - a[1]);
  const max = entries[0]?.[1] || 1;

  if (entries.length === 0) {
    return <p className="text-xs text-stone-400 text-center py-6">No stock data in latest report.</p>;
  }

  return (
    <div className="space-y-2">
      {entries.map(([key, val]) => {
        const pct = Math.round((val / max) * 100);
        return (
          <div key={key} className="flex items-center gap-2">
            <span
              className="text-[11px] font-bold w-14 shrink-0 text-right"
              style={{ color: pc(key) }}
            >
              {pl(key)}
            </span>
            <div className="flex-1 bg-clay-50 rounded-full h-4 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${pct}%`, backgroundColor: pc(key) }}
              />
            </div>
            <span className="text-[11px] font-bold text-clay-900 tabular-nums w-16 text-right">
              {val % 1 === 0 ? val : val.toFixed(2)} t
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Tab 2: Daily Flow — stacked bars, every product as a segment ─── */
function DailyFlowChart({
  reports,
  products,
}: {
  reports: OpsReport[];
  products: string[];
}) {
  const [mode, setMode] = useState<"received" | "delivered">("received");

  const src = (r: OpsReport) => (mode === "received" ? r.received : r.delivered);

  const flowReports = reports.filter(
    (r) => src(r) && Object.keys(src(r)!).length > 0
  );

  if (flowReports.length === 0) {
    return (
      <p className="text-xs text-stone-400 text-center py-6">No data yet.</p>
    );
  }

  const data = flowReports.map((r) => ({ date: fmtDate(r.date), ...src(r) }));

  const visibleProducts = products.filter((p) =>
    flowReports.some((r) => src(r) && p in src(r)!)
  );

  return (
    <div>
      <div className="flex gap-1.5 mb-3">
        {(["received", "delivered"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-3 py-1.5 rounded-full text-[11px] font-bold transition-all ${
              mode === m
                ? m === "received"
                  ? "bg-green-600 text-white shadow"
                  : "bg-clay-700 text-white shadow"
                : "bg-clay-50 text-clay-400"
            }`}
          >
            {m === "received" ? "↓ Produced" : "↑ Delivered"}
          </button>
        ))}
      </div>
      <div className="h-56 -ml-3">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            barCategoryGap="28%"
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#f3e3dd"
              vertical={false}
            />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: "#a8a29e" }}
              tickLine={false}
              axisLine={false}
              minTickGap={20}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "#a8a29e" }}
              tickLine={false}
              axisLine={false}
              width={30}
              unit="t"
            />
            <Tooltip
              contentStyle={TIP_STYLE}
              formatter={(v: number, name: string) => [`${v} t`, pl(name)]}
            />
            <Legend
              wrapperStyle={{ fontSize: 10 }}
              formatter={(v) => pl(v)}
            />
            {visibleProducts.map((p, i) => (
              <Bar
                key={p}
                dataKey={p}
                name={p}
                stackId="a"
                fill={pc(p)}
                radius={
                  i === visibleProducts.length - 1
                    ? [3, 3, 0, 0]
                    : undefined
                }
                animationDuration={400}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ─── Tab 3: Stock Trend — line chart, filterable per product ─── */
function StockTrendChart({
  reports,
  products,
}: {
  reports: OpsReport[];
  products: string[];
}) {
  const [selected, setSelected] = useState<string[]>(products.slice(0, 4));
  const stockReports = reports.filter(
    (r) => r.stock && Object.keys(r.stock).length > 0
  );

  if (stockReports.length === 0) {
    return (
      <p className="text-xs text-stone-400 text-center py-6">
        No stock data yet.
      </p>
    );
  }

  const data = stockReports.map((r) => ({ date: fmtDate(r.date), ...r.stock }));

  const toggle = (p: string) =>
    setSelected((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
    );

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {products.map((p) => (
          <button
            key={p}
            onClick={() => toggle(p)}
            className={`px-2.5 py-1 rounded-full text-[10px] font-bold transition-all ${
              selected.includes(p)
                ? "text-white shadow"
                : "bg-clay-50 text-stone-400"
            }`}
            style={
              selected.includes(p) ? { backgroundColor: pc(p) } : undefined
            }
          >
            {pl(p)}
          </button>
        ))}
      </div>
      <div className="h-52 -ml-3">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#f3e3dd"
              vertical={false}
            />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: "#a8a29e" }}
              tickLine={false}
              axisLine={false}
              minTickGap={24}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "#a8a29e" }}
              tickLine={false}
              axisLine={false}
              width={34}
              unit="t"
            />
            <Tooltip
              contentStyle={TIP_STYLE}
              formatter={(v: number, name: string) => [`${v} t`, pl(name)]}
            />
            {selected.map((p) => (
              <Line
                key={p}
                type="monotone"
                dataKey={p}
                stroke={pc(p)}
                strokeWidth={2}
                dot={false}
                animationDuration={400}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ─── Tab 4: Bag Inventory ─── */
function BagInventoryChart({ reports }: { reports: OpsReport[] }) {
  const [bagSize, setBagSize] = useState<"kg25" | "kg40">("kg25");
  const bagReports = reports.filter(
    (r) =>
      r.bags?.[bagSize] && Object.keys(r.bags[bagSize]!).length > 0
  );

  if (bagReports.length === 0) {
    return (
      <p className="text-xs text-stone-400 text-center py-6">
        No bag inventory data yet.
      </p>
    );
  }

  const colorKeys = Array.from(
    new Set(bagReports.flatMap((r) => Object.keys(r.bags?.[bagSize] || {})))
  );
  const data = bagReports.map((r) => ({
    date: fmtDate(r.date),
    ...r.bags?.[bagSize],
  }));

  return (
    <div>
      <div className="flex gap-1.5 mb-3">
        {(["kg25", "kg40"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setBagSize(s)}
            className={`px-3 py-1 rounded-full text-[11px] font-bold transition-all ${
              bagSize === s
                ? "bg-clay-700 text-white shadow"
                : "bg-clay-50 text-clay-700"
            }`}
          >
            {s === "kg25" ? "25 Kg bags" : "40 Kg bags"}
          </button>
        ))}
      </div>
      <div className="h-52 -ml-3">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          >
            <defs>
              {colorKeys.map((k) => (
                <linearGradient
                  key={k}
                  id={`bg-${k}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset="0%"
                    stopColor={BAG_COLORS[k] || "#a8a29e"}
                    stopOpacity={0.5}
                  />
                  <stop
                    offset="100%"
                    stopColor={BAG_COLORS[k] || "#a8a29e"}
                    stopOpacity={0.05}
                  />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#f3e3dd"
              vertical={false}
            />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: "#a8a29e" }}
              tickLine={false}
              axisLine={false}
              minTickGap={24}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "#a8a29e" }}
              tickLine={false}
              axisLine={false}
              width={40}
              tickFormatter={(v: number) =>
                v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)
              }
            />
            <Tooltip
              contentStyle={TIP_STYLE}
              formatter={(v: number, name: string) => [
                v.toLocaleString() + " pcs",
                name,
              ]}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {colorKeys.map((k) => (
              <Area
                key={k}
                type="monotone"
                dataKey={k}
                stroke={BAG_COLORS[k] || "#a8a29e"}
                strokeWidth={2}
                fill={`url(#bg-${k})`}
                animationDuration={400}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

const TABS = ["Snapshot", "Daily Flow", "Stock Trend", "Bags"] as const;

export default function OpsReportCharts({
  reports,
  products,
  latest,
}: {
  reports: OpsReport[];
  products: string[];
  latest: OpsReport | null;
}) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Snapshot");

  if (reports.length === 0) {
    return (
      <div className="card p-4 text-center text-stone-400 text-sm">
        No operations reports yet.
        <br />
        <span className="text-xs">
          Use 📊 Daily ops report in the Telegram bot to submit data.
        </span>
      </div>
    );
  }

  return (
    <div className="card p-4">
      <div className="flex gap-1 bg-clay-50 rounded-full p-0.5 mb-4 overflow-x-auto no-scrollbar">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-full text-[11px] font-bold whitespace-nowrap transition-all ${
              tab === t ? "bg-white text-clay-800 shadow" : "text-clay-400"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Snapshot" && (
        <>
          <p className="text-[10px] font-bold tracking-widest uppercase text-clay-500 mb-3">
            Current stock · {latest?.dateLabel} · tonnes
          </p>
          {latest ? (
            <SnapshotGrid latest={latest} />
          ) : (
            <p className="text-xs text-stone-400 text-center py-6">
              No snapshot available.
            </p>
          )}
        </>
      )}

      {tab === "Daily Flow" && (
        <>
          <p className="text-[10px] font-bold tracking-widest uppercase text-clay-500 mb-3">
            Produced vs delivered per day · tonnes · all products stacked
          </p>
          <DailyFlowChart reports={reports} products={products} />
        </>
      )}

      {tab === "Stock Trend" && (
        <>
          <p className="text-[10px] font-bold tracking-widest uppercase text-clay-500 mb-3">
            Stock levels over time · tonnes
          </p>
          <StockTrendChart reports={reports} products={products} />
        </>
      )}

      {tab === "Bags" && (
        <>
          <p className="text-[10px] font-bold tracking-widest uppercase text-clay-500 mb-3">
            Bag inventory trend · pieces
          </p>
          <BagInventoryChart reports={reports} />
        </>
      )}
    </div>
  );
}
