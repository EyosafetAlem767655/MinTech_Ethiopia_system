"use client";

import { useEffect, useState } from "react";
import { FINANCE_RAW_MATERIALS } from "@/lib/products";

/**
 * The daily raw-material report: what came in, what production used, and what
 * was counted on the ground.
 *
 * It replaces the per-truck intake table (supplier, delivery note, plate,
 * M.R.V). Those rows still exist and are still readable under Settings →
 * Submissions; nothing was deleted. What changed is what the store files each
 * day, and this is the shape of it.
 *
 * The report is filed about once a month, so the panel shows the LATEST
 * submission only, not a day-by-day table. Every day's row is still kept and
 * readable under Settings → Submissions. The check below does the only
 * comparison worth making.
 */

interface Row {
  _id: string;
  date: string;
  dateLabel: string;
  received: Record<string, number>;
  issued: Record<string, number>;
  stock: Record<string, number>;
  reportedBy: string;
}

interface CheckRow {
  material: string;
  baseBalance: number;
  received: number;
  issued: number;
  expected: number;
  counted: number | null;
  gap: number | null;
}

interface Check {
  month: string;
  countedOn: string | null;
  rows: CheckRow[];
  discrepancies: CheckRow[];
  openingSource?: "counted" | "submitted" | "carried" | "none";
  openingFrom?: string | null;
}

const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const num = (n?: number | null) =>
  n === null || n === undefined || n === 0 ? "" : (Math.round(n * 1000) / 1000).toLocaleString();
const t = (n: number | null) =>
  n === null ? "—" : `${(Math.round(n * 1000) / 1000).toLocaleString()}`;

export default function RawMaterialDailyPanel() {
  const [latest, setLatest] = useState<Row | null | undefined>(undefined);
  const [check, setCheck] = useState<Check | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/raw-material-daily`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        setLatest(d?.latest ?? null);
        setCheck(d?.check ?? null);
        setUnavailable(Boolean(d?.unavailable));
      })
      .catch(() => {
        if (alive) setLatest(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (latest === undefined) return <div className="card h-64 animate-pulse bg-clay-50" />;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
        <h2 className="font-display text-lg font-bold">🧱 Raw material · latest</h2>
        <p className="text-[11px] text-stone-400">tonnes · the last submission</p>
      </div>

      {unavailable && (
        <p className="card p-3 text-xs text-amber-700">
          The daily raw-material table is not in the database yet — apply migration 0033.
        </p>
      )}

      {/* The count is filed about once a month, so the last submission is the
          figure worth reading; a day-by-day table was mostly empty days. */}
      {latest === null ? (
        !unavailable && <p className="card p-3 text-xs text-stone-500">No raw-material report has been submitted yet.</p>
      ) : (
        <section className="card space-y-2 p-3">
          <p className="text-[11px] text-stone-500">
            Submitted for <b className="text-stone-800">{fmtDate(latest.date)}</b> by {latest.reportedBy}
          </p>
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[360px] text-right text-xs">
              <thead className="text-[10px] uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="p-1.5 text-left font-bold">Material</th>
                  <th className="p-1.5 font-bold">📥 Received</th>
                  <th className="p-1.5 font-bold">🏭 Issue</th>
                  <th className="p-1.5 font-bold">📦 Stock</th>
                </tr>
              </thead>
              <tbody>
                {FINANCE_RAW_MATERIALS.map((m) => (
                  <tr key={m} className="border-t border-clay-50">
                    <td className="p-1.5 text-left font-semibold text-stone-800">{m}</td>
                    <td className="p-1.5 tabular-nums text-stone-700">{num(latest.received?.[m]) || "—"}</td>
                    <td className="p-1.5 tabular-nums text-stone-700">{num(latest.issued?.[m]) || "—"}</td>
                    <td className="p-1.5 font-semibold tabular-nums text-stone-800">{num(latest.stock?.[m]) || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {check && <StockCheck check={check} />}
    </section>
  );
}

/**
 * Opening + received − issued, against what was counted on the ground.
 *
 * The same shape as the PP bag stock check, for the same reason: two records of
 * one quantity, and the gap between them is the number worth looking at.
 */
function StockCheck({ check }: { check: Check }) {
  const counted = check.countedOn !== null;
  const hasGaps = check.discrepancies.length > 0;

  return (
    <section className="card space-y-2 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-sm font-bold">⚖️ Raw material stock check · {check.month}</h3>
        <p className="text-[11px] text-stone-400">
          {counted ? `Counted ${fmtDate(check.countedOn!)}` : "No stock counted this month"}
        </p>
      </div>
      {check.openingSource && (
        <p className="text-[11px] text-stone-500">
          Opening:{" "}
          {check.openingSource === "counted"
            ? `last stock count in the daily report (${check.openingFrom ? fmtDate(check.openingFrom) : "before the 1st"}), plus anything received or issued after it`
            : check.openingSource === "submitted"
            ? `beginning balance submitted for ${check.month}`
            : check.openingSource === "carried"
              ? `carried from last month's closing${check.openingFrom ? ` (from the ${check.openingFrom} beginning balance + daily reports since)` : " (daily reports)"}`
              : "no beginning balance submitted yet"}
        </p>
      )}

      <div className="-mx-1 overflow-x-auto">
        <table className="w-full min-w-[460px] text-right text-xs">
          <thead className="text-[10px] uppercase tracking-wide text-stone-500">
            <tr>
              <th className="p-1.5 text-left font-bold">Material</th>
              <th className="p-1.5 font-bold">Opening</th>
              <th className="p-1.5 font-bold">Received</th>
              <th className="p-1.5 font-bold">Issued</th>
              <th className="p-1.5 font-bold">Expected</th>
              <th className="p-1.5 font-bold">Counted</th>
              <th className="p-1.5 font-bold">Gap</th>
            </tr>
          </thead>
          <tbody>
            {check.rows.map((r) => (
              <tr key={r.material} className="border-t border-clay-50">
                <td className="p-1.5 text-left font-semibold text-stone-800">{r.material}</td>
                <td className="p-1.5 tabular-nums text-stone-500">{t(r.baseBalance)}</td>
                <td className="p-1.5 tabular-nums text-stone-700">{t(r.received)}</td>
                <td className="p-1.5 tabular-nums text-stone-700">{t(r.issued)}</td>
                <td className="p-1.5 tabular-nums font-semibold text-stone-800">{t(r.expected)}</td>
                <td className="p-1.5 tabular-nums text-stone-800">
                  {r.counted === null ? <span className="text-stone-300">—</span> : t(r.counted)}
                </td>
                <td
                  className={`p-1.5 font-bold tabular-nums ${
                    r.gap === null ? "text-stone-300" : Math.abs(r.gap) <= 0.05 ? "text-green-700" : "text-red-700"
                  }`}
                >
                  {r.gap === null ? "—" : `${r.gap > 0 ? "+" : ""}${t(r.gap)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] leading-snug text-stone-400">
        {!counted
          ? "No stock figure has been filed this month, so there is nothing to check the movements against."
          : hasGaps
            ? "A gap means material moved without being written down, a figure was mistyped, or the opening balance is wrong. Nothing here changes what was reported."
            : "The ground agrees with the paperwork."}{" "}
        Expected is the opening balance plus everything received, less everything issued, for {check.month}.
      </p>
    </section>
  );
}
