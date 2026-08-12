"use client";

import { useEffect, useState } from "react";

/** Sales reports submitted from the Telegram bot → agreed Sales report table. */

interface Row {
  _id: string;
  date: string;
  customerName: string | null;
  productTy: string | null;
  qty: number | null;
  unitPrice: number | null;
  subTotal: number | null;
  vat: number | null;
  grandTotal: number | null;
  withhold: number | null;
  netPay: number | null;
  remark: string | null;
}

const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB");
const num = (n?: number | null) => (n ? Math.round(n).toLocaleString() : "");
const productQty = (p?: string | null, q?: number | null) => {
  const prod = (p || "").trim();
  const qty = q ? String(q) : "";
  return prod && qty ? `${prod} / ${qty}` : prod || qty || "";
};

export default function SalesReceiptsPanel() {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    fetch("/api/sales-receipts")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .catch(() => setRows([]));
  }, []);

  if (!rows) return <div className="card h-40 animate-pulse bg-clay-50" />;

  const sum = (k: keyof Row) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <h2 className="font-display text-lg font-bold">🧾 Sales report</h2>
        {rows.length > 0 && (
          <a href="/api/sales-receipts/export" className="text-[11px] font-bold text-clay-600">
            Export Excel →
          </a>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="card p-4 text-sm text-stone-400">No submitted sales reports yet.</p>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[820px] text-right text-xs">
            <thead className="bg-clay-50/70 text-[10px] uppercase tracking-wide text-stone-500">
              <tr>
                <th className="p-2 text-left font-bold">Date</th>
                <th className="p-2 text-left font-bold">Customer&apos;s Name</th>
                <th className="p-2 text-left font-bold">Product/Qty</th>
                <th className="p-2 font-bold">Unit Price</th>
                <th className="p-2 font-bold">Sub Total</th>
                <th className="p-2 font-bold">VAT 15%</th>
                <th className="p-2 font-bold">Grand Total</th>
                <th className="p-2 font-bold">Withholding</th>
                <th className="p-2 font-bold">Net Payable</th>
                <th className="p-2 text-left font-bold">Remark</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r._id} className="border-t border-clay-50">
                  <td className="p-2 text-left font-semibold text-stone-800">{fmtDate(r.date)}</td>
                  <td className="p-2 text-left text-stone-700">{r.customerName || "—"}</td>
                  <td className="p-2 text-left text-stone-700">{productQty(r.productTy, r.qty)}</td>
                  <td className="p-2 tabular-nums">{num(r.unitPrice)}</td>
                  <td className="p-2 tabular-nums">{num(r.subTotal)}</td>
                  <td className="p-2 tabular-nums">{num(r.vat)}</td>
                  <td className="p-2 tabular-nums font-semibold text-stone-800">{num(r.grandTotal)}</td>
                  <td className="p-2 tabular-nums">{num(r.withhold)}</td>
                  <td className="p-2 tabular-nums font-bold text-clay-900">{num(r.netPay)}</td>
                  <td className="p-2 text-left text-stone-500">{r.remark || ""}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-clay-200 bg-clay-50/40 font-bold">
                <td className="p-2 text-left" colSpan={4}>
                  Total · {rows.length}
                </td>
                <td className="p-2 tabular-nums">{num(sum("subTotal"))}</td>
                <td className="p-2 tabular-nums">{num(sum("vat"))}</td>
                <td className="p-2 tabular-nums">{num(sum("grandTotal"))}</td>
                <td className="p-2 tabular-nums">{num(sum("withhold"))}</td>
                <td className="p-2 tabular-nums text-clay-900">{num(sum("netPay"))}</td>
                <td className="p-2" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
