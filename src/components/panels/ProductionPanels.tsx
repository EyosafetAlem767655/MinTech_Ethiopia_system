"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import RangeSelector from "@/components/RangeSelector";
import { RANGES, rangeWindow, type Bucket, type RangeKey } from "@/lib/ranges";
import {
  BAG_SIZES,
  BAG_STOCK,
  PRODUCTION_PRODUCTS,
  bagLabel,
  orderProducts,
  productLabel,
  type BagSize,
} from "@/lib/products";

/**
 * The whole Production tab: what was produced, what is on hand, and a chart of
 * each — nothing else.
 *
 * One range control drives all four. Two independent filters would let the
 * production chart and the stock table show different periods side by side,
 * which is the sort of thing nobody notices until a number is quoted from the
 * wrong window.
 *
 * Both tables scroll inside a bounded box with a sticky header rather than
 * running the length of the page. A year of daily rows is a legitimate thing to
 * ask for; a year-long page is not.
 */

interface ProductionRow {
  _id: string;
  date: string;
  fgrNo: string | null;
  reportedBy: string;
  products: Record<string, number>;
}

interface OpsRow {
  _id: string;
  dateLabel: string;
  date: string;
  reportedBy: string;
  stock?: Record<string, number>;
  bags?: Partial<Record<BagSize, Record<string, number>>>;
}

/* Validated as a pair against the light chart surface: lightness band, chroma
   floor, CVD separation (worst adjacent ΔE 24.7 protan) and 3:1 contrast all
   pass. Each chart carries a single series, so its title names it and no legend
   is needed. */
const PRODUCTION_INK = "#c64d30";
const STOCK_INK = "#2a78d6";

const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const num = (n?: number) => (n ? (Math.round(n * 100) / 100).toLocaleString() : "");
const tons = (n: number) => `${(Math.round(n * 100) / 100).toLocaleString()} t`;
const sum = (m?: Record<string, number>) => Object.values(m || {}).reduce((a, b) => a + Number(b || 0), 0);

/** Bucket key for a date, at the granularity the chosen range declares. */
function bucketKey(iso: string, bucket: Bucket): string {
  const d = new Date(iso);
  if (bucket === "month") return d.toISOString().slice(0, 7);
  if (bucket === "week") {
    // Monday-anchored, like the rest of the app's week handling.
    const day = (d.getUTCDay() + 6) % 7;
    return new Date(d.getTime() - day * 86400000).toISOString().slice(0, 10);
  }
  return d.toISOString().slice(0, 10);
}

const bucketLabel = (key: string, bucket: Bucket) =>
  bucket === "month"
    ? new Date(`${key}-01`).toLocaleDateString("en-GB", { month: "short", year: "2-digit" })
    : fmtDate(key);

