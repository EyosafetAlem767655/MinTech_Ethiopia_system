"use client";

import { useCallback, useEffect, useState } from "react";
import DecideBtn from "@/components/DecideButton";

/**
 * Purchase requests filed from the bot — the one panel for them.
 *
 * A compact table, and a pop-up with everything behind one row: the full
 * description, the photograph at a readable size, the AI's verdict on it with
 * its confidence and what it saw, and the decision buttons. There used to be a
 * second panel underneath this one (the original "trust loop" card list) showing
 * the same rows with an ETB amount nobody files any more and an AI verdict in a
 * shape the bot stopped writing — so a request checked by the model showed no
 * check at all there. Two views of one table that disagreed; this is the one.
 */

/** What the bot's photo check writes (src/lib/llm.ts analyseToolPhoto). */
interface PhotoCheck {
  checked: boolean;
  plausible: boolean;
  confidence: number;
  observations: string;
}

/** What the retired free-text ingestion used to write. Old rows still carry it. */
interface LegacyLegitimacy {
  score: number;
  flags?: string[];
  reasoning?: string;
}

type Legitimacy = PhotoCheck | LegacyLegitimacy;

interface Row {
  _id: string;
  title: string;
  quantity: number | null;
  kind: "maintenance" | "new_item" | null;
  justification: string | null;
  /** New-tool requests only (0028); absent on older rows and older schemas. */
  description?: string | null;
  unit?: string | null;
  department?: string | null;
  notes?: string | null;
  photoFileId: string | null;
  legitimacy: Legitimacy | null;
  status: string;
  requestedBy: string;
  decidedBy?: string | null;
  decidedAt?: string | null;
  createdAt: string;
}

const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const fmtWhen = (d: string) =>
  new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

const STATUS_TONE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-blue-100 text-blue-800",
  bought: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-800",
  disregarded: "bg-stone-100 text-stone-600",
  deferred: "bg-purple-100 text-purple-700",
};

const DEPARTMENT_LABEL: Record<string, string> = {
  production: "Production",
  asset_management: "Asset",
  sales: "Sales",
  finance: "Finance",
  hr: "HR",
  other: "Other",
};

const OPEN_STATUSES = new Set(["pending", "deferred"]);

const isPhotoCheck = (l: Legitimacy): l is PhotoCheck => typeof (l as PhotoCheck).checked === "boolean";

/**
 * One number for either verdict shape: HOW REAL THE CLAIM LOOKS, 0–100.
 *
 * The model answers two things — is the damage real (`plausible`) and how sure
 * it is (`confidence`). Shown side by side they read wrongly: "100%" beside
 * "does not match" meant the model was certain the claim was NOT real, and the
 * badge looked like a perfect score. So the two are folded into one figure on
 * one scale: a plausible claim scores its confidence, an implausible one scores
 * the remainder. 100% sure it is real → 100% real; 100% sure it is not → 0% real;
 * "can't tell" lands in the middle either way, which is what it is.
 *
 * The legacy shape already was a 0–100 legitimacy score, so it passes through.
 *
 * A verdict that never ran is neutral, never red — a Gemini outage must not
 * read as an accusation that the employee faked the damage.
 */
function readVerdict(l: Legitimacy | null): { ran: boolean; real: number; note: string; flags: string[] } | null {
  if (!l) return null;
  if (isPhotoCheck(l)) {
    const c = Math.max(0, Math.min(100, Number(l.confidence) || 0));
    return { ran: l.checked, real: l.plausible ? c : 100 - c, note: l.observations || "", flags: [] };
  }
  const score = Math.max(0, Math.min(100, Number(l.score) || 0));
  return { ran: true, real: score, note: l.reasoning || "", flags: l.flags || [] };
}

/** Plain words for the figure. Four bands, deliberately few. */
function realLabel(real: number): string {
  if (real >= 85) return "Real";
  if (real >= 60) return "Likely real";
  if (real >= 35) return "Doubtful";
  return "Not real";
}

function tone(v: { ran: boolean; real: number }): string {
  if (!v.ran) return "bg-stone-100 text-stone-600";
  if (v.real >= 60) return "bg-green-100 text-green-700";
  if (v.real >= 35) return "bg-amber-100 text-amber-800";
  return "bg-red-100 text-red-800";
}

