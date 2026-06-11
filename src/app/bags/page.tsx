"use client";

import { useCallback, useEffect, useState } from "react";

interface Lot {
  _id: string;
  lotCode: string;
  supplier: string;
  bagType: string;
  quantity: number;
  deliveryNote: string;
  handlers: string[];
  photoIds: string[];
  balance?: {
    received: number;
    filled: number;
    damagedVerified: number;
    damagedPending: number;
    inStock: number;
    gap: number;
  };
}

interface Claim {
  _id: string;
  lotId: { lotCode: string; supplier: string; bagType: string } | null;
  quantity: number;
  source: string;
  worker: string;
  status: string;
  flags: string[];
  gps?: { lat: number; lng: number };
  photos: {
    fileId: string;
    ai?: { damage_severity: string; suspicious: boolean; suspicion_reasons: string[]; damage_visible: boolean };
    exifCheck?: { issues: string[] };
  }[];
  cosignedBy?: string;
  disposal?: { action: string; amount?: number };
  createdAt: string;
}

interface Tripwires {
  byWorker: { key: string; qty: number; vsMeanX: number; flagged: boolean }[];
  byShift: { key: string; qty: number; vsMeanX: number; flagged: boolean }[];
  bySupplierLot: { key: string; qty: number; vsMeanX: number; flagged: boolean }[];
}

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  cosign_required: "bg-purple-100 text-purple-800",
  verified: "bg-green-100 text-green-800",
  rejected: "bg-stone-200 text-stone-600",
};

