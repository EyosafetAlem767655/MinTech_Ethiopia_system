"use client";

import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import RangeSelector from "@/components/RangeSelector";
import { AXIS, Chart, ScrollTable, TOOLTIP } from "@/components/panels/TableChart";
import { RANGES, rangeWindow, type Bucket, type RangeKey } from "@/lib/ranges";
import { BAG_KINDS, PRODUCTION_PRODUCTS, bagLabel, orderProducts, productLabel } from "@/lib/products";
import type { BagSize } from "@/lib/products";

/**
 * What is on hand at the close of the day: finished product, and empty bags.
 *
 * This lived on the Production tab, beneath what was produced. It is not a
 * production figure — it is an inventory level, counted by the asset side and
 * reconciled against the vouchers directly above it on this tab. Production
 * answers what the plant made; this answers what is in the store, and the two
 * questions belong to two different people.
 *
 * Both tables are CLOSING COUNTS and never sum down the page: thirty daily
 * snapshots added together produce a number that means nothing.
 */

interface OpsRow {
  _id: string;
  dateLabel: string;
  date: string;
  reportedBy: string;
  stock?: Record<string, number>;
  bags?: Partial<Record<BagSize, Record<string, number>>>;
}

const STOCK_INK = "#2a78d6";

const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const num = (n?: number) => (n ? (Math.round(n * 100) / 100).toLocaleString() : "");
const tons = (n: number) => `${(Math.round(n * 100) / 100).toLocaleString()} t`;
const sum = (m?: Record<string, number>) => Object.values(m || {}).reduce((a, b) => a + Number(b || 0), 0);

/** Calendar day of a timestamp. */
const dayKey = (iso: string) => new Date(iso).toISOString().slice(0, 10);

/**
 * The same day, from the ops row's own "D/M/YYYY" label.
 *
 * The label is the row's primary key and cannot drift, so it is indexed as well
 * as the timestamp — a row whose timestamp was built some other way still lands
 * on the right day.
 */
function labelDayKey(label?: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(label || "");
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

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

export default function StockOnHandPanel() {
  const [range, setRange] = useState<RangeKey>("daily");
  const [ops, setOps] = useState<OpsRow[] | null>(null);

  useEffect(() => {
    fetch("/api/ops-reports")
      .then((r) => (r.ok ? r.json() : { reports: [] }))
      .then((d) => setOps(Array.isArray(d?.reports) ? d.reports : []))
      .catch(() => setOps([]));
  }, []);

  const { bucket } = RANGES[range];
  const win = useMemo(() => rangeWindow(range), [range]);

  // Filtered client-side: the endpoint already returns the full year, so
  // changing the range is instant and costs no round trip.
  const stockRows = useMemo(() => {
    const from = win.start.getTime();
    const to = win.end.getTime();
    return (ops ?? [])
      .filter((r) => {
        // Stock only. A row carrying nothing but a bag count is not a stock
        // count, and letting one in would both print a blank line and — as the
        // latest row of its bucket — pull the closing level down to zero.
        if (!r.stock || Object.keys(r.stock).length === 0) return false;
        const t = new Date(r.date).getTime();
        return t >= from && t < to;
      })
      .slice()
      .sort((a, b) => +new Date(b.date) - +new Date(a.date));
  }, [ops, win]);

  /* Stock is a LEVEL: the closing count for the bucket, never a sum. */
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

  const stockCols = orderProducts(
    Array.from(new Set([...PRODUCTION_PRODUCTS, ...stockRows.flatMap((r) => Object.keys(r.stock || {}))]))
  );

  /* The empty bags left at the close of each day in the window.

     One row per day: a re-count supersedes the earlier one rather than
     appearing beside it. Keyed on both the timestamp's day and the row's own
     label, for the same reason the stock table trusts the label. */
  const bagDays = useMemo(() => {
    const from = win.start.getTime();
    const to = win.end.getTime();
    const map = new Map<string, { at: number; bags: OpsRow["bags"]; who: string }>();
    for (const r of ops ?? []) {
      if (!r.bags || Object.keys(r.bags).length === 0) continue;
      const at = new Date(r.date).getTime();
      if (!(at >= from && at < to)) continue;
      for (const day of [dayKey(r.date), labelDayKey(r.dateLabel)]) {
        if (!day) continue;
        const prev = map.get(day);
        if (!prev || at > prev.at) map.set(day, { at, bags: r.bags, who: r.reportedBy });
      }
    }
    return [...map.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [ops, win]);

  if (ops === null) return <div className="card h-64 animate-pulse bg-clay-50" />;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
        <h2 className="font-display text-lg font-bold">📦 Stock on hand</h2>
        <p className="text-[11px] text-stone-400">Closing count · tonnes, bags in pieces</p>
      </div>

      <RangeSelector value={range} onChange={setRange} />
      <p className="px-1 text-[11px] text-stone-400">
        {RANGES[range].label} · {win.start.toISOString().slice(0, 10)} → {win.end.toISOString().slice(0, 10)}
      </p>

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

      {/* No column totals: each row is a closing snapshot, so summing them down
          the page would produce a number that means nothing. */}
      <ScrollTable minWidth={700} empty={stockRows.length === 0} emptyLabel="No stock counts in this period.">
        <thead className="sticky top-0 z-10 bg-clay-50 text-[10px] uppercase tracking-wide text-stone-500 shadow-[0_1px_0_#f3e3dd]">
          <tr>
            <th className="p-2 text-left font-bold">Date</th>
            {stockCols.map((c) => (
              <th key={c} className="p-2 font-bold">
                {productLabel(c)}
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
            </tr>
          ))}
        </tbody>
      </ScrollTable>

      {/* ── Empty bags ───────────────────────────────────────────────────────
          Pieces, not tonnes, which is why they are a table of their own rather
          than columns on the stock sheet or a second line on the chart. This is
          the count the voucher reconciliation above it predicts. */}
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1 pt-2">
        <h3 className="text-xs font-bold uppercase tracking-widest text-stone-400">Empty bags remaining</h3>
        <p className="text-[11px] text-stone-400">pieces · closing count</p>
      </div>

      <ScrollTable minWidth={620} empty={bagDays.length === 0} emptyLabel="No bag counts in this period.">
        <thead className="sticky top-0 z-10 bg-clay-50 text-[10px] uppercase tracking-wide text-stone-500 shadow-[0_1px_0_#f3e3dd]">
          <tr>
            <th className="p-2 text-left font-bold">Date</th>
            {BAG_KINDS.map(({ size, colour }) => (
              <th key={`${size}-${colour}`} className="p-2 font-bold">
                {bagLabel(size, colour)}
              </th>
            ))}
            <th className="p-2 text-left font-bold">Counted by</th>
          </tr>
        </thead>
        <tbody>
          {bagDays.map(([day, v]) => (
            <tr key={day} className="border-t border-clay-50">
              <td className="p-2 text-left font-semibold text-stone-800">{fmtDate(day)}</td>
              {BAG_KINDS.map(({ size, colour }) => (
                <td key={`${size}-${colour}`} className="p-2 tabular-nums text-stone-700">
                  {num(v.bags?.[size]?.[colour])}
                </td>
              ))}
              <td className="p-2 text-left text-stone-500">{v.who}</td>
            </tr>
          ))}
        </tbody>
      </ScrollTable>
    </section>
  );
}
