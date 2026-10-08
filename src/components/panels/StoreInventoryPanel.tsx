"use client";

import { useEffect, useMemo, useState } from "react";
import { STORE_BLOCKS, STORE_GROUPS, type StoreItem } from "@/lib/store-items";

/**
 * The spare-parts store: what each shelf should hold, what it is worth, and
 * when it was last counted.
 *
 * "Balance" is the last count moved on by the vouchers filed since (GRV in,
 * SIV out); "Counted" is the figure the storekeeper actually wrote down. The
 * two agree right after a count and drift apart only by what moved without a
 * voucher — which is the number worth looking at.
 *
 * Grouped and collapsed by default, because nobody reads 132 rows — the common
 * task is finding one part ("6210"), which is what the search box is for, and
 * the second is seeing which shelves are overdue, which is what the header
 * markers are for.
 *
 * A zero is printed as 0, never blank. On an inventory it is the most important
 * figure on the page, and a blank cell reads as "not counted" — which is a
 * different fact, shown here as a dash.
 */

interface ItemStatus {
  item: StoreItem;
  qty: number | null;
  received: number;
  issued: number;
  balance: number;
  unitCost: number | null;
  value: number | null;
  previous: number | null;
  countedAt: string | null;
  countedBy: string | null;
  unchangedFor: number;
}

interface GroupStatus {
  group: string;
  label: string;
  block: string;
  countedAt: string | null;
  daysSince: number | null;
  stale: boolean;
}

const etb = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** How many identical counts in a row before the figure is worth doubting. */
const STILL_AFTER = 4;

const ago = (days: number | null) =>
  days === null ? "never counted" : days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;

