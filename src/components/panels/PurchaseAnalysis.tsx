"use client";

import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import RangeSelector from "@/components/RangeSelector";
import { AXIS, Chart, ScrollTable, TOOLTIP } from "@/components/panels/TableChart";
import { RANGES, rangeWindow, type Bucket, type RangeKey } from "@/lib/ranges";

/**
 * The purchase analysis report: what the Goods Receiving Vouchers say was bought.
 *
 * Nothing here is typed by finance a second time — every figure is a GRV line
 * already filed. Who supplied what, when, and at what price; spend by supplier
 * and over time; and each item's price every time it was bought, so a price
 * change is visible at a glance.
 *
 * ETB throughout. A USD voucher is converted with its month's dollar rate from
 * the price list; one whose month has no rate is left out of the ETB figures
 * and counted apart, never guessed.
 */

interface GrvLine {
  grvId: string;
  grvNo: string | null;
  date: string;
  month: string;
  supplier: string;
  currency: "ETB" | "USD";
  item: string;
  itemKey: string;
  unit: string | null;
  qty: number | null;
  unitPrice: number | null;
  total: number | null;
  usdRate: number | null;
  etb: number | null;
}

const BAR = "#c64d30"; // clay-600, the app's one series colour

const fmt = (n: number | null | undefined, dp = 2) =>
  n === null || n === undefined || !Number.isFinite(n)
    ? "—"
    : n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: dp });
const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" });
const compact = (n: number) =>
  n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : n >= 1_000 ? `${Math.round(n / 100) / 10}k` : String(Math.round(n));

/** Bucket key for a date, as the production panel buckets it. */
function bucketKey(iso: string, bucket: Bucket): string {
  const d = new Date(new Date(iso).getTime() + 3 * 3_600_000);
  if (bucket === "month") return d.toISOString().slice(0, 7);
  if (bucket === "week") {
    const day = (d.getUTCDay() + 6) % 7;
    return new Date(d.getTime() - day * 86400000).toISOString().slice(0, 10);
  }
  return d.toISOString().slice(0, 10);
}
const bucketLabel = (key: string, bucket: Bucket) =>
  bucket === "month"
    ? new Date(`${key}-01`).toLocaleDateString("en-GB", { month: "short", year: "2-digit" })
    : new Date(key).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

function Tile({ label, value, suffix, note }: { label: string; value: string; suffix?: string; note?: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400">{label}</p>
      <p className="mt-1 font-display text-xl font-bold tabular-nums text-stone-800">
        {value}
        {suffix && <span className="ml-1 text-[10px] font-semibold text-stone-400">{suffix}</span>}
      </p>
      {note && <p className="mt-0.5 text-[10px] text-stone-400">{note}</p>}
    </div>
  );
}

