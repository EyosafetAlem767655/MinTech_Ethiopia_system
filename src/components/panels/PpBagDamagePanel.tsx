"use client";

import { useEffect, useState } from "react";

/** PP bag damage reports: reason, quantity, evidence photos and the AI verdict. */

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
  createdAt: string;
}

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

  useEffect(() => {
    fetch("/api/pp-bag-damage")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .catch(() => setRows([]));
  }, []);

  if (!rows) return <div className="card h-40 animate-pulse bg-clay-50" />;

  const totalBags = rows.reduce((a, r) => a + (Number(r.quantity) || 0), 0);
  const flagged = rows.filter((r) => r.flags?.length > 0).length;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <h2 className="font-display text-lg font-bold">💔 PP bag damage</h2>
        {rows.length > 0 && (
          <p className="text-[11px] font-bold text-stone-500">
            {totalBags.toLocaleString()} bags
            {flagged > 0 && <span className="ml-2 text-amber-700">· {flagged} flagged</span>}
          </p>
        )}
      </div>

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
                <TrustBadge row={r} />
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
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
