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
  const [busy, setBusy] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/purchase-requests");
    if (res.ok) setRequests(await res.json());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const decide = async (id: string, action: "approve" | "reject") => {
    setBusy(id);
    await fetch(`/api/purchase-requests/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, decidedBy: "Mr. Anteneh" }),
    });
    setBusy("");
    load();
  };

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    const res = await fetch("/api/purchase-requests", { method: "POST", body: new FormData(e.currentTarget) });
    setSaving(false);
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(json.error || "Could not submit request");
      return;
    }
    e.currentTarget.reset();
    load();
  };

  const pending = requests.filter((r) => r.status === "pending");
  const decided = requests.filter((r) => r.status !== "pending");
  const field =
    "w-full rounded-xl border border-clay-200 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-clay-500";

  return (
    <main className="max-w-4xl mx-auto px-4 pb-8">
      <header className="hero-gradient -mx-4 px-5 pb-7 pt-10 text-white sm:mx-0 sm:mt-4 sm:rounded-2xl">
        <p className="text-xs font-bold tracking-[0.24em] uppercase text-clay-100">M2</p>
        <h1 className="font-display text-2xl font-bold">Purchase Request Trust Loop</h1>
        <p className="mt-1 text-sm text-clay-100/90">Telegram intake, evidence, and owner approval.</p>
      </header>

      <section className="grid gap-4 py-5 lg:grid-cols-[0.85fr_1.15fr]">
        <form onSubmit={submit} className="rounded-xl border border-clay-100 bg-white p-4">
          <h2 className="font-display text-base font-bold text-ink">New request</h2>
          <div className="mt-4 space-y-3">
            <input name="title" required placeholder="Item or service" className={field} />
            <div className="grid grid-cols-2 gap-3">
              <input name="amount" required type="number" min={1} placeholder="Amount ETB" className={field} />
              <input name="requestedBy" required placeholder="Requested by" className={field} />
            </div>
            <textarea name="justification" rows={3} placeholder="Reason" className={field} />
            <input name="photo" type="file" accept="image/*" capture="environment" className="text-xs" />
            {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
            <button disabled={saving} className="w-full rounded-xl bg-clay-700 py-3 text-sm font-bold text-white disabled:opacity-50">
              {saving ? "Submitting..." : "Submit for approval"}
            </button>
          </div>
        </form>

        <div className="space-y-3">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-base font-bold text-amber-950">Awaiting owner decision</h2>
              <span className="rounded-full bg-amber-600 px-2.5 py-1 text-xs font-bold text-white">{pending.length}</span>
            </div>
            <RequestList requests={pending} busy={busy} onDecide={decide} />
          </div>

          <div className="rounded-xl border border-stone-200 bg-white p-4">
            <h2 className="font-display text-base font-bold text-ink">Decision history</h2>
            <RequestList requests={decided.slice(0, 20)} busy={busy} onDecide={decide} readOnly />
          </div>
        </div>
      </section>
    </main>
  );
}

function RequestList({
  requests,
  busy,
  readOnly,
  onDecide,
}: {
  requests: PurchaseRequest[];
  busy: string;
  readOnly?: boolean;
  onDecide: (id: string, action: "approve" | "reject") => void;
}) {
  if (requests.length === 0) return <p className="py-6 text-center text-sm text-stone-400">No requests.</p>;

  return (
    <div className="mt-3 divide-y divide-stone-100">
      {requests.map((request) => (
        <article key={request._id} className="py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-stone-900">{request.title}</h3>
              <p className="text-xs text-stone-500">
                {fmtETB(request.amount)} by {request.requestedBy} via {request.source}
              </p>
              {request.justification && <p className="mt-1 text-xs leading-relaxed text-stone-600">{request.justification}</p>}
              {readOnly && (
                <p className="mt-1 text-[11px] font-semibold text-stone-400">
                  {request.status} {request.decidedAt ? `on ${new Date(request.decidedAt).toLocaleDateString()}` : ""}
                </p>
              )}
            </div>
            {!readOnly && (
              <div className="flex shrink-0 gap-2">
                <button
                  disabled={busy === request._id}
                  onClick={() => onDecide(request._id, "approve")}
                  className="rounded-lg bg-green-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  disabled={busy === request._id}
                  onClick={() => onDecide(request._id, "reject")}
                  className="rounded-lg bg-stone-200 px-3 py-2 text-xs font-bold text-stone-700 disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
