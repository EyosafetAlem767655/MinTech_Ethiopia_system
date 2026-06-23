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
  const [busy, setBusy] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/invoices");
    if (res.ok) setData(await res.json());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    const form = new FormData(e.currentTarget);
    const body = Object.fromEntries(form.entries());
    const res = await fetch("/api/invoices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(json.error || "Could not save invoice");
      return;
    }
    e.currentTarget.reset();
    load();
  };

  const patchInvoice = async (id: string, body: Record<string, unknown>) => {
    setBusy(id);
    const res = await fetch(`/api/invoices/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy("");
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(json.error || "Invoice action failed");
    }
    load();
  };

  const field =
    "w-full rounded-xl border border-clay-200 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-clay-500";
  const invoices = data?.invoices || [];
  const overdueTotal = data?.receivables.overdueClients.reduce((sum, row) => sum + row.outstanding, 0) || 0;

  return (
    <main className="max-w-6xl mx-auto px-4 pb-8">
      <header className="hero-gradient -mx-4 px-5 pb-7 pt-10 text-white sm:mx-0 sm:mt-4 sm:rounded-2xl">
        <p className="text-xs font-bold tracking-[0.24em] uppercase text-clay-100">M3</p>
        <h1 className="font-display text-2xl font-bold">Receivables & Withholding Tracker</h1>
        <p className="mt-1 text-sm text-clay-100/90">Accountant panel with SMS reminders and 3% WHT tracking.</p>
      </header>

      <section className="grid gap-3 py-5 sm:grid-cols-3">
        <Metric label="Overdue" value={fmtETB(overdueTotal)} tone="text-red-700" />
        <Metric label="Missing WHT receipts" value={String(data?.missingWithholding.length || 0)} tone="text-amber-700" />
        <Metric label="Open invoices" value={String(invoices.filter((i) => i.outstanding > 0).length)} tone="text-sky-700" />
      </section>

      <section className="grid gap-4 lg:grid-cols-[0.72fr_1.28fr]">
        <div className="space-y-4">
          <form onSubmit={submit} className="rounded-xl border border-clay-100 bg-white p-4">
            <h2 className="font-display text-base font-bold text-ink">New invoice</h2>
            <div className="mt-4 space-y-3">
              <input name="invoiceNumber" required placeholder="Invoice number" className={field} />
              <input name="client" required placeholder="Client" className={field} />
              <input name="clientPhone" placeholder="Client phone for SMS" className={field} />
              <div className="grid grid-cols-2 gap-3">
                <input name="sacks" type="number" min={0} placeholder="Sacks" className={field} />
                <input name="amount" required type="number" min={1} placeholder="Amount ETB" className={field} />
              </div>
              <label className="block text-xs font-bold text-stone-500">
                Due date
                <input name="dueDate" required type="date" className={`${field} mt-1`} />
              </label>
              {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
              <button disabled={saving} className="w-full rounded-xl bg-clay-700 py-3 text-sm font-bold text-white disabled:opacity-50">
                {saving ? "Saving..." : "Save invoice"}
              </button>
            </div>
          </form>

          {data && (
            <div className="rounded-xl border border-stone-200 bg-white p-4">
              <p className="text-xs font-bold uppercase tracking-widest text-stone-500">Aging</p>
              <AgingChart buckets={data.receivables.buckets} />
            </div>
          )}
        </div>

        <div className="rounded-xl border border-stone-200 bg-white">
          <div className="flex items-center justify-between border-b border-stone-100 p-4">
            <h2 className="font-display text-base font-bold text-ink">Invoices</h2>
            <span className="text-xs font-semibold text-stone-400">{invoices.length} records</span>
          </div>
          <div className="divide-y divide-stone-100">
            {invoices.map((invoice) => (
              <article key={invoice._id} className="p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
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
                  <div className="flex flex-wrap gap-2">
                    {invoice.outstanding > 0 && (
                      <button
                        disabled={busy === invoice._id}
                        onClick={() => {
                          const amount = Number(window.prompt("Payment amount (ETB):", String(invoice.outstanding)) || 0);
                          if (amount > 0) patchInvoice(invoice._id, { action: "add_payment", amount, method: "bank" });
                        }}
                        className="rounded-lg bg-green-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                      >
                        Add payment
                      </button>
                    )}
                    <button
                      disabled={busy === invoice._id}
                      onClick={() => patchInvoice(invoice._id, { action: "mark_wht", received: !invoice.withholdingReceiptReceived })}
                      className="rounded-lg bg-amber-100 px-3 py-2 text-xs font-bold text-amber-800 disabled:opacity-50"
                    >
                      {invoice.withholdingReceiptReceived ? "Undo WHT" : "Mark WHT"}
                    </button>
                    {invoice.outstanding > 0 && (
                      <button
                        disabled={busy === invoice._id}
                        onClick={() => {
                          const phone = window.prompt("SMS number:", invoice.clientPhone || "");
                          if (phone) patchInvoice(invoice._id, { action: "send_sms", to: phone });
                        }}
                        className="rounded-lg bg-sky-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                      >
                        SMS
                      </button>
                    )}
                  </div>
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
