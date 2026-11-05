"use client";

import { useEffect, useState } from "react";
import { FINANCE_RAW_MATERIALS } from "@/lib/products";

/**
 * Raw material, worked out from production: what the month opened with, what
 * arrived, what each day's tons used (+ 5% wastage), and what is left.
 *
 * Nobody files what was used or counts stock daily. Asset management files only
 * what arrives; older daily reports stay under Settings → Submissions. Grade 1
 * has its own stone and is shown apart, only when there is some.
 */

type Tons = Record<string, number>;

interface Day {
  day: string;
  produced: Tons;
  used: Tons;
  received: Tons;
  remaining: Tons;
}

interface Stream {
  opening: Tons;
  openingSource: "counted" | "submitted" | "carried" | "none";
  openingFrom: string | null;
  received: Tons;
  used: Tons;
  closing: Tons;
  days: Day[];
}

interface Ledger {
  month: string;
  normal: Stream;
  grade1: Stream | null;
}

const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const t = (n: number) => (Math.round(n * 1000) / 1000).toLocaleString();
const moved = (n: number) => (n === 0 ? <span className="text-stone-300">0</span> : t(n));

function openingNote(s: Stream): string {
  if (s.openingSource === "submitted") return "beginning balance filed for this month";
  if (s.openingSource === "counted") return `last stock count before the month${s.openingFrom ? ` (${s.openingFrom})` : ""}`;
  if (s.openingSource === "carried") return `calculated closing of ${s.openingFrom ?? "last month"}`;
  return "nothing filed yet, opens at 0";
}

function StreamTables({ stream }: { stream: Stream }) {
  return (
    <>
      <section className="card space-y-2 p-3">
        <p className="text-[11px] text-stone-500">Opening: {openingNote(stream)}</p>
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[420px] text-right text-xs">
            <thead className="text-[10px] uppercase tracking-wide text-stone-500">
              <tr>
                <th className="p-1.5 text-left font-bold">Material</th>
                <th className="p-1.5 font-bold">Opening</th>
                <th className="p-1.5 font-bold">📥 Received</th>
                <th className="p-1.5 font-bold">🏭 Used</th>
                <th className="p-1.5 font-bold">📦 Remaining</th>
              </tr>
            </thead>
            <tbody>
              {FINANCE_RAW_MATERIALS.map((m) => (
                <tr key={m} className="border-t border-clay-50">
                  <td className="p-1.5 text-left font-semibold text-stone-800">{m}</td>
                  <td className="p-1.5 tabular-nums text-stone-500">{t(stream.opening[m])}</td>
                  <td className="p-1.5 tabular-nums text-stone-700">{t(stream.received[m])}</td>
                  <td className="p-1.5 tabular-nums text-stone-700">{t(stream.used[m])}</td>
                  <td
                    className={`p-1.5 font-bold tabular-nums ${stream.closing[m] < 0 ? "text-red-700" : "text-stone-800"}`}
                  >
                    {t(stream.closing[m])}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {stream.days.length > 0 && (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-right text-xs">
            <thead className="bg-clay-50/70 text-[10px] uppercase tracking-wide text-stone-500">
              <tr>
                <th rowSpan={2} className="p-2 text-left font-bold">
                  Day
                </th>
                <th colSpan={3} className="border-l border-clay-100 p-1 text-center font-bold">
                  Used (tons + 5%)
                </th>
                <th colSpan={3} className="border-l border-clay-100 p-1 text-center font-bold">
                  Received
                </th>
                <th colSpan={3} className="border-l border-clay-100 p-1 text-center font-bold">
                  Remaining
                </th>
              </tr>
              <tr>
                {[0, 1, 2].flatMap((block) =>
                  FINANCE_RAW_MATERIALS.map((m, i) => (
                    <th key={`${block}${m}`} className={`p-1.5 font-bold ${i === 0 ? "border-l border-clay-100" : ""}`}>
                      {m}
                    </th>
                  ))
                )}
              </tr>
            </thead>
            <tbody>
              {stream.days.map((d) => (
                <tr key={d.day} className="border-t border-clay-50">
                  <td className="whitespace-nowrap p-2 text-left font-semibold text-stone-800">{fmtDay(d.day)}</td>
                  {FINANCE_RAW_MATERIALS.map((m, i) => (
                    <td key={m} className={`p-1.5 tabular-nums ${i === 0 ? "border-l border-clay-50" : ""}`}>
                      {moved(d.used[m])}
                    </td>
                  ))}
                  {FINANCE_RAW_MATERIALS.map((m, i) => (
                    <td key={m} className={`p-1.5 tabular-nums ${i === 0 ? "border-l border-clay-50" : ""}`}>
                      {moved(d.received[m])}
                    </td>
                  ))}
                  {FINANCE_RAW_MATERIALS.map((m, i) => (
                    <td
                      key={m}
                      className={`p-1.5 font-semibold tabular-nums ${i === 0 ? "border-l border-clay-50" : ""} ${
                        d.remaining[m] < 0 ? "text-red-700" : "text-stone-800"
                      }`}
                    >
                      {t(d.remaining[m])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export default function RawMaterialDailyPanel() {
  const [month, setMonth] = useState("");
  const [months, setMonths] = useState<string[]>([]);
  const [ledger, setLedger] = useState<Ledger | null | undefined>(undefined);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setLedger(undefined);
    fetch(`/api/raw-material-daily${month ? `?month=${month}` : ""}`)
      .then((r) => r.json().catch(() => null))
      .then((d) => {
        if (!alive) return;
        setMonths(d?.months ?? []);
        setLedger(d?.ledger ?? null);
        setError(d?.error ?? "");
      })
      .catch(() => {
        if (alive) setLedger(null);
      });
    return () => {
      alive = false;
    };
  }, [month]);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div>
          <h2 className="font-display text-lg font-bold">🧱 Raw material</h2>
          <p className="text-[11px] text-stone-400">tonnes · used = produced tons + 5% wastage</p>
        </div>
        {months.length > 0 && (
          <select
            aria-label="Month"
            value={month || ledger?.month || months[0]}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-lg border border-clay-100 bg-white px-2 py-1 text-xs font-bold"
          >
            {months.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        )}
      </div>

      {ledger === undefined && <div className="card h-64 animate-pulse bg-clay-50" />}
      {ledger === null && (
        <p className="card p-3 text-xs text-amber-700">{error || "Raw material could not be loaded. Please try again."}</p>
      )}
      {ledger && (
        <>
          <StreamTables stream={ledger.normal} />
          {ledger.grade1 && (
            <>
              <h3 className="px-1 pt-2 text-xs font-bold uppercase tracking-widest text-stone-400">⭐ Grade 1</h3>
              <StreamTables stream={ledger.grade1} />
            </>
          )}
        </>
      )}
    </section>
  );
}
