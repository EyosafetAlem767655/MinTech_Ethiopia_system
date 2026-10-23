"use client";

import { useCanEdit } from "@/lib/use-role";

import { useCallback, useEffect, useMemo, useState } from "react";
import { productLabel, orderProducts, DELIVERY_PRODUCTS } from "@/lib/products";

/**
 * The sales sheet: Date · Deliver to · TIN · Invoice cash/credit · Invoice qty ·
 * per-brand tonnage · Bank(s). One row per sale, filed from the bot.
 *
 * A filter bar sits above it (TIN, name, bank, dates, cash/credit, brand), and
 * the last thing on the tab is a collapsed editor for the two fields a person
 * may correct here: the customer's name and TIN. Everything else came off the
 * receipts and is corrected in Settings → Submissions, where it is logged.
 *
 * No receipt image anywhere on this panel, by rule: the receipts are read once
 * by the bot and never stored or referenced. The figures are the record.
 */

interface Row {
  _id: string;
  date: string;
  dateLabel: string;
  customer: string;
  tin: string | null;
  invoiceCash: number;
  invoiceCredit: number;
  qty: number;
  bank: string | null;
  banks: { bank: string; amount: number }[];
  reportedBy: string;
  products: Record<string, number>;
}

interface Filters {
  tin: string;
  name: string;
  bank: string;
  from: string;
  to: string;
  pay: "" | "cash" | "credit";
  brand: string;
  noTin: boolean;
}

const NO_FILTERS: Filters = { tin: "", name: "", bank: "", from: "", to: "", pay: "", brand: "", noTin: false };

