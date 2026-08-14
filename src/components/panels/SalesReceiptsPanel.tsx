"use client";

import { useEffect, useState } from "react";

/** Sales reports submitted from the Telegram bot → agreed Sales report table. */

interface ReceiptCheck {
  /** False when the AI call failed — says nothing about the receipt itself.
   *  Rows written before this field existed have it undefined; those did run. */
  checked?: boolean;
  hasStamp: boolean;
  score: number;
  flags: string[];
  reasoning: string;
  extracted: { productTy: string; qty: number; unitPrice: number; grandTotal: number } | null;
  mismatches: string[];
}

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
  remark: string | null;
  receiptCheck: ReceiptCheck | null;
}

const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB");
const num = (n?: number | null) => (n ? Math.round(n).toLocaleString() : "");
/** Compact receipt validity badge: stamp (validity) first, then authenticity score. */
function CheckBadge({ check }: { check: ReceiptCheck | null }) {
  if (!check) return <span className="text-stone-300">—</span>;
  const { hasStamp, score, mismatches, flags, reasoning } = check;

  // A check that never ran is not a failed receipt. Show it as unverified in
  // neutral grey — flagging it red accused the salesperson of submitting an
  // unstamped receipt every time the AI call happened to fail.
  if (check.checked === false) {
    return (
      <span
        title={[reasoning, flags.length ? `flags: ${flags.join(", ")}` : ""].filter(Boolean).join(" · ")}
        className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-bold text-stone-600"
      >
        ⏳ Not checked
      </span>
    );
  }

  // No stamp ⇒ the receipt is not valid, regardless of the authenticity score.
  const tone = !hasStamp
    ? "bg-red-100 text-red-800"
    : score >= 75
    ? "bg-green-100 text-green-800"
    : score >= 50
    ? "bg-amber-100 text-amber-800"
    : "bg-red-100 text-red-800";
  const title = [
    `confidence: ${score}%`,
    hasStamp ? "stamp: present" : "NO STAMP — not valid",
    reasoning,
    flags.length ? `flags: ${flags.join(", ")}` : "",
    mismatches.length ? `mismatch: ${mismatches.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${tone}`}
    >
      {hasStamp ? `🔖 ${score}%` : "❌ No stamp"}
      {hasStamp && mismatches.length > 0 && <span>⚠️</span>}
    </span>
  );
}

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
          <table className="w-full min-w-[1180px] text-right text-xs">
            <thead className="bg-clay-50/70 text-[10px] uppercase tracking-wide text-stone-500">
              <tr>
                <th className="p-2 text-left font-bold">Date</th>
                <th className="p-2 text-left font-bold">Customers Name</th>
                <th className="p-2 text-left font-bold">Fs No</th>
                <th className="p-2 text-left font-bold">Att.No</th>
                <th className="p-2 text-left font-bold">Product Ty</th>
                <th className="p-2 font-bold">Qty</th>
                <th className="p-2 font-bold">Unit Price</th>
                <th className="p-2 font-bold">Sub Total</th>
                <th className="p-2 font-bold">Vat 15%</th>
                <th className="p-2 font-bold">Grand Total</th>
                <th className="p-2 font-bold">Withhold</th>
                <th className="p-2 font-bold">Net Pay</th>
                <th className="p-2 text-left font-bold">Deposited Bank</th>
                <th className="p-2 text-left font-bold">Remark</th>
                <th className="p-2 font-bold">Confidence</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r._id} className="border-t border-clay-50">
                  <td className="p-2 text-left font-semibold text-stone-800">{fmtDate(r.date)}</td>
                  <td className="p-2 text-left text-stone-700">{r.customerName || "—"}</td>
                  <td className="p-2 text-left tabular-nums text-stone-600">{r.fsNo || "—"}</td>
                  <td className="p-2 text-left tabular-nums text-stone-600">{r.attNo || "—"}</td>
                  <td className="p-2 text-left text-stone-700">{r.productTy || "—"}</td>
                  <td className="p-2 tabular-nums">{r.qty ?? ""}</td>
                  <td className="p-2 tabular-nums">{num(r.unitPrice)}</td>
                  <td className="p-2 tabular-nums">{num(r.subTotal)}</td>
                  <td className="p-2 tabular-nums">{num(r.vat)}</td>
                  <td className="p-2 tabular-nums font-semibold text-stone-800">{num(r.grandTotal)}</td>
                  <td className="p-2 tabular-nums">{num(r.withhold)}</td>
                  <td className="p-2 tabular-nums font-bold text-clay-900">{num(r.netPay)}</td>
                  <td className="p-2 text-left text-stone-600">{r.depositedBank || "—"}</td>
                  <td className="p-2 text-left text-stone-500">{r.remark || ""}</td>
                  <td className="p-2 text-center">
                    <CheckBadge check={r.receiptCheck} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-clay-200 bg-clay-50/40 font-bold">
                <td className="p-2 text-left" colSpan={7}>
                  Total · {rows.length}
                </td>
                <td className="p-2 tabular-nums">{num(sum("subTotal"))}</td>
                <td className="p-2 tabular-nums">{num(sum("vat"))}</td>
                <td className="p-2 tabular-nums">{num(sum("grandTotal"))}</td>
                <td className="p-2 tabular-nums">{num(sum("withhold"))}</td>
                <td className="p-2 tabular-nums text-clay-900">{num(sum("netPay"))}</td>
                <td className="p-2" />
                <td className="p-2" />
                <td className="p-2" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
