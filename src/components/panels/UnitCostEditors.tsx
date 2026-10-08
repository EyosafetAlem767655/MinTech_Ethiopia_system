"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { STORE_BLOCKS, STORE_GROUPS, STORE_ITEMS } from "@/lib/store-items";

/**
 * Unit costs, editable from Finance → Monthly — for the month the bot user
 * could not file them, or filed one wrong.
 *
 *   - PriceListEditor: the monthly price list the 💲 bot flow files (products,
 *     raw materials, PP bags, dollar rate). Saving merges into the month's row,
 *     so correcting one price never wipes the rest.
 *   - StoreCostEditor: a cost per warehouse item, plus what the vouchers moved
 *     that month and its value. A GRV records the price it paid on its own; a
 *     figure entered here applies from the 1st of the selected month.
 *
 * Only changed fields are sent, so leaving a field alone never restates it.
 */

const etb = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const qty = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 3 });

const inputCls =
  "w-28 rounded-lg border border-clay-100 bg-white px-2 py-1 text-right text-xs tabular-nums outline-none focus:border-clay-300";

function SaveBar({
  dirty,
  saving,
  message,
  onSave,
  onReset,
}: {
  dirty: number;
  saving: boolean;
  message: string;
  onSave: () => void;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 border-t border-clay-50 p-3">
      {message && <span className="mr-auto text-[11px] font-bold text-stone-500">{message}</span>}
      {dirty > 0 && (
        <button onClick={onReset} disabled={saving} className="rounded-full px-3 py-1.5 text-xs font-bold text-stone-500">
          Undo
        </button>
      )}
      <button
        onClick={onSave}
        disabled={dirty === 0 || saving}
        className="rounded-full bg-clay-700 px-4 py-1.5 text-xs font-bold text-white disabled:opacity-40"
      >
        {saving ? "Saving…" : dirty > 0 ? `Save ${dirty} change${dirty === 1 ? "" : "s"}` : "No changes"}
      </button>
    </div>
  );
}

/* ───────────────────────────── The monthly price list ─────────────────────── */

interface PriceListData {
  items: { key: string; label: string; unit: string }[];
  prices: Record<string, number>;
  usdRate: number | null;
  reportedBy: string | null;
  source: string | null;
  updatedAt: string | null;
}

const asText = (n: number | null | undefined) => (n == null ? "" : String(n));

