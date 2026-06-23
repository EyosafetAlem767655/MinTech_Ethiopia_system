"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

interface ReceiptRow {
  _id: string;
  vendor: string;
  client?: string;
  amount: number;
  category?: string;
  receiptDate?: string;
  taxInvoiceNumber?: string;
  photoFileId?: string;
  submittedBy: string;
  source: "app" | "telegram";
  createdAt: string;
}

interface MonthlyReport {
  month: string;
  sacksSold: number;
  revenueInvoiced: number;
  cashCollected: number;
  receiptExpenses: number;
  netCash: number;
  invoiceCount: number;
  receiptCount: number;
  paymentCount: number;
  topClients: { client: string; amount: number; sacks: number }[];
  expenseCategories: { category: string; amount: number; count: number }[];
}

interface ReceiptsData {
  receipts: ReceiptRow[];
  monthly: MonthlyReport;
}

const fmtETB = (n: number) => `ETB ${Math.round(n || 0).toLocaleString()}`;

export default function ReceiptsPage() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [data, setData] = useState<ReceiptsData | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/receipts?month=${month}`);
    if (res.ok) setData(await res.json());
  }, [month]);

  useEffect(() => {
    load();
  }, [load]);

  const monthly = data?.monthly;
  const receipts = useMemo(() => data?.receipts || [], [data]);

  return (
    <main className="max-w-6xl mx-auto px-4 pb-8">
      <header className="hero-gradient -mx-4 px-5 pb-7 pt-10 text-white sm:mx-0 sm:mt-4 sm:rounded-2xl">
        <p className="text-xs font-bold tracking-[0.24em] uppercase text-clay-100">M4</p>
        <h1 className="font-display text-2xl font-bold">Receipt Inbox & Monthly Sales Report</h1>
        <p className="mt-1 text-sm text-clay-100/90">Telegram receipt intake, payment evidence and monthly financials.</p>
      </header>

      <section className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between">
        <label className="text-xs font-bold uppercase tracking-widest text-stone-500">
          Month
          <input
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            type="month"
            className="mt-1 w-full max-w-xs rounded-xl border border-clay-200 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-clay-500"
          />
        </label>
      </section>

      {monthly && (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Metric label="Revenue" value={fmtETB(monthly.revenueInvoiced)} />
          <Metric label="Collected" value={fmtETB(monthly.cashCollected)} />
          <Metric label="Receipts" value={fmtETB(monthly.receiptExpenses)} />
          <Metric label="Net cash" value={fmtETB(monthly.netCash)} />
          <Metric label="Sacks sold" value={monthly.sacksSold.toLocaleString()} />
        </section>
      )}

      <section className="grid gap-4 py-5 lg:grid-cols-[0.72fr_1.28fr]">
        {monthly && (
          <div className="rounded-xl border border-stone-200 bg-white p-4">
            <h2 className="font-display text-base font-bold text-ink">Monthly mix</h2>
            <div className="mt-3 space-y-3">
              <ReportList title="Top clients" rows={monthly.topClients.map((r) => [r.client, fmtETB(r.amount)])} />
              <ReportList title="Expense categories" rows={monthly.expenseCategories.map((r) => [r.category, fmtETB(r.amount)])} />
            </div>
          </div>
        )}

        <div className="rounded-xl border border-stone-200 bg-white">
          <div className="flex items-center justify-between border-b border-stone-100 p-4">
            <h2 className="font-display text-base font-bold text-ink">Inbox</h2>
            <span className="text-xs font-semibold text-stone-400">{receipts.length} receipts</span>
          </div>
          <div className="divide-y divide-stone-100">
            {receipts.map((receipt) => (
              <article key={receipt._id} className="flex gap-3 p-4">
                {receipt.photoFileId ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/files/${receipt.photoFileId}`} alt="" className="h-16 w-16 rounded-lg object-cover" />
                ) : (
                  <div className="grid h-16 w-16 shrink-0 place-items-center rounded-lg bg-violet-50 text-xs font-bold text-violet-700">
                    OCR
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="truncate text-sm font-bold text-stone-900">{receipt.vendor}</h3>
                      <p className="text-xs text-stone-500">
                        {receipt.category || "Uncategorized"} via {receipt.source}
                      </p>
                    </div>
                    <span className="shrink-0 font-display text-sm font-bold text-violet-700">{fmtETB(receipt.amount)}</span>
                  </div>
                  <p className="mt-1 text-xs text-stone-400">
                    {receipt.receiptDate ? new Date(receipt.receiptDate).toLocaleDateString() : "No date"}
                    {receipt.client ? ` - ${receipt.client}` : ""}
                  </p>
                </div>
              </article>
            ))}
            {!data && <p className="p-6 text-center text-sm text-stone-400">Loading receipts...</p>}
            {data && receipts.length === 0 && <p className="p-6 text-center text-sm text-stone-400">No receipts for this month.</p>}
          </div>
        </div>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <p className="text-xs font-bold uppercase tracking-widest text-stone-400">{label}</p>
      <p className="mt-2 font-display text-xl font-bold text-ink">{value}</p>
    </div>
  );
}

function ReportList({ title, rows }: { title: string; rows: string[][] }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-widest text-stone-400">{title}</p>
      <div className="mt-2 divide-y divide-stone-100">
        {rows.length === 0 && <p className="py-2 text-xs text-stone-400">No data.</p>}
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between py-2 text-sm">
            <span className="truncate text-stone-700">{label}</span>
            <span className="font-bold text-stone-900">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
