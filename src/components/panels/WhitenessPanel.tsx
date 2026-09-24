"use client";

import { useEffect, useMemo, useState } from "react";
import { productLabel } from "@/lib/products";
import RangeSelector from "@/components/RangeSelector";
import { type RangeKey } from "@/lib/ranges";
import { bandLabel, belowSpec, readingBelow, specFor } from "@/lib/whiteness-spec";

/**
 * Whiteness quality checks — four a day, per product, per line.
 *
 * Every reading in the chosen window, and below it the per-brand and per-line
 * averages for that same window. Both are derived from the same rows rather
 * than stored: a stored average would go stale the moment a reading was
 * corrected, and nothing on screen would say which of the two to believe.
 *
 * The window is the whole point of the control at the top. This panel used to
 * print every reading ever filed in one unbroken table — by the third month
 * that is a thousand rows nobody scrolls, and "what did the line do today" was
 * unanswerable from the screen built to answer it.
 */

const WB_SLOTS = ["wb1", "wb2", "wb3", "wb4", "wb5", "wb6"] as const;

/**
 * The four windows worth asking about here, and their wording.
 *
 * The shared labels ("Daily", "Weekly") read correctly beside a trend chart and
 * wrongly beside a list of readings, where the same window means "today only".
 */
const WINDOW_KEYS: RangeKey[] = ["daily", "weekly", "monthly", "d90"];
const WINDOW_LABELS: Partial<Record<RangeKey, string>> = {
  daily: "Today",
  weekly: "7 days",
  monthly: "1 month",
  d90: "3 months",
};

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
  const [range, setRange] = useState<RangeKey>("weekly");
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    let alive = true;
    setRows(null);
    fetch(`/api/whiteness?range=${range}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive) setRows(Array.isArray(d?.rows) ? d.rows : []);
      })
      .catch(() => {
        if (alive) setRows([]);
      });
    return () => {
      alive = false;
    };
  }, [range]);

  /** Per-brand and per-line averages across everything in the window. */
  const summary = useMemo(() => {
    if (!rows || rows.length === 0) return null;

    const byBrand = new Map<string, (number | null)[]>();
    const byLine = new Map<number, (number | null)[]>();
    for (const r of rows) {
      byBrand.set(r.productCode, [...(byBrand.get(r.productCode) ?? []), r.avg]);
      byLine.set(r.line, [...(byLine.get(r.line) ?? []), r.avg]);
    }

    return {
      count: rows.length,
      /* Checks with at least one reading under the product's band — the same
         function the bot alarm and the Brief use, so a row shown red here is
         exactly a row somebody was paged about. */
      breached: rows.filter((r) => belowSpec(r.productCode, r.readings).length > 0).length,
      brands: [...byBrand.entries()]
        .map(([code, vals]) => ({ code, label: productLabel(code), avg: averageOf(vals), n: vals.length }))
        .sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1)),
      lines: [...byLine.entries()]
        .map(([line, vals]) => ({ line, avg: averageOf(vals), n: vals.length }))
        .sort((a, b) => a.line - b.line),
    };
  }, [rows]);

  const windowLabel = WINDOW_LABELS[range] ?? "";

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
        <h2 className="font-display text-lg font-bold">⚪ Whiteness quality</h2>
        <p className="text-[11px] text-stone-400">4 checks a day · per product, per line</p>
      </div>

      <RangeSelector value={range} onChange={setRange} keys={WINDOW_KEYS} labels={WINDOW_LABELS} />

      {rows === null ? (
        <div className="card h-64 animate-pulse bg-clay-50" />
      ) : rows.length === 0 ? (
        <p className="card p-4 text-sm text-stone-400">
          No whiteness checks in this window{range === "daily" ? " — nothing filed today yet." : "."}
        </p>
      ) : (
        <>
          <p className="px-1 text-[11px] text-stone-400">
            {rows.length} check{rows.length === 1 ? "" : "s"} · {windowLabel.toLowerCase()}
            {summary && summary.breached > 0 && (
              <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-800">
                ⚠️ {summary.breached} below spec
              </span>
            )}
          </p>

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
                      /* Three states, three colours: a number inside the band
                         is plain, a number under it is red, and a word (MNT,
                         OUTAGE, OFF) stays amber — a stopped line is not a
                         quality failure and must never be coloured as one. */
                      const low = readingBelow(r.productCode, v) !== null;
                      const spec = specFor(r.productCode);
                      return (
                        <td
                          key={s}
                          title={low && spec ? `Below the ${bandLabel(spec)} band for ${productLabel(r.productCode)}` : undefined}
                          className={`p-2 tabular-nums ${
                            low ? "font-bold text-red-700" : numeric ? "text-stone-700" : "text-amber-700"
                          }`}
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

          {summary && (
            <div className="grid gap-3 sm:grid-cols-2">
              <AverageTable
                title="Average · per brand"
                subtitle={`${windowLabel} · ${summary.count} checks`}
                rows={summary.brands.map((b) => {
                  const spec = specFor(b.code);
                  return {
                    key: b.code,
                    label: b.label,
                    avg: b.avg,
                    n: b.n,
                    // The band the sheet gives, so the average is read against
                    // something. Products the sheet does not cover say so
                    // rather than showing a blank that looks like a pass.
                    band: spec ? bandLabel(spec) : "no band",
                    low: spec !== null && b.avg !== null && b.avg < spec.alertFloor,
                  };
                })}
              />
              <AverageTable
                title="Average · per line"
                subtitle={`${windowLabel} · ${summary.count} checks`}
                rows={summary.lines.map((l) => ({ key: String(l.line), label: `Line ${l.line}`, avg: l.avg, n: l.n }))}
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
  /** `band` and `low` are the brand table only; the per-line table has neither. */
  rows: { key: string; label: string; avg: number | null; n: number; band?: string; low?: boolean }[];
}) {
  return (
    <div className="card p-3">
      <p className="text-[11px] font-bold text-stone-700">{title}</p>
      <p className="mb-2 text-[10px] text-stone-400">{subtitle}</p>
      {rows.length === 0 ? (
        <p className="text-xs text-stone-400">No checks in this window.</p>
      ) : (
        <table className="w-full text-right text-xs">
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-clay-50">
                <td className="p-1.5 text-left text-stone-700">{r.label}</td>
                {r.band !== undefined && <td className="p-1.5 text-left text-[10px] text-stone-400">{r.band}</td>}
                <td className="p-1.5 text-[10px] text-stone-400">{r.n} checks</td>
                <td className={`p-1.5 font-bold tabular-nums ${r.low ? "text-red-700" : "text-clay-900"}`}>
                  {pct(r.avg)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
