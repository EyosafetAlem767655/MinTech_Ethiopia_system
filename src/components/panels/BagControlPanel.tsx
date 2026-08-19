"use client";

import { useCallback, useEffect, useState } from "react";
import DecideBtn from "@/components/DecideButton";

/** M1 bag inventory, evidence-backed damage claims and reconciliation. Folded
 *  into the Asset Management department page (was /bags).
 *
 *  Claims carry verify/reject buttons: the review endpoint has always existed,
 *  but nothing on this page called it, so every claim the bot filed sat at
 *  "pending" forever and never reached the verified column of a lot's balance. */

interface Lot {
  _id: string;
  lotCode: string;
  supplier: string;
  bagType: string;
  quantity: number;
  deliveryNote: string;
  handlers: string[];
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

export default function BagControlPanel() {
  const [lots, setLots] = useState<Lot[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [tripwires, setTripwires] = useState<Tripwires | null>(null);
  const [tab, setTab] = useState<"lots" | "claims" | "tripwires">("lots");
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");

  const load = useCallback(() => {
    fetch("/api/lots").then((r) => r.json()).then((d) => Array.isArray(d) && setLots(d)).catch(() => {});
    fetch("/api/claims").then((r) => r.json()).then((d) => Array.isArray(d) && setClaims(d)).catch(() => {});
    fetch("/api/dashboard").then((r) => r.json()).then((d) => d.tripwires && setTripwires(d.tripwires)).catch(() => {});
  }, []);

  useEffect(load, [load]);

  const decide = useCallback(
    async (id: string, action: "cosign" | "verify" | "reject") => {
      setBusy((b) => ({ ...b, [id]: true }));
      setError("");
      try {
        const res = await fetch(`/api/claims/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, by: "Dashboard" }),
        });
        if (!res.ok) {
          // The co-sign rule for Telegram claims is enforced server-side and
          // surfaces here rather than failing silently.
          setError((await res.json().catch(() => ({}))).error || "Could not save that decision.");
          return;
        }
        load();
      } finally {
        setBusy((b) => ({ ...b, [id]: false }));
      }
    },
    [load]
  );

  const openClaims = claims.filter((c) => c.status === "pending" || c.status === "cosign_required");
  const gaps = lots.filter((lot) => (lot.balance?.gap || 0) > 0);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <h2 className="font-display text-lg font-bold">🛡 Bag control</h2>
        <a href="/api/export/damage-register" className="text-[11px] font-bold text-clay-600">
          Export register →
        </a>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Metric label="Lots" value={String(lots.length)} />
        <Metric label="Open claims" value={String(openClaims.length)} tone="text-amber-700" />
        <Metric label="Gaps" value={String(gaps.length)} tone="text-red-700" />
      </div>

      <div className="flex gap-1.5 bg-clay-50 rounded-full p-1">
        {(
          [
            ["lots", `Lots (${lots.length})`],
            ["claims", `Claims (${openClaims.length})`],
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

      {tab === "lots" && (
        <div className="space-y-3">
          {lots.map((lot) => {
            const gap = lot.balance?.gap || 0;
            return (
              <div key={lot._id} className={`card p-4 ${gap > 0 ? "border-red-300 bg-red-50/50" : ""}`}>
                <div className="flex items-center justify-between">
                  <p className="font-display font-bold text-clay-900">{lot.lotCode}</p>
                  {gap > 0 ? (
                    <span className="text-[11px] font-bold bg-red-600 text-white rounded-full px-2.5 py-1">
                      {gap} unaccounted
                    </span>
                  ) : (
                    <span className="text-[11px] font-bold bg-green-100 text-green-700 rounded-full px-2.5 py-1">
                      reconciled
                    </span>
                  )}
                </div>
                <p className="text-xs text-stone-500 mt-0.5">
                  {lot.supplier} - {lot.bagType} - DN {lot.deliveryNote}
                </p>
                <div className="grid grid-cols-4 gap-1.5 mt-3 text-center">
                  {[
                    ["Received", lot.balance?.received ?? lot.quantity],
                    ["Filled", lot.balance?.filled ?? 0],
                    ["Damaged", lot.balance?.damagedVerified ?? 0],
                    ["In stock", lot.balance?.inStock ?? lot.quantity],
                  ].map(([label, v]) => (
                    <div key={label} className="rounded-lg bg-clay-50/80 py-1.5">
                      <p className="text-sm font-bold text-clay-900 tabular-nums">{v}</p>
                      <p className="text-[9px] uppercase font-bold text-stone-400">{label}</p>
                    </div>
                  ))}
                </div>
                {(lot.balance?.damagedPending ?? 0) > 0 && (
                  <p className="text-[11px] text-amber-700 mt-2">{lot.balance!.damagedPending} bags in pending claims</p>
                )}
                <p className="text-[11px] text-stone-400 mt-2">Handled by: {lot.handlers.join(", ") || "-"}</p>
              </div>
            );
          })}
          {lots.length === 0 && <p className="text-center text-sm text-stone-400 py-8">No lots registered yet.</p>}
        </div>
      )}

      {tab === "claims" && (
        <div className="space-y-3">
          {error && <p className="card border-l-4 border-l-red-500 p-3 text-xs font-bold text-red-700">{error}</p>}
          {claims.map((claim) => {
            const ai = claim.photos[0]?.ai;
            return (
              <div key={claim._id} className="card p-4">
                <div className="flex items-center justify-between">
                  <p className="font-bold text-sm">
                    {claim.lotId?.lotCode || "?"} - {claim.quantity} bags
                  </p>
                  <span className={`text-[10px] font-bold rounded-full px-2.5 py-1 ${STATUS_STYLE[claim.status] || ""}`}>
                    {claim.status.replace("_", " ")}
                  </span>
                </div>
                <p className="text-xs text-stone-500 mt-0.5">
                  {claim.worker} via {claim.source} - {new Date(claim.createdAt).toLocaleDateString()}
                  {claim.gps && ` - ${claim.gps.lat.toFixed(3)},${claim.gps.lng.toFixed(3)}`}
                </p>

                {claim.photos.length > 0 && (
                  <div className="flex gap-2 mt-2 overflow-x-auto no-scrollbar">
                    {claim.photos.map((photo) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={photo.fileId} src={`/api/files/${photo.fileId}`} alt="Evidence" className="h-20 rounded-lg object-cover" />
                    ))}
                  </div>
                )}

                {ai && (
                  <div className={`mt-2 rounded-xl px-3 py-2 text-[11px] ${ai.suspicious ? "bg-red-50 text-red-800" : "bg-clay-50 text-clay-800"}`}>
                    AI: damage <b>{ai.damage_severity}</b>
                    {ai.suspicious && <> - suspicious ({ai.suspicion_reasons.join(", ")})</>}
                  </div>
                )}
                {claim.flags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {claim.flags.map((flag) => (
                      <span key={flag} className="text-[10px] font-bold bg-amber-100 text-amber-800 rounded-full px-2 py-0.5">
                        {flag.replace(/_/g, " ")}
                      </span>
                    ))}
                  </div>
                )}
                {claim.disposal?.action && (
                  <p className="mt-2 text-[11px] font-bold text-stone-500">
                    Disposal: {claim.disposal.action.replace(/_/g, " ")}
                    {claim.disposal.amount ? ` - ETB ${claim.disposal.amount.toLocaleString()}` : ""}
                  </p>
                )}

                {(claim.status === "pending" || claim.status === "cosign_required") && (
                  <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-clay-50 pt-2">
                    {/* A Telegram claim must be co-signed before it can be
                        verified — the server refuses otherwise, so the button
                        is offered in that order rather than failing on click. */}
                    {claim.source === "telegram" && !claim.cosignedBy && (
                      <DecideBtn
                        label="✍️ Co-sign"
                        tone="purple"
                        busy={!!busy[claim._id]}
                        onClick={() => decide(claim._id, "cosign")}
                      />
                    )}
                    <DecideBtn
                      label="✓ Approve"
                      tone="green"
                      busy={!!busy[claim._id]}
                      disabled={claim.source === "telegram" && !claim.cosignedBy}
                      title={
                        claim.source === "telegram" && !claim.cosignedBy
                          ? "Telegram claims must be co-signed first"
                          : undefined
                      }
                      onClick={() => decide(claim._id, "verify")}
                    />
                    <DecideBtn
                      label="✗ Reject"
                      tone="red"
                      busy={!!busy[claim._id]}
                      onClick={() => decide(claim._id, "reject")}
                    />
                  </div>
                )}
              </div>
            );
          })}
          {claims.length === 0 && <p className="text-center text-sm text-stone-400 py-8">No claims yet.</p>}
        </div>
      )}

      {tab === "tripwires" && tripwires && (
        <div className="space-y-4">
          {(
            [
              ["byWorker", "Damage by worker (90d)"],
              ["byShift", "Damage by shift (90d)"],
              ["bySupplierLot", "Damage by supplier lot (90d)"],
            ] as const
          ).map(([key, title]) => (
            <div key={key} className="card p-4">
              <p className="text-[11px] font-bold tracking-widest uppercase text-clay-500 mb-2">{title}</p>
              {tripwires[key].length === 0 && <p className="text-xs text-stone-400">No data yet.</p>}
              {tripwires[key].map((row) => (
                <div key={row.key} className="flex items-center justify-between py-1.5 text-xs border-t border-clay-50 first:border-t-0">
                  <span className={`font-semibold ${row.flagged ? "text-red-700" : ""}`}>{row.key}</span>
                  <span className="text-stone-500">
                    {row.qty} bags - {row.vsMeanX}x mean
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Metric({ label, value, tone = "text-clay-900" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-clay-100 bg-white p-3 text-center">
      <p className={`font-display text-xl font-bold ${tone}`}>{value}</p>
      <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400">{label}</p>
    </div>
  );
}
