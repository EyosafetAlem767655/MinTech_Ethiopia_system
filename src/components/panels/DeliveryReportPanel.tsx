"use client";

import { useEffect, useState } from "react";
import { productLabel, orderProducts, DELIVERY_PRODUCTS } from "@/lib/products";

/** Delivery report: Date · Deliver to · Invoice cash/credit · Total qty · Deli · per-product tonnage. */

interface Row {
  _id: string;
  date: string;
  customer: string;
  invoiceNo: string | null;
  paymentType: "cash" | "credit" | null;
  invoiceCash: number | null;
  invoiceCredit: number | null;
  qty: number | null;
  deliveryNo: string | null;
  reportedBy: string;
  products: Record<string, number>;
}

const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const num = (n?: number | null) => (n ? (Math.round(n * 100) / 100).toLocaleString() : "");

export default function DeliveryReportPanel() {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    fetch("/api/deliveries")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .catch(() => setRows([]));
  }, []);

  if (!rows) return <div className="card h-40 animate-pulse bg-clay-50" />;

  // Every sheet column always shows, plus any legacy code an older row carries.
  const cols = orderProducts(
    Array.from(new Set([...DELIVERY_PRODUCTS, ...rows.flatMap((r) => Object.keys(r.products || {}))]))
  );
  const sum = (pick: (r: Row) => number) => rows.reduce((a, r) => a + (pick(r) || 0), 0);

  return (
    <section className="space-y-3">
      <h2 className="font-display text-lg font-bold px-1">🚛 Delivery report</h2>
      {rows.length === 0 ? (
        <p className="card p-4 text-sm text-stone-400">No delivery reports yet.</p>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[1100px] text-right text-xs">
            <thead className="bg-clay-50/70 text-[10px] uppercase tracking-wide text-stone-500">
              <tr>
                <th className="p-2 text-left font-bold">Date</th>
                <th className="p-2 text-left font-bold">Deliver to</th>
                <th className="p-2 font-bold">Invoice in cash</th>
                <th className="p-2 font-bold">Invoice in credit</th>
                <th className="p-2 font-bold">Total quantity</th>
                <th className="p-2 text-left font-bold">Deli</th>
                {cols.map((c) => (
                  <th key={c} className="p-2 font-bold">{productLabel(c)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r._id} className="border-t border-clay-50">
                  <td className="p-2 text-left font-semibold text-stone-800">{fmtDate(r.date)}</td>
                  <td className="p-2 text-left text-stone-700">{r.customer}</td>
                  <td className="p-2 tabular-nums text-stone-700">{num(r.invoiceCash)}</td>
                  <td className="p-2 tabular-nums text-stone-700">{num(r.invoiceCredit)}</td>
                  <td className="p-2 tabular-nums font-semibold text-stone-800">{num(r.qty)}</td>
                  <td className="p-2 text-left text-stone-500">{r.deliveryNo || r.invoiceNo || ""}</td>
                  {cols.map((c) => (
                    <td key={c} className="p-2 tabular-nums text-stone-700">{num(r.products?.[c])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-clay-200 bg-clay-50/40 font-bold">
                <td className="p-2 text-left" colSpan={2}>
                  Total · {rows.length}
                </td>
                <td className="p-2 tabular-nums">{num(sum((r) => Number(r.invoiceCash)))}</td>
                <td className="p-2 tabular-nums">{num(sum((r) => Number(r.invoiceCredit)))}</td>
                <td className="p-2 tabular-nums text-clay-900">{num(sum((r) => Number(r.qty)))}</td>
                <td className="p-2" />
                {cols.map((c) => (
                  <td key={c} className="p-2 tabular-nums text-clay-900">
                    {num(sum((r) => Number(r.products?.[c])))}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
