"use client";

import { useCallback, useEffect, useState } from "react";
import AgingChart from "@/components/AgingChart";

interface InvoiceRow {
  _id: string;
  invoiceNumber: string;
  client: string;
  clientPhone: string;
  sacks: number;
  amount: number;
  paid: number;
  outstanding: number;
  daysOverdue: number;
  dueDate: string;
  withholdingReceiptReceived: boolean;
  reminders: { channel: "sms"; to: string; sentAt: string; status: string }[];
}

interface ReceivablesData {
  invoices: InvoiceRow[];
  receivables: {
    buckets: { current: number; d1_30: number; d31_60: number; d61_90: number; d90_plus: number };
    overdueClients: { client: string; invoiceNumber: string; outstanding: number; daysOverdue: number }[];
  };
  missingWithholding: { _id: string }[];
}

const fmtETB = (n: number) => `ETB ${Math.round(n || 0).toLocaleString()}`;

export default function ReceivablesPage() {
  const [data, setData] = useState<ReceivablesData | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/invoices");
    if (res.ok) setData(await res.json());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const invoices = data?.invoices || [];
  const open = invoices.filter((i) => i.outstanding > 0);
  const overdueTotal = data?.receivables.overdueClients.reduce((sum, row) => sum + row.outstanding, 0) || 0;
  const missingWht = invoices.filter((i) => i.paid > 0 && !i.withholdingReceiptReceived);

  return (
    <main className="max-w-6xl mx-auto px-4 pb-8">
      <header className="hero-gradient -mx-4 px-5 pb-7 pt-10 text-white sm:mx-0 sm:mt-4 sm:rounded-2xl">
        <p className="text-xs font-bold tracking-[0.24em] uppercase text-clay-100">M3</p>
        <h1 className="font-display text-2xl font-bold">Receivables & Withholding Tracker</h1>
        <p className="mt-1 text-sm text-clay-100/90">Accountant oversight for payments, overdue clients and 3% WHT receipts.</p>
      </header>

      <section className="grid gap-3 py-5 sm:grid-cols-3">
        <Metric label="Overdue" value={fmtETB(overdueTotal)} tone="text-red-700" />
        <Metric label="Missing WHT receipts" value={String(missingWht.length)} tone="text-amber-700" />
        <Metric label="Open invoices" value={String(open.length)} tone="text-sky-700" />
      </section>

      <section className="grid gap-4 lg:grid-cols-[0.72fr_1.28fr]">
        <div className="space-y-4">
          {data && (
            <div className="rounded-xl border border-stone-200 bg-white p-4">
              <p className="text-xs font-bold uppercase tracking-widest text-stone-500">Aging</p>
              <AgingChart buckets={data.receivables.buckets} />
            </div>
          )}

          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <h2 className="font-display text-base font-bold text-amber-950">WHT gaps</h2>
            <div className="mt-3 divide-y divide-amber-100">
              {missingWht.slice(0, 12).map((invoice) => (
                <div key={invoice._id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="font-semibold text-amber-950">{invoice.invoiceNumber}</span>
                  <span className="truncate text-amber-800">{invoice.client}</span>
                </div>
              ))}
              {missingWht.length === 0 && <p className="py-4 text-sm text-amber-800">No missing WHT receipts.</p>}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-stone-200 bg-white">
          <div className="flex items-center justify-between border-b border-stone-100 p-4">
            <h2 className="font-display text-base font-bold text-ink">Invoices</h2>
            <span className="text-xs font-semibold text-stone-400">{invoices.length} records</span>
          </div>
          <div className="divide-y divide-stone-100">
            {invoices.map((invoice) => (
              <article key={invoice._id} className="p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-bold text-stone-900">{invoice.invoiceNumber}</h3>
                      <Badge ok={invoice.outstanding <= 0} label={invoice.outstanding <= 0 ? "paid" : `${invoice.daysOverdue}d overdue`} />
                      <Badge ok={invoice.withholdingReceiptReceived} label={invoice.withholdingReceiptReceived ? "WHT received" : "WHT missing"} />
                    </div>
                    <p className="mt-1 text-sm text-stone-600">{invoice.client}</p>
                    <p className="mt-1 text-xs text-stone-500">
                      {fmtETB(invoice.amount)} invoiced, {fmtETB(invoice.paid)} paid, {fmtETB(invoice.outstanding)} outstanding
                    </p>
                    {invoice.reminders?.length > 0 && (
                      <p className="mt-1 text-[11px] font-semibold text-stone-400">
                        Last SMS: {invoice.reminders[invoice.reminders.length - 1].status}
                      </p>
                    )}
                  </div>
                  <p className="text-[11px] font-semibold text-stone-400">Due {new Date(invoice.dueDate).toLocaleDateString()}</p>
                </div>
              </article>
            ))}
            {!data && <p className="p-6 text-center text-sm text-stone-400">Loading invoices...</p>}
            {data && invoices.length === 0 && <p className="p-6 text-center text-sm text-stone-400">No invoices yet.</p>}
          </div>
        </div>
      </section>
    </main>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <p className="text-xs font-bold uppercase tracking-widest text-stone-400">{label}</p>
      <p className={`mt-2 font-display text-2xl font-bold ${tone}`}>{value}</p>
    </div>
  );
}

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${ok ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
      {label}
    </span>
  );
}
