"use client";

import { useEffect, useState } from "react";

/**
 * Opening + received − issued, against what production actually counted.
 *
 * It lived inside VoucherPanels, which is rendered on BOTH the asset and the
 * finance tabs — so on finance it appeared under whichever sub-tab happened to
 * be open, floating beneath the WHT list or the credit table as though it
 * belonged to them. It belongs to a month, so on finance it now sits inside the
 * monthly report and nowhere else. On the asset tab it stays exactly where it
 * was, at the head of the vouchers it reconciles.
 *
 * Two exports: the table itself, for a caller that already has the figures, and
 * a self-loading card for one that does not.
 */

export interface ReconRow {
  key: string;
  size: string;
  colour: string;
  label: string;
  baseBalance: number;
  received: number;
  issued: number;
  expected: number;
  counted: number | null;
  gap: number | null;
}

export interface Reconciliation {
  month: string;
  countedOn: string | null;
  rows: ReconRow[];
  discrepancies: ReconRow[];
}

const fmt = (n: number | null | undefined, dp = 2) =>
  n == null
    ? "—"
    : (Math.round(n * 10 ** dp) / 10 ** dp).toLocaleString(undefined, { maximumFractionDigits: dp });

/**
 * A null gap means nobody has counted this month, which is NOT the same as
 * everything agreeing — it says so rather than showing a reassuring dash.
 */
export function BagStockCheck({ recon }: { recon: Reconciliation | null }) {
  if (!recon) return null;
  const hasGaps = recon.discrepancies.length > 0;
  const counted = recon.rows.some((r) => r.counted !== null);

  return (
    <section className="card space-y-2 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-sm font-bold">📦 PP bag stock check · {recon.month}</h3>
        <p className="text-[11px] text-stone-400">
          {counted ? `Counted ${recon.countedOn}` : "Not counted this month"}
        </p>
      </div>

      <div className="-mx-1 overflow-x-auto">
        <table className="w-full min-w-[420px] text-right text-xs">
          <thead className="text-[10px] uppercase tracking-wide text-stone-500">
            <tr>
              <th className="p-1.5 text-left font-bold">Bag</th>
              <th className="p-1.5 font-bold">Opening</th>
              <th className="p-1.5 font-bold">Received</th>
              <th className="p-1.5 font-bold">Issued</th>
              <th className="p-1.5 font-bold">Expected</th>
              <th className="p-1.5 font-bold">Counted</th>
              <th className="p-1.5 font-bold">Gap</th>
            </tr>
          </thead>
          <tbody>
            {recon.rows.map((r) => (
              <tr key={r.key} className="border-t border-clay-50">
                <td className="p-1.5 text-left font-semibold text-stone-800">{r.label}</td>
                <td className="p-1.5 tabular-nums text-stone-500">{fmt(r.baseBalance, 0)}</td>
                <td className="p-1.5 tabular-nums text-stone-700">{fmt(r.received, 0)}</td>
                <td className="p-1.5 tabular-nums text-stone-700">{fmt(r.issued, 0)}</td>
                <td className="p-1.5 tabular-nums font-semibold text-stone-800">{fmt(r.expected, 0)}</td>
                <td className="p-1.5 tabular-nums text-stone-800">
                  {r.counted === null ? <span className="text-stone-300">—</span> : fmt(r.counted, 0)}
                </td>
                <td
                  className={`p-1.5 font-bold tabular-nums ${
                    r.gap === null ? "text-stone-300" : r.gap === 0 ? "text-green-700" : "text-red-700"
                  }`}
                >
                  {r.gap === null ? "—" : `${r.gap > 0 ? "+" : ""}${fmt(r.gap, 0)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] leading-snug text-stone-400">
        {!counted
          ? "Production has not filed a bag count this month, so there is nothing to check the vouchers against."
          : hasGaps
            ? "A gap means bags moved without a voucher, a voucher was filed twice, or the count is off. The counted figure is recorded as reported — nothing here changes it."
            : "The floor agrees with the vouchers."}{" "}
        Checked per colour, because the six kinds carry different unit prices and are packed
        separately — a gap that named only the size could not say what it is worth.
      </p>
    </section>
  );
}

/**
 * The same table, loading its own figures for a given month.
 *
 * Used by the monthly report, which knows which month is on screen but holds
 * none of the voucher data. Refetches when that month changes, so the check can
 * never describe a different period from the report above it.
 */
export default function BagStockCheckCard({ month }: { month?: string }) {
  const [recon, setRecon] = useState<Reconciliation | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/bag-reconciliation${month ? `?month=${encodeURIComponent(month)}` : ""}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        setRecon(d?.reconciliation ?? null);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setRecon(null);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [month]);

  if (loading) return <div className="card h-40 animate-pulse bg-clay-50" />;
  if (!recon) {
    return (
      <p className="card p-3 text-xs text-stone-400">
        The bag stock check is unavailable — the voucher tables are not in the database yet.
      </p>
    );
  }
  return <BagStockCheck recon={recon} />;
}
