"use client";

import { useEffect, useState } from "react";
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
 * Daily stock count: finished product on hand, then empty bags by size and
 * colour — the second half of the guided production report.
 *
 * Reads the same `daily_ops_reports` rows the pasted operations report writes,
 * because both routes record one day's stock into one row.
 *
 * Deliberately shows NO column totals. Each row is a closing snapshot, so adding
 * thirty of them together produces a number that means nothing — unlike the
 * production grid, where the period sum is real output.
 */

interface OpsRow {
  _id: string;
  dateLabel: string;
  date: string;
  reportedBy: string;
  stock?: Record<string, number>;
  bags?: Partial<Record<BagSize, Record<string, number>>>;
}

const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const num = (n?: number) => (n ? (Math.round(n * 100) / 100).toLocaleString() : "");

export default function DailyStockPanel() {
  const [rows, setRows] = useState<OpsRow[] | null>(null);

  useEffect(() => {
    fetch("/api/ops-reports")
      .then((r) => (r.ok ? r.json() : { reports: [] }))
      .then((d) => setRows(Array.isArray(d?.reports) ? d.reports : []))
      .catch(() => setRows([]));
  }, []);

  if (!rows) return <div className="card h-40 animate-pulse bg-clay-50" />;

  // Newest first; the API returns the ledger oldest-first for charting.
  const recent = rows.filter((r) => r.stock || r.bags).slice().reverse().slice(0, 60);

  const cols = orderProducts(
    Array.from(new Set([...PRODUCTION_PRODUCTS, ...recent.flatMap((r) => Object.keys(r.stock || {}))]))
  );
  const bagCols = BAG_SIZES.flatMap((size) => BAG_STOCK[size].map((colour) => ({ size, colour })));

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <h2 className="font-display text-lg font-bold">📦 Daily stock</h2>
        <p className="text-[11px] text-stone-400">Closing count · tonnes, bags in pieces</p>
      </div>

      {recent.length === 0 ? (
        <p className="card p-4 text-sm text-stone-400">No daily stock counts yet.</p>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[900px] text-right text-xs">
            <thead className="bg-clay-50/70 text-[10px] uppercase tracking-wide text-stone-500">
              <tr>
                <th className="p-2 text-left font-bold">Date</th>
                {cols.map((c) => (
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
              {recent.map((r) => (
                <tr key={r._id} className="border-t border-clay-50">
                  <td className="p-2 text-left font-semibold text-stone-800">{fmtDate(r.date)}</td>
                  {cols.map((c) => (
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
          </table>
        </div>
      )}
    </section>
  );
}
