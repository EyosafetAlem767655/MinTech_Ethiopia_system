"use client";

import { useCallback, useEffect, useState } from "react";
import DecideBtn from "@/components/DecideButton";

/**
 * PP bag damage reports: reason, quantity, evidence photos, the AI verdict and
 * the human decision.
 *
 * The trust score is advice, not a verdict — a report the AI could not check at
 * all must still be approvable, and a convincing photo must still be refusable,
 * so every report carries approve/reject buttons regardless of what the model
 * said.
 */

interface PhotoCheck {
  checked: boolean;
  photoAnalysed: boolean;
  provider: "gemini" | "qwen" | "nemotron" | "none";
  plausible: boolean;
  confidence: number;
  observations: string;
}

interface Photo {
  fileId: string | null;
  duplicateOfReportId: string | null;
  ai: PhotoCheck | null;
}

type Status = "pending" | "approved" | "rejected";

interface Row {
  _id: string;
  date: string;
  reason: string;
  quantity: number | null;
  reportedBy: string;
  trustScore: number | null;
  flags: string[];
  ai: PhotoCheck | null;
  photos: Photo[];
  status: Status;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
}

const STATUS_TONE: Record<Status, string> = {
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-800",
};

const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

const PROVIDER_LABEL: Record<string, string> = {
  gemini: "Gemini",
  qwen: "Qwen-VL",
  nemotron: "Nemotron (text only)",
  none: "—",
};

/** Human wording for each flag, so the panel does not leak snake_case at people. */
const FLAG_LABEL: Record<string, string> = {
  duplicate_photo: "🔁 Photo already submitted",
  photo_older_than_48h: "🕓 Photo older than 48h",
  edited_with_software: "🖌 Edited in an image editor",
  suspicious_image: "⚠️ Doesn't match the report",
  photo_not_analysed: "ℹ️ Photo not analysed",
  ai_not_checked: "⏳ Not checked",
};

/**
 * Trust badge. A check that never ran is neutral grey, never red — an AI outage
 * must not read as an accusation that the reporter faked the damage.
 */
function TrustBadge({ row }: { row: Row }) {
  if (row.ai && !row.ai.checked) {
    return (
      <span className="inline-flex rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-bold text-stone-600">
        ⏳ Not checked
      </span>
    );
  }
  const score = row.trustScore;
  if (score == null) return <span className="text-stone-300">—</span>;
  const tone =
    score >= 70 ? "bg-green-100 text-green-700" : score >= 40 ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800";
  return (
    <span
      title={row.ai?.observations || ""}
      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${tone}`}
    >
      {score}%
    </span>
  );
}

export default function PpBagDamagePanel() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/pp-bag-damage");
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
    async (id: string, action: "approve" | "reject" | "reopen") => {
      setBusy((b) => ({ ...b, [id]: true }));
      setError("");
      try {
        const res = await fetch(`/api/pp-bag-damage/${id}`, {
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

  const totalBags = rows.reduce((a, r) => a + (Number(r.quantity) || 0), 0);
  const flagged = rows.filter((r) => r.flags?.length > 0).length;
  const awaiting = rows.filter((r) => (r.status ?? "pending") === "pending").length;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <h2 className="font-display text-lg font-bold">💔 PP bag damage</h2>
        {rows.length > 0 && (
          <p className="text-[11px] font-bold text-stone-500">
            {totalBags.toLocaleString()} bags
            {flagged > 0 && <span className="ml-2 text-amber-700">· {flagged} flagged</span>}
            {awaiting > 0 && <span className="ml-2 text-amber-800">· {awaiting} awaiting decision</span>}
          </p>
        )}
      </div>

      {error && <p className="card border-l-4 border-l-red-500 p-3 text-xs font-bold text-red-700">{error}</p>}

      {rows.length === 0 ? (
        <p className="card p-4 text-sm text-stone-400">No PP bag damage reports yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r._id} className="card space-y-2 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-stone-800">
                    {fmtDate(r.date)} · {Number(r.quantity) || 0} bags
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap text-xs text-stone-700">{r.reason}</p>
                  <p className="mt-0.5 text-[10px] text-stone-400">{r.reportedBy}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${
                      STATUS_TONE[r.status ?? "pending"]
                    }`}
                  >
                    {r.status ?? "pending"}
                  </span>
                  <TrustBadge row={r} />
                </div>
              </div>

              {r.photos?.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {r.photos.map((p, i) =>
                    p.fileId ? (
                      <a key={i} href={`/api/files/${p.fileId}`} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`/api/files/${p.fileId}`}
                          alt="Damaged PP bags"
                          className="h-20 w-20 rounded-lg object-cover ring-1 ring-clay-100"
                        />
                      </a>
                    ) : (
                      // The binary is purged after a year; the hash and verdict remain.
                      <span
                        key={i}
                        className="grid h-20 w-20 place-items-center rounded-lg bg-stone-100 text-center text-[9px] text-stone-400"
                      >
                        photo
                        <br />
                        expired
                      </span>
                    )
                  )}
                </div>
              )}

              {r.ai?.checked && r.ai.observations && (
                <p className="rounded-lg bg-clay-50 px-2.5 py-1.5 text-[11px] italic text-clay-800">
                  {r.ai.observations}
                  <span className="ml-1 not-italic text-clay-500">
                    — {PROVIDER_LABEL[r.ai.provider] || r.ai.provider}
                  </span>
                </p>
              )}

              {r.flags?.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {r.flags.map((f) => (
                    <span
                      key={f}
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        f === "ai_not_checked" || f === "photo_not_analysed"
                          ? "bg-stone-100 text-stone-600"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {FLAG_LABEL[f] || f.replace(/_/g, " ")}
                    </span>
                  ))}
                </div>
              )}

              {r.photos?.some((p) => p.duplicateOfReportId) && (
                <p className="text-[11px] font-bold text-red-700">
                  ❗ A photo here was already submitted in an earlier report.
                </p>
              )}

              <div className="flex flex-wrap items-center gap-1.5 border-t border-clay-50 pt-2">
                {(r.status ?? "pending") === "pending" ? (
                  <>
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
                  </>
                ) : (
                  <>
                    <p className="text-[10px] text-stone-400">
                      {r.status === "approved" ? "Approved" : "Rejected"}
                      {r.decidedBy ? ` by ${r.decidedBy}` : ""}
                      {r.decidedAt ? ` · ${fmtDate(r.decidedAt)}` : ""}
                    </p>
                    <DecideBtn
                      label="↺ Reopen"
                      tone="grey"
                      busy={!!busy[r._id]}
                      onClick={() => decide(r._id, "reopen")}
                    />
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
