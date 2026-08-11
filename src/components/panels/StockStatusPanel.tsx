"use client";

import { useEffect, useState } from "react";
import { productLabel } from "@/lib/products";

/** Image 1 — monthly stock-status: B.balance + Received − Sales = Stock on hand, valued. */

interface Item {
  code?: string;
  description?: string;
  category?: string;
  bBalance?: number;
  received?: number;
  sales?: number;
  unitPrice?: number;
  stockTon?: number;
  etb?: number;
}

interface Report {
  _id: string;
  month: string;
  reportedBy: string;
  items: Item[];
  createdAt: string;
}

const num = (n?: number, dp = 2) =>
  n == null || n === 0 ? "" : (Math.round(n * 10 ** dp) / 10 ** dp).toLocaleString(undefined, { maximumFractionDigits: dp });

/** Only show this panel's category rows if `category` filter is given. */
export default function StockStatusPanel({ category, title }: { category?: string; title?: string }) {
  const [reports, setReports] = useState<Report[] | null>(null);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    fetch("/api/stock-status")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setReports(Array.isArray(d) ? d : []))
      .catch(() => setReports([]));
  }, []);

  if (!reports) return <div className="card h-40 animate-pulse bg-clay-50" />;

  const heading = title || "📦 Stock status";
  if (reports.length === 0) {
    return (
      <section className="space-y-3">
        <h2 className="font-display text-lg font-bold px-1">{heading}</h2>
        <p className="card p-4 text-sm text-stone-400">No stock-status reports yet.</p>
      </section>
    );
  }

  const report = reports[Math.min(idx, reports.length - 1)];
  const items = (report.items || []).filter((it) => !category || (it.category || "").toLowerCase() === category);
  const totalEtb = items.reduce((a, it) => a + (Number(it.etb) || 0), 0);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <h2 className="font-display text-lg font-bold">{heading}</h2>
        {reports.length > 1 && (
          <select
            value={idx}
            onChange={(e) => setIdx(Number(e.target.value))}
            className="rounded-lg border border-clay-200 bg-white px-2 py-1 text-xs"
          >
            {reports.map((r, i) => (
              <option key={r._id} value={i}>{r.month}</option>
            ))}
          </select>
        )}
      </div>

      {items.length === 0 ? (
        <p className="card p-4 text-sm text-stone-400">No rows for this section in {report.month}.</p>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-right text-xs">
            <thead className="bg-clay-50/70 text-[10px] uppercase tracking-wide text-stone-500">
              <tr>
                <th className="p-2 text-left font-bold">P.code</th>
                <th className="p-2 text-left font-bold">Description</th>
                <th className="p-2 font-bold">B.balance</th>
                <th className="p-2 font-bold">Received</th>
                <th className="p-2 font-bold">Sales (t)</th>
                <th className="p-2 font-bold">U.price</th>
                <th className="p-2 font-bold">Stock (t)</th>
                <th className="p-2 font-bold">ETB</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} className="border-t border-clay-50">
                  <td className="p-2 text-left font-semibold text-stone-800">{it.code ? productLabel(it.code) : "—"}</td>
                  <td className="p-2 text-left text-stone-500">{it.description || ""}</td>
                  <td className="p-2 tabular-nums text-stone-700">{num(it.bBalance)}</td>
                  <td className="p-2 tabular-nums text-stone-700">{num(it.received)}</td>
                  <td className="p-2 tabular-nums text-stone-700">{num(it.sales)}</td>
                  <td className="p-2 tabular-nums text-stone-700">{num(it.unitPrice, 0)}</td>
                  <td className="p-2 tabular-nums font-semibold text-stone-800">{num(it.stockTon)}</td>
                  <td className="p-2 tabular-nums font-bold text-clay-900">{num(it.etb, 0)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-clay-100 bg-clay-50/50 font-bold">
                <td className="p-2 text-left" colSpan={7}>Total</td>
                <td className="p-2 tabular-nums text-clay-900">{num(totalEtb, 0)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
