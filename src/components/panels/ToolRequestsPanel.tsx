"use client";

import { useCallback, useEffect, useState } from "react";
import DecideBtn from "@/components/DecideButton";

/**
 * Tool purchase requests filed from the bot: what, how many, why, the AI photo
 * check, and the human decision.
 *
 * Decisions go to the same `purchase_requests` endpoint the Purchase requests
 * panel below uses — the two panels are two views of one table, so a request
 * marked bought here shows as bought there.
 */

interface PhotoCheck {
  checked: boolean;
  plausible: boolean;
  confidence: number;
  observations: string;
}

interface Row {
  _id: string;
  title: string;
  quantity: number | null;
  kind: "maintenance" | "new_item" | null;
  justification: string | null;
  photoFileId: string | null;
  legitimacy: PhotoCheck | null;
  status: string;
  requestedBy: string;
  createdAt: string;
}

const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

const STATUS_TONE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-green-100 text-green-700",
  bought: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-800",
  disregarded: "bg-stone-100 text-stone-600",
  deferred: "bg-stone-100 text-stone-600",
};

/**
 * AI verdict on the damaged-item photo.
 *
 * A check that never ran is neutral grey, never red — a Gemini outage must not
 * read as an accusation that the employee faked the damage.
 */
function PhotoBadge({ check, kind }: { check: PhotoCheck | null; kind: Row["kind"] }) {
  if (kind !== "maintenance") return <span className="text-stone-300">—</span>;
  if (!check) return <span className="text-stone-300">—</span>;

  if (!check.checked) {
    return (
      <span
        title={check.observations}
        className="inline-flex rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-bold text-stone-600"
      >
        ⏳ Not checked
      </span>
    );
  }
  const tone = !check.plausible
    ? "bg-red-100 text-red-800"
    : check.confidence >= 70
    ? "bg-green-100 text-green-700"
    : "bg-amber-100 text-amber-800";
  return (
    <span
      title={check.observations}
      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${tone}`}
    >
      {check.plausible ? "✅" : "⚠️"} {check.confidence}%
    </span>
  );
}

const OPEN_STATUSES = new Set(["pending", "deferred"]);

export default function ToolRequestsPanel() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/tool-requests");
      const data = res.ok ? await res.json() : [];
      setRows(Array.isArray(data) ? data : []);
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const decide = useCallback(
    async (id: string, action: string) => {
      setBusy((b) => ({ ...b, [id]: true }));
      setError("");
      try {
        const res = await fetch(`/api/purchase-requests/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        if (!res.ok) {
          setError((await res.json().catch(() => ({}))).error || "Could not save that decision.");
          return;
        }
        await load();
      } finally {
        setBusy((b) => ({ ...b, [id]: false }));
      }
    },
    [load]
  );

  if (!rows) return <div className="card h-40 animate-pulse bg-clay-50" />;

  const open = rows.filter((r) => r.status === "pending").length;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <h2 className="font-display text-lg font-bold">🔧 Tool purchase requests</h2>
        {open > 0 && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
            {open} awaiting decision
          </span>
        )}
      </div>

      {error && <p className="card border-l-4 border-l-red-500 p-3 text-xs font-bold text-red-700">{error}</p>}

      {rows.length === 0 ? (
        <p className="card p-4 text-sm text-stone-400">No tool purchase requests yet.</p>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[980px] text-right text-xs">
            <thead className="bg-clay-50/70 text-[10px] uppercase tracking-wide text-stone-500">
              <tr>
                <th className="p-2 text-left font-bold">Date</th>
                <th className="p-2 text-left font-bold">Tool</th>
                <th className="p-2 font-bold">Qty</th>
                <th className="p-2 font-bold">Type</th>
                <th className="p-2 text-left font-bold">Reason</th>
                <th className="p-2 font-bold">Photo</th>
                <th className="p-2 font-bold">AI check</th>
                <th className="p-2 text-left font-bold">By</th>
                <th className="p-2 font-bold">Status</th>
                <th className="p-2 font-bold">Decision</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r._id} className="border-t border-clay-50">
                  <td className="p-2 text-left font-semibold text-stone-800">{fmtDate(r.createdAt)}</td>
                  <td className="p-2 text-left text-stone-700">{r.title}</td>
                  <td className="p-2 tabular-nums">{r.quantity ?? ""}</td>
                  <td className="p-2">
                    {r.kind && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          r.kind === "maintenance" ? "bg-clay-100 text-clay-800" : "bg-blue-100 text-blue-800"
                        }`}
                      >
                        {r.kind === "maintenance" ? "🛠 Maintenance" : "🆕 New item"}
                      </span>
                    )}
                  </td>
                  <td className="p-2 text-left text-stone-500">{r.justification || ""}</td>
                  <td className="p-2">
                    {r.photoFileId ? (
                      <a href={`/api/files/${r.photoFileId}`} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`/api/files/${r.photoFileId}`}
                          alt="Damaged item"
                          className="mx-auto h-10 w-10 rounded object-cover ring-1 ring-clay-100"
                        />
                      </a>
                    ) : (
                      <span className="text-stone-300">—</span>
                    )}
                  </td>
                  <td className="p-2">
                    <PhotoBadge check={r.legitimacy} kind={r.kind} />
                  </td>
                  <td className="p-2 text-left text-stone-500">{r.requestedBy}</td>
                  <td className="p-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        STATUS_TONE[r.status] || "bg-stone-100 text-stone-600"
                      }`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="p-2">
                    {OPEN_STATUSES.has(r.status) ? (
                      <div className="flex justify-end gap-1">
                        <DecideBtn
                          label="✓ Approve"
                          tone="green"
                          busy={!!busy[r._id]}
                          onClick={() => decide(r._id, "approve")}
                        />
                        <DecideBtn
                          label="✗ Reject"
                          tone="red"
                          busy={!!busy[r._id]}
                          onClick={() => decide(r._id, "reject")}
                        />
                      </div>
                    ) : (
                      <span className="text-[10px] text-stone-400">decided</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
