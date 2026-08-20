"use client";

import { useEffect, useState } from "react";
import { PRODUCTION_PRODUCTS, productLabel, orderProducts } from "@/lib/products";

/** Image 2 — daily production grid: Date × product (tons), with FGR No. */

interface Row {
  _id: string;
  date: string;
  fgrNo: string | null;
  reportedBy: string;
  products: Record<string, number>;
}

const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const num = (n?: number) => (n ? (Math.round(n * 100) / 100).toLocaleString() : "");

export default function ProductionGridPanel() {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    fetch("/api/production-reports")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .catch(() => setRows([]));
  }, []);

  if (!rows) return <div className="card h-40 animate-pulse bg-clay-50" />;

  // Seeded with the canonical list, not derived from the data alone. Zero-valued
  // products are dropped from the stored jsonb, so a data-only column set
  // silently changed shape from one day to the next — a product simply vanished
  // from the sheet on a day nobody made it. Unknown historic codes still append.
  const cols = orderProducts(
    Array.from(new Set([...PRODUCTION_PRODUCTS, ...rows.flatMap((r) => Object.keys(r.products || {}))]))
  );
  const rowTotal = (p: Record<string, number>) => Object.values(p || {}).reduce((a, b) => a + b, 0);
  const colTotal = (c: string) => rows.reduce((a, r) => a + (r.products?.[c] || 0), 0);
  const grand = rows.reduce((a, r) => a + rowTotal(r.products), 0);

  return (
    <section className="space-y-3">
      <h2 className="font-display text-lg font-bold px-1">🏭 Production report</h2>
      {rows.length === 0 ? (
        <p className="card p-4 text-sm text-stone-400">No production reports yet.</p>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[560px] text-right text-xs">
            <thead className="bg-clay-50/70 text-[10px] uppercase tracking-wide text-stone-500">
              <tr>
                <th className="p-2 text-left font-bold">Date</th>
                <th className="p-2 text-left font-bold">FGR No</th>
                {cols.map((c) => (
                  <th key={c} className="p-2 font-bold">{productLabel(c)}</th>
                ))}
                <th className="p-2 font-bold">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r._id} className="border-t border-clay-50">
                  <td className="p-2 text-left font-semibold text-stone-800">{fmtDate(r.date)}</td>
                  <td className="p-2 text-left text-stone-500">{r.fgrNo || "—"}</td>
                  {cols.map((c) => (
                    <td key={c} className="p-2 tabular-nums text-stone-700">{num(r.products?.[c])}</td>
                  ))}
                  <td className="p-2 font-bold tabular-nums text-clay-900">{num(rowTotal(r.products))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-clay-100 bg-clay-50/50 font-bold">
                <td className="p-2 text-left" colSpan={2}>Total</td>
                {cols.map((c) => (
                  <td key={c} className="p-2 tabular-nums">{num(colTotal(c))}</td>
                ))}
                <td className="p-2 tabular-nums text-clay-900">{num(grand)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
