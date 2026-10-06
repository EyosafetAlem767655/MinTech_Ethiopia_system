"use client";

import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import RangeSelector from "@/components/RangeSelector";
import { AXIS, Chart, ScrollTable } from "@/components/panels/TableChart";
import { RANGES, rangeWindow, type Bucket, type RangeKey } from "@/lib/ranges";
import { PRODUCTION_PRODUCTS, PRODUCT_COLOR, orderProducts, productLabel } from "@/lib/products";

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

/**
 * The hover card: the date, then every brand that ran that day, heaviest first,
 * and what they add up to.
 *
 * Sorted by tonnage rather than by the order the lines were declared, because
 * the question being asked at the moment of hovering is "what was this day
 * made of". The total is included so nothing was lost when the single total
 * bar became ten lines.
 */
function BrandTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { dataKey?: string | number; value?: number; color?: string }[];
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const rows = payload
    .filter((p) => typeof p.value === "number" && p.value > 0)
    .sort((a, b) => (b.value || 0) - (a.value || 0));
  if (rows.length === 0) return null;
  const total = rows.reduce((a, p) => a + (p.value || 0), 0);

  return (
    <div className="rounded-xl border border-clay-100 bg-white/95 px-3 py-2 shadow-lg backdrop-blur">
      <p className="mb-1 text-[11px] font-bold text-stone-800">{label}</p>
      <table className="text-[11px]">
        <tbody>
          {rows.map((p) => (
            <tr key={String(p.dataKey)}>
              <td className="pr-2">
                <span
                  className="inline-block h-2 w-2 rounded-full align-middle"
                  style={{ backgroundColor: p.color }}
                />
              </td>
              {/* The label wears text ink, never the series colour — the dot
                  beside it carries the identity. */}
              <td className="pr-3 text-stone-600">{productLabel(String(p.dataKey))}</td>
              <td className="text-right font-bold tabular-nums text-stone-800">{tons(p.value || 0)}</td>
            </tr>
          ))}
          {rows.length > 1 && (
            <tr className="border-t border-clay-100">
              <td />
              <td className="pr-3 pt-1 text-stone-400">Total</td>
              <td className="pt-1 text-right font-bold tabular-nums text-clay-900">{tons(total)}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function ProductionPanels() {
  const [range, setRange] = useState<RangeKey>("weekly");
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

      <Chart empty={prodSeries.length === 0} emptyLabel="No production in this period.">
        <LineChart data={prodSeries} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f3e3dd" vertical={false} />
          <XAxis dataKey="label" {...AXIS} minTickGap={16} />
          <YAxis {...AXIS} width={40} tickFormatter={(v: number) => String(Math.round(v))} />
          <Tooltip cursor={{ stroke: "#d6c3bd", strokeWidth: 1 }} content={<BrandTooltip />} />
          {/* A legend whenever there is more than one line: identity must never
              rest on colour alone. One brand needs none — the heading names it. */}
          {drawnBrands.length > 1 && (
            <Legend
              iconType="plainline"
              iconSize={12}
              wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
              formatter={(code: string) => productLabel(code)}
            />
          )}
          {drawnBrands.map((code) => (
            <Line
              key={code}
              type="monotone"
              dataKey={code}
              name={code}
              stroke={PRODUCT_COLOR[code] || "#6b6a66"}
              strokeWidth={2}
              // No dot per point: a quarter of daily readings across ten brands
              // is a chart made of dots. The active one appears on hover with a
              // surface ring, so an overlapping pair stays two marks.
              dot={false}
              activeDot={{ r: 5, strokeWidth: 2, stroke: "#ffffff" }}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
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
