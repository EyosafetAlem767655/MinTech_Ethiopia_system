"use client";

import { useEffect, useState } from "react";
import { productLabel, orderProducts } from "@/lib/products";

/** Image 4 — finished-goods delivery: Date · Customer · Invoice(cash/credit/qty) · Delivery# · per-product qty. */

interface Row {
  _id: string;
  date: string;
  customer: string;
  invoiceNo: string | null;
  paymentType: "cash" | "credit" | null;
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

  const cols = orderProducts(Array.from(new Set(rows.flatMap((r) => Object.keys(r.products || {})))));

  return (
    <section className="space-y-3">
      <h2 className="font-display text-lg font-bold px-1">🚛 Finished-goods delivery</h2>
      {rows.length === 0 ? (
        <p className="card p-4 text-sm text-stone-400">No delivery reports yet.</p>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-right text-xs">
            <thead className="bg-clay-50/70 text-[10px] uppercase tracking-wide text-stone-500">
              <tr>
                <th className="p-2 text-left font-bold">Date</th>
                <th className="p-2 text-left font-bold">Deliver to</th>
                <th className="p-2 text-left font-bold">Invoice</th>
                <th className="p-2 font-bold">Pay</th>
                <th className="p-2 font-bold">Qty</th>
                <th className="p-2 text-left font-bold">Deli #</th>
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
                  <td className="p-2 text-left text-stone-500">{r.invoiceNo || ""}</td>
                  <td className="p-2">
                    {r.paymentType ? (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          r.paymentType === "cash" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {r.paymentType}
                      </span>
                    ) : (
                      ""
                    )}
                  </td>
                  <td className="p-2 tabular-nums text-stone-700">{num(r.qty)}</td>
                  <td className="p-2 text-left text-stone-500">{r.deliveryNo || ""}</td>
                  {cols.map((c) => (
                    <td key={c} className="p-2 tabular-nums text-stone-700">{num(r.products?.[c])}</td>
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
