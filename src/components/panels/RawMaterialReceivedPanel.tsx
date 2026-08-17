"use client";

import { useEffect, useState } from "react";
import { RAW_MATERIALS } from "@/lib/products";

/** Raw material received: Date · Supplier · Sup.Dn.No. · Truck · M.R.V · material tonnages. */

interface Row {
  _id: string;
  date: string;
  supplier: string | null;
  dnNo: string | null;
  truckPlate: string | null;
  mrvNo: string | null;
  reportedBy: string;
  materials: Record<string, number>;
}

const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const num = (n?: number) => (n ? (Math.round(n * 100) / 100).toLocaleString() : "");

export default function RawMaterialReceivedPanel() {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    fetch("/api/raw-receipts")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .catch(() => setRows([]));
  }, []);

  if (!rows) return <div className="card h-40 animate-pulse bg-clay-50" />;

  // Fixed columns from the company's sheet, not whatever keys happen to be in
  // the data: a material nobody reported today must still hold its column, or
  // the table silently changes shape from one day to the next. Any unexpected
  // key from an older row is appended so nothing is hidden.
  const extra = Array.from(new Set(rows.flatMap((r) => Object.keys(r.materials || {}))))
    .filter((k) => !RAW_MATERIALS.includes(k as (typeof RAW_MATERIALS)[number]))
    .sort();
  const cols = [...RAW_MATERIALS, ...extra];
  const total = (c: string) => rows.reduce((a, r) => a + (Number(r.materials?.[c]) || 0), 0);

  return (
    <section className="space-y-3">
      <h2 className="font-display text-lg font-bold px-1">🚚 Raw material received</h2>
      {rows.length === 0 ? (
        <p className="card p-4 text-sm text-stone-400">No raw-material receipts yet.</p>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[760px] text-right text-xs">
            <thead className="bg-clay-50/70 text-[10px] uppercase tracking-wide text-stone-500">
              <tr>
                <th className="p-2 text-left font-bold">Date</th>
                <th className="p-2 text-left font-bold">Supplier</th>
                <th className="p-2 text-left font-bold">Sup.Dn.No.</th>
                <th className="p-2 text-left font-bold">Truck Plate No.</th>
                <th className="p-2 text-left font-bold">M.R.V</th>
                {cols.map((c) => (
                  <th key={c} className="p-2 font-bold">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r._id} className="border-t border-clay-50">
                  <td className="p-2 text-left font-semibold text-stone-800">{fmtDate(r.date)}</td>
                  <td className="p-2 text-left text-stone-600">{r.supplier || "—"}</td>
                  <td className="p-2 text-left text-stone-500">{r.dnNo || ""}</td>
                  <td className="p-2 text-left text-stone-500">{r.truckPlate || ""}</td>
                  <td className="p-2 text-left text-stone-500">{r.mrvNo || ""}</td>
                  {cols.map((c) => (
                    <td key={c} className="p-2 tabular-nums text-stone-700">{num(r.materials?.[c])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-clay-200 bg-clay-50/40 font-bold">
                <td className="p-2 text-left" colSpan={5}>
                  Total · {rows.length}
                </td>
                {cols.map((c) => (
                  <td key={c} className="p-2 tabular-nums text-clay-900">{num(total(c))}</td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
