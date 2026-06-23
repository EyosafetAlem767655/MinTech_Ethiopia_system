"use client";

import { useCallback, useEffect, useState } from "react";

interface PurchaseRequest {
  _id: string;
  title: string;
  amount: number;
  requestedBy: string;
  justification?: string;
  source: "app" | "telegram";
  status: "pending" | "approved" | "rejected";
  decidedBy?: string;
  decidedAt?: string;
  createdAt: string;
}

const fmtETB = (n: number) => `ETB ${Math.round(n || 0).toLocaleString()}`;

export default function PurchasesPage() {
  const [requests, setRequests] = useState<PurchaseRequest[]>([]);

  const load = useCallback(async () => {
    const res = await fetch("/api/purchase-requests");
    if (res.ok) setRequests(await res.json());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const pending = requests.filter((r) => r.status === "pending");
  const approved = requests.filter((r) => r.status === "approved");
  const rejected = requests.filter((r) => r.status === "rejected");

  return (
    <main className="max-w-4xl mx-auto px-4 pb-8">
      <header className="hero-gradient -mx-4 px-5 pb-7 pt-10 text-white sm:mx-0 sm:mt-4 sm:rounded-2xl">
        <p className="text-xs font-bold tracking-[0.24em] uppercase text-clay-100">M2</p>
        <h1 className="font-display text-2xl font-bold">Purchase Request Trust Loop</h1>
        <p className="mt-1 text-sm text-clay-100/90">Telegram intake, evidence, and decision visibility.</p>
      </header>

      <section className="grid gap-3 py-5 sm:grid-cols-3">
        <Metric label="Pending" value={String(pending.length)} tone="text-amber-700" />
        <Metric label="Approved" value={String(approved.length)} tone="text-green-700" />
        <Metric label="Rejected" value={String(rejected.length)} tone="text-stone-700" />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Panel title="Awaiting owner decision" count={pending.length} tone="border-amber-200 bg-amber-50">
          <RequestList requests={pending} />
        </Panel>
        <Panel title="Decision history" count={approved.length + rejected.length}>
          <RequestList requests={[...approved, ...rejected].slice(0, 30)} />
        </Panel>
      </section>
    </main>
  );
}

function RequestList({ requests }: { requests: PurchaseRequest[] }) {
  if (requests.length === 0) return <p className="py-6 text-center text-sm text-stone-400">No requests.</p>;

  return (
    <div className="divide-y divide-stone-100">
      {requests.map((request) => (
        <article key={request._id} className="py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-bold text-stone-900">{request.title}</h3>
                <span className={statusClass(request.status)}>{request.status}</span>
              </div>
              <p className="text-xs text-stone-500">
                {fmtETB(request.amount)} by {request.requestedBy} via {request.source}
              </p>
              {request.justification && <p className="mt-1 text-xs leading-relaxed text-stone-600">{request.justification}</p>}
              <p className="mt-1 text-[11px] font-semibold text-stone-400">
                {new Date(request.createdAt).toLocaleDateString()}
                {request.decidedAt ? ` - decided ${new Date(request.decidedAt).toLocaleDateString()}` : ""}
              </p>
            </div>
          </div>
        </article>
      ))}
    </div>
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

function Panel({
  title,
  count,
  tone = "border-stone-200 bg-white",
  children,
}: {
  title: string;
  count: number;
  tone?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-xl border p-4 ${tone}`}>
      <div className="flex items-center justify-between">
        <h2 className="font-display text-base font-bold text-ink">{title}</h2>
        <span className="rounded-full bg-stone-900 px-2.5 py-1 text-xs font-bold text-white">{count}</span>
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function statusClass(status: PurchaseRequest["status"]) {
  const base = "rounded-full px-2.5 py-1 text-[11px] font-bold";
  if (status === "approved") return `${base} bg-green-100 text-green-700`;
  if (status === "rejected") return `${base} bg-stone-200 text-stone-700`;
  return `${base} bg-amber-100 text-amber-800`;
}
