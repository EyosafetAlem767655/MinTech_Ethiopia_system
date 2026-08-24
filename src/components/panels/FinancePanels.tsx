"use client";

import { useCallback, useEffect, useState } from "react";
import DecideBtn from "@/components/DecideButton";

/**
 * The whole Finance tab: the three things the department does.
 *
 *   1. Tool purchase batches, with their receipts and the AI cross-check.
 *   2. The monthly asset report — production and raw materials.
 *   3. WHT receipt holders, and the daily SMS chasing them.
 *
 * One component so the three share a tab strip rather than stacking into a page
 * nobody scrolls to the bottom of.
 */

type Tab = "purchases" | "monthly" | "wht";

const fmt = (n: number | null | undefined, dp = 2) =>
  n == null ? "—" : (Math.round(n * 10 ** dp) / 10 ** dp).toLocaleString(undefined, { maximumFractionDigits: dp });
const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

export default function FinancePanels() {
  const [tab, setTab] = useState<Tab>("purchases");
  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-full bg-clay-50 p-0.5">
        {(
          [
            ["purchases", "🧾 Purchases"],
            ["monthly", "📊 Monthly report"],
            ["wht", "📄 WHT"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`flex-1 rounded-full py-2 text-xs font-bold transition ${
              tab === k ? "bg-white text-clay-800 shadow" : "text-clay-500"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "purchases" && <PurchasesTab />}
      {tab === "monthly" && <MonthlyTab />}
      {tab === "wht" && <WhtTab />}
    </div>
  );
}

/* ───────────────────────────── 1. Tool purchases ──────────────────────────── */

interface PurchaseItem {
  description: string;
  uom: string | null;
  quantity: number | null;
}

interface ReceiptCheck {
  checked: boolean;
  score: number;
  printedTotal: number | null;
  mismatches: string[];
  reasoning: string;
}

interface Batch {
  _id: string;
  srNo: number;
  date: string;
  supplier: string | null;
  costCenter: string | null;
  purchaser: string | null;
  currency: "ETB" | "USD";
  totalAmount: number | null;
  reportedBy: string;
  photoFileIds: string[];
  receiptCheck: ReceiptCheck | null;
  items: PurchaseItem[];
}

function PurchasesTab() {
  const [rows, setRows] = useState<Batch[] | null>(null);
  const [usdRate, setUsdRate] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/finance/purchases")
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((d) => {
        setRows(Array.isArray(d.rows) ? d.rows : []);
        setUsdRate(d.usdRate ?? null);
      })
      .catch(() => setRows([]));
  }, []);

  if (!rows) return <div className="card h-40 animate-pulse bg-clay-50" />;

  const etbNative = rows.filter((r) => r.currency === "ETB").reduce((a, r) => a + (r.totalAmount || 0), 0);
  const usdNative = rows.filter((r) => r.currency === "USD").reduce((a, r) => a + (r.totalAmount || 0), 0);
  // Converted with the current month's published rate, so this screen and the
  // monthly report cannot quote two different dollar figures.
  const totalEtb = usdRate ? etbNative + usdNative * usdRate : null;
  const totalUsd = usdRate ? usdNative + etbNative / usdRate : null;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
        <h2 className="font-display text-lg font-bold">🧾 Tool purchases</h2>
        <p className="text-[11px] text-stone-400">{rows.length} batches</p>
      </div>

      {rows.length === 0 ? (
        <p className="card p-4 text-sm text-stone-400">No purchase reports yet.</p>
      ) : (
        <>
          <div className="card max-h-[26rem] overflow-auto p-0">
            <table className="w-full min-w-[900px] text-right text-xs">
              <thead className="sticky top-0 z-10 bg-clay-50 text-[10px] uppercase tracking-wide text-stone-500 shadow-[0_1px_0_#f3e3dd]">
                <tr>
                  <th className="p-2 font-bold">Sr.No</th>
                  <th className="p-2 text-left font-bold">Date</th>
                  <th className="p-2 text-left font-bold">Description</th>
                  <th className="p-2 font-bold">UOM</th>
                  <th className="p-2 font-bold">Qty</th>
                  <th className="p-2 text-left font-bold">Supplier</th>
                  <th className="p-2 font-bold">Total</th>
                  <th className="p-2 text-left font-bold">Cost centre</th>
                  <th className="p-2 text-left font-bold">Purchaser</th>
                  <th className="p-2 font-bold">Receipt</th>
                </tr>
              </thead>
              <tbody>
                {rows.flatMap((b) =>
                  (b.items.length > 0 ? b.items : [null]).map((it, i) => (
                    <tr key={`${b._id}-${i}`} className={i === 0 ? "border-t-2 border-clay-100" : "border-t border-clay-50"}>
                      {/* Batch fields print once and span their items: they
                          describe the purchase, not the individual tool. */}
                      {i === 0 ? (
                        <>
                          <td rowSpan={Math.max(b.items.length, 1)} className="p-2 font-bold tabular-nums text-clay-900">
                            {b.srNo}
                          </td>
                          <td rowSpan={Math.max(b.items.length, 1)} className="p-2 text-left font-semibold text-stone-800">
                            {fmtDate(b.date)}
                          </td>
                        </>
                      ) : null}
                      <td className="p-2 text-left text-stone-700">{it?.description ?? "—"}</td>
                      <td className="p-2 text-stone-500">{it?.uom ?? ""}</td>
                      <td className="p-2 tabular-nums text-stone-700">{it ? fmt(it.quantity, 3) : ""}</td>
                      {i === 0 ? (
                        <>
                          <td rowSpan={Math.max(b.items.length, 1)} className="p-2 text-left text-stone-600">
                            {b.supplier || "—"}
                          </td>
                          <td rowSpan={Math.max(b.items.length, 1)} className="p-2 font-bold tabular-nums text-clay-900">
                            {fmt(b.totalAmount)} <span className="text-[10px] font-normal text-stone-400">{b.currency}</span>
                          </td>
                          <td rowSpan={Math.max(b.items.length, 1)} className="p-2 text-left text-stone-600">
                            {b.costCenter || "—"}
                          </td>
                          <td rowSpan={Math.max(b.items.length, 1)} className="p-2 text-left text-stone-600">
                            {b.purchaser || b.reportedBy}
                          </td>
                          <td rowSpan={Math.max(b.items.length, 1)} className="p-2">
                            <ReceiptCell batch={b} />
                          </td>
                        </>
                      ) : null}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="card grid grid-cols-2 gap-3 p-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400">Total in birr</p>
              <p className="font-display text-xl font-bold text-clay-900">
                {totalEtb == null ? `${fmt(etbNative)} ETB` : `${fmt(totalEtb)} ETB`}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400">Total in dollars</p>
              <p className="font-display text-xl font-bold text-clay-900">
                {totalUsd == null ? `${fmt(usdNative)} USD` : `${fmt(totalUsd)} USD`}
              </p>
            </div>
            <p className="col-span-2 text-[11px] leading-snug text-stone-400">
              {usdRate
                ? `Converted at ${fmt(usdRate)} ETB per USD, from this month's price list.`
                : "No USD rate on this month's price list yet, so each currency is totalled on its own rather than guessing a rate."}
            </p>
          </div>
        </>
      )}
    </section>
  );
}

