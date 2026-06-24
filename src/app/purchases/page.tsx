"use client";

import { useCallback, useEffect, useState } from "react";

interface LegitimacyInfo {
  score: number;
  flags: string[];
  reasoning: string;
}

interface PurchaseRequest {
  _id: string;
  title: string;
  amount: number;
  requestedBy: string;
  justification?: string;
  source: "app" | "telegram";
  status: "pending" | "approved" | "rejected" | "bought" | "disregarded" | "deferred";
  decidedBy?: string;
  decidedAt?: string;
  legitimacy?: LegitimacyInfo;
  createdAt: string;
}

const fmtETB = (n: number) => `ETB ${Math.round(n || 0).toLocaleString()}`;
const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-blue-100 text-blue-800",
  rejected: "bg-stone-200 text-stone-600",
  bought: "bg-green-100 text-green-800",
  disregarded: "bg-stone-100 text-stone-500",
  deferred: "bg-purple-100 text-purple-700",
};

const DECIDED_STATUSES = new Set(["approved", "rejected", "bought", "disregarded"]);
const OPEN_STATUSES = new Set(["pending", "deferred"]);

export default function PurchasesPage() {
  const [requests, setRequests] = useState<PurchaseRequest[]>([]);
  const [deciding, setDeciding] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState<"open" | "all" | "history">("open");

  const load = useCallback(async () => {
    const res = await fetch("/api/purchase-requests");
    if (res.ok) setRequests(await res.json());
  }, []);

  useEffect(() => { load(); }, [load]);

  const decide = useCallback(async (id: string, action: string) => {
    setDeciding((p) => ({ ...p, [id]: true }));
    try {
      await fetch(`/api/purchase-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      await load();
    } finally {
      setDeciding((p) => ({ ...p, [id]: false }));
    }
  }, [load]);

  const open = requests.filter((r) => OPEN_STATUSES.has(r.status));
  const history = requests.filter((r) => DECIDED_STATUSES.has(r.status));
  const visible = filter === "open" ? open : filter === "history" ? history : requests;

  const counts = {
    pending: requests.filter((r) => r.status === "pending").length,
    bought: requests.filter((r) => r.status === "bought").length,
    disregarded: requests.filter((r) => r.status === "disregarded").length,
    deferred: requests.filter((r) => r.status === "deferred").length,
  };

  return (
    <main className="max-w-4xl mx-auto px-4 pb-10">
      <header className="hero-gradient -mx-4 px-5 pb-7 pt-10 text-white sm:mx-0 sm:mt-4 sm:rounded-2xl">
        <p className="text-xs font-bold tracking-[0.24em] uppercase text-clay-100">M2</p>
        <h1 className="font-display text-2xl font-bold">Purchase Request Trust Loop</h1>
        <p className="mt-1 text-sm text-clay-100/90">Telegram intake · AI legitimacy · Decision history</p>
      </header>

      {/* ── Metrics ── */}
      <section className="grid grid-cols-2 gap-3 py-5 sm:grid-cols-4">
        <Metric label="Awaiting" value={counts.pending} tone="text-amber-700" />
        <Metric label="Bought" value={counts.bought} tone="text-green-700" />
        <Metric label="Disregarded" value={counts.disregarded} tone="text-stone-500" />
        <Metric label="Deferred" value={counts.deferred} tone="text-purple-600" />
      </section>

      {/* ── Filter tabs ── */}
      <div className="flex gap-1.5 mb-4">
        {(["open", "history", "all"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full text-xs font-bold capitalize transition-all ${
              filter === f ? "bg-clay-700 text-white" : "bg-stone-100 text-stone-600"
            }`}
          >
            {f === "open" ? `Open (${open.length})` : f === "history" ? `History (${history.length})` : `All (${requests.length})`}
          </button>
        ))}
      </div>

      {/* ── Request list ── */}
      {visible.length === 0 && (
        <p className="py-12 text-center text-sm text-stone-400">
          {filter === "open" ? "Nothing waiting for a decision. 🎉" : "No requests here."}
        </p>
      )}

      <div className="space-y-3">
        {visible.map((pr) => (
          <div
            key={pr._id}
            className={`rounded-2xl border bg-white p-4 shadow-sm ${
              OPEN_STATUSES.has(pr.status) ? "border-amber-200" : "border-stone-100"
            }`}
          >
            {/* Header row */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-bold text-stone-900">{pr.title}</h3>
                  <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold capitalize ${STATUS_STYLES[pr.status] || "bg-stone-100 text-stone-500"}`}>
                    {pr.status}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-stone-500">
                  {fmtETB(pr.amount)} · by <span className="font-semibold">{pr.requestedBy}</span> · {pr.source} · {fmtDate(pr.createdAt)}
                </p>
                {pr.justification && (
                  <p className="mt-1 text-xs leading-relaxed text-stone-600">{pr.justification}</p>
                )}
              </div>
            </div>

            {/* Legitimacy badge */}
            {pr.legitimacy && (
              <div className="mt-2">
                <LegitimacyBar score={pr.legitimacy.score} reasoning={pr.legitimacy.reasoning} flags={pr.legitimacy.flags} />
              </div>
            )}

            {/* Decision record */}
            {pr.decidedBy && pr.decidedAt && (
              <p className="mt-2 text-[11px] text-stone-400 font-medium">
                {pr.status === "bought" ? "Purchased" : pr.status === "disregarded" ? "Disregarded" : "Decided"} by{" "}
                <span className="font-semibold text-stone-600">{pr.decidedBy}</span> on {fmtDate(pr.decidedAt)}
              </p>
            )}

            {/* Decision buttons (only for open items) */}
            {OPEN_STATUSES.has(pr.status) && (
              <div className="mt-3 flex flex-wrap gap-2">
                <ActionBtn label="✓ Bought" color="green" loading={!!deciding[pr._id]} onClick={() => decide(pr._id, "bought")} />
                <ActionBtn label="✗ Disregard" color="red" loading={!!deciding[pr._id]} onClick={() => decide(pr._id, "disregarded")} />
                <ActionBtn label="⏸ Defer" color="purple" loading={!!deciding[pr._id]} onClick={() => decide(pr._id, "defer")} />
                <ActionBtn label="✓ Approve only" color="blue" loading={!!deciding[pr._id]} onClick={() => decide(pr._id, "approve")} />
              </div>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <p className="text-xs font-bold uppercase tracking-widest text-stone-400">{label}</p>
      <p className={`mt-1 font-display text-2xl font-bold ${tone}`}>{value}</p>
    </div>
  );
}

function LegitimacyBar({ score, reasoning, flags }: { score: number; reasoning: string; flags: string[] }) {
  const color = score >= 75 ? "bg-green-500" : score >= 50 ? "bg-amber-400" : "bg-red-500";
  const label = score >= 75 ? "High legitimacy" : score >= 50 ? "Review needed" : "Suspicious";
  const textColor = score >= 75 ? "text-green-700" : score >= 50 ? "text-amber-700" : "text-red-700";
  return (
    <div className="rounded-xl bg-stone-50 p-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className={`text-[11px] font-bold ${textColor}`}>AI legitimacy · {score}% · {label}</span>
      </div>
      <div className="h-2 rounded-full bg-stone-200 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${score}%` }} />
      </div>
      {reasoning && <p className="mt-1.5 text-[11px] text-stone-500 leading-snug">{reasoning}</p>}
      {flags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {flags.map((f) => (
            <span key={f} className="rounded bg-stone-200 px-1.5 py-0.5 text-[10px] font-mono text-stone-600">{f}</span>
          ))}
        </div>
      )}
    </div>
  );
}

const BTN_COLORS: Record<string, string> = {
  green: "bg-green-600 hover:bg-green-700 text-white",
  red: "bg-red-500 hover:bg-red-600 text-white",
  blue: "bg-blue-600 hover:bg-blue-700 text-white",
  purple: "bg-purple-600 hover:bg-purple-700 text-white",
};

function ActionBtn({ label, color, loading, onClick }: { label: string; color: string; loading: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition-all active:scale-95 disabled:opacity-50 ${BTN_COLORS[color]}`}
    >
      {loading ? "…" : label}
    </button>
  );
}
