"use client";

import { useEffect, useMemo, useState } from "react";
import { productLabel } from "@/lib/products";

/**
 * Whiteness quality checks — four a day, per product, per line.
 *
 * Two tables: every reading as it was taken, and below it the weekly averages
 * per brand and per line, derived from the same rows rather than stored. A
 * stored weekly figure would go stale the moment a reading was corrected, and
 * nothing on screen would say which of the two to believe.
 */

const WB_SLOTS = ["wb1", "wb2", "wb3", "wb4", "wb5", "wb6"] as const;

interface Row {
  _id: string;
  date: string;
  dateLabel: string;
  quarter: number;
  productCode: string;
  line: number;
  readings: Record<string, string>;
  avg: number | null;
  reportedBy: string;
}

const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const pct = (n: number | null) => (n === null ? "—" : `${(Math.round(n * 100) / 100).toLocaleString()}%`);

/** Monday-anchored ISO week key, matching the rest of the app's week handling. */
function weekKey(iso: string): string {
  const d = new Date(iso);
  const day = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - day * 86400000).toISOString().slice(0, 10);
}

/**
 * Mean of the numeric readings only, divided by how many there were.
 *
 * The same rule the bot applies when it stores `avg`: a slot reading MNT,
 * outage or off is not a whiteness of zero, and counting it as one would report
 * a line that was switched off as one producing badly.
 */
function averageOf(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v !== null && isFinite(v));
  if (nums.length === 0) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
}

export default function WhitenessPanel() {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    fetch("/api/whiteness")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setRows(Array.isArray(d?.rows) ? d.rows : []))
      .catch(() => setRows([]));
  }, []);

  /** The most recent week present, and its per-brand / per-line averages. */
  const weekly = useMemo(() => {
    if (!rows || rows.length === 0) return null;
    const week = weekKey(rows[0].date);
    const inWeek = rows.filter((r) => weekKey(r.date) === week);

    const byBrand = new Map<string, (number | null)[]>();
    const byLine = new Map<number, (number | null)[]>();
    for (const r of inWeek) {
      byBrand.set(r.productCode, [...(byBrand.get(r.productCode) ?? []), r.avg]);
      byLine.set(r.line, [...(byLine.get(r.line) ?? []), r.avg]);
    }

    return {
      week,
      count: inWeek.length,
      brands: [...byBrand.entries()]
        .map(([code, vals]) => ({ code, label: productLabel(code), avg: averageOf(vals), n: vals.length }))
        .sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1)),
      lines: [...byLine.entries()]
        .map(([line, vals]) => ({ line, avg: averageOf(vals), n: vals.length }))
        .sort((a, b) => a.line - b.line),
    };
  }, [rows]);

  if (rows === null) return <div className="card h-64 animate-pulse bg-clay-50" />;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
        <h2 className="font-display text-lg font-bold">⚪ Whiteness quality</h2>
        <p className="text-[11px] text-stone-400">4 checks a day · per product, per line</p>
      </div>

      {rows.length === 0 ? (
        <p className="card p-4 text-sm text-stone-400">No whiteness checks filed yet.</p>
      ) : (
        <>
          <div className="card max-h-[26rem] overflow-auto p-0">
            <table className="w-full min-w-[640px] text-right text-xs">
              <thead className="sticky top-0 z-10 bg-clay-50 text-[10px] uppercase tracking-wide text-stone-500 shadow-[0_1px_0_#f3e3dd]">
                <tr>
                  <th className="p-2 text-left font-bold">Date</th>
                  <th className="p-2 font-bold">Qtr</th>
                  <th className="p-2 text-left font-bold">Product</th>
                  <th className="p-2 font-bold">Line</th>
                  {WB_SLOTS.map((s) => (
                    <th key={s} className="p-2 font-bold uppercase">
                      {s}
                    </th>
                  ))}
                  <th className="p-2 font-bold">Avg</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r._id} className="border-t border-clay-50">
                    <td className="p-2 text-left font-semibold text-stone-800">{fmtDate(r.date)}</td>
                    <td className="p-2 tabular-nums text-stone-500">{r.quarter}</td>
                    <td className="p-2 text-left text-stone-700">{productLabel(r.productCode)}</td>
                    <td className="p-2 tabular-nums text-stone-700">{r.line}</td>
                    {WB_SLOTS.map((s) => {
                      const v = r.readings?.[s] ?? "";
                      const numeric = v !== "" && isFinite(Number(v));
                      return (
                        <td
                          key={s}
                          className={`p-2 tabular-nums ${numeric ? "text-stone-700" : "text-amber-700"}`}
                        >
                          {/* A non-numeric reading is shown as the word that was
                              typed — MNT and 0 mean entirely different things. */}
                          {v === "" ? <span className="text-stone-300">—</span> : v}
                        </td>
                      );
                    })}
                    <td className="p-2 font-bold tabular-nums text-clay-900">{pct(r.avg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {weekly && (
            <div className="grid gap-3 sm:grid-cols-2">
              <AverageTable
                title="Weekly average · per brand"
                subtitle={`Week of ${fmtDate(weekly.week)} · ${weekly.count} checks`}
                rows={weekly.brands.map((b) => ({ key: b.code, label: b.label, avg: b.avg, n: b.n }))}
              />
              <AverageTable
                title="Weekly average · per line"
                subtitle={`Week of ${fmtDate(weekly.week)} · ${weekly.count} checks`}
                rows={weekly.lines.map((l) => ({ key: String(l.line), label: `Line ${l.line}`, avg: l.avg, n: l.n }))}
              />
            </div>
          )}
        </>
      )}
    </section>
  );
}

function AverageTable({
  title,
  subtitle,
  rows,
}: {
  title: string;
  subtitle: string;
  rows: { key: string; label: string; avg: number | null; n: number }[];
}) {
  return (
    <div className="card p-3">
      <p className="text-[11px] font-bold text-stone-700">{title}</p>
      <p className="mb-2 text-[10px] text-stone-400">{subtitle}</p>
      {rows.length === 0 ? (
        <p className="text-xs text-stone-400">No checks this week.</p>
      ) : (
        <table className="w-full text-right text-xs">
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-clay-50">
                <td className="p-1.5 text-left text-stone-700">{r.label}</td>
                <td className="p-1.5 text-[10px] text-stone-400">{r.n} checks</td>
                <td className="p-1.5 font-bold tabular-nums text-clay-900">{pct(r.avg)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