export function PriceListEditor({ month, onSaved }: { month: string; onSaved: () => void }) {
  const [data, setData] = useState<PriceListData | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [usd, setUsd] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/finance/price-list?month=${month}`);
    const json = (await res.json().catch(() => null)) as PriceListData | null;
    if (!json) return;
    setData(json);
    setDraft(Object.fromEntries(json.items.map((i) => [i.key, asText(json.prices[i.key])])));
    setUsd(asText(json.usdRate));
  }, [month]);

  useEffect(() => {
    setData(null);
    setMessage("");
    load();
  }, [load]);

  if (!data) return <div className="card h-32 animate-pulse bg-clay-50" />;

  const changed = data.items.filter((i) => draft[i.key] !== asText(data.prices[i.key]));
  const usdChanged = usd !== asText(data.usdRate);
  const dirty = changed.length + (usdChanged ? 1 : 0);

  const save = async () => {
    setSaving(true);
    setMessage("");
    const prices = Object.fromEntries(
      changed.map((i) => [i.key, draft[i.key].trim() === "" ? null : Number(draft[i.key])])
    );
    const res = await fetch("/api/finance/price-list", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ month, prices, ...(usdChanged ? { usdRate: usd.trim() === "" ? null : Number(usd) } : {}) }),
    });
    const json = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setMessage(`⚠️ ${json.error || "Could not save."}`);
      return;
    }
    setMessage("✅ Saved — the report above now uses these prices.");
    await load();
    onSaved();
  };

  return (
    <div className="card overflow-hidden p-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-3 pt-3">
        <p className="text-sm font-bold text-stone-800">💲 Price list · {month}</p>
        <p className="text-[10px] text-stone-400">
          {data.reportedBy
            ? `Last set by ${data.reportedBy} (${data.source === "app" ? "dashboard" : "bot"})`
            : "Not filed yet for this month"}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-right text-xs">
          <thead className="text-[10px] uppercase tracking-wide text-stone-500">
            <tr>
              <th className="p-2 text-left font-bold">Item</th>
              <th className="p-2 font-bold">Unit price</th>
              <th className="p-2 text-left font-bold">Per</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((i) => (
              <tr key={i.key} className="border-t border-clay-50">
                <td className="p-2 text-left font-semibold text-stone-800">{i.label}</td>
                <td className="p-2">
                  <input
                    inputMode="decimal"
                    value={draft[i.key] ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, [i.key]: e.target.value.replace(/[^0-9.]/g, "") }))}
                    className={`${inputCls} ${draft[i.key] !== asText(data.prices[i.key]) ? "border-amber-400 bg-amber-50" : ""}`}
                    placeholder="—"
                  />
                </td>
                <td className="p-2 text-left text-[10px] text-stone-400">{i.unit}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-clay-100">
              <td className="p-2 text-left font-semibold text-stone-800">💱 1 USD in ETB</td>
              <td className="p-2">
                <input
                  inputMode="decimal"
                  value={usd}
                  onChange={(e) => setUsd(e.target.value.replace(/[^0-9.]/g, ""))}
                  className={`${inputCls} ${usdChanged ? "border-amber-400 bg-amber-50" : ""}`}
                  placeholder="—"
                />
              </td>
              <td className="p-2 text-left text-[10px] text-stone-400">rate</td>
            </tr>
          </tbody>
        </table>
      </div>
      <SaveBar dirty={dirty} saving={saving} message={message} onSave={save} onReset={load} />
    </div>
  );
}

/* ──────────────────────────── Warehouse item costs ────────────────────────── */

interface StoreCostData {
  costs: Record<string, { unitCost: number; effectiveFrom: string; source: string; ref: string | null }>;
  movements: Record<string, { inQty: number; inValue: number; outQty: number; outValue: number }>;
}

export function StoreCostEditor({ month }: { month: string }) {
  const [data, setData] = useState<StoreCostData | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/store/costs?month=${month}`);
    const json = (await res.json().catch(() => null)) as StoreCostData | null;
    setData(json ?? { costs: {}, movements: {} });
    setDraft({});
  }, [month]);

  useEffect(() => {
    setData(null);
    setMessage("");
    load();
  }, [load]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle
      ? STORE_ITEMS.filter((i) => i.name.toLowerCase().includes(needle) || i.key.toLowerCase().includes(needle))
      : STORE_ITEMS;
  }, [q]);

  if (!data) return <div className="card h-32 animate-pulse bg-clay-50" />;

  const changed = Object.entries(draft).filter(([k, v]) => v.trim() !== "" && Number(v) !== data.costs[k]?.unitCost);
  const blockOf = (group: string) => STORE_GROUPS.find((g) => g.key === group)?.block;
  const totals = (keys: string[]) =>
    keys.reduce(
      (a, k) => {
        const m = data.movements[k];
        return m ? { inValue: a.inValue + m.inValue, outValue: a.outValue + m.outValue } : a;
      },
      { inValue: 0, outValue: 0 }
    );
  const all = totals(STORE_ITEMS.map((i) => i.key));
  const priced = STORE_ITEMS.filter((i) => data.costs[i.key]).length;

  const save = async () => {
    setSaving(true);
    setMessage("");
    const res = await fetch("/api/store/costs", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ month, costs: Object.fromEntries(changed.map(([k, v]) => [k, Number(v)])) }),
    });
    const json = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setMessage(`⚠️ ${json.error || "Could not save."}`);
      return;
    }
    setMessage(`✅ ${json.saved} cost${json.saved === 1 ? "" : "s"} saved from ${month}-01.`);
    await load();
  };

  const searching = q.trim() !== "";

  return (
    <div className="card overflow-hidden p-0">
      <div className="space-y-2 px-3 pt-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-bold text-stone-800">🧰 Warehouse item costs · {month}</p>
          <p className="text-[10px] text-stone-400">
            {priced} of {STORE_ITEMS.length} priced · in {etb(all.inValue)} · out {etb(all.outValue)} ETB
          </p>
        </div>
        <p className="text-[11px] text-stone-500">
          A GRV sets an item&rsquo;s cost from the price it paid. A cost entered here applies from the 1st of{" "}
          {month}, and also values issues already made without one.
        </p>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find an item — 6210, A52, Gas oil…"
          className="w-full rounded-xl border border-clay-100 bg-white px-3 py-2 text-sm outline-none focus:border-clay-300"
        />
      </div>

      <div className="space-y-2 p-3">
        {STORE_BLOCKS.map((block) => {
          const items = visible.filter((i) => blockOf(i.group) === block.key);
          if (items.length === 0) return null;
          const t = totals(items.map((i) => i.key));
          const isOpen = searching || (open[block.key] ?? false);
          return (
            <div key={block.key} className="overflow-hidden rounded-xl border border-clay-50">
              <button
                onClick={() => setOpen((o) => ({ ...o, [block.key]: !isOpen }))}
                className="flex w-full items-center justify-between gap-2 bg-clay-50/50 px-3 py-2 text-left"
              >
                <span className="text-xs font-bold text-stone-700">
                  {block.icon} {block.label} <span className="font-normal text-stone-400">· {items.length} items</span>
                </span>
                <span className="text-[10px] text-stone-500">
                  in {etb(t.inValue)} · out {etb(t.outValue)} {isOpen ? "▾" : "▸"}
                </span>
              </button>
              {isOpen && (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-right text-xs">
                    <thead className="text-[10px] uppercase tracking-wide text-stone-500">
                      <tr>
                        <th className="p-2 text-left font-bold">Item</th>
                        <th className="p-2 font-bold">Unit cost</th>
                        <th className="p-2 text-left font-bold">From</th>
                        <th className="p-2 font-bold">In</th>
                        <th className="p-2 font-bold">In value</th>
                        <th className="p-2 font-bold">Out</th>
                        <th className="p-2 font-bold">Out value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((i) => {
                        const c = data.costs[i.key];
                        const m = data.movements[i.key];
                        const v = draft[i.key] ?? (c ? String(c.unitCost) : "");
                        const edited = draft[i.key] !== undefined && draft[i.key] !== (c ? String(c.unitCost) : "");
                        return (
                          <tr key={i.key} className="border-t border-clay-50">
                            <td className="p-2 text-left font-semibold text-stone-800">
                              <span className="mr-1 text-[10px] font-normal text-stone-400">
                                {STORE_GROUPS.find((g) => g.key === i.group)?.label}
                              </span>
                              {i.name}
                              <span className="ml-1 text-[10px] font-normal text-stone-400">{i.unit}</span>
                            </td>
                            <td className="p-2">
                              <input
                                inputMode="decimal"
                                value={v}
                                onChange={(e) =>
                                  setDraft((d) => ({ ...d, [i.key]: e.target.value.replace(/[^0-9.]/g, "") }))
                                }
                                className={`${inputCls} ${edited ? "border-amber-400 bg-amber-50" : ""}`}
                                placeholder="—"
                              />
                            </td>
                            <td className="p-2 text-left text-[10px] text-stone-400">
                              {c ? `${c.source === "grv" ? `GRV ${c.ref ?? ""}`.trim() : "web"} · ${c.effectiveFrom}` : "—"}
                            </td>
                            <td className="p-2 tabular-nums text-stone-600">{m?.inQty ? qty(m.inQty) : "—"}</td>
                            <td className="p-2 tabular-nums text-stone-600">{m?.inValue ? etb(m.inValue) : "—"}</td>
                            <td className="p-2 tabular-nums text-stone-600">{m?.outQty ? qty(m.outQty) : "—"}</td>
                            <td className="p-2 tabular-nums text-stone-600">{m?.outValue ? etb(m.outValue) : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <SaveBar
        dirty={changed.length}
        saving={saving}
        message={message}
        onSave={save}
        onReset={() => setDraft({})}
      />
    </div>
  );
}