export default function StoreInventoryPanel() {
  const [items, setItems] = useState<ItemStatus[] | null>(null);
  const [groups, setGroups] = useState<GroupStatus[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [q, setQ] = useState("");

  useEffect(() => {
    fetch("/api/store-inventory")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setItems(Array.isArray(d?.items) ? d.items : []);
        setGroups(Array.isArray(d?.groups) ? d.groups : []);
      })
      .catch(() => setItems([]));
  }, []);

  const groupByKey = useMemo(() => new Map(groups.map((g) => [g.group, g])), [groups]);

  /** Search runs across every group and opens the ones that match. */
  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle || !items) return null;
    return items.filter(
      (s) => s.item.name.toLowerCase().includes(needle) || s.item.key.toLowerCase().includes(needle)
    );
  }, [items, q]);

  if (!items) return <div className="card h-40 animate-pulse bg-clay-50" />;

  const staleGroups = groups.filter((g) => g.stale);
  const byGroup = (group: string) => items.filter((s) => s.item.group === group);
  const valueOf = (rows: ItemStatus[]) => rows.reduce((a, s) => a + (s.value ?? 0), 0);
  const totalValue = valueOf(items);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
        <h2 className="font-display text-lg font-bold">🧰 Store inventory</h2>
        <p className="text-[11px] text-stone-400">
          {items.length} items · counted per group
          {totalValue > 0 && <> · worth <b className="text-stone-600">{etb(totalValue)} ETB</b></>}
        </p>
      </div>

      {staleGroups.length > 0 && (
        <p className="card border-l-4 border-l-amber-500 p-3 text-xs font-bold text-amber-800">
          ⏳ {staleGroups.length} group{staleGroups.length === 1 ? "" : "s"} not counted in the last week:{" "}
          <span className="font-normal">{staleGroups.map((g) => g.label).join(", ")}</span>
        </p>
      )}

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Find a part — 6210, A52, Electrod…"
        className="w-full rounded-xl border border-clay-100 bg-white px-3 py-2 text-sm outline-none focus:border-clay-300"
      />

      {matches ? (
        <div className="card overflow-x-auto p-0">
          {matches.length === 0 ? (
            <p className="p-4 text-sm text-stone-400">Nothing matches “{q}”.</p>
          ) : (
            <ItemTable rows={matches} showGroup />
          )}
        </div>
      ) : (
        STORE_BLOCKS.map((block) => (
          <div key={block.key} className="space-y-2">
            <h3 className="flex justify-between px-1 text-xs font-bold uppercase tracking-widest text-stone-400">
              <span>
                {block.icon} {block.label}
              </span>
              {(() => {
                const v = valueOf(items.filter((s) => STORE_GROUPS.find((g) => g.key === s.item.group)?.block === block.key));
                return v > 0 ? <span className="normal-case tracking-normal">{etb(v)} ETB</span> : null;
              })()}
            </h3>
            {STORE_GROUPS.filter((g) => g.block === block.key).map((g) => {
              const status = groupByKey.get(g.key);
              const rows = byGroup(g.key);
              const isOpen = open[g.key] ?? false;
              return (
                <div key={g.key} className="card overflow-hidden p-0">
                  <button
                    onClick={() => setOpen((o) => ({ ...o, [g.key]: !isOpen }))}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
                  >
                    <span className="flex items-baseline gap-2">
                      <span className="text-sm font-bold text-stone-800">{g.label}</span>
                      <span className="text-[10px] text-stone-400">{rows.length} items</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          status?.stale ? "bg-amber-100 text-amber-800" : "bg-clay-50 text-stone-500"
                        }`}
                      >
                        {ago(status?.daysSince ?? null)}
                      </span>
                      <span className="text-xs text-stone-400">{isOpen ? "▾" : "▸"}</span>
                    </span>
                  </button>
                  {isOpen && (
                    <div className="overflow-x-auto border-t border-clay-50">
                      <ItemTable rows={rows} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))
      )}
    </section>
  );
}

function ItemTable({ rows, showGroup = false }: { rows: ItemStatus[]; showGroup?: boolean }) {
  const label = (group: string) => STORE_GROUPS.find((g) => g.key === group)?.label ?? group;

  return (
    <table className="w-full min-w-[720px] text-right text-xs">
      <thead className="bg-clay-50/70 text-[10px] uppercase tracking-wide text-stone-500">
        <tr>
          <th className="p-2 text-left font-bold">Item</th>
          {showGroup && <th className="p-2 text-left font-bold">Group</th>}
          <th className="p-2 font-bold" title="Last count + received − issued since">Balance</th>
          <th className="p-2 font-bold">Unit</th>
          <th className="p-2 font-bold" title="The figure on the last count">Counted</th>
          <th className="p-2 font-bold" title="Received on GRVs since the last count">In</th>
          <th className="p-2 font-bold" title="Issued on SIVs since the last count">Out</th>
          <th className="p-2 font-bold">Value</th>
          <th className="p-2 font-bold">Change</th>
          <th className="p-2 text-left font-bold">Last counted</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s) => {
          const change = s.qty !== null && s.previous !== null ? s.qty - s.previous : null;
          return (
            <tr key={s.item.key} className="border-t border-clay-50">
              <td className="p-2 text-left font-semibold text-stone-800">{s.item.name}</td>
              {showGroup && <td className="p-2 text-left text-stone-500">{label(s.item.group)}</td>}
              <td className={`p-2 font-bold tabular-nums ${s.balance <= 0 && (s.qty !== null || s.received || s.issued) ? "text-red-700" : "text-stone-800"}`}>
                {s.qty === null && !s.received && !s.issued ? (
                  <span className="font-normal text-stone-300">—</span>
                ) : (
                  <>
                    {s.balance.toLocaleString()}
                    {s.qty === null && (
                      <span title="Never counted: this is only what the vouchers moved" className="ml-1 text-[9px] font-normal text-amber-600">
                        not counted
                      </span>
                    )}
                  </>
                )}
              </td>
              <td className="p-2 text-[10px] text-stone-400">{s.item.unit}</td>
              <td className="p-2 tabular-nums text-stone-500">
                {s.qty === null ? <span className="text-stone-300">—</span> : s.qty.toLocaleString()}
              </td>
              <td className={`p-2 tabular-nums ${s.received ? "text-green-700" : "text-stone-300"}`}>
                {s.received ? `+${s.received.toLocaleString()}` : "—"}
              </td>
              <td className={`p-2 tabular-nums ${s.issued ? "text-amber-700" : "text-stone-300"}`}>
                {s.issued ? `−${s.issued.toLocaleString()}` : "—"}
              </td>
              <td className="p-2 tabular-nums text-stone-600" title={s.unitCost ? `${etb(s.unitCost)} ETB each` : "No cost yet"}>
                {s.value !== null ? etb(s.value) : <span className="text-stone-300">—</span>}
              </td>
              <td
                className={`p-2 tabular-nums ${
                  change === null || change === 0 ? "text-stone-300" : change > 0 ? "text-green-700" : "text-amber-700"
                }`}
              >
                {change === null ? "—" : change === 0 ? "0" : `${change > 0 ? "+" : ""}${change.toLocaleString()}`}
              </td>
              <td className="p-2 text-left text-stone-500">
                {s.countedAt ? fmtDate(s.countedAt) : <span className="text-stone-300">never</span>}
                {/* The cost of a pre-filled count sheet, made visible: a figure
                    that comes back identical week after week is either a part
                    nobody uses or a line nobody recounts. */}
                {s.unchangedFor >= STILL_AFTER && (
                  <span
                    title={`Unchanged across the last ${s.unchangedFor} counts`}
                    className="ml-1 text-[10px] text-stone-400"
                  >
                    · same ×{s.unchangedFor}
                  </span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
