"use client";

import { useEffect, useMemo, useState } from "react";
import { BAG_KINDS, bagLabel, bagLedgerKey } from "@/lib/products";

/**
 * PP bags consumed, as reported daily from the bot.
 *
 * Sits beside the goods-issue voucher rather than replacing it, and the two are
 * deliberately NOT added together: the store issue voucher already records bags
 * leaving the store, so counting both would subtract the same bags twice and
 * turn every month into a phantom shortfall. This is production's own record of
 * what it actually used, and the value is in reading the two side by side.
 */

interface Item {
  ledgerKey: string;
  referenceNo: string | null;
  quantity: number;
}

interface Row {
  _id: string;
  date: string;
  dateLabel: string;
  reportedBy: string;
  items: Item[];
}

const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const num = (n: number) => (n ? Math.round(n).toLocaleString() : "");

/** The six kinds as columns, in the same order as every other bag table. */
const COLUMNS = BAG_KINDS.map(({ size, colour }) => ({
  key: bagLedgerKey(size, colour),
  label: bagLabel(size, colour),
}));

export default function PpBagUsagePanel() {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    fetch("/api/pp-bag-usage")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .catch(() => setRows([]));
  }, []);

  /** One day, one row: the six kinds across, plus whatever refs were quoted. */
  const table = useMemo(() => {
    if (!rows) return null;
    return rows.map((r) => {
      const byKind: Record<string, number> = {};
      const refs: string[] = [];
      for (const it of r.items) {
        byKind[it.ledgerKey] = (byKind[it.ledgerKey] || 0) + it.quantity;
        // Several lines can share a reference number, and the same one twice on
        // a row reads as two documents when it is one.
        if (it.referenceNo && !refs.includes(it.referenceNo)) refs.push(it.referenceNo);
      }
      return {
        ...r,
        byKind,
        refs,
        total: r.items.reduce((a, it) => a + it.quantity, 0),
      };
    });
  }, [rows]);

  if (!table) return <div className="card h-40 animate-pulse bg-clay-50" />;

  const columnTotal = (key: string) => table.reduce((a, r) => a + (r.byKind[key] || 0), 0);
  const grandTotal = table.reduce((a, r) => a + r.total, 0);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
        <h2 className="font-display text-lg font-bold">🧺 PP bags used</h2>
        <p className="text-[11px] text-stone-400">Reported daily by production</p>
      </div>

      {table.length === 0 ? (
        <p className="card p-4 text-sm text-stone-400">No bag consumption reported yet.</p>
      ) : (
        <>
          <div className="card max-h-[26rem] overflow-auto p-0">
            <table className="w-full min-w-[680px] text-right text-xs">
              <thead className="sticky top-0 z-10 bg-clay-50 text-[10px] uppercase tracking-wide text-stone-500 shadow-[0_1px_0_#f3e3dd]">
                <tr>
                  <th className="p-2 text-left font-bold">Date</th>
                  {COLUMNS.map((c) => (
                    <th key={c.key} className="p-2 font-bold">
                      {c.label}
                    </th>
                  ))}
                  <th className="p-2 font-bold">Total</th>
                  <th className="p-2 text-left font-bold">Ref</th>
                </tr>
              </thead>
              <tbody>
                {table.map((r) => (
                  <tr key={r._id} className="border-t border-clay-50">
                    <td className="p-2 text-left font-semibold text-stone-800">{fmtDate(r.date)}</td>
                    {COLUMNS.map((c) => (
                      <td key={c.key} className="p-2 tabular-nums text-stone-700">
                        {r.byKind[c.key] ? (
                          num(r.byKind[c.key])
                        ) : (
                          // A kind not used that day is blank, not 0 — nothing
                          // was reported about it either way.
                          <span className="text-stone-300">—</span>
                        )}
                      </td>
                    ))}
                    <td className="p-2 font-bold tabular-nums text-clay-900">{num(r.total)}</td>
                    <td className="p-2 text-left text-[10px] text-stone-500">{r.refs.join(", ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-clay-200 bg-clay-50/40 font-bold">
                  <td className="p-2 text-left">Total · {table.length} day(s)</td>
                  {COLUMNS.map((c) => (
                    <td key={c.key} className="p-2 tabular-nums">
                      {num(columnTotal(c.key))}
                    </td>
                  ))}
                  <td className="p-2 tabular-nums text-clay-900">{num(grandTotal)}</td>
                  <td className="p-2" />
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="px-1 text-[10px] text-stone-400">
            Production&apos;s own count of what it consumed. It is not subtracted from stock — the store
            issue voucher above already does that, and counting both would remove the same bags twice.
          </p>
        </>
      )}
    </section>
  );
}
