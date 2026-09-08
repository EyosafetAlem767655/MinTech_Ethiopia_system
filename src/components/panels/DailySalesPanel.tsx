"use client";

import { useEffect, useState } from "react";

/**
 * The day's sales, as the till reports them.
 *
 * This replaced a fifteen-column table with one row per transaction. The
 * salesperson was photographing and filing every sale individually, which on a
 * busy day meant the same six steps a dozen times over — and the till already
 * totals the day itself.
 */

interface Row {
  _id: string;
  date: string;
  dateLabel: string;
  cashPayment: number;
  cashRefund: number;
  chequePayment: number;
  chequeRefund: number;
  cardPayment: number;
  cardRefund: number;
  creditPayment: number;
  creditRefund: number;
  voucherPayment: number;
  voucherRefund: number;
  totalPayment: number;
  totalRefund: number;
  netTotal: number;
  printedTotal: number | null;
  reportedBy: string;
}

const COLUMNS = [
  { key: "cash", label: "Cash" },
  { key: "cheque", label: "Cheque" },
  { key: "card", label: "Card" },
  { key: "credit", label: "Credit" },
  { key: "voucher", label: "Voucher" },
] as const;

const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const money = (n: number) => (n ? Math.round(n).toLocaleString() : "");

export default function DailySalesPanel() {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    fetch("/api/daily-sales")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .catch(() => setRows([]));
  }, []);

  if (!rows) return <div className="card h-40 animate-pulse bg-clay-50" />;

  const sum = (k: keyof Row) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
        <h2 className="font-display text-lg font-bold">🧾 Daily sales</h2>
        <p className="text-[11px] text-stone-400">One payment summary per day</p>
      </div>

      {rows.length === 0 ? (
        <p className="card p-4 text-sm text-stone-400">No daily sales report filed yet.</p>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-right text-xs">
            <thead className="bg-clay-50/70 text-[10px] uppercase tracking-wide text-stone-500">
              <tr>
                <th className="p-2 text-left font-bold">Date</th>
                {COLUMNS.map((c) => (
                  <th key={c.key} className="p-2 font-bold">
                    {c.label}
                  </th>
                ))}
                <th className="p-2 font-bold">Payments</th>
                <th className="p-2 font-bold">Refunds</th>
                {/* No receipt column. The photograph is read once in the bot,
                    checked by the reporter on the edit card, and never kept —
                    not in the bucket and not as a Telegram id. What survives the
                    day is the figures on this row. */}
                <th className="p-2 font-bold">Net</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                // A printed total that disagrees with its own rows is the thing
                // worth surfacing, so it is shown rather than silently trusted
                // or silently discarded.
                const mismatch =
                  r.printedTotal !== null && Math.abs(r.printedTotal - r.totalPayment) > 1;
                return (
                  <tr key={r._id} className="border-t border-clay-50">
                    <td className="p-2 text-left font-semibold text-stone-800">{fmtDate(r.date)}</td>
                    {COLUMNS.map((c) => {
                      const pay = Number(r[`${c.key}Payment` as keyof Row]) || 0;
                      const ref = Number(r[`${c.key}Refund` as keyof Row]) || 0;
                      return (
                        <td key={c.key} className="p-2 tabular-nums text-stone-700">
                          {pay ? money(pay) : <span className="text-stone-300">—</span>}
                          {ref > 0 && <span className="block text-[10px] text-amber-700">↩ {money(ref)}</span>}
                        </td>
                      );
                    })}
                    <td className="p-2 font-semibold tabular-nums text-stone-800">
                      {money(r.totalPayment)}
                      {mismatch && (
                        <span
                          title={`The receipt printed ${money(r.printedTotal || 0)}, which does not match the rows above it.`}
                          className="ml-1 text-amber-600"
                        >
                          ⚠️
                        </span>
                      )}
                    </td>
                    <td className="p-2 tabular-nums text-stone-600">{money(r.totalRefund)}</td>
                    <td className="p-2 font-bold tabular-nums text-clay-900">{money(r.netTotal)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-clay-200 bg-clay-50/40 font-bold">
                <td className="p-2 text-left">Total · {rows.length} day(s)</td>
                {COLUMNS.map((c) => (
                  <td key={c.key} className="p-2 tabular-nums">
                    {money(sum(`${c.key}Payment` as keyof Row))}
                  </td>
                ))}
                <td className="p-2 tabular-nums">{money(sum("totalPayment"))}</td>
                <td className="p-2 tabular-nums">{money(sum("totalRefund"))}</td>
                <td className="p-2 tabular-nums text-clay-900">{money(sum("netTotal"))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
