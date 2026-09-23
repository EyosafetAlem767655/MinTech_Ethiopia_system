"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
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

/** Calendar month key, "YYYY-MM". */
function monthKey(iso: string): string {
  return new Date(iso).toISOString().slice(0, 7);
}

/** The day itself — the finest bucket, one row per reading set. */
function dayKey(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

type Grain = "day" | "week" | "month";

const GRAINS: { key: Grain; label: string }[] = [
  { key: "day", label: "Daily" },
  { key: "week", label: "Weekly" },
  { key: "month", label: "Monthly" },
];

const keyOf: Record<Grain, (iso: string) => string> = { day: dayKey, week: weekKey, month: monthKey };

const fmtMonth = (key: string) =>
  new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

/** How a bucket is named on screen. */
function bucketLabel(grain: Grain, key: string): string {
  if (grain === "month") return fmtMonth(key);
  if (grain === "week") return `Week of ${fmtDate(key)}`;
  return fmtDate(key);
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
  /**
   * How far the readings are rolled up.
   *
   * The panel used to print every reading ever filed in one table and average
   * only the newest week underneath it — a list that grows by four rows a day
   * for ever, and a summary that could answer exactly one question. The grain
   * is a DISPLAY choice, not a time window, which is why it is local state
   * rather than the shared RangeSelector: nothing is fetched again when it
   * changes, the same rows are simply grouped differently.
   */
  const [grain, setGrain] = useState<Grain>("week");
  /** Which bucket's readings are expanded. Nothing is hidden, only folded. */
  const [openBucket, setOpenBucket] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/whiteness")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setRows(Array.isArray(d?.rows) ? d.rows : []))
      .catch(() => setRows([]));
  }, []);

  /** The readings grouped into the chosen bucket, newest bucket first. */
  const buckets = useMemo(() => {
    if (!rows || rows.length === 0) return [];
    const key = keyOf[grain];
    const map = new Map<string, Row[]>();
    for (const r of rows) {
      const k = key(r.date);
      map.set(k, [...(map.get(k) ?? []), r]);
    }
    return [...map.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([k, inBucket]) => ({
        key: k,
        label: bucketLabel(grain, k),
        rows: inBucket,
        count: inBucket.length,
        avg: averageOf(inBucket.map((r) => r.avg)),
        brands: new Set(inBucket.map((r) => r.productCode)).size,
        lines: new Set(inBucket.map((r) => r.line)).size,
      }));
  }, [rows, grain]);

  /** The bucket the breakdown cards describe: the one opened, else the newest. */
  const focus = useMemo(() => {
    if (buckets.length === 0) return null;
    const b = buckets.find((x) => x.key === openBucket) ?? buckets[0];

    const byBrand = new Map<string, (number | null)[]>();
    const byLine = new Map<number, (number | null)[]>();
    for (const r of b.rows) {
      byBrand.set(r.productCode, [...(byBrand.get(r.productCode) ?? []), r.avg]);
      byLine.set(r.line, [...(byLine.get(r.line) ?? []), r.avg]);
    }

    return {
      label: b.label,
      count: b.count,
      brands: [...byBrand.entries()]
        .map(([code, vals]) => ({ code, label: productLabel(code), avg: averageOf(vals), n: vals.length }))
        .sort((a, b2) => (b2.avg ?? -1) - (a.avg ?? -1)),
      lines: [...byLine.entries()]
        .map(([line, vals]) => ({ line, avg: averageOf(vals), n: vals.length }))
        .sort((a, b2) => a.line - b2.line),
    };
  }, [buckets, openBucket]);

  if (rows === null) return <div className="card h-64 animate-pulse bg-clay-50" />;

  const grainNoun = grain === "day" ? "day" : grain === "week" ? "week" : "month";

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
        <h2 className="font-display text-lg font-bold">⚪ Whiteness quality</h2>
        <p className="text-[11px] text-stone-400">4 checks a day · per product, per line</p>
      </div>

      {rows.length > 0 && (
        <div className="flex gap-1 rounded-full bg-clay-50 p-0.5">
          {GRAINS.map((g) => (
            <button
              key={g.key}
              onClick={() => {
                setGrain(g.key);
                setOpenBucket(null);
              }}
              aria-current={grain === g.key ? "true" : undefined}
              className={`flex-1 rounded-full py-1.5 text-[11px] font-bold transition-all duration-300 ${
                grain === g.key ? "bg-white text-clay-800 shadow" : "text-clay-400 hover:text-clay-600"
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="card p-4 text-sm text-stone-400">No whiteness checks filed yet.</p>
      ) : (
        <>
          {/* One row per bucket, with its readings a tap away. The summary folds
              the list; it never replaces it — a figure nobody can open is a
              figure nobody can check. */}
          <div className="card max-h-[26rem] overflow-auto p-0">
            <table className="w-full text-right text-xs">
              <thead className="sticky top-0 z-10 bg-clay-50 text-[10px] uppercase tracking-wide text-stone-500 shadow-[0_1px_0_#f3e3dd]">
                <tr>
                  <th className="p-2 text-left font-bold">{grainNoun === "day" ? "Day" : grainNoun === "week" ? "Week" : "Month"}</th>
                  <th className="p-2 font-bold">Checks</th>
                  <th className="p-2 font-bold">Brands</th>
                  <th className="p-2 font-bold">Lines</th>
                  <th className="p-2 font-bold">Average</th>
                </tr>
              </thead>
              <tbody>
                {buckets.map((b) => {
                  const open = openBucket === b.key;
                  return (
                    // Fragment with a key: a bucket renders two sibling rows and
                    // the shorthand <> cannot carry one.
                    <Fragment key={b.key}>
                      <tr
                        onClick={() => setOpenBucket(open ? null : b.key)}
                        className={`cursor-pointer border-t border-clay-50 transition-colors hover:bg-clay-50/60 ${
                          open ? "bg-clay-50/60" : ""
                        }`}
                      >
                        <td className="p-2 text-left font-semibold text-stone-800">
                          <span className="mr-1 text-[9px] text-stone-400">{open ? "▾" : "▸"}</span>
                          {b.label}
                        </td>
                        <td className="p-2 tabular-nums text-stone-500">{b.count}</td>
                        <td className="p-2 tabular-nums text-stone-500">{b.brands}</td>
                        <td className="p-2 tabular-nums text-stone-500">{b.lines}</td>
                        <td className="p-2 font-bold tabular-nums text-clay-900">{pct(b.avg)}</td>
                      </tr>
                      {open && (
                        <tr>
                          <td colSpan={5} className="bg-stone-50/70 p-0">
                            <ReadingsTable rows={b.rows} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {focus && (
            <div className="grid gap-3 sm:grid-cols-2">
              <AverageTable
                title="Average · per brand"
                subtitle={`${focus.label} · ${focus.count} checks`}
                rows={focus.brands.map((b) => ({ key: b.code, label: b.label, avg: b.avg, n: b.n }))}
              />
              <AverageTable
                title="Average · per line"
                subtitle={`${focus.label} · ${focus.count} checks`}
                rows={focus.lines.map((l) => ({ key: String(l.line), label: `Line ${l.line}`, avg: l.avg, n: l.n }))}
              />
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** Every reading behind one bucket, exactly as it was taken. */
function ReadingsTable({ rows }: { rows: Row[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-right text-xs">
              <thead className="bg-stone-100/80 text-[10px] uppercase tracking-wide text-stone-500">
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