/** The receipt thumbnail plus the AI verdict, or an honest blank. */
function ReceiptCell({ batch }: { batch: Batch }) {
  const c = batch.receiptCheck;
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1">
        {batch.photoFileIds.slice(0, 3).map((id) => (
          <a key={id} href={`/api/files/${id}`} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/files/${id}`} alt="Receipt" className="h-9 w-9 rounded object-cover ring-1 ring-clay-100" />
          </a>
        ))}
        {batch.photoFileIds.length === 0 && <span className="text-stone-300">—</span>}
      </div>
      {c &&
        (!c.checked ? (
          // Never red: a check that could not run is not an accusation.
          <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-bold text-stone-600">
            ⏳ Not checked
          </span>
        ) : c.mismatches.length > 0 ? (
          <span
            title={c.mismatches.join(" · ")}
            className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800"
          >
            ⚠️ {fmt(c.printedTotal)} on receipt
          </span>
        ) : (
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-700">
            ✅ {c.score}%
          </span>
        ))}
    </div>
  );
}

/* ───────────────────────────── 2. Monthly report ──────────────────────────── */

interface ProductionRow {
  code: string;
  label: string;
  baseBalance: number;
  received: number;
  receivedPct: number;
  total: number;
  sold: number;
  soldPct: number;
  revenue: number;
  stock: number;
  unitPrice: number;
  netWorth: number;
}

interface RawRow {
  code: string;
  label: string;
  unit: "t" | "pcs";
  baseBalance: number;
  received: number;
  total: number;
  issue: number;
  stock: number;
  unitPrice: number;
  netWorth: number;
}

interface Report {
  month: string;
  hasBaseBalance: boolean;
  hasPrices: boolean;
  usdRate: number | null;
  production: ProductionRow[];
  rawMaterials: RawRow[];
  totals: Record<string, number>;
  availableMonths: string[];
  error?: string;
}

function MonthlyTab() {
  const [month, setMonth] = useState("");
  const [data, setData] = useState<Report | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async (m: string) => {
    setData(null);
    setError("");
    const res = await fetch(`/api/finance/monthly${m ? `?month=${m}` : ""}`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error || "Could not load the monthly report.");
      return;
    }
    setData(json);
    setMonth(json.month);
  }, []);

  useEffect(() => {
    load("");
  }, [load]);

  if (error) return <p className="card border-l-4 border-l-red-500 p-4 text-xs font-bold text-red-700">{error}</p>;
  if (!data) return <div className="card h-56 animate-pulse bg-clay-50" />;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <h2 className="font-display text-lg font-bold">📊 Monthly report</h2>
        <select
          value={month}
          onChange={(e) => load(e.target.value)}
          className="rounded-lg border border-clay-100 bg-white px-2 py-1 text-xs font-bold"
        >
          {data.availableMonths.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      {!data.hasBaseBalance && (
        <p className="card border-l-4 border-l-amber-500 p-3 text-xs font-bold text-amber-800">
          No opening balance filed for {data.month}. Every &ldquo;Total&rdquo; below is the month&rsquo;s movement
          only, with nothing carried in.
        </p>
      )}
      {!data.hasPrices && (
        <p className="card border-l-4 border-l-amber-500 p-3 text-xs font-bold text-amber-800">
          No price list for {data.month}, so revenue and stock net worth read zero.
        </p>
      )}

      <h3 className="px-1 text-xs font-bold uppercase tracking-widest text-stone-400">Production</h3>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[1000px] text-right text-xs">
          <thead className="bg-clay-50/70 text-[10px] uppercase tracking-wide text-stone-500">
            <tr>
              <th className="p-2 text-left font-bold">Product</th>
              <th className="p-2 font-bold">Base bal.</th>
              <th className="p-2 font-bold">Received</th>
              <th className="p-2 font-bold">In %</th>
              <th className="p-2 font-bold">Total</th>
              <th className="p-2 font-bold">Sold</th>
              <th className="p-2 font-bold">Sold %</th>
              <th className="p-2 font-bold">Revenue</th>
              <th className="p-2 font-bold">Stock</th>
              <th className="p-2 font-bold">Unit price</th>
              <th className="p-2 font-bold">Net worth</th>
            </tr>
          </thead>
          <tbody>
            {data.production.map((r) => (
              <tr key={r.code} className="border-t border-clay-50">
                <td className="p-2 text-left font-semibold text-stone-800">{r.label}</td>
                <td className="p-2 tabular-nums text-stone-700">{fmt(r.baseBalance, 3)}</td>
                <td className="p-2 tabular-nums text-stone-700">{fmt(r.received, 3)}</td>
                <td className="p-2 tabular-nums text-stone-400">{fmt(r.receivedPct, 1)}%</td>
                <td className="p-2 tabular-nums text-stone-700">{fmt(r.total, 3)}</td>
                <td className="p-2 tabular-nums text-stone-700">{fmt(r.sold, 3)}</td>
                <td className="p-2 tabular-nums text-stone-400">{fmt(r.soldPct, 1)}%</td>
                <td className="p-2 tabular-nums text-stone-700">{fmt(r.revenue)}</td>
                <td className="p-2 tabular-nums font-semibold text-stone-800">{fmt(r.stock, 3)}</td>
                <td className="p-2 tabular-nums text-stone-500">{fmt(r.unitPrice)}</td>
                <td className="p-2 tabular-nums font-bold text-clay-900">{fmt(r.netWorth)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-clay-100 bg-clay-50/50 font-bold">
              <td className="p-2 text-left">Total</td>
              <td className="p-2 tabular-nums">{fmt(data.totals.baseBalance, 3)}</td>
              <td className="p-2 tabular-nums">{fmt(data.totals.received, 3)}</td>
              <td className="p-2" />
              <td className="p-2" />
              <td className="p-2 tabular-nums">{fmt(data.totals.sold, 3)}</td>
              <td className="p-2" />
              <td className="p-2 tabular-nums">{fmt(data.totals.revenue)}</td>
              <td className="p-2 tabular-nums">{fmt(data.totals.stock, 3)}</td>
              <td className="p-2" />
              <td className="p-2 tabular-nums text-clay-900">{fmt(data.totals.productionNetWorth)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <h3 className="px-1 text-xs font-bold uppercase tracking-widest text-stone-400">Raw materials &amp; bags</h3>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[760px] text-right text-xs">
          <thead className="bg-clay-50/70 text-[10px] uppercase tracking-wide text-stone-500">
            <tr>
              <th className="p-2 text-left font-bold">Item</th>
              <th className="p-2 font-bold">Base bal.</th>
              <th className="p-2 font-bold">Received</th>
              <th className="p-2 font-bold">Total</th>
              <th className="p-2 font-bold">Issue</th>
              <th className="p-2 font-bold">Stock</th>
              <th className="p-2 font-bold">Unit price</th>
              <th className="p-2 font-bold">Net worth</th>
            </tr>
          </thead>
          <tbody>
            {data.rawMaterials.map((r) => (
              <tr key={r.code} className="border-t border-clay-50">
                <td className="p-2 text-left font-semibold text-stone-800">
                  {r.label}
                  {/* Tonnes and pieces never share a column total, so the unit
                      is on every row rather than in the header. */}
                  <span className="ml-1 text-[10px] font-normal text-stone-400">{r.unit}</span>
                </td>
                <td className="p-2 tabular-nums text-stone-700">{fmt(r.baseBalance, r.unit === "t" ? 3 : 0)}</td>
                <td className="p-2 tabular-nums text-stone-700">{fmt(r.received, r.unit === "t" ? 3 : 0)}</td>
                <td className="p-2 tabular-nums text-stone-700">{fmt(r.total, r.unit === "t" ? 3 : 0)}</td>
                <td className="p-2 tabular-nums text-stone-700">{fmt(r.issue, r.unit === "t" ? 3 : 0)}</td>
                <td className="p-2 tabular-nums font-semibold text-stone-800">
                  {fmt(r.stock, r.unit === "t" ? 3 : 0)}
                </td>
                <td className="p-2 tabular-nums text-stone-500">{fmt(r.unitPrice)}</td>
                <td className="p-2 tabular-nums font-bold text-clay-900">{fmt(r.netWorth)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-clay-100 bg-clay-50/50 font-bold">
              <td className="p-2 text-left" colSpan={7}>
                Total net worth
              </td>
              <td className="p-2 tabular-nums text-clay-900">{fmt(data.totals.rawMaterialNetWorth)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="card flex flex-wrap items-baseline justify-between gap-2 p-4">
        <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400">
          Total stock net worth · {data.month}
        </p>
        <p className="font-display text-2xl font-bold text-clay-900">{fmt(data.totals.netWorth)} ETB</p>
      </div>
    </section>
  );
}

/* ─────────────────────────────── 3. WHT holders ───────────────────────────── */

interface Holder {
  _id: string;
  company: string;
  phone: string;
  description: string | null;
  status: "pending" | "received" | "cancelled";
  registeredBy: string;
  smsSent: number;
  lastSmsOn: string | null;
  lastError: string | null;
  createdAt: string;
}

const STATUS_TONE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  received: "bg-green-100 text-green-700",
  cancelled: "bg-stone-100 text-stone-600",
};

function WhtTab() {
  const [rows, setRows] = useState<Holder[] | null>(null);
  const [smsConfigured, setSmsConfigured] = useState(true);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");
  const [form, setForm] = useState({ company: "", phone: "", description: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/finance/wht");
      const d = res.ok ? await res.json() : { rows: [] };
      setRows(Array.isArray(d.rows) ? d.rows : []);
      setSmsConfigured(d.smsConfigured !== false);
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const decide = async (id: string, action: "received" | "cancel" | "reopen") => {
    setBusy((b) => ({ ...b, [id]: true }));
    setError("");
    try {
      const res = await fetch(`/api/finance/wht/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        setError((await res.json().catch(() => ({}))).error || "Could not save that.");
        return;
      }
      await load();
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  };

  const add = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/finance/wht", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        setError((await res.json().catch(() => ({}))).error || "Could not register that holder.");
        return;
      }
      setForm({ company: "", phone: "", description: "" });
      await load();
    } finally {
      setSaving(false);
    }
  };

  if (!rows) return <div className="card h-40 animate-pulse bg-clay-50" />;

  const pending = rows.filter((r) => r.status === "pending");

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
        <h2 className="font-display text-lg font-bold">📄 WHT receipt holders</h2>
        <p className="text-[11px] font-bold text-amber-800">{pending.length} still owed</p>
      </div>

      {!smsConfigured && (
        <p className="card border-l-4 border-l-amber-500 p-3 text-xs font-bold text-amber-800">
          The SMS gateway is not configured, so nobody is being chased. Set SMS_GATEWAY_USER and
          SMS_GATEWAY_PASSWORD on Vercel.
        </p>
      )}
      {error && <p className="card border-l-4 border-l-red-500 p-3 text-xs font-bold text-red-700">{error}</p>}

      <div className="card space-y-2 p-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400">Register a holder</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <input
            value={form.company}
            onChange={(e) => setForm({ ...form, company: e.target.value })}
            placeholder="Company"
            className="rounded-lg border border-clay-100 px-2 py-1.5 text-sm"
          />
          <input
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            placeholder="0912345678"
            className="rounded-lg border border-clay-100 px-2 py-1.5 text-sm"
          />
          <input
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Receipt description"
            className="rounded-lg border border-clay-100 px-2 py-1.5 text-sm"
          />
        </div>
        <DecideBtn
          label={saving ? "Saving…" : "➕ Register"}
          tone="green"
          busy={saving}
          disabled={!form.company.trim() || !form.phone.trim()}
          onClick={add}
        />
      </div>

      {rows.length === 0 ? (
        <p className="card p-4 text-sm text-stone-400">No WHT receipt holders registered.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((h) => (
            <div key={h._id} className="card space-y-2 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-stone-800">{h.company}</p>
                  <p className="text-[11px] text-stone-500">{h.phone}</p>
                  {h.description && <p className="mt-0.5 text-xs text-stone-600">{h.description}</p>}
                  <p className="mt-0.5 text-[10px] text-stone-400">
                    Registered by {h.registeredBy} · {fmtDate(h.createdAt)}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${STATUS_TONE[h.status]}`}>
                  {h.status}
                </span>
              </div>

              <p className="text-[11px] text-stone-500">
                {h.smsSent > 0
                  ? `📲 ${h.smsSent} reminder${h.smsSent === 1 ? "" : "s"} sent${h.lastSmsOn ? `, last on ${h.lastSmsOn}` : ""}`
                  : "📲 No reminder sent yet"}
              </p>
              {h.lastError && (
                <p className="rounded-lg bg-red-50 px-2 py-1 text-[11px] text-red-700">
                  Last attempt failed: {h.lastError}
                </p>
              )}

              <div className="flex flex-wrap gap-1.5 border-t border-clay-50 pt-2">
                {h.status === "pending" ? (
                  <>
                    <DecideBtn
                      label="✓ Receipt received"
                      tone="green"
                      busy={!!busy[h._id]}
                      onClick={() => decide(h._id, "received")}
                    />
                    <DecideBtn
                      label="✗ Stop chasing"
                      tone="red"
                      busy={!!busy[h._id]}
                      onClick={() => decide(h._id, "cancel")}
                    />
                  </>
                ) : (
                  <DecideBtn
                    label="↺ Reopen"
                    tone="grey"
                    busy={!!busy[h._id]}
                    onClick={() => decide(h._id, "reopen")}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