const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" });
const num = (n?: number | null) => (n ? (Math.round(n * 100) / 100).toLocaleString() : "");
const short = (v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(2)}M` : v >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v)));

/** "CBE 300k · Awash 200k" for a split sale; the one bank otherwise. */
function bankCell(r: Row): string {
  if (r.banks.length > 1) return r.banks.map((b) => `${b.bank} ${short(b.amount)}`).join(" · ");
  return r.bank || "";
}

const bankNames = (r: Row) => (r.banks.length > 0 ? r.banks.map((b) => b.bank) : r.bank ? r.bank.split(" + ") : []);

function applyFilters(rows: Row[], f: Filters): Row[] {
  const name = f.name.trim().toLowerCase();
  const tin = f.tin.replace(/\D/g, "");
  return rows.filter((r) => {
    const day = r.dateLabel || r.date.slice(0, 10);
    if (f.from && day < f.from) return false;
    if (f.to && day > f.to) return false;
    if (tin && !(r.tin || "").includes(tin)) return false;
    if (f.noTin && r.tin) return false;
    if (name && !r.customer.toLowerCase().includes(name)) return false;
    if (f.bank && !bankNames(r).includes(f.bank)) return false;
    if (f.pay === "cash" && !(r.invoiceCash > 0)) return false;
    if (f.pay === "credit" && !(r.invoiceCredit > 0)) return false;
    if (f.brand && !(Number(r.products?.[f.brand]) > 0)) return false;
    return true;
  });
}

export default function SalesInvoicesPanel() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);

  const load = useCallback(() => {
    fetch("/api/sales-invoices")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .catch(() => setRows([]));
  }, []);
  useEffect(load, [load]);

  const shown = useMemo(() => applyFilters(rows ?? [], filters), [rows, filters]);
  const banks = useMemo(() => [...new Set((rows ?? []).flatMap(bankNames))].sort(), [rows]);

  if (!rows) return <div className="card h-40 animate-pulse bg-clay-50" />;

  // Every sheet column always shows, plus any legacy code an older row carries.
  const cols = orderProducts(
    Array.from(new Set([...DELIVERY_PRODUCTS, ...rows.flatMap((r) => Object.keys(r.products || {}))]))
  );
  const sum = (pick: (r: Row) => number) => shown.reduce((a, r) => a + (pick(r) || 0), 0);
  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));
  const active = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);

  return (
    <section className="space-y-3">
      <h2 className="font-display text-lg font-bold px-1">🧾 Sales report</h2>

      {/* Filters */}
      <div className="card grid grid-cols-2 gap-2 p-3 text-xs sm:grid-cols-4 lg:grid-cols-8">
        <input className="input" placeholder="TIN" inputMode="numeric" value={filters.tin} onChange={(e) => set({ tin: e.target.value })} />
        <input className="input" placeholder="Customer name" value={filters.name} onChange={(e) => set({ name: e.target.value })} />
        <select className="input" value={filters.bank} onChange={(e) => set({ bank: e.target.value })}>
          <option value="">All banks</option>
          {banks.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
        <select className="input" value={filters.pay} onChange={(e) => set({ pay: e.target.value as Filters["pay"] })}>
          <option value="">Cash & credit</option>
          <option value="cash">Cash sales</option>
          <option value="credit">Credit sales</option>
        </select>
        <select className="input" value={filters.brand} onChange={(e) => set({ brand: e.target.value })}>
          <option value="">All brands</option>
          {cols.map((c) => (
            <option key={c} value={c}>{productLabel(c)}</option>
          ))}
        </select>
        <label className="flex flex-col gap-0.5 text-[10px] text-stone-400">
          From
          <input className="input" type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} />
        </label>
        <label className="flex flex-col gap-0.5 text-[10px] text-stone-400">
          To
          <input className="input" type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} />
        </label>
        <div className="flex flex-col justify-end gap-1">
          <label className="flex items-center gap-1.5 text-[11px] text-stone-600">
            <input type="checkbox" checked={filters.noTin} onChange={(e) => set({ noTin: e.target.checked })} />
            No TIN yet
          </label>
          {active && (
            <button className="text-left text-[11px] font-bold text-clay-700" onClick={() => setFilters(NO_FILTERS)}>
              ✕ Clear filters
            </button>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="card p-4 text-sm text-stone-400">No sales filed yet.</p>
      ) : shown.length === 0 ? (
        <p className="card p-4 text-sm text-stone-400">No sales match these filters.</p>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[1200px] text-right text-xs">
            <thead className="bg-clay-50/70 text-[10px] uppercase tracking-wide text-stone-500">
              <tr>
                <th className="p-2 text-left font-bold">Date</th>
                <th className="p-2 text-left font-bold">Deliver to</th>
                <th className="p-2 text-left font-bold">TIN</th>
                <th className="p-2 font-bold">Invoice cash</th>
                <th className="p-2 font-bold">Invoice credit</th>
                <th className="p-2 font-bold">Invoice qty</th>
                {cols.map((c) => (
                  <th key={c} className="p-2 font-bold">{productLabel(c)}</th>
                ))}
                <th className="p-2 text-left font-bold">Bank</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r._id} className="border-t border-clay-50">
                  <td className="p-2 text-left font-semibold text-stone-800">{fmtDate(r.date)}</td>
                  <td className="p-2 text-left text-stone-700">{r.customer}</td>
                  <td className="p-2 text-left tabular-nums text-stone-500">{r.tin || <span className="text-stone-300">—</span>}</td>
                  <td className="p-2 tabular-nums text-stone-700">{num(r.invoiceCash)}</td>
                  <td className="p-2 tabular-nums text-stone-700">{num(r.invoiceCredit)}</td>
                  <td className="p-2 tabular-nums font-semibold text-stone-800">{num(r.qty)}</td>
                  {cols.map((c) => (
                    <td key={c} className="p-2 tabular-nums text-stone-700">{num(r.products?.[c])}</td>
                  ))}
                  <td className="p-2 text-left text-stone-700">{bankCell(r)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-clay-200 bg-clay-50/40 font-bold">
                <td className="p-2 text-left" colSpan={3}>
                  Total · {shown.length}
                  {active && <span className="font-normal text-stone-400"> of {rows.length}</span>}
                </td>
                <td className="p-2 tabular-nums">{num(sum((r) => r.invoiceCash))}</td>
                <td className="p-2 tabular-nums">{num(sum((r) => r.invoiceCredit))}</td>
                <td className="p-2 tabular-nums text-clay-900">{num(sum((r) => r.qty))}</td>
                {cols.map((c) => (
                  <td key={c} className="p-2 tabular-nums text-clay-900">
                    {num(sum((r) => Number(r.products?.[c])))}
                  </td>
                ))}
                <td className="p-2" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <CustomerEditor rows={shown} onSaved={load} />
    </section>
  );
}

/**
 * The customer name and TIN of each sale — the only two fields editable here.
 *
 * Collapsed by default and placed last: it is a cleanup tool, used once for the
 * months filed before TINs were read, then rarely. It shows the same rows the
 * filters above leave, so "October · No TIN yet" is exactly the list to fill.
 */
function CustomerEditor({ rows, onSaved }: { rows: Row[]; onSaved: () => void }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="card p-0">
      <button
        className="flex w-full items-center justify-between p-4 text-left text-sm font-bold text-clay-800"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span>✏️ Edit TIN &amp; customer names</span>
        <span className="text-xs text-stone-400">{open ? "▲ Hide" : `▼ Show · ${rows.length} sales`}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-clay-50 p-3">
          <p className="text-[11px] text-stone-500">
            Only the customer name and TIN can be changed here. A TIN set on one sale is also given to every other sale
            under the same name that has none (untick to change just this sale). Use the filters above — for example
            October and &ldquo;No TIN yet&rdquo; — to get the list to fill.
          </p>
          {rows.length === 0 ? (
            <p className="py-3 text-center text-xs text-stone-400">No sales match the filters.</p>
          ) : (
            <div className="max-h-[480px] space-y-1.5 overflow-y-auto">
              {rows.map((r) => (
                <EditorRow key={r._id} row={r} onSaved={onSaved} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EditorRow({ row, onSaved }: { row: Row; onSaved: () => void }) {
  const canEdit = useCanEdit();
  const [customer, setCustomer] = useState(row.customer);
  const [tin, setTin] = useState(row.tin || "");
  const [all, setAll] = useState(true);
  const [state, setState] = useState<{ busy?: boolean; msg?: string; err?: string }>({});

  useEffect(() => {
    setCustomer(row.customer);
    setTin(row.tin || "");
  }, [row.customer, row.tin]);

  const cleanTin = tin.replace(/[\s\-.]/g, "");
  const tinOk = cleanTin === "" || /^\d{10}$/.test(cleanTin);
  const dirty = customer.trim() !== row.customer || cleanTin !== (row.tin || "");

  async function save() {
    setState({ busy: true });
    try {
      const res = await fetch("/api/sales-invoices", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: row._id, customer: customer.trim(), tin: cleanTin || null, applyToSameName: all }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setState({ msg: body.others ? `Saved · TIN also set on ${body.others} other sale${body.others === 1 ? "" : "s"}` : "Saved" });
      onSaved();
    } catch (e) {
      setState({ err: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <div className="grid grid-cols-[70px_1fr] items-center gap-2 rounded-xl border border-clay-50 p-2 text-xs sm:grid-cols-[80px_1fr_150px_110px_auto]">
      <span className="text-stone-500">{fmtDate(row.date)}</span>
      <input className="input" value={customer} onChange={(e) => setCustomer(e.target.value)} aria-label="Customer name" />
      <input
        className={`input tabular-nums ${tinOk ? "" : "border-red-400"}`}
        placeholder="TIN (10 digits)"
        inputMode="numeric"
        value={tin}
        onChange={(e) => setTin(e.target.value)}
        aria-label="TIN"
      />
      <span className="text-right tabular-nums text-stone-500">{num(row.invoiceCash + row.invoiceCredit)} ETB</span>
      <div className="col-span-2 flex flex-wrap items-center gap-2 sm:col-span-1">
        <label className="flex items-center gap-1 text-[10px] text-stone-500" title="Give this TIN to every sale with the same name">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
          same name
        </label>
        {canEdit && (
          <button
            className="rounded-lg bg-clay-700 px-3 py-1 text-[11px] font-bold text-white disabled:opacity-40"
            disabled={!dirty || !tinOk || !customer.trim() || state.busy}
            onClick={save}
          >
            {state.busy ? "…" : "Save"}
          </button>
        )}
        {state.msg && <span className="text-[10px] text-green-700">{state.msg}</span>}
        {state.err && <span className="text-[10px] text-red-700">{state.err}</span>}
        {!tinOk && <span className="text-[10px] text-red-700">10 digits</span>}
      </div>
    </div>
  );
}
