"use client";

import { useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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

const PRODUCT_COLORS = [
  "#c64d30", "#8a3622", "#da674c", "#e8855c", "#2563eb",
  "#16a34a", "#ca8a04", "#9333ea", "#0891b2",
];

const BAG_COLORS: Record<string, string> = {
  Yellow: "#eab308",
  White: "#a8a29e",
  Beige: "#d4b896",
  Green: "#16a34a",
};

function fmtDate(d: string) {
  // d is ISO date string from MongoDB
  const dt = new Date(d);
  return `${dt.getDate()}/${dt.getMonth() + 1}`;
}

/* ─── 1. Stock Trend ─── */
function StockTrendChart({ reports, products }: { reports: OpsReport[]; products: string[] }) {
  const stockReports = reports.filter((r) => r.stock && Object.keys(r.stock).length > 0);
  const [selected, setSelected] = useState<string[]>(products.slice(0, 3));

  if (stockReports.length === 0) {
    return <p className="text-xs text-stone-400 text-center py-6">No stock data yet.</p>;
  }

  const data = stockReports.map((r) => ({
    date: fmtDate(r.date),
    ...r.stock,
  }));

  const toggle = (p: string) =>
    setSelected((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {products.map((p, i) => (
          <button
            key={p}
            onClick={() => toggle(p)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-all ${
              selected.includes(p)
                ? "text-white shadow"
                : "bg-clay-50 text-stone-400"
            }`}
            style={selected.includes(p) ? { backgroundColor: PRODUCT_COLORS[i % PRODUCT_COLORS.length] } : {}}
          >
            {p}
          </button>
        ))}
      </div>
      <div className="h-52 -ml-3">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3e3dd" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#a8a29e" }} tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis tick={{ fontSize: 10, fill: "#a8a29e" }} tickLine={false} axisLine={false} width={36}
              tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)} />
            <Tooltip
              contentStyle={{ borderRadius: 12, border: "1px solid #f3e3dd", fontSize: 12, boxShadow: "0 8px 24px rgba(62,22,13,0.12)" }}
              formatter={(v: number, name: string) => [`${v}`, name]}
            />
            {selected.map((p, i) => (
              <Line
                key={p}
                type="monotone"
                dataKey={p}
                stroke={PRODUCT_COLORS[products.indexOf(p) % PRODUCT_COLORS.length]}
                strokeWidth={2}
                dot={false}
                animationDuration={500}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ─── 2. Daily Flow: Received vs Delivered ─── */
function FlowChart({ reports, products }: { reports: OpsReport[]; products: string[] }) {
  const [product, setProduct] = useState(products[0] || "");

  const flowReports = reports.filter(
    (r) =>
      (r.received && product in r.received) ||
      (r.delivered && product in r.delivered)
  );

  if (!product || flowReports.length === 0) {
    return <p className="text-xs text-stone-400 text-center py-6">No flow data yet.</p>;
  }

  const data = flowReports.map((r) => ({
    date: fmtDate(r.date),
    received: r.received?.[product] ?? 0,
    delivered: r.delivered?.[product] ?? 0,
    net: (r.received?.[product] ?? 0) - (r.delivered?.[product] ?? 0),
  }));

  return (
    <div>
      <div className="flex gap-1.5 flex-wrap mb-3">
        {products.map((p) => (
          <button
            key={p}
            onClick={() => setProduct(p)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-all ${
              product === p ? "bg-clay-700 text-white shadow" : "bg-clay-50 text-clay-700"
            }`}
          >
            {p}
          </button>
        ))}
      </div>
      <div className="h-52 -ml-3">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="30%">
            <CartesianGrid strokeDasharray="3 3" stroke="#f3e3dd" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#a8a29e" }} tickLine={false} axisLine={false} minTickGap={20} />
            <YAxis tick={{ fontSize: 10, fill: "#a8a29e" }} tickLine={false} axisLine={false} width={36} />
            <Tooltip
              contentStyle={{ borderRadius: 12, border: "1px solid #f3e3dd", fontSize: 12 }}
              formatter={(v: number, name: string) => [`${v}`, name]}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="received" name="Received ↓" fill="#16a34a" radius={[4, 4, 0, 0]} />
            <Bar dataKey="delivered" name="Delivered ↑" fill="#c64d30" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ─── 3. Bag Inventory ─── */
function BagInventoryChart({ reports }: { reports: OpsReport[] }) {
  const [bagSize, setBagSize] = useState<"kg25" | "kg40">("kg25");

  const bagReports = reports.filter((r) => r.bags?.[bagSize] && Object.keys(r.bags[bagSize]!).length > 0);

  if (bagReports.length === 0) {
    return <p className="text-xs text-stone-400 text-center py-6">No bag inventory data yet.</p>;
  }

  const colorKeys = Array.from(
    new Set(bagReports.flatMap((r) => Object.keys(r.bags?.[bagSize] || {})))
  );

  const data = bagReports.map((r) => ({
    date: fmtDate(r.date),
    ...r.bags?.[bagSize],
  }));

  const fmtBag = (v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v));

  return (
    <div>
      <div className="flex gap-1.5 mb-3">
        {(["kg25", "kg40"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setBagSize(s)}
            className={`px-3 py-1 rounded-full text-[11px] font-bold transition-all ${
              bagSize === s ? "bg-clay-700 text-white shadow" : "bg-clay-50 text-clay-700"
            }`}
          >
            {s === "kg25" ? "25 Kg bags" : "40 Kg bags"}
          </button>
        ))}
      </div>
      <div className="h-52 -ml-3">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              {colorKeys.map((k) => (
                <linearGradient key={k} id={`bag-grad-${k}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={BAG_COLORS[k] || "#a8a29e"} stopOpacity={0.5} />
                  <stop offset="100%" stopColor={BAG_COLORS[k] || "#a8a29e"} stopOpacity={0.05} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3e3dd" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#a8a29e" }} tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis tick={{ fontSize: 10, fill: "#a8a29e" }} tickLine={false} axisLine={false} width={40}
              tickFormatter={fmtBag} />
            <Tooltip
              contentStyle={{ borderRadius: 12, border: "1px solid #f3e3dd", fontSize: 12 }}
              formatter={(v: number, name: string) => [v.toLocaleString(), name]}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {colorKeys.map((k) => (
              <Area
                key={k}
                type="monotone"
                dataKey={k}
                stroke={BAG_COLORS[k] || "#a8a29e"}
                strokeWidth={2}
                fill={`url(#bag-grad-${k})`}
                animationDuration={500}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ─── Latest Stock Snapshot ─── */
function LatestStockGrid({ stock }: { stock: Record<string, number> }) {
  const entries = Object.entries(stock).sort((a, b) => b[1] - a[1]);
  return (
    <div className="grid grid-cols-3 gap-2">
      {entries.map(([key, val]) => (
        <div key={key} className="rounded-xl bg-clay-50/60 px-3 py-2 text-center">
          <p className="text-[10px] font-bold text-stone-400 uppercase tracking-wide">{key}</p>
          <p className="text-base font-display font-bold text-clay-900 tabular-nums mt-0.5">
            {val % 1 === 0 ? val : val.toFixed(2)}
          </p>
        </div>
      ))}
    </div>
  );
}

const TABS = ["Stock Trend", "Daily Flow", "Bag Inventory"] as const;

export default function OpsReportCharts({
  reports,
  products,
  latest,
}: {
  reports: OpsReport[];
  products: string[];
  latest: OpsReport | null;
}) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Stock Trend");

  if (reports.length === 0) {
    return (
      <div className="card p-4 text-center text-stone-400 text-sm">
        No operations reports yet.
        <br />
        <span className="text-xs">Use 📊 Daily ops report in the Telegram bot to submit data.</span>
      </div>
    );
  }

  return (
    <div className="card p-4">
      {/* Tab bar */}
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

      {tab === "Stock Trend" && (
        <>
          {latest?.stock && Object.keys(latest.stock).length > 0 && (
            <div className="mb-4">
              <p className="text-[11px] font-bold tracking-widest uppercase text-clay-500 mb-2">
                Latest snapshot · {latest.dateLabel}
              </p>
              <LatestStockGrid stock={latest.stock} />
            </div>
          )}
          <p className="text-[11px] font-bold tracking-widest uppercase text-clay-500 mb-2">
            Stock over time
          </p>
          <StockTrendChart reports={reports} products={products} />
        </>
      )}

      {tab === "Daily Flow" && (
        <>
          <p className="text-[11px] font-bold tracking-widest uppercase text-clay-500 mb-2">
            Received vs Delivered per product
          </p>
          <FlowChart reports={reports} products={products} />
        </>
      )}

      {tab === "Bag Inventory" && (
        <>
          <p className="text-[11px] font-bold tracking-widest uppercase text-clay-500 mb-2">
            Bag inventory trend
          </p>
          <BagInventoryChart reports={reports} />
        </>
      )}
    </div>
  );
}