/** The badge in the table. Compact; the pop-up carries the reasoning. */
function CheckBadge({ row }: { row: Row }) {
  const v = readVerdict(row.legitimacy);
  if (!v) {
    // A new tool has no photo and nothing to check; a damaged item without a
    // verdict is a real gap and is named as one.
    return row.kind === "maintenance" ? (
      <span className="text-[10px] font-bold text-stone-400">no check</span>
    ) : (
      <span className="text-stone-300">—</span>
    );
  }
  if (!v.ran) {
    return (
      <span title={v.note} className="inline-flex rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-bold text-stone-600">
        ⏳ Not checked
      </span>
    );
  }
  return (
    <span title={v.note} className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${tone(v)}`}>
      {v.real}% real · {realLabel(v.real)}
    </span>
  );
}

/** The full verdict, for the pop-up. */
function CheckDetail({ row }: { row: Row }) {
  const v = readVerdict(row.legitimacy);
  if (!v) {
    return (
      <p className="text-xs text-stone-500">
        {row.kind === "maintenance"
          ? "No AI check was recorded for this request."
          : "New-tool requests carry no photograph, so there is nothing for the AI to check."}
      </p>
    );
  }
  if (!v.ran) {
    return (
      <div className="rounded-xl bg-stone-50 p-3">
        <p className="text-xs font-bold text-stone-600">⏳ The check did not run</p>
        {v.note && <p className="mt-1 text-[11px] text-stone-500">{v.note}</p>}
        <p className="mt-1 text-[11px] text-stone-400">
          Not a verdict on the photo — the model was unreachable or the image could not be read back. Judge it by eye.
        </p>
      </div>
    );
  }
  const bar = v.real >= 60 ? "bg-green-500" : v.real >= 35 ? "bg-amber-400" : "bg-red-500";
  const text = v.real >= 60 ? "text-green-700" : v.real >= 35 ? "text-amber-700" : "text-red-700";
  return (
    <div className="rounded-xl bg-stone-50 p-3">
      <div className="mb-1.5 flex items-center justify-between">
        <span className={`text-[11px] font-bold ${text}`}>
          AI check · {v.real}% real · {realLabel(v.real)}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-stone-200">
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${v.real}%` }} />
      </div>
      <p className="mt-1 text-[10px] text-stone-400">
        How real the damage looks in the photo, from the AI: 100% = clearly real, 0% = clearly not.
      </p>
      {v.note && <p className="mt-1.5 text-[11px] leading-snug text-stone-600">{v.note}</p>}
      {v.flags.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {v.flags.map((f) => (
            <span key={f} className="rounded bg-stone-200 px-1.5 py-0.5 font-mono text-[10px] text-stone-600">
              {f}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function KindBadge({ kind }: { kind: Row["kind"] }) {
  if (!kind) return null;
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
        kind === "maintenance" ? "bg-clay-100 text-clay-800" : "bg-blue-100 text-blue-800"
      }`}
    >
      {kind === "maintenance" ? "🛠 Damaged" : "🆕 New tool"}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_TONE[status] || "bg-stone-100 text-stone-600"}`}>
      {status}
    </span>
  );
}

export default function ToolRequestsPanel() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

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

  // Escape closes the pop-up, the way every modal is expected to.
  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId]);

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
  const selected = openId ? rows.find((r) => r._id === openId) ?? null : null;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <h2 className="font-display text-lg font-bold">🛒 Purchase requests</h2>
        {open > 0 && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
            {open} awaiting decision
          </span>
        )}
      </div>

      {error && <p className="card border-l-4 border-l-red-500 p-3 text-xs font-bold text-red-700">{error}</p>}

      {rows.length === 0 ? (
        <p className="card p-4 text-sm text-stone-400">No purchase requests yet.</p>
      ) : (
        <div className="card overflow-x-auto p-0">
          <p className="px-3 pt-2 text-[10px] text-stone-400">Tap a row for the full request, the photo and the AI check.</p>
          <table className="w-full min-w-[720px] text-right text-xs">
            <thead className="bg-clay-50/70 text-[10px] uppercase tracking-wide text-stone-500">
              <tr>
                <th className="p-2 text-left font-bold">Date</th>
                <th className="p-2 font-bold">Type</th>
                <th className="p-2 text-left font-bold">Item</th>
                <th className="p-2 font-bold">Qty</th>
                <th className="p-2 text-left font-bold">Dept</th>
                <th className="p-2 font-bold">AI check</th>
                <th className="p-2 text-left font-bold">By</th>
                <th className="p-2 font-bold">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r._id}
                  onClick={() => setOpenId(r._id)}
                  className="cursor-pointer border-t border-clay-50 transition-colors hover:bg-clay-50/60"
                >
                  <td className="p-2 text-left font-semibold text-stone-800">{fmtDate(r.createdAt)}</td>
                  <td className="p-2">
                    <KindBadge kind={r.kind} />
                  </td>
                  <td className="max-w-[220px] truncate p-2 text-left font-semibold text-stone-700">{r.title}</td>
                  <td className="p-2 tabular-nums">
                    {r.quantity ?? ""}
                    {r.unit && <span className="ml-1 text-[10px] text-stone-400">{r.unit}</span>}
                  </td>
                  <td className="p-2 text-left text-stone-500">
                    {r.department ? DEPARTMENT_LABEL[r.department] || r.department : ""}
                  </td>
                  <td className="p-2">
                    <CheckBadge row={r} />
                  </td>
                  <td className="p-2 text-left text-stone-500">{r.requestedBy}</td>
                  <td className="p-2">
                    <StatusBadge status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <RequestModal row={selected} busy={!!busy[selected._id]} onClose={() => setOpenId(null)} onDecide={decide} />
      )}
    </section>
  );
}

