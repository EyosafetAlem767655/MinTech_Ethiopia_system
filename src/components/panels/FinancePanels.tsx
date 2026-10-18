"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import DecideBtn from "@/components/DecideButton";
import { PriceListEditor, StoreCostEditor } from "@/components/panels/UnitCostEditors";
import PurchaseForm, { type PurchaseRequestRef } from "@/components/panels/PurchaseForm";
import { purchaseDeptLabel } from "@/lib/purchase-departments";
import {
  ALARM_TONNES,
  STATUS_LABEL,
  daysLeftLabel,
  type CreditStatus,
  type CustomerExposure,
} from "@/lib/credit";

/**
 * The whole Finance tab: the four things the department does.
 *
 *   1. Raw material bought on credit — each load, its payments, what is owed.
 *   2. The monthly asset report — production and raw materials.
 *   3. Credit sales: what is owed, when it falls due, and who is over-extended.
 *   4. WHT receipt holders, and the daily SMS chasing them.
 *   5. What came in through each bank, once a month, off one sheet.
 *
 * One component so the four share a tab strip rather than stacking into a page
 * nobody scrolls to the bottom of.
 */

type Tab = "rmcredit" | "monthly" | "credit" | "wht" | "banks" | "purchases";

const fmt = (n: number | null | undefined, dp = 2) =>
  n == null ? "—" : (Math.round(n * 10 ** dp) / 10 ** dp).toLocaleString(undefined, { maximumFractionDigits: dp });
const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