export default function PurchaseAnalysis() {
  const [lines, setLines] = useState<GrvLine[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [range, setRange] = useState<RangeKey>("d90");
  const [supplier, setSupplier] = useState("");
  const [search, setSearch] = useState("");
  const [openItem, setOpenItem] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/finance/grv-analysis")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setLines(Array.isArray(d?.rows) ? d.rows : []);
        setUnavailable(!!d?.unavailable);
      })
      .catch(() => setLines([]));
  }, []);

  const { bucket } = RANGES[range];
  const win = useMemo(() => rangeWindow(range), [range]);

  const inWindow = useMemo(() => {
    const from = win.start.getTime();
    const to = win.end.getTime();
    return (lines ?? []).filter((l) => {
      const t = new Date(l.date).getTime();
      return t >= from && t < to;
    });
  }, [lines, win]);

  const suppliers = useMemo(
    () => Array.from(new Set(inWindow.map((l) => l.supplier))).sort((a, b) => a.localeCompare(b)),
    [inWindow]
  );

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return inWindow.filter(
      (l) => (!supplier || l.supplier === supplier) && (!q || l.item.toLowerCase().includes(q) || l.supplier.toLowerCase().includes(q))
    );
  }, [inWindow, supplier, search]);

  const totals = useMemo(() => {
    const spent = shown.reduce((a, l) => a + (l.etb ?? 0), 0);
    const unconverted = shown.filter((l) => l.currency === "USD" && l.etb === null);
    return {
      spent,
      vouchers: new Set(shown.map((l) => l.grvId)).size,
      suppliers: new Set(shown.map((l) => l.supplier)).size,
      items: new Set(shown.map((l) => l.itemKey)).size,
      usdLeftOut: unconverted.reduce((a, l) => a + (l.total ?? 0), 0),
    };
  }, [shown]);

  /* Spend by supplier: the ten biggest, the rest folded into "Other". */
  const bySupplier = useMemo(() => {
    const m = new Map<string, { spend: number; vouchers: Set<string> }>();
    for (const l of shown) {
      const s = m.get(l.supplier) ?? { spend: 0, vouchers: new Set<string>() };
      s.spend += l.etb ?? 0;
      s.vouchers.add(l.grvId);
      m.set(l.supplier, s);
    }
    const all = [...m.entries()]
      .map(([name, s]) => ({ name, spend: Math.round(s.spend), vouchers: s.vouchers.size }))
      .sort((a, b) => b.spend - a.spend);
    if (all.length <= 10) return all;
    const rest = all.slice(9);
    return [
      ...all.slice(0, 9),
      { name: `Other (${rest.length})`, spend: rest.reduce((a, r) => a + r.spend, 0), vouchers: rest.reduce((a, r) => a + r.vouchers, 0) },
    ];
  }, [shown]);

  /* Spend over time, bucketed like every other report on the dashboard. */
  const overTime = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of shown) {
      const k = bucketKey(l.date, bucket);
      m.set(k, (m.get(k) || 0) + (l.etb ?? 0));
    }
    return [...m.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => ({ label: bucketLabel(k, bucket), spend: Math.round(v) }));
  }, [shown, bucket]);

  /* Items: what was bought most, and its price each time. */
  const items = useMemo(() => {
    const m = new Map<string, { item: string; unit: string | null; lines: GrvLine[] }>();
    for (const l of shown) {
      if (l.item === "(voucher with no lines)") continue;
      const it = m.get(l.itemKey) ?? { item: l.item, unit: l.unit, lines: [] };
      it.lines.push(l);
      m.set(l.itemKey, it);
    }
    return [...m.entries()]
      .map(([key, it]) => {
        const byDate = [...it.lines].sort((a, b) => +new Date(a.date) - +new Date(b.date));
        const prices = byDate.map((l) => priceEtb(l)).filter((p): p is number => p !== null);
        const last = byDate[byDate.length - 1];
        return {
          key,
          item: it.item,
          unit: it.unit,
          times: it.lines.length,
          qty: it.lines.reduce((a, l) => a + (l.qty ?? 0), 0),
          spend: it.lines.reduce((a, l) => a + (l.etb ?? 0), 0),
          lastPrice: last ? priceEtb(last) : null,
          minPrice: prices.length ? Math.min(...prices) : null,
          maxPrice: prices.length ? Math.max(...prices) : null,
          lastSupplier: last?.supplier ?? "—",
          history: byDate,
        };
      })
      .sort((a, b) => b.spend - a.spend);
  }, [shown]);

  if (lines === null) return <div className="card h-40 animate-pulse bg-clay-50" />;

  const open = items.find((i) => i.key === openItem) ?? null;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
        <h2 className="font-display text-lg font-bold">📊 Purchase analysis</h2>
        <p className="text-[11px] text-stone-400">from the Goods Receiving Vouchers · 📥 የዕቃ ገቢ ቫውቸር</p>
      </div>

      {unavailable && (
        <p className="card border-l-4 border-l-amber-500 p-3 text-xs font-bold text-amber-800">
          The voucher tables are not in the database yet — apply migration 0019.
        </p>
      )}

      {/* Filters, in one row above everything they filter. */}
      <div className="space-y-2">
        <RangeSelector value={range} onChange={setRange} />
        <div className="flex flex-wrap gap-2">
          <select
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
            className="rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-xs"
          >
            <option value="">All suppliers</option>
            {suppliers.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search item or supplier…"
            className="min-w-[180px] flex-1 rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-xs"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile
          label="Spent"
          value={fmt(totals.spent, 0)}
          suffix="ETB"
          note={totals.usdLeftOut > 0 ? `+ ${fmt(totals.usdLeftOut)} USD with no rate` : undefined}
        />
        <Tile label="Vouchers" value={String(totals.vouchers)} />
        <Tile label="Suppliers" value={String(totals.suppliers)} />
        <Tile label="Items" value={String(totals.items)} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-1">
          <p className="px-1 text-[11px] font-bold uppercase tracking-widest text-clay-500">Spend by supplier (ETB)</p>
          <Chart empty={bySupplier.length === 0} emptyLabel="No vouchers in this period.">
            <BarChart data={bySupplier} layout="vertical" margin={{ left: 8, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3e3dd" horizontal={false} />
              <XAxis type="number" {...AXIS} tickFormatter={compact} />
              <YAxis type="category" dataKey="name" {...AXIS} width={110} interval={0} />
              <Tooltip
                contentStyle={TOOLTIP}
                cursor={{ fill: "#fdf5f3" }}
                formatter={(v: number, _n, p) => [`${fmt(v, 0)} ETB · ${p?.payload?.vouchers ?? 0} voucher(s)`, "Spent"]}
              />
              <Bar dataKey="spend" fill={BAR} radius={[0, 4, 4, 0]} maxBarSize={18} />
            </BarChart>
          </Chart>
        </div>
        <div className="space-y-1">
          <p className="px-1 text-[11px] font-bold uppercase tracking-widest text-clay-500">
            Spend over time (ETB, per {bucket})
          </p>
          <Chart empty={overTime.length === 0} emptyLabel="No vouchers in this period.">
            <BarChart data={overTime}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3e3dd" vertical={false} />
              <XAxis dataKey="label" {...AXIS} minTickGap={16} />
              <YAxis {...AXIS} width={44} tickFormatter={compact} />
              <Tooltip
                contentStyle={TOOLTIP}
                cursor={{ fill: "#fdf5f3" }}
                formatter={(v: number) => [`${fmt(v, 0)} ETB`, "Spent"]}
              />
              <Bar dataKey="spend" fill={BAR} radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart>
          </Chart>
        </div>
      </div>

      {/* Items, biggest spend first. Tap one for its price every time it was bought. */}
      <p className="px-1 pt-1 text-[11px] font-bold uppercase tracking-widest text-clay-500">
        Items bought · tap one for its price history
      </p>
      <ScrollTable minWidth={760} empty={items.length === 0} emptyLabel="No items in this period.">
        <thead className="sticky top-0 z-10 bg-clay-50 text-[10px] uppercase tracking-wide text-stone-500">
          <tr>
            <th className="p-2 text-left font-bold">Item</th>
            <th className="p-2 font-bold">Times</th>
            <th className="p-2 font-bold">Qty</th>
            <th className="p-2 font-bold">Spent (ETB)</th>
            <th className="p-2 font-bold">Last price</th>
            <th className="p-2 font-bold">Lowest – highest</th>
            <th className="p-2 text-left font-bold">Last supplier</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr
              key={it.key}
              onClick={() => setOpenItem(openItem === it.key ? null : it.key)}
              className={`cursor-pointer border-t border-clay-50 hover:bg-clay-50/60 ${openItem === it.key ? "bg-clay-50" : ""}`}
            >
              <td className="max-w-[240px] truncate p-2 text-left font-semibold text-stone-800">{it.item}</td>
              <td className="p-2 tabular-nums text-stone-700">{it.times}</td>
              <td className="p-2 tabular-nums text-stone-700">
                {fmt(it.qty, 3)} <span className="text-[10px] text-stone-400">{it.unit || ""}</span>
              </td>
              <td className="p-2 font-bold tabular-nums text-clay-900">{fmt(it.spend, 0)}</td>
              <td className="p-2 tabular-nums text-stone-800">{fmt(it.lastPrice)}</td>
              <td className="p-2 tabular-nums text-stone-500">
                {it.minPrice === null ? "—" : it.minPrice === it.maxPrice ? fmt(it.minPrice) : `${fmt(it.minPrice)} – ${fmt(it.maxPrice)}`}
              </td>
              <td className="max-w-[160px] truncate p-2 text-left text-stone-600">{it.lastSupplier}</td>
            </tr>
          ))}
        </tbody>
      </ScrollTable>

      {open && <PriceHistory item={open.item} unit={open.unit} history={open.history} onClose={() => setOpenItem(null)} />}

      {/* Every line, as filed. */}
      <p className="px-1 pt-1 text-[11px] font-bold uppercase tracking-widest text-clay-500">
        Every received line ({shown.length})
      </p>
      <ScrollTable minWidth={900} empty={shown.length === 0} emptyLabel="No vouchers in this period.">
        <thead className="sticky top-0 z-10 bg-clay-50 text-[10px] uppercase tracking-wide text-stone-500">
          <tr>
            <th className="p-2 text-left font-bold">Date</th>
            <th className="p-2 text-left font-bold">GRV No</th>
            <th className="p-2 text-left font-bold">Supplier</th>
            <th className="p-2 text-left font-bold">Item</th>
            <th className="p-2 font-bold">Qty</th>
            <th className="p-2 font-bold">Unit price</th>
            <th className="p-2 font-bold">Total</th>
            <th className="p-2 font-bold">ETB</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((l, i) => (
            <tr key={`${l.grvId}-${i}`} className="border-t border-clay-50">
              <td className="p-2 text-left font-semibold text-stone-800">{fmtDate(l.date)}</td>
              <td className="p-2 text-left text-stone-500">{l.grvNo || "—"}</td>
              <td className="max-w-[160px] truncate p-2 text-left text-stone-700">{l.supplier}</td>
              <td className="max-w-[240px] truncate p-2 text-left text-stone-800">{l.item}</td>
              <td className="p-2 tabular-nums text-stone-700">
                {fmt(l.qty, 3)} <span className="text-[10px] text-stone-400">{l.unit || ""}</span>
              </td>
              <td className="p-2 tabular-nums text-stone-700">
                {fmt(l.unitPrice)}
                {l.currency === "USD" && <span className="ml-1 text-[10px] text-stone-400">USD</span>}
              </td>
              <td className="p-2 tabular-nums text-stone-700">
                {fmt(l.total)}
                {l.currency === "USD" && <span className="ml-1 text-[10px] text-stone-400">USD</span>}
              </td>
              <td className="p-2 font-semibold tabular-nums text-clay-900">
                {l.etb === null ? <span className="text-[10px] font-normal text-amber-700">no rate</span> : fmt(l.etb, 0)}
              </td>
            </tr>
          ))}
        </tbody>
      </ScrollTable>
    </section>
  );
}

