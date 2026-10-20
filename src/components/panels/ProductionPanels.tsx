"use client";

import { useEffect, useMemo, useState } from "react";
import RangeSelector from "@/components/RangeSelector";
import { Chart, ScrollTable } from "@/components/panels/TableChart";
import { BrandDayBars, BrandLines } from "@/components/panels/BrandCharts";
import { RANGES, rangeWindow, type Bucket, type RangeKey } from "@/lib/ranges";
import { PRODUCTION_PRODUCTS, orderProducts, productLabel } from "@/lib/products";

/**
 * What the plant produced, and nothing else.
 *
 * This panel used to carry the stock levels and the empty-bag counts as well.
 * Neither is a production figure: both are inventory, counted by the asset side
 * and reconciled against the goods vouchers, so they moved to Asset Management
 * (StockOnHandPanel) where the rest of that argument lives. Production is left
 * with the one question it owns — how much came off the lines — and the
 * whiteness of it, in the panel below.
 *
 * The table scrolls inside a bounded box with a sticky header rather than
 * running the length of the page. A year of daily rows is a legitimate thing to
 * ask for; a year-long page is not.
 */

interface ProductionRow {
  _id: string;
  date: string;
  fgrNo: string | null;
  reportedBy: string;
  products: Record<string, number>;
  /** When the report reached us, as opposed to the day it is for. */
  createdAt?: string | null;
}

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

  useEffect(() => {
    fetch("/api/production-reports")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setProduction(Array.isArray(d) ? d : []))
      .catch(() => setProduction([]));
  }, []);

  const { bucket } = RANGES[range];
  const win = useMemo(() => rangeWindow(range), [range]);

  // Filtered client-side: the endpoint already returns the full year, so
  // changing the range is instant and costs no round trip.
  const prodRows = useMemo(() => {
    const from = win.start.getTime();
    const to = win.end.getTime();
    return (production ?? []).filter((r) => {
      const t = new Date(r.date).getTime();
      return t >= from && t < to;
    });
  }, [production, win]);

  /* Production is a FLOW: bucketed tonnage genuinely adds up.

     One series PER BRAND, not one total. A single line of total tonnage cannot
     answer the question the brands exist for — how much ETL-9 did we make last
     week — and the figure it does carry is the one the table below already
     foots. */
  const { prodSeries, drawnBrands } = useMemo(() => {
    const acc = new Map<string, Map<string, number>>();
    for (const r of prodRows) {
      const k = bucketKey(r.date, bucket);
      const bucketTotals = acc.get(k) ?? new Map<string, number>();
      for (const [code, tonnes] of Object.entries(r.products || {})) {
        bucketTotals.set(code, (bucketTotals.get(code) || 0) + (Number(tonnes) || 0));
      }
      acc.set(k, bucketTotals);
    }

    // Only the brands that actually ran. A flat zero line for the other seven
    // is a legend nobody can read and six colours spent saying nothing.
    const present = orderProducts(
      Array.from(new Set([...acc.values()].flatMap((m) => [...m.keys()].filter((c) => (m.get(c) || 0) > 0))))
    );

    const rows = [...acc.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, totals]) => {
        const row: Record<string, string | number> = { label: bucketLabel(k, bucket) };
        let total = 0;
        for (const code of present) {
          const v = Math.round((totals.get(code) || 0) * 100) / 100;
          // Undefined rather than 0 for a brand that did not run in this
          // bucket: Recharts then breaks the line instead of drawing it down
          // to the floor and back, which reads as a day of nothing produced.
          if (v > 0) row[code] = v;
          total += v;
        }
        row._total = Math.round(total * 100) / 100;
        return row;
      });

    return { prodSeries: rows, drawnBrands: present };
  }, [prodRows, bucket]);

  const prodCols = orderProducts(
    Array.from(new Set([...PRODUCTION_PRODUCTS, ...prodRows.flatMap((r) => Object.keys(r.products || {}))]))
  );

  const colTotal = (c: string) => prodRows.reduce((a, r) => a + (r.products?.[c] || 0), 0);
  const grand = prodRows.reduce((a, r) => a + sum(r.products), 0);

  if (production === null) {
    return <div className="card h-64 animate-pulse bg-clay-50" />;
  }

  return (
    <section className="space-y-3">
      <div className="sticky top-0 z-20 -mx-4 bg-white/95 px-4 py-2 backdrop-blur sm:mx-0 sm:px-1">
        <RangeSelector value={range} onChange={setRange} />
        <p className="mt-1 px-1 text-[11px] text-stone-400">
          {RANGES[range].label} · {win.start.toISOString().slice(0, 10)} → {win.end.toISOString().slice(0, 10)}
        </p>
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
        <h2 className="font-display text-lg font-bold">🏭 Production</h2>
        <p className="text-[11px] font-bold text-stone-500">
          {tons(grand)} over {prodRows.length} report{prodRows.length === 1 ? "" : "s"}
        </p>
      </div>

      {/* One day is a bar per brand — a line over a single day is a lone dot.
          Longer ranges are a line per brand. */}
      <Chart empty={prodSeries.length === 0} emptyLabel="No production in this period.">
        {range === "daily" ? (
          <BrandDayBars
            totals={Object.fromEntries(drawnBrands.map((c) => [c, colTotal(c)]))}
            valueName="Produced"
          />
        ) : (
          <BrandLines series={prodSeries} brands={drawnBrands} />
        )}
      </Chart>

      <ScrollTable minWidth={720} empty={prodRows.length === 0} emptyLabel="No production reports in this period.">
        <thead className="sticky top-0 z-10 bg-clay-50 text-[10px] uppercase tracking-wide text-stone-500 shadow-[0_1px_0_#f3e3dd]">
          <tr>
            <th className="p-2 text-left font-bold" rowSpan={2}>
              Date
            </th>
            <th className="p-2 text-left font-bold" rowSpan={2}>
              FGR No
            </th>
            <th className="p-2 font-bold" colSpan={prodCols.length + 1}>
              Produced (tonnes)
            </th>
          </tr>
          <tr>
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
  );
}