export default function BagControlPage() {
  const [lots, setLots] = useState<Lot[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [tripwires, setTripwires] = useState<Tripwires | null>(null);
  const [tab, setTab] = useState<"lots" | "claims" | "tripwires">("lots");
  const [showRegister, setShowRegister] = useState(false);
  const [busyId, setBusyId] = useState("");

  const load = useCallback(() => {
    fetch("/api/lots").then((r) => r.json()).then((d) => Array.isArray(d) && setLots(d)).catch(() => {});
    fetch("/api/claims").then((r) => r.json()).then((d) => Array.isArray(d) && setClaims(d)).catch(() => {});
    fetch("/api/dashboard").then((r) => r.json()).then((d) => d.tripwires && setTripwires(d.tripwires)).catch(() => {});
  }, []);

  useEffect(load, [load]);

  const act = async (id: string, body: Record<string, unknown>) => {
    setBusyId(id);
    await fetch(`/api/claims/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusyId("");
    load();
  };

  return (
    <main className="max-w-lg mx-auto">
      <header className="hero-gradient text-white px-5 pt-10 pb-6 rounded-b-3xl">
        <h1 className="font-display text-xl font-bold">🛡 PB Bag Control</h1>
        <p className="text-clay-100/80 text-xs mt-1">Lots, evidence-backed damage claims & reconciliation.</p>
        <a
          href="/api/export/damage-register"
          className="inline-block mt-3 text-xs font-bold bg-white/15 border border-white/25 rounded-full px-4 py-2"
        >
          📄 Export damage register (PDF)
        </a>
      </header>

      <div className="px-4 py-4">
        <div className="flex gap-1.5 bg-clay-50 rounded-full p-1 mb-4">
          {(
            [
              ["lots", `Lots (${lots.length})`],
              ["claims", `Claims (${claims.filter((c) => c.status === "pending" || c.status === "cosign_required").length})`],
              ["tripwires", "Tripwires"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`flex-1 rounded-full py-2 text-xs font-bold transition ${
                tab === k ? "bg-clay-700 text-white shadow" : "text-clay-600"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ───────────── Lots ───────────── */}
        {tab === "lots" && (
          <div className="space-y-3 stagger">
            <button
              onClick={() => setShowRegister(!showRegister)}
              className="w-full border-2 border-dashed border-clay-300 rounded-2xl py-3.5 text-clay-700 font-bold text-sm bg-clay-50/50"
            >
              {showRegister ? "✕ Close" : "＋ Register new bag lot"}
            </button>
            {showRegister && <RegisterLotForm onDone={() => { setShowRegister(false); load(); }} />}
            {lots.map((lot) => {
              const gap = lot.balance?.gap || 0;
              return (
                <div key={lot._id} className={`card p-4 ${gap > 0 ? "border-red-300 bg-red-50/50" : ""}`}>
                  <div className="flex items-center justify-between">
                    <p className="font-display font-bold text-clay-900">{lot.lotCode}</p>
                    {gap > 0 ? (
                      <span className="text-[11px] font-bold bg-red-600 text-white rounded-full px-2.5 py-1 animate-pulse">
                        🔴 {gap} unaccounted
                      </span>
                    ) : (
                      <span className="text-[11px] font-bold bg-green-100 text-green-700 rounded-full px-2.5 py-1">
                        ✓ reconciled
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-stone-500 mt-0.5">
                    {lot.supplier} · {lot.bagType} · DN {lot.deliveryNote}
                  </p>
                  <div className="grid grid-cols-4 gap-1.5 mt-3 text-center">
                    {[
                      ["Received", lot.balance?.received ?? lot.quantity],
                      ["Filled", lot.balance?.filled ?? 0],
                      ["Damaged ✓", lot.balance?.damagedVerified ?? 0],
                      ["In stock", lot.balance?.inStock ?? lot.quantity],
                    ].map(([label, v]) => (
                      <div key={label} className="rounded-lg bg-clay-50/80 py-1.5">
                        <p className="text-sm font-bold text-clay-900 tabular-nums">{v}</p>
                        <p className="text-[9px] uppercase font-bold text-stone-400">{label}</p>
                      </div>
                    ))}
                  </div>
                  {(lot.balance?.damagedPending ?? 0) > 0 && (
                    <p className="text-[11px] text-amber-700 mt-2">
                      ⏳ {lot.balance!.damagedPending} bags in pending claims
                    </p>
                  )}
                  <p className="text-[11px] text-stone-400 mt-2">👤 Handled by: {lot.handlers.join(", ") || "—"}</p>
                </div>
              );
            })}
            {lots.length === 0 && <p className="text-center text-sm text-stone-400 py-8">No lots registered yet.</p>}
          </div>
        )}

        {/* ───────────── Claims ───────────── */}
        {tab === "claims" && (
          <div className="space-y-3 stagger">
            {claims.map((c) => {
              const ai = c.photos[0]?.ai;
              return (
                <div key={c._id} className="card p-4">
                  <div className="flex items-center justify-between">
                    <p className="font-bold text-sm">
                      {c.lotId?.lotCode || "?"} · {c.quantity} bags
                    </p>
                    <span className={`text-[10px] font-bold rounded-full px-2.5 py-1 ${STATUS_STYLE[c.status] || ""}`}>
                      {c.status.replace("_", " ")}
                    </span>
                  </div>
                  <p className="text-xs text-stone-500 mt-0.5">
                    {c.worker} · via {c.source === "telegram" ? "✈️ Telegram" : "📱 App"} ·{" "}
                    {new Date(c.createdAt).toLocaleDateString()}
                    {c.gps && ` · 📍${c.gps.lat.toFixed(3)},${c.gps.lng.toFixed(3)}`}
                  </p>

                  {c.photos.length > 0 && (
                    <div className="flex gap-2 mt-2 overflow-x-auto no-scrollbar">
                      {c.photos.map((p) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={p.fileId}
                          src={`/api/files/${p.fileId}`}
                          alt="evidence"
                          className="h-20 rounded-lg object-cover"
                        />
                      ))}
                    </div>
                  )}

                  {ai && (
                    <div className={`mt-2 rounded-xl px-3 py-2 text-[11px] ${ai.suspicious ? "bg-red-50 text-red-800" : "bg-clay-50 text-clay-800"}`}>
                      🤖 AI: damage <b>{ai.damage_severity}</b>
                      {ai.suspicious && <> · ⚠️ suspicious ({ai.suspicion_reasons.join(", ")})</>}
                    </div>
                  )}
                  {c.flags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {c.flags.map((f) => (
                        <span key={f} className="text-[10px] font-bold bg-amber-100 text-amber-800 rounded-full px-2 py-0.5">
                          {f.replace(/_/g, " ")}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2 mt-3">
                    {c.status === "cosign_required" && (
                      <button
                        disabled={busyId === c._id}
                        onClick={() => act(c._id, { action: "cosign", by: promptName() })}
                        className="bg-purple-600 text-white text-xs font-bold rounded-full px-3.5 py-2 active:scale-95 disabled:opacity-50"
                      >
                        ✍️ Co-sign
                      </button>
                    )}
                    {(c.status === "pending" || c.status === "cosign_required") && (
                      <>
                        <button
                          disabled={busyId === c._id || c.status === "cosign_required"}
                          onClick={() => act(c._id, { action: "verify", by: promptName() })}
                          className="bg-green-600 text-white text-xs font-bold rounded-full px-3.5 py-2 active:scale-95 disabled:opacity-40"
                        >
                          ✓ Verify
                        </button>
                        <button
                          disabled={busyId === c._id}
                          onClick={() => act(c._id, { action: "reject", by: promptName() })}
                          className="bg-clay-100 text-clay-800 text-xs font-bold rounded-full px-3.5 py-2 active:scale-95 disabled:opacity-50"
                        >
                          ✕ Reject
                        </button>
                      </>
                    )}
                    {c.status === "verified" && !c.disposal?.action && (
                      <DisposalPicker onPick={(d) => act(c._id, { action: "disposal", disposal: d, by: promptName() })} />
                    )}
                    {c.disposal?.action && (
                      <span className="text-[11px] font-bold text-stone-500 py-2">
                        ♻️ {c.disposal.action.replace(/_/g, " ")}
                        {c.disposal.amount ? ` · ETB ${c.disposal.amount.toLocaleString()}` : ""}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
            {claims.length === 0 && <p className="text-center text-sm text-stone-400 py-8">No claims yet.</p>}
          </div>
        )}

        {/* ───────────── Tripwires ───────────── */}
        {tab === "tripwires" && tripwires && (
          <div className="space-y-4 stagger">
            {(
              [
                ["byWorker", "👷 Damage by worker (90d)"],
                ["byShift", "🕐 Damage by shift (90d)"],
                ["bySupplierLot", "🏭 Damage by supplier lot (90d)"],
              ] as const
            ).map(([key, title]) => (
              <div key={key} className="card p-4">
                <p className="text-[11px] font-bold tracking-widest uppercase text-clay-500 mb-2">{title}</p>
                {tripwires[key].length === 0 && <p className="text-xs text-stone-400">No data yet.</p>}
                {tripwires[key].map((row) => (
                  <div key={row.key} className="flex items-center justify-between py-1.5 text-xs border-t border-clay-50 first:border-t-0">
                    <span className={`font-semibold ${row.flagged ? "text-red-700" : ""}`}>
                      {row.flagged && "🚩 "}
                      {row.key}
                    </span>
                    <span className="text-stone-500">
                      {row.qty} bags · {row.vsMeanX}× mean
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function promptName(): string {
  const saved = localStorage.getItem("mt_supervisor") || "";
  const name = window.prompt("Your name (for the sign-off record):", saved) || saved || "supervisor";
  localStorage.setItem("mt_supervisor", name);
  return name;
}

function DisposalPicker({ onPick }: { onPick: (d: { action: string; amount?: number }) => void }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="bg-clay-700 text-white text-xs font-bold rounded-full px-3.5 py-2 active:scale-95"
      >
        ♻️ Assign disposal
      </button>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5 animate-fade-in">
      {[
        ["returned_to_supplier", "↩ Return to supplier"],
        ["destroyed", "🔥 Destroyed"],
      ].map(([action, label]) => (
        <button
          key={action}
          onClick={() => onPick({ action })}
          className="bg-clay-100 text-clay-800 text-[11px] font-bold rounded-full px-3 py-2"
        >
          {label}
        </button>
      ))}
      <button
        onClick={() => {
          const amount = Number(window.prompt("Scrap sale amount (ETB):") || 0);
          onPick({ action: "sold_as_scrap", amount });
        }}
        className="bg-clay-100 text-clay-800 text-[11px] font-bold rounded-full px-3 py-2"
      >
        💰 Sold as scrap
      </button>
    </div>
  );
}

function RegisterLotForm({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const field = "w-full rounded-xl border border-clay-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-clay-500 bg-white";

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/lots", { method: "POST", body: new FormData(e.currentTarget) });
    setBusy(false);
    if (res.ok) onDone();
    else setError((await res.json()).error || "Failed to register lot");
  };

  return (
    <form onSubmit={submit} className="card p-4 space-y-3 animate-scale-in">
      <input name="supplier" required placeholder="Supplier" className={field} />
      <input name="bagType" required placeholder="Bag type (e.g. PP woven 50kg)" className={field} />
      <div className="grid grid-cols-2 gap-3">
        <input name="quantity" required type="number" min={1} placeholder="Quantity" className={field} />
        <input name="deliveryNote" required placeholder="Delivery note #" className={field} />
      </div>
      <input name="registeredBy" required placeholder="Your name" className={field} />
      <div>
        <label className="text-xs font-bold text-clay-800 block mb-1.5">Photos of the stacked lot</label>
        <input name="photos" type="file" accept="image/*" capture="environment" multiple className="text-xs" />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button
        disabled={busy}
        className="w-full bg-clay-700 text-white font-bold rounded-xl py-3 text-sm disabled:opacity-50"
      >
        {busy ? "Registering…" : "Register lot"}
      </button>
    </form>
  );
}