/** A line's unit price in birr: converted for USD, null when it cannot be. */
function priceEtb(l: GrvLine): number | null {
  if (l.unitPrice === null) return null;
  if (l.currency !== "USD") return l.unitPrice;
  return l.usdRate ? Math.round(l.unitPrice * l.usdRate * 100) / 100 : null;
}

/** One item: its unit price each time it was bought, who supplied it, and the change. */
function PriceHistory({
  item,
  unit,
  history,
  onClose,
}: {
  item: string;
  unit: string | null;
  history: GrvLine[];
  onClose: () => void;
}) {
  const points = history
    .map((l) => ({ label: fmtDate(l.date), price: priceEtb(l), supplier: l.supplier }))
    .filter((p) => p.price !== null);

  return (
    <section className="card space-y-2 border-l-4 border-l-clay-500 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-display text-sm font-bold">💲 {item}</h3>
          <p className="text-[11px] text-stone-500">Unit price in ETB{unit ? ` per ${unit}` : ""}, each time it was bought</p>
        </div>
        <button onClick={onClose} className="text-xs font-bold text-stone-400 hover:text-stone-700">
          ✕
        </button>
      </div>

      {points.length >= 2 && (
        <div className="-ml-2 h-40">
          <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3e3dd" vertical={false} />
            <XAxis dataKey="label" {...AXIS} minTickGap={16} />
            <YAxis {...AXIS} width={48} tickFormatter={compact} domain={["auto", "auto"]} />
            <Tooltip
              contentStyle={TOOLTIP}
              cursor={{ stroke: "#d6c3bd", strokeWidth: 1 }}
              formatter={(v: number, _n, p) => [`${fmt(v)} ETB · ${p?.payload?.supplier ?? ""}`, "Unit price"]}
            />
            <Line type="monotone" dataKey="price" stroke={BAR} strokeWidth={2} dot={{ r: 4, fill: BAR, stroke: "#fff", strokeWidth: 2 }} />
          </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="-mx-1 overflow-x-auto">
        <table className="w-full min-w-[520px] text-right text-xs">
          <thead className="text-[10px] uppercase tracking-wide text-stone-500">
            <tr>
              <th className="p-1.5 text-left font-bold">Date</th>
              <th className="p-1.5 text-left font-bold">Supplier</th>
              <th className="p-1.5 text-left font-bold">GRV No</th>
              <th className="p-1.5 font-bold">Qty</th>
              <th className="p-1.5 font-bold">Unit price (ETB)</th>
              <th className="p-1.5 font-bold">Change</th>
            </tr>
          </thead>
          <tbody>
            {[...history].reverse().map((l, i, arr) => {
              const p = priceEtb(l);
              const prev = arr[i + 1] ? priceEtb(arr[i + 1]) : null;
              const change = p !== null && prev !== null && prev > 0 ? ((p - prev) / prev) * 100 : null;
              return (
                <tr key={`${l.grvId}-${i}`} className="border-t border-clay-50">
                  <td className="p-1.5 text-left font-semibold text-stone-800">{fmtDate(l.date)}</td>
                  <td className="p-1.5 text-left text-stone-700">{l.supplier}</td>
                  <td className="p-1.5 text-left text-stone-500">{l.grvNo || "—"}</td>
                  <td className="p-1.5 tabular-nums text-stone-700">{fmt(l.qty, 3)}</td>
                  <td className="p-1.5 font-semibold tabular-nums text-stone-800">{fmt(p)}</td>
                  <td
                    className={`p-1.5 tabular-nums ${
                      change === null || Math.abs(change) < 0.5 ? "text-stone-400" : change > 0 ? "text-red-700" : "text-green-700"
                    }`}
                  >
                    {change === null ? "—" : `${change > 0 ? "▲" : change < 0 ? "▼" : ""} ${Math.abs(Math.round(change * 10) / 10)}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