export default function ProductionPanels() {
  const [range, setRange] = useState<RangeKey>("monthly");
  const [production, setProduction] = useState<ProductionRow[] | null>(null);
  const [ops, setOps] = useState<OpsRow[] | null>(null);

  useEffect(() => {
    fetch("/api/production-reports")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setProduction(Array.isArray(d) ? d : []))
      .catch(() => setProduction([]));
    fetch("/api/ops-reports")
      .then((r) => (r.ok ? r.json() : { reports: [] }))
      .then((d) => setOps(Array.isArray(d?.reports) ? d.reports : []))
      .catch(() => setOps([]));
  }, []);

  const { bucket } = RANGES[range];
  const win = useMemo(() => rangeWindow(range), [range]);

  // Filtered client-side: both endpoints already return the full year, so
  // changing the range is instant and costs no round trip.
  const prodRows = useMemo(() => {
    const from = win.start.getTime();
    const to = win.end.getTime();
    return (production ?? []).filter((r) => {
      const t = new Date(r.date).getTime();
      return t >= from && t < to;
    });
  }, [production, win]);

  const stockRows = useMemo(() => {
    const from = win.start.getTime();
    const to = win.end.getTime();
    return (ops ?? [])
      .filter((r) => {
        if (!r.stock && !r.bags) return false;
        const t = new Date(r.date).getTime();
        return t >= from && t < to;
      })
      .slice()
      .sort((a, b) => +new Date(b.date) - +new Date(a.date));
  }, [ops, win]);

  /* Production is a FLOW: bucketed tonnage genuinely adds up. */
  const prodSeries = useMemo(() => {
    const acc = new Map<string, number>();
    for (const r of prodRows) {
      const k = bucketKey(r.date, bucket);
      acc.set(k, (acc.get(k) || 0) + sum(r.products));
    }
    return [...acc.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, t]) => ({ label: bucketLabel(k, bucket), tons: Math.round(t * 100) / 100 }));
  }, [prodRows, bucket]);

  /* Stock is a LEVEL: the closing count for the bucket, never a sum. Adding
     thirty daily snapshots together produces a number that means nothing. */
  const stockSeries = useMemo(() => {
    const acc = new Map<string, { at: number; tons: number }>();
    for (const r of stockRows) {
      const k = bucketKey(r.date, bucket);
      const at = new Date(r.date).getTime();
      const prev = acc.get(k);
      if (!prev || at > prev.at) acc.set(k, { at, tons: sum(r.stock) });
    }
    return [...acc.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => ({ label: bucketLabel(k, bucket), tons: Math.round(v.tons * 100) / 100 }));
  }, [stockRows, bucket]);

  const prodCols = orderProducts(
    Array.from(new Set([...PRODUCTION_PRODUCTS, ...prodRows.flatMap((r) => Object.keys(r.products || {}))]))
  );
  const stockCols = orderProducts(
    Array.from(new Set([...PRODUCTION_PRODUCTS, ...stockRows.flatMap((r) => Object.keys(r.stock || {}))]))
  );
  const bagCols = BAG_SIZES.flatMap((size) => BAG_STOCK[size].map((colour) => ({ size, colour })));

  const colTotal = (c: string) => prodRows.reduce((a, r) => a + (r.products?.[c] || 0), 0);
  const grand = prodRows.reduce((a, r) => a + sum(r.products), 0);

  if (production === null || ops === null) {
    return <div className="card h-64 animate-pulse bg-clay-50" />;
  }

  return (
    <div className="space-y-8">
      <div className="sticky top-0 z-20 -mx-4 bg-white/95 px-4 py-2 backdrop-blur sm:mx-0 sm:px-1">
        <RangeSelector value={range} onChange={setRange} />
        <p className="mt-1 px-1 text-[11px] text-stone-400">
          {RANGES[range].label} · {win.start.toISOString().slice(0, 10)} → {win.end.toISOString().slice(0, 10)}
        </p>
      </div>

      {/* ─────────────────────────── 1. Production ─────────────────────────── */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
          <h2 className="font-display text-lg font-bold">🏭 Production</h2>
          <p className="text-[11px] font-bold text-stone-500">
            {tons(grand)} over {prodRows.length} report{prodRows.length === 1 ? "" : "s"}
          </p>
        </div>

        <Chart empty={prodSeries.length === 0} emptyLabel="No production in this period.">
          <BarChart data={prodSeries} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3e3dd" vertical={false} />
            <XAxis dataKey="label" {...AXIS} minTickGap={16} />
            <YAxis {...AXIS} width={40} tickFormatter={(v: number) => String(Math.round(v))} />
            <Tooltip
              cursor={{ fill: "#f3e3dd", opacity: 0.5 }}
              contentStyle={TOOLTIP}
              formatter={(v: number) => [tons(Number(v)), "Produced"]}
            />
            <Bar dataKey="tons" fill={PRODUCTION_INK} radius={[4, 4, 0, 0]} maxBarSize={38} />
          </BarChart>
        </Chart>

        <ScrollTable minWidth={560} empty={prodRows.length === 0} emptyLabel="No production reports in this period.">
          <thead className="sticky top-0 z-10 bg-clay-50 text-[10px] uppercase tracking-wide text-stone-500 shadow-[0_1px_0_#f3e3dd]">
            <tr>
              <th className="p-2 text-left font-bold">Date</th>
              <th className="p-2 text-left font-bold">FGR No</th>
              {prodCols.map((c) => (
                <th key={c} className="p-2 font-bold">
                  {productLabel(c)}
                </th>
              ))}
              <th className="p-2 font-bold">Total</th>
            </tr>
          </thead>
          <tbody>
            {prodRows.map((r) => (
              <tr key={r._id} className="border-t border-clay-50">
                <td className="p-2 text-left font-semibold text-stone-800">{fmtDate(r.date)}</td>
                <td className="p-2 text-left text-stone-500">{r.fgrNo || "—"}</td>
                {prodCols.map((c) => (
                  <td key={c} className="p-2 tabular-nums text-stone-700">
                    {num(r.products?.[c])}
                  </td>
                ))}
                <td className="p-2 font-bold tabular-nums text-clay-900">{num(sum(r.products))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="sticky bottom-0 bg-clay-50 shadow-[0_-1px_0_#f3e3dd]">
            <tr className="font-bold">
              <td className="p-2 text-left" colSpan={2}>
                Total
              </td>
              {prodCols.map((c) => (
                <td key={c} className="p-2 tabular-nums">
                  {num(colTotal(c))}
                </td>
              ))}
              <td className="p-2 tabular-nums text-clay-900">{num(grand)}</td>
            </tr>
          </tfoot>
        </ScrollTable>
      </section>

      {/* ────────────────────────────── 2. Stock ───────────────────────────── */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
          <h2 className="font-display text-lg font-bold">📦 Stock on hand</h2>
          <p className="text-[11px] text-stone-400">Closing count · tonnes, bags in pieces</p>
        </div>

        <Chart empty={stockSeries.length === 0} emptyLabel="No stock counts in this period.">
          <LineChart data={stockSeries} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3e3dd" vertical={false} />
            <XAxis dataKey="label" {...AXIS} minTickGap={16} />
            <YAxis {...AXIS} width={40} tickFormatter={(v: number) => String(Math.round(v))} />
            <Tooltip
              cursor={{ stroke: "#d6c3bd", strokeWidth: 1 }}
              contentStyle={TOOLTIP}
              formatter={(v: number) => [tons(Number(v)), "Finished stock"]}
            />
            <Line
              type="monotone"
              dataKey="tons"
              stroke={STOCK_INK}
              strokeWidth={2}
              dot={{ r: 3, fill: STOCK_INK, stroke: "#ffffff", strokeWidth: 2 }}
              activeDot={{ r: 5, fill: STOCK_INK, stroke: "#ffffff", strokeWidth: 2 }}
            />
          </LineChart>
        </Chart>
        <p className="px-1 text-[11px] leading-snug text-stone-400">
          Total finished product on hand. Empty-bag counts are pieces rather than tonnes, so they stay in the
          table below instead of sharing this axis.
        </p>

        {/* No column totals here: each row is a closing snapshot, so summing
            them down the page would produce a number that means nothing. */}
        <ScrollTable minWidth={900} empty={stockRows.length === 0} emptyLabel="No stock counts in this period.">
          <thead className="sticky top-0 z-10 bg-clay-50 text-[10px] uppercase tracking-wide text-stone-500 shadow-[0_1px_0_#f3e3dd]">
            <tr>
              <th className="p-2 text-left font-bold">Date</th>
              {stockCols.map((c) => (
                <th key={c} className="p-2 font-bold">
                  {productLabel(c)}
                </th>
              ))}
              {bagCols.map(({ size, colour }) => (
                <th key={`${size}-${colour}`} className="border-l border-clay-100 p-2 font-bold">
                  {bagLabel(size, colour)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stockRows.map((r) => (
              <tr key={r._id} className="border-t border-clay-50">
                <td className="p-2 text-left font-semibold text-stone-800">{fmtDate(r.date)}</td>
                {stockCols.map((c) => (
                  <td key={c} className="p-2 tabular-nums text-stone-700">
                    {num(r.stock?.[c])}
                  </td>
                ))}
                {bagCols.map(({ size, colour }) => (
                  <td
                    key={`${size}-${colour}`}
                    className="border-l border-clay-50 p-2 tabular-nums text-stone-700"
                  >
                    {num(r.bags?.[size]?.[colour])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </ScrollTable>
      </section>
    </div>
  );
}

/* ────────────────────────────── shared pieces ─────────────────────────────── */

const AXIS = {
  tick: { fontSize: 10, fill: "#a8a29e" },
  tickLine: false,
  axisLine: false,
} as const;

const TOOLTIP = {
  borderRadius: 12,
  border: "1px solid #f3e3dd",
  fontSize: 12,
  boxShadow: "0 8px 24px rgba(62,22,13,0.12)",
} as const;

function Chart({
  empty,
  emptyLabel,
  children,
}: {
  empty: boolean;
  emptyLabel: string;
  children: React.ReactElement;
}) {
  if (empty) return <p className="card p-6 text-center text-sm text-stone-400">{emptyLabel}</p>;
  return (
    <div className="card p-3">
      <div className="-ml-2 h-52">
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/**
 * A table that scrolls in both directions inside a bounded box, so a long period
 * never stretches the page. The header and the totals row stay put while the
 * rows move between them.
 */
function ScrollTable({
  minWidth,
  empty,
  emptyLabel,
  children,
}: {
  minWidth: number;
  empty: boolean;
  emptyLabel: string;
  children: React.ReactNode;
}) {
  if (empty) return <p className="card p-4 text-sm text-stone-400">{emptyLabel}</p>;
  return (
    <div className="card max-h-[26rem] overflow-auto p-0">
      <table className="w-full text-right text-xs" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}
