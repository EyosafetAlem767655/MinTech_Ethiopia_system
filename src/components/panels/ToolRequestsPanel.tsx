"use client";

import { useEffect, useState } from "react";

/** Tool purchase requests filed from the bot: what, how many, why, and the AI photo check. */

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

export default function ToolRequestsPanel() {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    fetch("/api/tool-requests")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .catch(() => setRows([]));
  }, []);

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

      {rows.length === 0 ? (
        <p className="card p-4 text-sm text-stone-400">No tool purchase requests yet.</p>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[820px] text-right text-xs">
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