/** The whole request in one pop-up: every field, the photo, the verdict, the decision. */
function RequestModal({
  row,
  busy,
  onClose,
  onDecide,
}: {
  row: Row;
  busy: boolean;
  onClose: () => void;
  onDecide: (id: string, action: string) => Promise<void>;
}) {
  const field = (label: string, value: React.ReactNode) =>
    value === null || value === undefined || value === "" ? null : (
      <div className="grid grid-cols-[110px_1fr] gap-2 border-t border-stone-100 py-1.5 text-xs">
        <span className="text-[10px] font-bold uppercase tracking-wide text-stone-400">{label}</span>
        <span className="text-stone-700">{value}</span>
      </div>
    );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-4 shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <KindBadge kind={row.kind} />
              <StatusBadge status={row.status} />
            </div>
            <h3 className="mt-1.5 font-display text-base font-bold text-stone-900">{row.title}</h3>
            <p className="text-[11px] text-stone-400">
              by <span className="font-semibold text-stone-600">{row.requestedBy}</span> · {fmtWhen(row.createdAt)}
            </p>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-full bg-stone-100 px-2.5 py-1 text-xs font-bold text-stone-600">
            ✕
          </button>
        </div>

        <div className="mt-3">
          {field("Description", row.description)}
          {field(
            "Quantity",
            row.quantity == null ? null : (
              <span className="tabular-nums">
                {row.quantity} {row.unit || ""}
              </span>
            )
          )}
          {field("Reason", row.justification)}
          {field("Department", row.department ? DEPARTMENT_LABEL[row.department] || row.department : null)}
          {field("Notes", row.notes)}
          {row.decidedBy && row.decidedAt
            ? field("Decision", `${row.status} by ${row.decidedBy} · ${fmtWhen(row.decidedAt)}`)
            : null}
        </div>

        {row.photoFileId && (
          <a href={`/api/files/${row.photoFileId}`} target="_blank" rel="noreferrer" className="mt-3 block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/files/${row.photoFileId}`}
              alt="Submitted photo"
              className="max-h-72 w-full rounded-xl object-contain ring-1 ring-clay-100"
            />
          </a>
        )}

        <div className="mt-3">
          <CheckDetail row={row} />
        </div>

        {OPEN_STATUSES.has(row.status) && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            <DecideBtn label="✓ Approve" tone="blue" busy={busy} onClick={() => onDecide(row._id, "approve")} />
            <DecideBtn label="✓ Bought" tone="green" busy={busy} onClick={() => onDecide(row._id, "bought")} />
            <DecideBtn label="⏸ Defer" tone="purple" busy={busy} onClick={() => onDecide(row._id, "deferred")} />
            <DecideBtn label="✗ Reject" tone="red" busy={busy} onClick={() => onDecide(row._id, "reject")} />
            <DecideBtn label="Disregard" tone="grey" busy={busy} onClick={() => onDecide(row._id, "disregarded")} />
          </div>
        )}
      </div>
    </div>
  );
}
