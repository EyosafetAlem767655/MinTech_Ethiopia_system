"use client";

import { useEffect, useState } from "react";

/** Sales receipts submitted from the Telegram scanner → Cash Sales report table. */

interface Row {
  _id: string;
  date: string;
  customerName: string | null;
  fsNo: string | null;
  attNo: string | null;
  productTy: string | null;
  qty: number | null;
  unitPrice: number | null;
  subTotal: number | null;
  vat: number | null;
  grandTotal: number | null;
  withhold: number | null;
  netPay: number | null;
  depositedBank: string | null;
}

const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB");
const num = (n?: number | null) => (n ? Math.round(n).toLocaleString() : "");

export default function SalesReceiptsPanel() {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    fetch("/api/sales-receipts")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .catch(() => setRows([]));
  }, []);

  if (!rows) return <div className="card h-40 animate-pulse bg-clay-50" />;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <h2 className="font-display text-lg font-bold">🧾 Cash sales (scanned)</h2>
        {rows.length > 0 && (
          <a href="/api/sales-receipts/export" className="text-[11px] font-bold text-clay-600">
            Export Excel →
          </a>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="card p-4 text-sm text-stone-400">No submitted sales receipts yet.</p>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[760px] text-right text-xs">
            <thead className="bg-clay-50/70 text-[10px] uppercase tracking-wide text-stone-500">
              <tr>
                <th className="p-2 text-left font-bold">Date</th>
                <th className="p-2 text-left font-bold">Customer</th>
                <th className="p-2 font-bold">Fs.No</th>
                <th className="p-2 font-bold">Att.No</th>
                <th className="p-2 font-bold">Product</th>
                <th className="p-2 font-bold">Qty</th>
                <th className="p-2 font-bold">U.price</th>
                <th className="p-2 font-bold">Sub</th>
                <th className="p-2 font-bold">VAT</th>
                <th className="p-2 font-bold">Grand</th>
                <th className="p-2 font-bold">W/hold</th>
                <th className="p-2 font-bold">Net</th>
                <th className="p-2 text-left font-bold">Bank</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r._id} className="border-t border-clay-50">
                  <td className="p-2 text-left font-semibold text-stone-800">{fmtDate(r.date)}</td>
                  <td className="p-2 text-left text-stone-700">{r.customerName || "—"}</td>
                  <td className="p-2 text-stone-500">{r.fsNo || ""}</td>
                  <td className="p-2 text-stone-500">{r.attNo || ""}</td>
                  <td className="p-2 text-stone-700">{r.productTy || ""}</td>
                  <td className="p-2 tabular-nums">{num(r.qty)}</td>
                  <td className="p-2 tabular-nums">{num(r.unitPrice)}</td>
                  <td className="p-2 tabular-nums">{num(r.subTotal)}</td>
                  <td className="p-2 tabular-nums">{num(r.vat)}</td>
                  <td className="p-2 tabular-nums font-semibold text-stone-800">{num(r.grandTotal)}</td>
                  <td className="p-2 tabular-nums">{num(r.withhold)}</td>
                  <td className="p-2 tabular-nums font-bold text-clay-900">{num(r.netPay)}</td>
                  <td className="p-2 text-left text-stone-500">{r.depositedBank || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