export default function FinancePanels() {
  // Monthly is what finance opens the tab for; the others are looked up.
  const [tab, setTab] = useState<Tab>("monthly");
  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-full bg-clay-50 p-0.5">
        {(
          [
            ["rmcredit", "🚚 RM credit"],
            ["monthly", "📊 Monthly"],
            ["credit", "💳 Credit"],
            ["wht", "📄 WHT"],
            ["banks", "🏦 Banks"],
            ["purchases", "🛍 Purchase status"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`flex-1 rounded-full py-2 text-[11px] font-bold transition sm:text-xs ${
              tab === k ? "bg-white text-clay-800 shadow" : "text-clay-500"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "rmcredit" && <RmCreditTab />}
      {tab === "monthly" && <MonthlyTab />}
      {tab === "credit" && <CreditTab />}
      {tab === "wht" && <WhtTab />}
      {tab === "banks" && <BankCollectionsTab />}
      {tab === "purchases" && <PurchaseStatusTab />}
    </div>
  );
}

/* ──────────────────────── 1. Raw material on credit ───────────────────────── */

interface RmPayment {
  id: string;
  amount: number;
  paidOn: string;
  note: string | null;
  recordedBy: string;
}

interface RmLoad {
  id: string;
  date: string;
  supplier: string;
  truckPlate: string | null;
  material: string;
  tonnes: number;
  pricePerTonne: number;
  amount: number;
  paid: number;
  remaining: number;
  status: "open" | "settled";
  note: string | null;
  reportedBy: string;
  payments: RmPayment[];
}

interface RmData {
  loads: RmLoad[];
  suppliers: { supplier: string; loads: number; open: number; tonnes: number; amount: number; paid: number; remaining: number }[];
  totals: { outstanding: number; openLoads: number; tonnesOnCredit: number; paidThisMonth: number };
}

/**
 * Raw material bought on credit: each truckload (supplier, plate, material,
 * tonnes × price per tonne), what has been paid against it, and what is still
 * owed. Filed from the bot — 🚚 for a load, 💸 for a payment.
 */
function RmCreditTab() {
  const [data, setData] = useState<RmData | null>(null);
  const [showSettled, setShowSettled] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/finance/rm-credit")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d ?? { loads: [], suppliers: [], totals: { outstanding: 0, openLoads: 0, tonnesOnCredit: 0, paidThisMonth: 0 } }))
      .catch(() => setData({ loads: [], suppliers: [], totals: { outstanding: 0, openLoads: 0, tonnesOnCredit: 0, paidThisMonth: 0 } }));
  }, []);

  if (!data) return <div className="card h-40 animate-pulse bg-clay-50" />;
  const loads = data.loads.filter((l) => showSettled || l.status === "open");

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
        <h2 className="font-display text-lg font-bold">🚚 Raw material on credit</h2>
        <p className="text-[11px] text-stone-400">filed from the bot · 🚚 load · 💸 payment</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <CreditTile label="Still owed" value={fmt(data.totals.outstanding, 0)} suffix="ETB" tone="text-clay-900" />
        <CreditTile label="Open loads" value={String(data.totals.openLoads)} tone="text-stone-800" />
        <CreditTile label="Tonnes on credit" value={fmt(data.totals.tonnesOnCredit, 2)} suffix="t" tone="text-stone-800" />
        <CreditTile label="Paid this month" value={fmt(data.totals.paidThisMonth, 0)} suffix="ETB" tone="text-green-700" />
      </div>

      {data.loads.length === 0 ? (
        <p className="card p-4 text-sm text-stone-400">
          No raw material bought on credit yet. A load is filed from the bot with 🚚 የጥሬ ዕቃ ብድር ግዢ.
        </p>
      ) : (
        <>
          {/* Per supplier */}
          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[560px] text-right text-xs">
              <thead className="bg-clay-50/70 text-[10px] uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="p-2 text-left font-bold">Supplier</th>
                  <th className="p-2 font-bold">Loads</th>
                  <th className="p-2 font-bold">Tonnes</th>
                  <th className="p-2 font-bold">Amount</th>
                  <th className="p-2 font-bold">Paid</th>
                  <th className="p-2 font-bold">Owed</th>
                </tr>
              </thead>
              <tbody>
                {data.suppliers.map((s) => (
                  <tr key={s.supplier} className="border-t border-clay-50">
                    <td className="p-2 text-left font-semibold text-stone-800">{s.supplier}</td>
                    <td className="p-2 tabular-nums text-stone-600">
                      {s.loads}
                      {s.open ? <span className="text-amber-700"> · {s.open} open</span> : null}
                    </td>
                    <td className="p-2 tabular-nums text-stone-700">{fmt(s.tonnes, 2)}</td>
                    <td className="p-2 tabular-nums text-stone-700">{fmt(s.amount, 0)}</td>
                    <td className="p-2 tabular-nums text-green-700">{fmt(s.paid, 0)}</td>
                    <td className={`p-2 font-bold tabular-nums ${s.remaining > 1 ? "text-clay-900" : "text-stone-400"}`}>
                      {fmt(s.remaining, 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Loads */}
          <div className="flex items-center justify-between px-1">
            <p className="text-[11px] font-bold uppercase tracking-widest text-clay-500">Loads</p>
            <label className="flex items-center gap-1.5 text-[11px] text-stone-500">
              <input type="checkbox" checked={showSettled} onChange={(e) => setShowSettled(e.target.checked)} />
              Show paid loads
            </label>
          </div>
          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[900px] text-right text-xs">
              <thead className="bg-clay-50/70 text-[10px] uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="p-2 text-left font-bold">Date</th>
                  <th className="p-2 text-left font-bold">Supplier</th>
                  <th className="p-2 text-left font-bold">Truck</th>
                  <th className="p-2 text-left font-bold">Material</th>
                  <th className="p-2 font-bold">Tonnes</th>
                  <th className="p-2 font-bold">Price / t</th>
                  <th className="p-2 font-bold">Amount</th>
                  <th className="p-2 font-bold">Paid</th>
                  <th className="p-2 font-bold">Owed</th>
                  <th className="p-2 text-left font-bold">Status</th>
                </tr>
              </thead>
              <tbody>
                {loads.length === 0 && (
                  <tr>
                    <td colSpan={10} className="p-4 text-center text-stone-400">
                      Every load is paid.
                    </td>
                  </tr>
                )}
                {loads.map((l) => (
                  <Fragment key={l.id}>
                    <tr
                      className="cursor-pointer border-t border-clay-50 hover:bg-clay-50/40"
                      onClick={() => setOpenId((o) => (o === l.id ? null : l.id))}
                      aria-expanded={openId === l.id}
                    >
                      <td className="p-2 text-left font-semibold text-stone-800">{fmtDate(l.date)}</td>
                      <td className="p-2 text-left text-stone-700">{l.supplier}</td>
                      <td className="p-2 text-left text-stone-500">{l.truckPlate || "—"}</td>
                      <td className="p-2 text-left text-stone-700">{l.material}</td>
                      <td className="p-2 tabular-nums text-stone-700">{fmt(l.tonnes, 3)}</td>
                      <td className="p-2 tabular-nums text-stone-500">{fmt(l.pricePerTonne, 2)}</td>
                      <td className="p-2 tabular-nums text-stone-800">{fmt(l.amount, 0)}</td>
                      <td className="p-2 tabular-nums text-green-700">{fmt(l.paid, 0)}</td>
                      <td className={`p-2 font-bold tabular-nums ${l.status === "open" ? "text-clay-900" : "text-stone-400"}`}>
                        {fmt(Math.max(0, l.remaining), 0)}
                      </td>
                      <td className="p-2 text-left">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            l.status === "open" ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-800"
                          }`}
                        >
                          {l.status === "open" ? (l.paid > 0 ? "Part paid" : "Unpaid") : "Paid"}
                        </span>
                        <span className="ml-1 text-[10px] text-stone-400">{openId === l.id ? "▲" : "▼"}</span>
                      </td>
                    </tr>
                    {openId === l.id && (
                      <tr className="bg-clay-50/30">
                        <td colSpan={10} className="p-3 text-left">
                          {l.payments.length === 0 ? (
                            <p className="text-[11px] text-stone-500">No payment recorded yet.</p>
                          ) : (
                            <ul className="space-y-1 text-[11px] text-stone-600">
                              {l.payments.map((p) => (
                                <li key={p.id}>
                                  💸 {fmtDate(p.paidOn)} · <b className="tabular-nums">{fmt(p.amount, 0)} ETB</b> · {p.recordedBy}
                                  {p.note ? <span className="text-stone-400"> — {p.note}</span> : null}
                                </li>
                              ))}
                            </ul>
                          )}
                          <p className="mt-1 text-[10px] text-stone-400">
                            Filed by {l.reportedBy}
                            {l.note ? ` · ${l.note}` : ""}
                          </p>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
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
  rawMaterialSource?: "daily" | "vouchers";
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

      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
        <h3 className="text-xs font-bold uppercase tracking-widest text-stone-400">Raw materials &amp; bags</h3>
        {/* Which record the in/out columns were built from. The daily report
            and the store issue voucher both describe material movement, and a
            month reads one of them, never both — so it says which. */}
        <p className="text-[10px] text-stone-400">
          {data.rawMaterialSource === "daily"
            ? "in/out from the daily raw-material report"
            : "in/out from receipts and store issue vouchers"}
        </p>
      </div>
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

      {/* The unit costs behind the figures above, editable for the month the
          bot user could not file them. A saved price reloads the report. */}
      <h3 className="px-1 pt-2 text-xs font-bold uppercase tracking-widest text-stone-400">Unit costs</h3>
      <PriceListEditor month={data.month} onSaved={() => load(data.month)} />
      <StoreCostEditor month={data.month} />
      {/* The PP bag stock check and the GRV/SIV voucher lists are asset
          management's, and live on that tab only: repeated here they competed
          with the monthly report for the same screen. */}
    </section>
  );
}

/* ────────────────────────────── 3. Credit sales ───────────────────────────── */

interface CreditPayment {
  id: string;
  amount: number;
  collectedOn: string;
  note: string | null;
  recordedBy: string;
}

interface CreditRow {
  _id: string;
  date: string;
  customer: string;
  qty: number;
  invoiceCash: number;
  deliveryNo: string | null;
  bank: string | null;
  reportedBy: string;
  credit: number;
  paid: number;
  outstanding: number;
  dueDate: string;
  daysLeft: number;
  status: CreditStatus;
  payments: CreditPayment[];
}

interface CreditData {
  rows: CreditRow[];
  customers: CustomerExposure[];
  totals: { outstanding: number; overdue: number; dueSoon: number; alarms: number };
  unavailable: boolean;
}

const CREDIT_TONE: Record<CreditStatus, string> = {
  settled: "bg-stone-100 text-stone-500",
  overdue: "bg-red-100 text-red-800",
  due_soon: "bg-amber-100 text-amber-800",
  open: "bg-green-100 text-green-700",
};

/**
 * Credit sales, their countdown, and the money coming back in.
 *
 * Every figure on this tab is derived from the invoice and its payments by
 * `src/lib/credit.ts` — the same module the API uses — so a payment deleted here
 * moves the outstanding total, the countdown, the status and the alarm together.
 */
function CreditTab() {
  const [data, setData] = useState<CreditData | null>(null);
  const [showSettled, setShowSettled] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/finance/credit");
      setData(res.ok ? await res.json() : { ...EMPTY_CREDIT });
    } catch {
      setData({ ...EMPTY_CREDIT });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId]);

  if (!data) return <div className="card h-40 animate-pulse bg-clay-50" />;

  const alarms = data.customers.filter((c) => c.alarm);
  const visible = showSettled ? data.rows : data.rows.filter((r) => r.status !== "settled");
  const selected = openId ? data.rows.find((r) => r._id === openId) ?? null : null;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
        <h2 className="font-display text-lg font-bold">💳 Credit sales</h2>
        <p className="text-[11px] text-stone-400">One month to collect · {ALARM_TONNES} t triggers an alarm</p>
      </div>

      {error && <p className="card border-l-4 border-l-red-500 p-3 text-xs font-bold text-red-700">{error}</p>}

      {data.unavailable && (
        <p className="card border-l-4 border-l-amber-500 p-3 text-xs font-bold text-amber-800">
          Run migration 0029 in the Supabase editor — the credit payments table is not there yet.
        </p>
      )}

      {/* The alarm. Named clients, not a count: "somebody is over" is not something
          anyone can act on, and this is the one thing on the tab worth interrupting for. */}
      {alarms.length > 0 && (
        <div className="card border-l-4 border-l-red-500 bg-red-50/60 p-3">
          <p className="text-xs font-bold text-red-800">
            🚨 {alarms.length} client{alarms.length === 1 ? "" : "s"} past {ALARM_TONNES} t of unpaid stock
          </p>
          <div className="mt-2 space-y-1.5">
            {alarms.map((c) => (
              <div key={c.customer} className="flex flex-wrap items-baseline justify-between gap-2 text-[11px]">
                <span className="font-bold text-stone-800">{c.customer}</span>
                <span className="text-stone-600">
                  <span className="font-bold tabular-nums text-red-700">{fmt(c.unpaidTonnes, 2)} t</span> unpaid ·{" "}
                  {fmt(c.outstanding, 0)} ETB owed · {c.invoices} invoice{c.invoices === 1 ? "" : "s"}
                  {c.worstOverdueDays > 0 && ` · ${c.worstOverdueDays}d overdue`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <CreditTile label="Outstanding" value={`${fmt(data.totals.outstanding, 0)}`} suffix="ETB" tone="text-clay-900" />
        <CreditTile label="Overdue" value={String(data.totals.overdue)} tone="text-red-700" />
        <CreditTile label="Due in 7 days" value={String(data.totals.dueSoon)} tone="text-amber-700" />
        <CreditTile label="On alarm" value={String(data.totals.alarms)} tone={alarms.length ? "text-red-700" : "text-stone-500"} />
      </div>

      <div className="flex items-center justify-between px-1">
        <p className="text-[11px] text-stone-400">Tap a row to record a payment.</p>
        <button
          onClick={() => setShowSettled((s) => !s)}
          className={`rounded-full px-3 py-1 text-[11px] font-bold transition ${
            showSettled ? "bg-clay-700 text-white" : "bg-stone-100 text-stone-600"
          }`}
        >
          {showSettled ? "Hiding nothing" : "Show settled"}
        </button>
      </div>

      {visible.length === 0 ? (
        <p className="card p-4 text-sm text-stone-400">
          {data.rows.length === 0 ? "No credit sales yet." : "Nothing outstanding. 🎉"}
        </p>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[760px] text-right text-xs">
            <thead className="bg-clay-50/70 text-[10px] uppercase tracking-wide text-stone-500">
              <tr>
                <th className="p-2 text-left font-bold">Sold</th>
                <th className="p-2 text-left font-bold">Client</th>
                <th className="p-2 font-bold">Qty (t)</th>
                <th className="p-2 font-bold">Credit</th>
                <th className="p-2 font-bold">Paid</th>
                <th className="p-2 font-bold">Outstanding</th>
                <th className="p-2 text-left font-bold">Due</th>
                <th className="p-2 font-bold">Countdown</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr
                  key={r._id}
                  onClick={() => setOpenId(r._id)}
                  className="cursor-pointer border-t border-clay-50 transition-colors hover:bg-clay-50/60"
                >
                  <td className="p-2 text-left font-semibold text-stone-800">{fmtDate(r.date)}</td>
                  <td className="max-w-[180px] truncate p-2 text-left text-stone-700">{r.customer}</td>
                  <td className="p-2 tabular-nums text-stone-600">{fmt(r.qty, 2)}</td>
                  <td className="p-2 tabular-nums text-stone-700">{fmt(r.credit, 0)}</td>
                  <td className="p-2 tabular-nums text-green-700">{r.paid > 0 ? fmt(r.paid, 0) : ""}</td>
                  <td className="p-2 font-bold tabular-nums text-clay-900">{fmt(r.outstanding, 0)}</td>
                  <td className="p-2 text-left text-stone-500">{fmtDate(r.dueDate)}</td>
                  <td className="p-2">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${CREDIT_TONE[r.status]}`}>
                      {r.status === "settled" ? "✓ Settled" : daysLeftLabel(r)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <CreditModal
          row={selected}
          onClose={() => setOpenId(null)}
          onError={setError}
          onSaved={async () => {
            await load();
          }}
        />
      )}
    </section>
  );
}

const EMPTY_CREDIT: CreditData = {
  rows: [],
  customers: [],
  totals: { outstanding: 0, overdue: 0, dueSoon: 0, alarms: 0 },
  unavailable: true,
};

function CreditTile({ label, value, suffix, tone }: { label: string; value: string; suffix?: string; tone: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400">{label}</p>
      <p className={`mt-1 font-display text-xl font-bold tabular-nums ${tone}`}>
        {value}
        {suffix && <span className="ml-1 text-[10px] font-semibold text-stone-400">{suffix}</span>}
      </p>
    </div>
  );
}

/** One credit sale: what it was, what has come back, and a way to record more. */
function CreditModal({
  row,
  onClose,
  onSaved,
  onError,
}: {
  row: CreditRow;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [amount, setAmount] = useState("");
  const [collectedOn, setCollectedOn] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    onError("");
    try {
      const res = await fetch("/api/finance/credit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId: row._id, amount: Number(amount), collectedOn, note }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        onError(body.error || "Could not record that payment.");
        return;
      }
      setAmount("");
      setNote("");
      await onSaved();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const removePayment = async (id: string) => {
    if (!confirm("Remove this payment? The outstanding amount goes back up.")) return;
    setBusy(true);
    onError("");
    try {
      const res = await fetch(`/api/finance/credit?paymentId=${id}`, { method: "DELETE" });
      if (!res.ok) {
        onError((await res.json().catch(() => ({}))).error || "Could not remove that payment.");
        return;
      }
      await onSaved();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-4 shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${CREDIT_TONE[row.status]}`}>
              {row.status === "settled" ? "✓ Settled" : `${STATUS_LABEL[row.status]} · ${daysLeftLabel(row)}`}
            </span>
            <h3 className="mt-1.5 font-display text-base font-bold text-stone-900">{row.customer}</h3>
            <p className="text-[11px] text-stone-400">
              Sold {fmtDate(row.date)} · due {fmtDate(row.dueDate)} · filed by {row.reportedBy}
            </p>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-full bg-stone-100 px-2.5 py-1 text-xs font-bold text-stone-600">
            ✕
          </button>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-stone-50 p-2">
            <p className="text-[10px] font-bold uppercase text-stone-400">Credit</p>
            <p className="font-display text-base font-bold tabular-nums text-stone-800">{fmt(row.credit, 0)}</p>
          </div>
          <div className="rounded-xl bg-stone-50 p-2">
            <p className="text-[10px] font-bold uppercase text-stone-400">Paid</p>
            <p className="font-display text-base font-bold tabular-nums text-green-700">{fmt(row.paid, 0)}</p>
          </div>
          <div className="rounded-xl bg-stone-50 p-2">
            <p className="text-[10px] font-bold uppercase text-stone-400">Left</p>
            <p className="font-display text-base font-bold tabular-nums text-clay-900">{fmt(row.outstanding, 0)}</p>
          </div>
        </div>

        <p className="mt-2 text-[11px] text-stone-500">
          {fmt(row.qty, 2)} t on this sale
          {row.invoiceCash > 0 && ` · ${fmt(row.invoiceCash, 0)} ETB of it paid in cash at the time`}
          {row.deliveryNo && ` · Deli ${row.deliveryNo}`}
          {row.bank && ` · ${row.bank}`}
        </p>

        {row.payments.length > 0 && (
          <div className="mt-3">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-stone-400">Collected</p>
            <div className="space-y-1">
              {row.payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-2 rounded-lg bg-stone-50 px-2.5 py-1.5">
                  <div className="min-w-0">
                    <span className="text-xs font-bold tabular-nums text-stone-800">{fmt(p.amount, 0)} ETB</span>
                    <span className="ml-2 text-[11px] text-stone-500">{fmtDate(p.collectedOn)}</span>
                    {p.note && <p className="truncate text-[11px] text-stone-400">{p.note}</p>}
                  </div>
                  <button
                    onClick={() => removePayment(p.id)}
                    disabled={busy}
                    title="Remove this payment"
                    className="shrink-0 rounded-full bg-stone-200 px-2 py-0.5 text-[10px] font-bold text-stone-600 disabled:opacity-50"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {row.outstanding > 0 && (
          <div className="mt-4 space-y-2 rounded-xl border border-clay-100 p-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400">Record a payment</p>
            <div className="flex gap-2">
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder={`Amount (max ${fmt(row.outstanding, 0)})`}
                className="min-w-0 flex-1 rounded-lg border border-stone-200 px-2 py-1.5 text-xs"
              />
              <input
                type="date"
                value={collectedOn}
                onChange={(e) => setCollectedOn(e.target.value)}
                title="The day the money came in"
                className="shrink-0 rounded-lg border border-stone-200 px-2 py-1.5 text-xs text-stone-600"
              />
            </div>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note (bank, reference…)"
              className="w-full rounded-lg border border-stone-200 px-2 py-1.5 text-xs"
            />
            <div className="flex gap-2">
              <DecideBtn
                label={`Record ${amount ? fmt(Number(amount) || 0, 0) : ""} ETB`}
                tone="green"
                busy={busy}
                disabled={!(Number(amount) > 0)}
                onClick={save}
              />
              <DecideBtn
                label="Paid in full"
                tone="blue"
                busy={busy}
                onClick={() => setAmount(String(row.outstanding))}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────── 4. WHT holders ───────────────────────────── */

/** The gateway's live settings. The key itself is never sent — only its shape. */
interface SmsDiagnostics {
  configured: boolean;
  endpoint: string;
  keyLength: number;
  keyTail: string | null;
  keyWasWrapped: boolean;
  sender: string | null;
  senderRaw: string;
}

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
  /** What happened to the SMS that registration sends — separate from `error`,
   *  because "registered, but the text failed" is not a failed registration. */
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState({ company: "", phone: "", description: "" });
  const [saving, setSaving] = useState(false);
  /** What the gateway will actually use — key shape, sender, endpoint. */
  const [sms, setSms] = useState<SmsDiagnostics | null>(null);
  const [testTo, setTestTo] = useState("");
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/finance/wht");
      const d = res.ok ? await res.json() : { rows: [] };
      setRows(Array.isArray(d.rows) ? d.rows : []);
      setSmsConfigured(d.smsConfigured !== false);
      setSms(d.sms ?? null);
    } catch {
      setRows([]);
    }
  }, []);

  /** One test message, so the gateway is proved before a customer needs it. */
  const testSms = async () => {
    setTesting(true);
    setNotice("");
    setError("");
    try {
      const res = await fetch("/api/finance/wht", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: testTo }),
      });
      const d = await res.json().catch(() => ({}));
      setSms(d.sms ?? null);
      if (d.ok) setNotice(`Queued to ${d.to}. The handset sends it when it next has internet.`);
      else setError(d.error || "The test message did not go.");
    } finally {
      setTesting(false);
    }
  };

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
    setNotice("");
    try {
      const res = await fetch("/api/finance/wht", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || "Could not register that holder.");
        return;
      }
      // The first chase goes out on registration, not at the next morning's
      // cron. Saying so here is the only place the person registering finds out
      // it failed — otherwise a dead gateway is discovered days later, by which
      // point nobody has been chased at all.
      setNotice(
        body.sms?.sent
          ? "Registered. The first SMS has been queued — the handset sends it when it next has internet."
          : body.sms?.error
          ? `Registered, but the SMS did not go: ${body.sms.error}`
          : "Registered."
      );
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
          The SMS gateway is not configured, so nobody is being chased. Set HTTPSMS_API_KEY and
          PHONE_NUMBER on Vercel (PHONE_NUMBER must be the number registered in the httpSMS app).
        </p>
      )}

      {/* The gateway's own settings, and a way to prove them. httpSMS answers a
          wrong key with a message that reads as though the header were missing,
          so the only way to tell a wrong key from a missing one is to see what
          is actually being sent. */}
      {sms && (
        <div className="card space-y-2 p-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400">SMS gateway</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
            <dt className="text-stone-400">API key</dt>
            <dd className={`tabular-nums ${sms.keyLength > 0 ? "text-stone-700" : "text-red-600 font-bold"}`}>
              {sms.keyLength > 0 ? `${sms.keyLength} chars · ends “${sms.keyTail}”` : "not set"}
              {sms.keyWasWrapped && (
                <span className="ml-1 text-amber-700">· quotes/prefix stripped</span>
              )}
            </dd>
            <dt className="text-stone-400">Sender</dt>
            <dd className={sms.sender ? "text-stone-700" : "text-red-600 font-bold"}>
              {sms.sender || `unusable: ${sms.senderRaw || "not set"}`}
            </dd>
            <dt className="text-stone-400">Endpoint</dt>
            <dd className="break-all text-stone-500">{sms.endpoint}</dd>
          </dl>
          <div className="flex gap-2">
            <input
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder={sms.sender ? `Test number (default ${sms.sender})` : "Test number"}
              className="min-w-0 flex-1 rounded-lg border border-stone-200 px-2 py-1.5 text-xs"
            />
            <button
              onClick={testSms}
              disabled={testing}
              className="shrink-0 rounded-lg bg-clay-700 px-3 py-1.5 text-xs font-bold text-white disabled:bg-stone-200 disabled:text-stone-400"
            >
              {testing ? "…" : "Send test"}
            </button>
          </div>
          <p className="text-[10px] text-stone-400">
            A test never claims a customer&apos;s daily slot, so it cannot stop a real chase going out.
          </p>
        </div>
      )}
      {error && <p className="card border-l-4 border-l-red-500 p-3 text-xs font-bold text-red-700">{error}</p>}
      {notice && (
        <p className="card border-l-4 border-l-clay-400 p-3 text-xs font-bold text-stone-700">{notice}</p>
      )}

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


/* ───────────────────────── 5. Bank cash collection ────────────────────────── */

interface BankMonth {
  month: string;
  banks: Record<string, number>;
  counts: Record<string, number>;
  total: number;
  sales: number;
}

interface BankSale {
  date: string;
  customer: string;
  deliveryNo: string | null;
  bank: string;
  cash: number;
}

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const monthName = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return `${MONTH_NAMES[(mo || 1) - 1]} ${y}`;
};

/**
 * Cash in through each bank, month by month — worked out from the sales report.
 *
 * Every sale already records its cash and the bank it was deposited in, so
 * this is a sum of what is on record rather than a second sheet filed once a
 * month that could disagree with it. Months down the page and banks across,
 * because the question is "is CBE still carrying most of it", read down a
 * column. Tap a month to see the sales behind its figures.
 */
function BankCollectionsTab() {
  const [data, setData] = useState<{ months: BankMonth[]; banks: string[]; unavailable?: boolean } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [sales, setSales] = useState<BankSale[] | null>(null);

  useEffect(() => {
    fetch("/api/finance/bank-collections")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d ?? { months: [], banks: [] }))
      .catch(() => setData({ months: [], banks: [] }));
  }, []);

  useEffect(() => {
    if (!open) return;
    setSales(null);
    fetch(`/api/finance/bank-collections?month=${open}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setSales(Array.isArray(d?.sales) ? d.sales : []))
      .catch(() => setSales([]));
  }, [open]);

  if (!data) return <div className="card h-56 animate-pulse bg-clay-50" />;

  const { months, banks } = data;
  const byBank = (rows: BankSale[]) => {
    const map = new Map<string, BankSale[]>();
    for (const r of rows) map.set(r.bank, [...(map.get(r.bank) ?? []), r]);
    return banks.filter((b) => map.has(b)).map((b) => [b, map.get(b)!] as const);
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
        <h2 className="font-display text-lg font-bold">🏦 Bank collections</h2>
        <p className="text-[11px] text-stone-400">ETB · cash, by deposit bank · from the sales report</p>
      </div>
      <p className="px-1 text-[11px] text-stone-500">
        Each sale&rsquo;s cash, added up by the bank it was deposited in. Credit collections are not
        included — they record no bank.
      </p>

      {data.unavailable && (
        <p className="card p-3 text-xs text-amber-700">
          The sales table is not in the database yet — apply migration 0027.
        </p>
      )}

      {months.length === 0 ? (
        <p className="card p-4 text-sm text-stone-400">No cash sales in the last twelve months.</p>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[560px] text-right text-xs">
            <thead className="bg-clay-50/70 text-[10px] uppercase tracking-wide text-stone-500">
              <tr>
                <th className="p-2 text-left font-bold">Month</th>
                {banks.map((b) => (
                  <th key={b} className="p-2 font-bold">
                    {b}
                  </th>
                ))}
                <th className="p-2 font-bold">Total</th>
                <th className="p-2 font-bold">vs prev.</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m, i) => {
                // `months` is newest first, so the month before this one is the
                // NEXT row down.
                const prev = months[i + 1];
                const delta = prev ? m.total - prev.total : null;
                const isOpen = open === m.month;
                return (
                  <Fragment key={m.month}>
                    <tr
                      onClick={() => setOpen(isOpen ? null : m.month)}
                      className={`cursor-pointer border-t border-clay-50 hover:bg-clay-50/40 ${isOpen ? "bg-clay-50/60" : ""}`}
                    >
                      <td className="p-2 text-left font-semibold text-stone-800">
                        {isOpen ? "▾" : "▸"} {monthName(m.month)}
                        <span className="ml-1 text-[10px] font-normal text-stone-400">{m.sales} sales</span>
                      </td>
                      {banks.map((b) => (
                        <td key={b} className="p-2 tabular-nums text-stone-700">
                          {m.banks[b] ? fmt(m.banks[b], 0) : <span className="text-stone-300">—</span>}
                        </td>
                      ))}
                      <td className="p-2 font-bold tabular-nums text-clay-900">{fmt(m.total, 0)}</td>
                      <td
                        className={`p-2 tabular-nums ${
                          delta === null ? "text-stone-300" : delta >= 0 ? "text-green-700" : "text-amber-700"
                        }`}
                      >
                        {delta === null ? "—" : `${delta >= 0 ? "+" : ""}${fmt(delta, 0)}`}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-clay-50/30">
                        <td colSpan={banks.length + 3} className="p-3 text-left">
                          {sales === null ? (
                            <div className="h-16 animate-pulse rounded-lg bg-clay-50" />
                          ) : sales.length === 0 ? (
                            <p className="text-stone-400">No cash sales this month.</p>
                          ) : (
                            <div className="space-y-3">
                              {byBank(sales).map(([bank, rows]) => (
                                <div key={bank}>
                                  <p className="mb-1 text-[11px] font-bold text-stone-700">
                                    {bank} · {fmt(rows.reduce((a, r) => a + r.cash, 0), 0)} ETB · {rows.length} sale
                                    {rows.length === 1 ? "" : "s"}
                                  </p>
                                  <table className="w-full text-[11px]">
                                    <tbody>
                                      {rows.map((r, j) => (
                                        <tr key={j} className="border-t border-clay-50">
                                          <td className="py-1 pr-2 text-stone-500">{r.date}</td>
                                          <td className="py-1 pr-2 text-stone-700">{r.customer}</td>
                                          <td className="py-1 pr-2 text-stone-400">{r.deliveryNo ? `Fs ${r.deliveryNo}` : ""}</td>
                                          <td className="py-1 text-right tabular-nums text-stone-800">{fmt(r.cash, 0)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ───────────────────────────── 6. Purchase status ─────────────────────────── */

interface ItemPurchase {
  id: string;
  date: string;
  itemName: string;
  itemKey: string | null;
  itemLabel: string | null;
  isNew: boolean;
  qty: number;
  unit: string;
  unitPrice: number | null;
  total: number | null;
  basis: "unit" | "total" | null;
  requestId: string | null;
  requestTitle: string | null;
  note: string | null;
  reportedBy: string;
}

interface RequestRow extends PurchaseRequestRef {
  department?: string | null;
  status: string;
  requestedBy: string;
  createdAt: string;
}

const REQUEST_TONE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-blue-100 text-blue-800",
  bought: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-800",
  disregarded: "bg-stone-100 text-stone-600",
  deferred: "bg-purple-100 text-purple-700",
};

/** A request that can still be bought. */
const BUYABLE = new Set(["pending", "approved", "deferred"]);

/**
 * What was bought, and where every purchase request stands.
 *
 * Purchases come from the bot (🛍 የዕቃ ግዢ) or from the form behind ✓ Bought on
 * a request — here or in Asset Management — which records the purchase and
 * marks the request bought together. A record only: the store balance moves
 * when the GRV is filed.
 */
function PurchaseStatusTab() {
  const [purchases, setPurchases] = useState<ItemPurchase[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [buying, setBuying] = useState<RequestRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [showClosed, setShowClosed] = useState(false);

  const load = useCallback(async () => {
    const [p, r] = await Promise.all([
      fetch("/api/finance/purchases")
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null),
      fetch("/api/tool-requests")
        .then((res) => (res.ok ? res.json() : []))
        .catch(() => []),
    ]);
    setPurchases(Array.isArray(p?.rows) ? p.rows : []);
    setUnavailable(!!p?.unavailable);
    setRequests(Array.isArray(r) ? r : []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!purchases) return <div className="card h-40 animate-pulse bg-clay-50" />;

  const thisMonth = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 7);
  const monthRows = purchases.filter((p) => p.date.slice(0, 7) === thisMonth);
  const spent = monthRows.reduce((a, p) => a + (p.total ?? 0), 0);
  const byRequest = new Map<string, ItemPurchase>();
  for (const p of purchases) if (p.requestId && !byRequest.has(p.requestId)) byRequest.set(p.requestId, p);
  const open = requests.filter((r) => BUYABLE.has(r.status));
  const shownRequests = showClosed ? requests : open;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
        <h2 className="font-display text-lg font-bold">🛍 Purchase status</h2>
        <p className="text-[11px] text-stone-400">filed from the bot · 🛍 የዕቃ ግዢ · or ✓ Bought on a request</p>
      </div>

      {unavailable && (
        <p className="card border-l-4 border-l-amber-500 p-3 text-xs font-bold text-amber-800">
          Run migration 0042_item_purchases.sql in the Supabase editor — the purchases table is not there yet.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <CreditTile label="Spent this month" value={fmt(spent, 0)} suffix="ETB" tone="text-clay-900" />
        <CreditTile label="Purchases this month" value={String(monthRows.length)} tone="text-stone-800" />
        <CreditTile label="Requests open" value={String(open.length)} tone={open.length ? "text-amber-700" : "text-stone-500"} />
        <CreditTile
          label="Requests bought"
          value={String(requests.filter((r) => r.status === "bought").length)}
          tone="text-green-700"
        />
      </div>

      {/* Purchases */}
      <div className="flex items-center justify-between px-1">
        <p className="text-[11px] font-bold uppercase tracking-widest text-clay-500">Purchases</p>
        <DecideBtn label="➕ Record a purchase" tone="green" onClick={() => setAdding(true)} />
      </div>
      {purchases.length === 0 ? (
        <p className="card p-4 text-sm text-stone-400">No purchases recorded yet.</p>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[820px] text-right text-xs">
            <thead className="bg-clay-50/70 text-[10px] uppercase tracking-wide text-stone-500">
              <tr>
                <th className="p-2 text-left font-bold">Date</th>
                <th className="p-2 text-left font-bold">Item</th>
                <th className="p-2 font-bold">Qty</th>
                <th className="p-2 font-bold">Unit price</th>
                <th className="p-2 font-bold">Total</th>
                <th className="p-2 text-left font-bold">Request</th>
                <th className="p-2 text-left font-bold">By</th>
              </tr>
            </thead>
            <tbody>
              {purchases.map((p) => (
                <tr key={p.id} className="border-t border-clay-50">
                  <td className="p-2 text-left font-semibold text-stone-800">{fmtDate(p.date)}</td>
                  <td className="max-w-[260px] p-2 text-left">
                    <p className="truncate font-semibold text-stone-800">{p.itemName}</p>
                    <p className="truncate text-[10px] text-stone-400">
                      {p.itemLabel ? `🔗 ${p.itemLabel}` : p.isNew ? "🆕 new item" : "not on the store list"}
                      {p.note ? ` · ${p.note}` : ""}
                    </p>
                  </td>
                  <td className="p-2 tabular-nums text-stone-700">
                    {fmt(p.qty, 3)} <span className="text-[10px] text-stone-400">{p.unit}</span>
                  </td>
                  <td className={`p-2 tabular-nums ${p.basis === "unit" ? "text-stone-800" : "text-stone-500"}`}>
                    {fmt(p.unitPrice)}
                  </td>
                  <td className={`p-2 tabular-nums ${p.basis === "total" ? "font-bold text-clay-900" : "text-stone-700"}`}>
                    {fmt(p.total)}
                  </td>
                  <td className="max-w-[180px] truncate p-2 text-left text-stone-500">{p.requestTitle || "—"}</td>
                  <td className="p-2 text-left text-stone-500">{p.reportedBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Purchase requests, from Asset Management */}
      <div className="flex items-center justify-between px-1 pt-2">
        <p className="text-[11px] font-bold uppercase tracking-widest text-clay-500">Purchase requests</p>
        <label className="flex items-center gap-1.5 text-[11px] text-stone-500">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
          Show bought / closed
        </label>
      </div>
      {shownRequests.length === 0 ? (
        <p className="card p-4 text-sm text-stone-400">
          {requests.length === 0 ? "No purchase requests yet." : "No request is waiting to be bought."}
        </p>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[820px] text-right text-xs">
            <thead className="bg-clay-50/70 text-[10px] uppercase tracking-wide text-stone-500">
              <tr>
                <th className="p-2 text-left font-bold">Asked</th>
                <th className="p-2 text-left font-bold">Item</th>
                <th className="p-2 text-left font-bold">Department</th>
                <th className="p-2 font-bold">Qty</th>
                <th className="p-2 text-left font-bold">By</th>
                <th className="p-2 text-left font-bold">Status</th>
                <th className="p-2 font-bold">Bought</th>
              </tr>
            </thead>
            <tbody>
              {shownRequests.map((r) => {
                const bought = byRequest.get(r._id);
                return (
                  <tr key={r._id} className="border-t border-clay-50">
                    <td className="p-2 text-left font-semibold text-stone-800">{fmtDate(r.createdAt)}</td>
                    <td className="max-w-[220px] truncate p-2 text-left font-semibold text-stone-700">{r.title}</td>
                    <td className="p-2 text-left text-stone-500">{purchaseDeptLabel(r.department)}</td>
                    <td className="p-2 tabular-nums text-stone-700">
                      {r.quantity ?? ""}
                      {r.unit && <span className="ml-1 text-[10px] text-stone-400">{r.unit}</span>}
                    </td>
                    <td className="p-2 text-left text-stone-500">{r.requestedBy}</td>
                    <td className="p-2 text-left">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          REQUEST_TONE[r.status] || "bg-stone-100 text-stone-600"
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="p-2">
                      {bought ? (
                        <span className="text-[11px] text-stone-600">
                          {fmtDate(bought.date)} · <b className="tabular-nums">{fmt(bought.total, 0)} ETB</b>
                        </span>
                      ) : BUYABLE.has(r.status) ? (
                        <DecideBtn label="✓ Bought" tone="green" onClick={() => setBuying(r)} />
                      ) : (
                        <span className="text-stone-300">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {buying && <PurchaseForm request={buying} onClose={() => setBuying(null)} onSaved={load} />}
      {adding && <PurchaseForm onClose={() => setAdding(false)} onSaved={load} />}
    </section>
  );
}
