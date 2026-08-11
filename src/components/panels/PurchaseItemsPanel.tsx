"use client";

import { useEffect, useState } from "react";

/** Image 5 — foreign & local purchased items: Date · Description · UoM · Qty · Supplier · Amount · Cost center · Purchaser. */

interface Row {
  _id: string;
  date: string;
  description: string;
  uom: string | null;
  qty: number | null;
  supplier: string | null;
  amount: number | null;
  costCenter: string | null;
  purchaser: string | null;
  reportedBy: string;
}

const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const num = (n?: number | null) => (n ? Math.round(n).toLocaleString() : "");

export default function PurchaseItemsPanel() {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    fetch("/api/purchase-items")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .catch(() => setRows([]));
  }, []);

  if (!rows) return <div className="card h-40 animate-pulse bg-clay-50" />;

  return (
    <section className="space-y-3">
      <h2 className="font-display text-lg font-bold px-1">🧾 Purchased items</h2>
      {rows.length === 0 ? (
        <p className="card p-4 text-sm text-stone-400">No purchased-items reports yet.</p>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="bg-clay-50/70 text-[10px] uppercase tracking-wide text-stone-500">
              <tr>
                <th className="p-2 font-bold">Date</th>
                <th className="p-2 font-bold">Description</th>
                <th className="p-2 font-bold">UoM</th>
                <th className="p-2 text-right font-bold">Qty</th>
                <th className="p-2 font-bold">Supplier</th>
                <th className="p-2 text-right font-bold">Amount</th>
                <th className="p-2 font-bold">Cost center</th>
                <th className="p-2 font-bold">Purchaser</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r._id} className="border-t border-clay-50">
                  <td className="p-2 font-semibold text-stone-800">{fmtDate(r.date)}</td>
                  <td className="p-2 text-stone-700">{r.description}</td>
                  <td className="p-2 text-stone-500">{r.uom || ""}</td>
                  <td className="p-2 text-right tabular-nums text-stone-700">{num(r.qty)}</td>
                  <td className="p-2 text-stone-600">{r.supplier || ""}</td>
                  <td className="p-2 text-right tabular-nums font-semibold text-clay-900">{num(r.amount)}</td>
                  <td className="p-2 text-stone-500">{r.costCenter || ""}</td>
                  <td className="p-2 text-stone-500">{r.purchaser || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
