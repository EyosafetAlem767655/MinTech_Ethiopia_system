"use client";

import { useEffect, useMemo, useState } from "react";
import RangeSelector from "@/components/RangeSelector";
import { ScrollTable } from "@/components/panels/TableChart";
import { RANGES, type RangeKey } from "@/lib/ranges";
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
 * Received and issued are FLOWS and foot; stock is a LEVEL and deliberately
 * does not — adding a month of daily stock counts produces a number that means
 * nothing. The check below does the only comparison worth making.
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
}

const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const num = (n?: number | null) =>
  n === null || n === undefined || n === 0 ? "" : (Math.round(n * 1000) / 1000).toLocaleString();
const t = (n: number | null) =>
  n === null ? "—" : `${(Math.round(n * 1000) / 1000).toLocaleString()}`;

export default function RawMaterialDailyPanel() {
  const [range, setRange] = useState<RangeKey>("monthly");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [check, setCheck] = useState<Check | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let alive = true;
    setRows(null);
    fetch(`/api/raw-material-daily?range=${range}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        setRows(Array.isArray(d?.rows) ? d.rows : []);
        setCheck(d?.check ?? null);
        setUnavailable(Boolean(d?.unavailable));
      })
      .catch(() => {
        if (alive) setRows([]);
      });
    return () => {
      alive = false;
    };
  }, [range]);

  const totals = useMemo(() => {
    const sum = (pick: (r: Row) => Record<string, number>) => {
      const out: Record<string, number> = {};
      for (const m of FINANCE_RAW_MATERIALS) {
        out[m] = (rows ?? []).reduce((a, r) => a + (Number(pick(r)?.[m]) || 0), 0);
      }
      return out;
    };
    return { received: sum((r) => r.received), issued: sum((r) => r.issued) };
  }, [rows]);

  if (rows === null) return <div className="card h-64 animate-pulse bg-clay-50" />;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
        <h2 className="font-display text-lg font-bold">🧱 Raw material · daily</h2>
        <p className="text-[11px] text-stone-400">tonnes · received, used, counted</p>
      </div>

      <RangeSelector value={range} onChange={setRange} />

      {unavailable && (
        <p className="card p-3 text-xs text-amber-700">
          The daily raw-material table is not in the database yet — apply migration 0033.
        </p>
      )}

      <ScrollTable
        minWidth={720}
        empty={rows.length === 0}
        emptyLabel={`No daily raw-material reports in the ${RANGES[range].label.toLowerCase()} window.`}
      >
        <thead className="sticky top-0 z-10 bg-clay-50 text-[10px] uppercase tracking-wide text-stone-500 shadow-[0_1px_0_#f3e3dd]">
          <tr>
            <th className="p-2 text-left font-bold" rowSpan={2}>
              Date
            </th>
            <th className="p-2 font-bold" colSpan={3}>
              📥 Received
            </th>
            <th className="border-l border-clay-100 p-2 font-bold" colSpan={3}>
              🏭 Issue
            </th>
            <th className="border-l border-clay-100 p-2 font-bold" colSpan={3}>
              📦 Stock
            </th>
            <th className="border-l border-clay-100 p-2 text-left font-bold" rowSpan={2}>
              By
            </th>
          </tr>
          <tr>
            {(["received", "issued", "stock"] as const).map((section) =>
              FINANCE_RAW_MATERIALS.map((m, i) => (
                <th
                  key={`${section}-${m}`}
                  className={`p-2 font-bold ${i === 0 && section !== "received" ? "border-l border-clay-100" : ""}`}
                >
                  {m}
                </th>
              ))
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r._id} className="border-t border-clay-50">
              <td className="p-2 text-left font-semibold text-stone-800">{fmtDate(r.date)}</td>
              {(["received", "issued", "stock"] as const).map((section) =>
                FINANCE_RAW_MATERIALS.map((m, i) => (
                  <td
                    key={`${section}-${m}`}
                    className={`p-2 tabular-nums text-stone-700 ${
                      i === 0 && section !== "received" ? "border-l border-clay-50" : ""
                    }`}
                  >
                    {num(r[section]?.[m])}
                  </td>
                ))
              )}
              <td className="border-l border-clay-50 p-2 text-left text-stone-500">{r.reportedBy}</td>
            </tr>
          ))}
        </tbody>
        {/* Received and issued foot; stock does not. Each stock figure is a
            closing count, so a column of them adds up to nothing real. */}
        <tfoot className="sticky bottom-0 bg-clay-50 shadow-[0_-1px_0_#f3e3dd]">
          <tr className="font-bold">
            <td className="p-2 text-left">Total</td>
            {FINANCE_RAW_MATERIALS.map((m) => (
              <td key={`tr-${m}`} className="p-2 tabular-nums">
                {num(totals.received[m])}
              </td>
            ))}
            {FINANCE_RAW_MATERIALS.map((m, i) => (
              <td key={`ti-${m}`} className={`p-2 tabular-nums ${i === 0 ? "border-l border-clay-100" : ""}`}>
                {num(totals.issued[m])}
              </td>
            ))}
            <td colSpan={4} className="border-l border-clay-100 p-2 text-[10px] font-normal text-stone-400">
              stock is a closing count
            </td>
          </tr>
        </tfoot>
      </ScrollTable>

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
