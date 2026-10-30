"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BOT_FUNCTIONALITIES,
  CAPABILITIES,
  positionsToSelection,
  selectionToPositions,
  type CapabilityKey,
  type PositionKey,
} from "@/lib/positions";
import {
  SUBMISSIONS,
  SUBMISSION_COLLECTIONS,
  SUBMISSION_RANGES,
  type SubmissionCollection,
  type SubmissionRange,
  type SubmissionSpec,
} from "@/lib/submissions";
import { InstallButton } from "@/components/InstallPrompt";
import { useCanEdit, useIsSuper } from "@/lib/use-role";
import WebUsersTab from "@/components/panels/WebUsersPanel";
import AiRecheckPanel from "@/components/panels/AiRecheckPanel";
import type { SchemaReport } from "@/lib/schema-check";

interface BotUser {
  _id: string;
  fullName: string;
  positions: PositionKey[];
  /** Per-employee override; null/absent means the positions' defaults. */
  capabilities?: CapabilityKey[] | null;
  active: boolean;
  loggedIn: boolean;
  chatId?: string;
  lastLoginAt?: string;
  lastSeenAt?: string;
  lockedUntil?: string;
  note?: string;
  archivedAt?: string;
  createdAt: string;
}

interface Activity {
  _id: string;
  chatId: string;
  actor: string;
  positions: string[];
  audience: "internal" | "external" | "unknown";
  action: string;
  detail?: string;
  ok: boolean;
  createdAt: string;
}

/** What the employee screen ticks: bot buttons, plus the two digest roles. */
interface Selection {
  caps: CapabilityKey[];
  hr: boolean;
  admin: boolean;
}

const EMPTY_SELECTION: Selection = { caps: [], hr: false, admin: false };

const selectionEmpty = (s: Selection) => s.caps.length === 0 && !s.hr && !s.admin;

/** The save body for a selection: the roles it implies and its buttons. */
const selectionBody = (s: Selection) => ({
  positions: selectionToPositions(s.caps, s.hr, s.admin),
  capabilities: s.caps,
});

/** One line saying what an employee gets, in the same words as the picker. */
function selectionSummary(u: BotUser): string {
  const s = positionsToSelection(u.positions, u.capabilities);
  const parts = s.caps.map((k) => CAPABILITIES[k].button);
  if (s.hr) parts.push("👥 HR");
  if (s.admin) parts.push("🛡 ADMIN");
  return parts.join(" · ") || "Nothing ticked";
}

const fmtTime = (d: string) =>
  new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const ACTION_STYLES: Record<string, string> = {
  login_success: "bg-green-100 text-green-800",
  login_failed: "bg-red-100 text-red-700",
  login_locked: "bg-red-200 text-red-900",
  unauthorized: "bg-red-100 text-red-700",
  session_revoked: "bg-amber-100 text-amber-800",
  logout: "bg-stone-200 text-stone-600",
  submission: "bg-blue-100 text-blue-800",
  submission_rejected: "bg-amber-100 text-amber-800",
  menu_select: "bg-stone-100 text-stone-500",
  reminder_sent: "bg-purple-100 text-purple-700",
  purchase_decision: "bg-emerald-100 text-emerald-800",
  report_decided: "bg-emerald-100 text-emerald-800",
  report_edited: "bg-blue-100 text-blue-800",
  report_deleted: "bg-red-100 text-red-700",
  chat_question: "bg-indigo-100 text-indigo-700",
  external_registered: "bg-teal-100 text-teal-800",
  start: "bg-stone-100 text-stone-500",
  error: "bg-red-200 text-red-900",
};

type Tab = "users" | "submissions" | "errors" | "activity" | "devices" | "webusers";

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("users");
  const router = useRouter();
  // Errors, Devices, Web users and the danger zone are the Super Admin's.
  const isSuper = useIsSuper();
  const tabs: Tab[] = isSuper
    ? ["users", "submissions", "errors", "activity", "devices", "webusers"]
    : ["users", "submissions", "activity"];

  const logout = async () => {
    if (!confirm("Log out of this browser?")) return;
    await fetch("/api/logout", { method: "POST" }).catch(() => {});
    router.push("/login");
  };

  return (
    <main className="app-shell px-4 pb-10">
      <header className="hero-gradient -mx-4 px-5 pb-7 pt-10 text-white sm:mx-0 sm:mt-4 sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.png"
              alt="MinTech"
              className="mb-3 h-10 w-auto drop-shadow-[0_3px_10px_rgba(0,0,0,0.25)]"
            />
            <p className="text-xs font-bold tracking-[0.24em] uppercase text-clay-100">Settings</p>
            <h1 className="font-display text-2xl font-bold">Telegram bot access</h1>
            <p className="mt-1 text-sm text-clay-100/90">Employees · positions · passwords · devices</p>
          </div>
          <button
            onClick={logout}
            className="shrink-0 rounded-full border border-white/25 bg-white/15 px-3 py-1.5 text-xs font-bold hover:bg-white/25 active:scale-95"
          >
            🚪 Log out
          </button>
        </div>
      </header>

      <div className="pt-5">
        <InstallButton />
      </div>

      <div className="flex gap-1.5 py-5">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-full text-xs font-bold capitalize transition-all ${
              tab === t ? "bg-clay-700 text-white" : "bg-stone-100 text-stone-600"
            }`}
          >
            {t === "users"
              ? "Employees"
              : t === "submissions"
              ? "Submissions"
              : t === "errors"
              ? "Errors"
              : t === "activity"
              ? "Bot activity"
              : t === "webusers"
              ? "👤 Web users"
              : "Devices"}
          </button>
        ))}
      </div>

      {tab === "users" && <UsersTab />}
      {tab === "submissions" && <SubmissionsTab />}
      {tab === "errors" && isSuper && <ErrorsTab />}
      {tab === "activity" && <ActivityTab />}
      {tab === "devices" && isSuper && <DevicesTab />}
      {tab === "webusers" && isSuper && <WebUsersTab />}

      {/* Kept out of the tabs on purpose. Nothing here is recoverable, so it
          should be somewhere you arrive at deliberately rather than somewhere
          you land while looking for something else. */}
      {tab === "submissions" && isSuper && <DangerZone />}
    </main>
  );
}

/* ──────────────────────────────── Danger zone ─────────────────────────────── */

interface PurgeCounts {
  sales: { receipts: number; briefs: number };
  request_photos: { photos: number };
  asset_management: { rows: number; perTable: Record<string, number>; files: number };
}

type PurgeScope = "sales" | "request_photos" | "asset_management";

/**
 * Permanent, scoped deletion — rows AND the storage objects behind them.
 *
 * This exists because the SQL scripts under supabase/ cannot finish the job: SQL
 * run in the Supabase editor has no reach into the storage bucket, so it clears
 * the rows and leaves the images paying rent forever.
 */
function DangerZone() {
  const [counts, setCounts] = useState<PurgeCounts | null>(null);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/purge").catch(() => null);
    setCounts(res?.ok ? await res.json() : null);
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const run = async (scope: PurgeScope) => {
    setBusy(scope);
    setResult("");
    try {
      const res = await fetch("/api/admin/purge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, confirm: typed[scope] || "" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResult(body.error || "That did not run.");
        return;
      }
      setResult(
        scope === "sales"
          ? `Removed ${body.receiptsDeleted} sales report(s), ${body.filesRemoved} image(s) and ${body.briefsDeleted} cached brief(s).`
          : scope === "asset_management"
            ? `Removed ${body.rowsDeleted} row(s) across ${Object.keys(body.perTable || {}).length} tables, ` +
              `${body.filesRemoved} image(s) and ${body.binEntriesDeleted} recycle-bin entr(ies).`
            : `Removed ${body.filesRemoved} image(s) from ${body.requestsAffected} request(s). The requests themselves are untouched.`
      );
      setTyped((t) => ({ ...t, [scope]: "" }));
      await load();
    } finally {
      setBusy("");
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-8 w-full rounded-xl border border-dashed border-stone-200 p-3 text-xs font-bold text-stone-400 hover:border-red-200 hover:text-red-600"
      >
        ⚠️ Danger zone
      </button>
    );
  }

  return (
    <section className="mt-8 space-y-3 rounded-xl border-2 border-red-100 p-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-bold text-red-700">⚠️ Danger zone</h2>
        <button onClick={() => setOpen(false)} className="text-[11px] font-bold text-stone-400">
          Hide
        </button>
      </div>
      <p className="text-[11px] text-stone-500">
        Permanent. Both actions delete the images from storage as well as the rows — which is the part
        the SQL scripts cannot do.
      </p>

      {result && <p className="rounded-lg bg-stone-100 p-2 text-[11px] font-bold text-stone-700">{result}</p>}

      <PurgeCard
        title="Clear the sales tab"
        detail={
          counts
            ? `${counts.sales.receipts} sales report(s) and their receipt images, plus ${counts.sales.briefs} cached brief(s).`
            : "…"
        }
        scope="sales"
        typed={typed.sales || ""}
        onType={(v) => setTyped((t) => ({ ...t, sales: v }))}
        busy={busy === "sales"}
        onRun={() => run("sales")}
      />
      <PurgeCard
        title="Delete purchase request images"
        detail={
          counts
            ? `${counts.request_photos.photos} image(s). The requests themselves stay — only the photos go.`
            : "…"
        }
        scope="request_photos"
        typed={typed.request_photos || ""}
        onType={(v) => setTyped((t) => ({ ...t, request_photos: v }))}
        busy={busy === "request_photos"}
        onRun={() => run("request_photos")}
      />
      <PurgeCard
        title="Clear the asset management tab"
        detail={
          counts
            ? `${counts.asset_management.rows} row(s): raw material received, deliveries, GRV and store issue vouchers ` +
              `with their line items, PP bag usage and damage reports (${counts.asset_management.files} image(s)), ` +
              `purchase requests, bag lots and damage claims — plus their recycle-bin entries. ` +
              `GRV vouchers are shared with the Finance tab and go too.`
            : "…"
        }
        scope="asset_management"
        typed={typed.asset_management || ""}
        onType={(v) => setTyped((t) => ({ ...t, asset_management: v }))}
        busy={busy === "asset_management"}
        onRun={() => run("asset_management")}
      />
    </section>
  );
}

function PurgeCard({
  title,
  detail,
  scope,
  typed,
  onType,
  busy,
  onRun,
}: {
  title: string;
  detail: string;
  scope: string;
  typed: string;
  onType: (v: string) => void;
  busy: boolean;
  onRun: () => void;
}) {
  return (
    <div className="space-y-2 rounded-lg bg-stone-50 p-3">
      <p className="text-xs font-bold text-stone-800">{title}</p>
      <p className="text-[11px] text-stone-500">{detail}</p>
      <div className="flex gap-2">
        <input
          value={typed}
          onChange={(e) => onType(e.target.value)}
          placeholder={`Type ${scope}`}
          className="min-w-0 flex-1 rounded-lg border border-stone-200 px-2 py-1.5 text-xs"
        />
        <button
          onClick={onRun}
          disabled={busy || typed !== scope}
          className="shrink-0 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white disabled:bg-stone-200 disabled:text-stone-400"
        >
          {busy ? "…" : "Delete"}
        </button>
      </div>
    </div>
  );
}

/* ──────────────────────── One submission, in full ─────────────────────────── */

/** "reported_by" → "Reported by". */
const humanise = (col: string) => col.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** Columns that are plumbing, not information, on any table. */
const PLUMBING = new Set(["id", "_collection", "photo_ids"]);

function DetailValue({ value }: { value: unknown }) {
  if (value == null || value === "") return <span className="text-stone-300">—</span>;
  if (typeof value === "object") {
    if (Array.isArray(value) && value.length === 0) return <span className="text-stone-300">—</span>;
    return (
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-clay-50/60 p-2 text-[10px] text-stone-600">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }
  const text = String(value);
  // Timestamps read as dates, not as ISO strings.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) return <span>{fmtTime(text)}</span>;
  return <span className="whitespace-pre-wrap break-words">{text}</span>;
}

/**
 * Everything about one submission, in a pop-up: every column of its row (the
 * registry's labelled fields first, then the rest), its line items and payments,
 * its photos — and, below them, the buttons to edit or delete it.
 */
function SubmissionDetail(props: {
  collection: SubmissionCollection;
  row: SubmissionRow;
  spec: SubmissionSpecLite;
  photoIds: string[];
  editing: boolean;
  draft: Record<string, string>;
  busy: boolean;
  error: string;
  onDraft: (d: Record<string, string>) => void;
  /** The full record's values, once loaded: the starting point of an edit. */
  onBase: (d: Record<string, string>) => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { collection, row, spec, editing, draft, busy, error, onClose } = props;
  const canEdit = useCanEdit();
  const isSuper = useIsSuper();
  const [data, setData] = useState<{ row: Record<string, unknown>; children: { table: string; rows: Record<string, unknown>[] }[] } | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let alive = true;
    fetch(`/api/submissions/${collection}/${String(row.id)}`)
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`))))
      .then((d) => alive && setData(d))
      .catch((e) => alive && setLoadError(String(e instanceof Error ? e.message : e)));
    return () => {
      alive = false;
    };
  }, [collection, row.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const full = data?.row ?? row;

  // Editing starts from the SUBMITTED record — every editable field filled with
  // what was filed, read from the full row rather than the short list row,
  // which does not carry every column. Filled once per edit, so typing is
  // never overwritten.
  const filledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!editing) {
      filledFor.current = null;
      return;
    }
    if (!data || filledFor.current === String(row.id)) return;
    filledFor.current = String(row.id);
    const vals: Record<string, string> = {};
    for (const key of spec.editableKeys) {
      const v = data.row[key];
      vals[key] = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    }
    props.onBase(vals);
    props.onDraft(vals);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, data, row.id]);
  const labelled = spec.displayFields.map((f) => f.column);
  const labelOf = (col: string) => spec.displayFields.find((f) => f.column === col)?.label ?? humanise(col);
  const columns = [
    ...labelled.filter((c) => c in full),
    ...Object.keys(full).filter((c) => !labelled.includes(c) && !PLUMBING.has(c)),
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${spec.label} details`}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-clay-50 p-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-clay-600">
              {spec.icon} {spec.label}
            </p>
            <p className="text-[11px] text-stone-400">{fmtTime(String(row.created_at))}</p>
          </div>
          <button onClick={onClose} className="rounded-full px-2 py-1 text-lg text-stone-400 hover:bg-clay-50" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {loadError && <p className="text-xs font-bold text-red-700">Could not load every detail: {loadError}</p>}
          {!data && !loadError && <div className="h-24 animate-pulse rounded-xl bg-clay-50" />}

          {editing ? (
            <div className="space-y-2">
              {spec.editableKeys.map((key) => {
                const f = spec.displayFields.find((x) => x.key === key) ?? {
                  key,
                  column: key,
                  label: humanise(key),
                  type: "text" as const,
                };
                return (
                  <label key={key} className="block text-[11px] font-bold text-stone-500">
                    {f.label}
                    {f.type === "longtext" ? (
                      <textarea
                        value={draft[key] ?? ""}
                        onChange={(e) => props.onDraft({ ...draft, [key]: e.target.value })}
                        rows={4}
                        className="mt-1 w-full rounded-lg border border-clay-100 p-2 text-sm font-normal"
                      />
                    ) : (
                      <input
                        type={f.type === "number" ? "number" : "text"}
                        value={draft[key] ?? ""}
                        onChange={(e) => props.onDraft({ ...draft, [key]: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-clay-100 px-2 py-1.5 text-sm font-normal"
                      />
                    )}
                  </label>
                );
              })}
              <p className="text-[10px] text-stone-400">
                Change only what is wrong — fields left as they are keep their submitted value.
              </p>
            </div>
          ) : null}

          {/* The whole submitted record stays on screen while editing, so the
              correction is made against it rather than from memory. */}
          {data && (
            <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-xs sm:grid-cols-[160px_1fr]">
              {columns.map((c) => (
                <Fragment key={c}>
                  <dt className="font-bold text-stone-500">{labelOf(c)}</dt>
                  <dd className="text-stone-800">
                    <DetailValue value={full[c]} />
                  </dd>
                </Fragment>
              ))}
            </dl>
          )}

          {data?.children
              .filter((c) => c.rows.length > 0)
              .map((c) => {
                const cols = Object.keys(c.rows[0]).filter((k) => !PLUMBING.has(k) && !/_id$/.test(k) && k !== "created_at");
                return (
                  <div key={c.table} className="space-y-1">
                    <p className="text-[11px] font-bold uppercase tracking-widest text-clay-500">
                      {humanise(c.table)} ({c.rows.length})
                    </p>
                    <div className="overflow-x-auto rounded-xl border border-clay-50">
                      <table className="w-full min-w-[480px] text-left text-[11px]">
                        <thead className="bg-clay-50/70 text-[10px] uppercase text-stone-500">
                          <tr>
                            {cols.map((k) => (
                              <th key={k} className="p-2 font-bold">
                                {humanise(k)}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {c.rows.map((r, i) => (
                            <tr key={String(r.id ?? i)} className="border-t border-clay-50 align-top">
                              {cols.map((k) => (
                                <td key={k} className="p-2 text-stone-700">
                                  {r[k] == null || r[k] === "" ? "—" : typeof r[k] === "object" ? JSON.stringify(r[k]) : String(r[k])}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}

          {props.photoIds.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {props.photoIds.map((pid) => (
                <a key={pid} href={`/api/files/${pid}`} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/files/${pid}`} alt="" className="h-20 w-20 rounded-lg object-cover" />
                </a>
              ))}
            </div>
          )}

          {error && <p className="text-xs font-bold text-red-700">{error}</p>}
        </div>

        <div className="flex flex-wrap gap-1.5 border-t border-clay-50 p-4">
          {editing ? (
            <>
              <SmallBtn label={busy ? "Saving…" : "💾 Save"} tone="green" disabled={busy} onClick={props.onSave} />
              <SmallBtn label="Cancel" onClick={props.onCancelEdit} />
            </>
          ) : (
            <>
              {spec.editableKeys.length > 0 && canEdit && <SmallBtn label="✏️ Edit" disabled={busy} onClick={props.onEdit} />}
              {isSuper && <SmallBtn label="🗑 Delete" tone="red" disabled={busy} onClick={props.onDelete} />}
              <SmallBtn label="Close" onClick={onClose} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────── Submissions ─────────────────────────────── */

/** "all" plus every registered report type. */
type CollectionFilter = "all" | SubmissionCollection;

/**
 * A submission row as the API returns it.
 *
 * `_collection` is present only in the merged view, which is why every lookup
 * falls back to the selected collection: in a single-type view the server has no
 * reason to repeat the type on all 200 rows.
 */
type SubmissionRow = Record<string, unknown> & { _collection?: string };

type SubmissionSpecLite = SubmissionSpec;

interface BinRow {
  id: string;
  collection: string;
  label: string;
  icon: string;
  summary: string | null;
  photoIds: string[];
  deletedBy: string;
  deletedAt: string;
}

/**
 * View, correct and remove anything filed through the Telegram bot.
 *
 * Columns are driven entirely by the registry in lib/submissions.ts, so a new
 * report type appears here without touching this component.
 */
/**
 * View, correct and remove anything filed through the Telegram bot.
 *
 * Columns are driven entirely by the registry in lib/submissions.ts, so a new
 * report type appears here without touching this component.
 *
 * It opens on ALL types rather than one. The old default was the free-text daily
 * report, which almost nobody files now that every role reports through a guided
 * flow — so a report filed minutes earlier sat two dropdown selections away and
 * the screen said "no submissions found", which reads as the bot being broken.
 *
 * Deleting is two-stage. A delete moves the report to the recycle bin below,
 * where it can be restored or removed for good; nothing is destroyed by a single
 * click any more.
 */
function SubmissionsTab() {
  const canEdit = useCanEdit();
  const isSuper = useIsSuper();
  const [collection, setCollection] = useState<CollectionFilter>("all");
  const [range, setRange] = useState<SubmissionRange>("24h");
  const [rows, setRows] = useState<SubmissionRow[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  /** The record's values when editing began — only what differs from these is saved. */
  const [editBase, setEditBase] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [bin, setBin] = useState<BinRow[] | null>(null);
  const [showBin, setShowBin] = useState(false);
  const [loading, setLoading] = useState(false);
  // The submission open in the detail pop-up, and a counter that makes it
  // re-read itself after an edit.
  const [open, setOpen] = useState<SubmissionRow | null>(null);
  const [openVersion, setOpenVersion] = useState(0);

  /**
   * The registry entry for one row.
   *
   * In the merged view each row names its own type; in a single-type view the
   * server has no reason to repeat it 200 times, so the selected one stands in.
   * The fallback to `daily` never fires in practice — it exists because looking
   * up SUBMISSIONS["all"] would return undefined and take the whole screen down
   * with it on the first field render.
   */
  const collectionOf = (row: SubmissionRow): SubmissionCollection => {
    const own = row._collection;
    if (own && own in SUBMISSIONS) return own as SubmissionCollection;
    return collection === "all" ? "daily" : collection;
  };
  const specOf = (row: SubmissionRow): SubmissionSpecLite => SUBMISSIONS[collectionOf(row)];

  /**
   * Reload WITHOUT blanking the screen.
   *
   * It used to start with `setRows(null)`, which swapped the whole list for a
   * skeleton on every reload — including the one that follows a delete. With
   * twenty-odd collections to read, that left the screen apparently empty for
   * as long as the round trip took, and the report was that deleting one
   * submission hides the rest. The skeleton now belongs to the FIRST load only;
   * after that the old rows stay up until the new ones arrive.
   */
  const load = useCallback(async (opts: { replace?: boolean } = {}) => {
    setError("");
    setLoading(true);
    // A filter change REPLACES the list wholesale, so the old rows are already
    // wrong and the skeleton is the honest thing to show. A background reload
    // (after a delete, say) keeps them up and only dims them — that was the
    // fix for "deleting one submission hides the rest" and must not regress.
    if (opts.replace) setRows(null);
    const p = new URLSearchParams({ collection });
    // An explicit date range wins over the quick one — otherwise picking dates
    // would silently keep filtering by "last 7 days" as well.
    if (from || to) {
      if (from) p.set("from", from);
      if (to) p.set("to", to);
    } else if (range !== "all") {
      p.set("range", range);
    }
    if (q.trim()) p.set("q", q.trim());
    p.set("limit", "200");

    try {
      const res = await fetch(`/api/submissions?${p}`);
      if (!res.ok) {
        setError((await res.json().catch(() => ({}))).error || "Could not load submissions.");
        setRows((prev) => prev ?? []);
        return;
      }
      const json = await res.json();
      setCounts(json.counts || {});
      setUnavailable(json.unavailableCollections || (json.unavailable ? [collection] : []));
      setRows(Array.isArray(json.rows) ? json.rows : []);
    } catch {
      // A failed reload must never leave `rows` at null — that is the state
      // that renders as a skeleton for ever and reads as "everything is gone".
      setError("Could not reach the server. What is on screen may be out of date.");
      setRows((prev) => prev ?? []);
    } finally {
      setLoading(false);
    }
  }, [collection, range, from, to, q]);

  const loadBin = useCallback(async () => {
    const res = await fetch("/api/submissions/bin");
    if (!res.ok) {
      setBin([]);
      return;
    }
    const json = await res.json();
    setBin(Array.isArray(json.rows) ? json.rows : []);
  }, []);

  // `load` is rebuilt whenever a filter changes, which is exactly when the list
  // should be replaced rather than refreshed underneath.
  useEffect(() => {
    load({ replace: true });
  }, [load]);
  useEffect(() => {
    loadBin();
  }, [loadBin]);

  const startEdit = (row: SubmissionRow) => {
    const spec = specOf(row);
    const d: Record<string, string> = {};
    for (const key of spec.editableKeys) d[key] = row[key] == null ? "" : String(row[key]);
    setDraft(d);
    setEditBase(d);
    setEditing(String(row.id));
  };

  const save = async (row: SubmissionRow) => {
    // Only the fields actually changed are sent. Sending the whole form wrote
    // every field back — a field that had not loaded, or was left alone, could
    // overwrite the submitted value as if the record were being re-typed.
    const changed = Object.fromEntries(Object.entries(draft).filter(([k, v]) => v !== (editBase[k] ?? "")));
    if (Object.keys(changed).length === 0) {
      setEditing(null);
      return;
    }
    setBusy(true);
    setError("");
    const res = await fetch(`/api/submissions/${collectionOf(row)}/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(changed),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "Update failed.");
      return;
    }
    setEditing(null);
    setOpenVersion((v) => v + 1);
    await load();
  };

  /**
   * Delete → recycle bin.
   *
   * A plain confirm is right here, unlike the typed DELETE this used to demand:
   * the report leaves every total immediately but is recoverable from the bin,
   * so the expensive confirmation now belongs on the permanent removal instead.
   */
  const remove = async (row: SubmissionRow) => {
    const spec = specOf(row);
    const who = spec.authorColumn ? String(row[spec.authorColumn] ?? "unknown") : "unknown";
    if (
      !confirm(
        `Delete this ${spec.label.toLowerCase()} filed by ${who}?\n\n` +
          `It moves to the recycle bin below — out of every report and total, but restorable.`
      )
    ) {
      return;
    }

    setBusy(true);
    setError("");
    const res = await fetch(`/api/submissions/${collectionOf(row)}/${row.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "Delete failed.");
      return;
    }
    // Gone from the screen the moment the server says it is gone, rather than
    // when a reload of every other collection finishes. The reload still runs,
    // to pick up anything else that changed.
    setRows((prev) => (prev ?? []).filter((r) => String(r.id) !== String(row.id)));
    setOpen(null);
    await Promise.all([load(), loadBin()]);
  };

  const restore = async (entry: BinRow) => {
    setBusy(true);
    setError("");
    const res = await fetch("/api/submissions/bin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: entry.id }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "Restore failed.");
      return;
    }
    await Promise.all([load(), loadBin()]);
  };

  /** The only irreversible action on this screen, so it keeps the typed confirm. */
  const purge = async (entry: BinRow) => {
    const answer = prompt(
      `Permanently remove this ${entry.label.toLowerCase()} from the database?\n\n` +
        `${entry.summary || ""}\n\n` +
        `This cannot be undone, and any attached photos are deleted too.\n\n` +
        `Type DELETE to confirm.`
    );
    if (answer !== "DELETE") return;

    setBusy(true);
    setError("");
    const res = await fetch(`/api/submissions/bin?id=${entry.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "Delete failed.");
      return;
    }
    await loadBin();
  };

  const photoIds = (row: SubmissionRow): string[] => {
    const spec = specOf(row);
    const out: string[] = [];
    if (spec.photosColumn && Array.isArray(row[spec.photosColumn])) {
      out.push(...(row[spec.photosColumn] as unknown[]).map(String));
    }
    if (spec.photoColumn && row[spec.photoColumn]) out.push(String(row[spec.photoColumn]));
    // Photos kept in a child table arrive pre-aggregated under this one key.
    if (Array.isArray(row.photo_ids)) out.push(...(row.photo_ids as unknown[]).map(String));
    return out;
  };

  const usingDates = Boolean(from || to);

  return (
    <div className="space-y-4 pb-10">
      {/* First, because it is the one thing on this screen that is a gap rather
          than a record: submissions whose AI verdict never arrived. */}
      <AiRecheckPanel />

      <div className="card space-y-3 p-4">
        <select
          value={collection}
          disabled={loading}
          onChange={(e) => {
            setEditing(null);
            setCollection(e.target.value as CollectionFilter);
          }}
          className="w-full rounded-lg border border-clay-100 bg-white px-3 py-2 text-sm font-bold disabled:opacity-60"
        >
          <option value="all">📋 All submissions</option>
          {SUBMISSION_COLLECTIONS.map((c) => (
            <option key={c} value={c}>
              {SUBMISSIONS[c].icon} {SUBMISSIONS[c].label}
              {counts[c] ? ` (${counts[c]})` : ""}
            </option>
          ))}
        </select>

        {/* Quick ranges. Disabled while explicit dates are set, so the screen
            never shows one filter while obeying another — and while a load is
            in flight, so a second tap cannot queue an answer that arrives after
            the first one and leaves the list disagreeing with the pills. */}
        <div className="flex flex-wrap items-center gap-1">
          {(Object.keys(SUBMISSION_RANGES) as SubmissionRange[]).map((k) => (
            <button
              key={k}
              disabled={usingDates || loading}
              onClick={() => setRange(k)}
              className={`rounded-full px-3 py-1 text-[11px] font-bold transition disabled:opacity-60 ${
                usingDates
                  ? "bg-clay-50 text-stone-300"
                  : range === k
                    ? "bg-clay-700 text-white"
                    : "bg-clay-50 text-clay-700"
              }`}
            >
              {SUBMISSION_RANGES[k].label}
            </button>
          ))}
          {loading && (
            <span className="ml-1 flex items-center gap-1 text-[11px] font-bold text-stone-400">
              <span className="inline-block animate-spin">⟳</span> Loading…
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <label className="flex-1 text-[11px] font-bold text-stone-500">
            From
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="mt-1 w-full rounded-lg border border-clay-100 px-2 py-1.5 text-xs font-normal"
            />
          </label>
          <label className="flex-1 text-[11px] font-bold text-stone-500">
            To
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="mt-1 w-full rounded-lg border border-clay-100 px-2 py-1.5 text-xs font-normal"
            />
          </label>
        </div>

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, supplier, text…"
          className="w-full rounded-lg border border-clay-100 px-3 py-2 text-sm"
        />

        {(from || to || q) && (
          <SmallBtn
            label="Clear filters"
            onClick={() => {
              setFrom("");
              setTo("");
              setQ("");
            }}
          />
        )}
      </div>

      {error && <p className="card border-l-4 border-l-red-500 p-3 text-xs font-bold text-red-700">{error}</p>}

      {unavailable.length > 0 && (
        <p className="card p-3 text-xs text-amber-700">
          {unavailable.length === 1
            ? `The ${SUBMISSIONS[unavailable[0] as SubmissionCollection]?.label ?? unavailable[0]} table isn't in the database yet`
            : `${unavailable.length} report types aren't in the database yet`}{" "}
          — apply the outstanding migrations.
        </p>
      )}

      {rows === null ? (
        // Three skeleton cards rather than one grey slab: the shape of what is
        // coming, so a range change reads as loading rather than as emptiness.
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card h-24 animate-pulse bg-clay-50" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="card p-4 text-sm text-stone-400">
          Nothing filed in this period. Widen the range above — it is set to{" "}
          {usingDates ? "the dates you picked" : SUBMISSION_RANGES[range].label.toLowerCase()}.
        </p>
      ) : (
        <div className={`space-y-2 transition-opacity ${loading ? "opacity-50" : ""}`}>
          <p className="px-1 text-[11px] font-bold text-stone-400">{rows.length} submission(s)</p>
          {rows.map((row) => {
            const spec = specOf(row);
            const id = String(row.id);
            // The first few summary fields; everything else is in the pop-up.
            const shown = spec.displayFields.filter((f) => row[f.column] != null && row[f.column] !== "").slice(0, 3);
            return (
              <button
                key={`${collectionOf(row)}-${id}`}
                type="button"
                onClick={() => {
                  setEditing(null);
                  setOpen(row);
                }}
                className="card block w-full space-y-1 p-3 text-left transition hover:border-clay-300 hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-clay-600">
                    {spec.icon} {spec.label}
                  </p>
                  <span className="text-[10px] font-bold text-clay-500">Details ›</span>
                </div>
                {shown.map((f) => (
                  <p key={f.key} className="truncate text-xs">
                    <span className="font-bold text-stone-500">{f.label}: </span>
                    <span className="text-stone-700">{String(row[f.column])}</span>
                  </p>
                ))}
                <p className="text-[10px] text-stone-400">
                  {fmtTime(String(row.created_at))}
                  {photoIds(row).length > 0 ? ` · 📷 ${photoIds(row).length}` : ""}
                </p>
              </button>
            );
          })}
        </div>
      )}

      {open && (
        <SubmissionDetail
          key={`${collectionOf(open)}-${String(open.id)}-${openVersion}`}
          collection={collectionOf(open)}
          row={open}
          spec={specOf(open)}
          photoIds={photoIds(open)}
          editing={editing === String(open.id)}
          draft={draft}
          busy={busy}
          error={error}
          onDraft={setDraft}
          onBase={setEditBase}
          onEdit={() => startEdit(open)}
          onCancelEdit={() => setEditing(null)}
          onSave={() => save(open)}
          onDelete={() => remove(open)}
          onClose={() => {
            setEditing(null);
            setOpen(null);
          }}
        />
      )}

      {/* ───────────────────────────── Recycle bin ──────────────────────────── */}
      <div className="space-y-2 border-t border-clay-100 pt-4">
        <button
          onClick={() => setShowBin((v) => !v)}
          className="flex w-full items-center justify-between rounded-lg bg-clay-50 px-3 py-2 text-left"
        >
          <span className="text-sm font-bold text-clay-800">
            🗑 Recycle bin {bin ? `(${bin.length})` : ""}
          </span>
          <span className="text-xs text-stone-500">{showBin ? "Hide" : "Show"}</span>
        </button>

        {showBin &&
          (bin === null ? (
            <div className="card h-20 animate-pulse bg-clay-50" />
          ) : bin.length === 0 ? (
            <p className="card p-4 text-sm text-stone-400">
              Nothing deleted. Deleted submissions wait here until you restore them or remove them for good.
            </p>
          ) : (
            <>
              <p className="px-1 text-[11px] leading-snug text-stone-400">
                These are out of every report and total already. Restoring puts one back exactly as it was,
                photos included; removing it is permanent.
              </p>
              {bin.map((entry) => (
                <div key={entry.id} className="card space-y-2 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-stone-500">
                    {entry.icon} {entry.label}
                  </p>
                  <p className="text-xs text-stone-700">{entry.summary || "—"}</p>
                  <p className="text-[10px] text-stone-400">
                    Deleted {fmtTime(entry.deletedAt)} by {entry.deletedBy}
                    {entry.photoIds.length > 0 ? ` · ${entry.photoIds.length} photo(s) kept` : ""}
                  </p>
                  {canEdit && (
                    <div className="flex gap-1.5 border-t border-clay-50 pt-2">
                      <SmallBtn label="↩️ Restore" tone="green" disabled={busy} onClick={() => restore(entry)} />
                      {isSuper && (
                        <SmallBtn label="🗑 Remove for good" tone="red" disabled={busy} onClick={() => purge(entry)} />
                      )}
                    </div>
                  )}
                </div>
              ))}
            </>
          ))}
      </div>
    </div>
  );
}

/* ──────────────────────────────────── Errors ──────────────────────────────── */

interface ErrorRow {
  id: string;
  source: string;
  kind: string;
  message: string;
  detail: Record<string, unknown> | null;
  actor: string | null;
  chatId: string | null;
  createdAt: string;
  resolvedAt: string | null;
  last24h: number;
}

/**
 * What has been failing.
 *
 * Before this screen existed, a Gemini timeout reached exactly one person — the
 * salesperson holding the phone — and left no trace anywhere else. Nobody could
 * answer how often it happened or whether it was still happening.
 *
 * The 24-hour count beside each row is the point of it: one timeout is weather,
 * forty is a broken deployment, and the message alone cannot tell them apart.
 */
/**
 * Does the database have the columns this deployment writes to?
 *
 * Migrations are applied by hand here, so a deploy can run ahead of its schema.
 * `insertRow` keeps that from losing a submission, but the drift itself was only
 * ever visible as a `schema_column_missing` row naming a column — never the file
 * that adds it. This names the file.
 */
function SchemaCheck() {
  // The route adds the name of the one file that fixes everything at once.
  const [report, setReport] = useState<(SchemaReport & { backfill: string }) | null>(null);
  const [checking, setChecking] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/admin/schema");
      setReport(res.ok ? await res.json() : null);
    } catch {
      setReport(null);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  if (!report) {
    return <div className="card h-14 animate-pulse bg-clay-50" />;
  }

  // Grouped by the file to run: four missing columns from one migration is one
  // action, not four.
  const byMigration = new Map<string, string[]>();
  for (const m of report.missing) {
    byMigration.set(m.migration, [...(byMigration.get(m.migration) ?? []), `${m.table}.${m.column}`]);
  }
  for (const t of report.missingTables) {
    byMigration.set(t.migration, [...(byMigration.get(t.migration) ?? []), `${t.table} (whole table)`]);
  }

  if (report.ok) {
    return (
      <div className="card flex items-center justify-between gap-2 border-l-4 border-l-green-500 p-3">
        <p className="text-xs font-bold text-green-800">✅ Database schema matches the code.</p>
        <button
          onClick={check}
          disabled={checking}
          className="shrink-0 rounded-full bg-stone-100 px-2.5 py-1 text-[10px] font-bold text-stone-600 disabled:opacity-50"
        >
          {checking ? "…" : "Re-check"}
        </button>
      </div>
    );
  }

  return (
    <div className="card space-y-2 border-l-4 border-l-red-500 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-bold text-red-800">
          {report.error
            ? "⚠️ The schema check could not run."
            : `⚠️ The database is missing ${report.missing.length + report.missingTables.length} thing(s) the code writes to.`}
        </p>
        <button
          onClick={check}
          disabled={checking}
          className="shrink-0 rounded-full bg-stone-100 px-2.5 py-1 text-[10px] font-bold text-stone-600 disabled:opacity-50"
        >
          {checking ? "…" : "Re-check"}
        </button>
      </div>

      {report.error ? (
        <p className="text-[11px] text-stone-500">{report.error}</p>
      ) : (
        <>
          {[...byMigration.entries()].map(([migration, items]) => (
            <div key={migration} className="rounded-lg bg-stone-50 p-2">
              <p className="font-mono text-[10px] font-bold text-stone-700">{migration}</p>
              <p className="mt-0.5 text-[11px] text-stone-500">{items.join(" · ")}</p>
            </div>
          ))}
          <p className="text-[11px] text-stone-500">
            Run the file named against each group above in the Supabase SQL editor; every one of them is safe to
            run more than once. <span className="font-mono font-bold text-clay-800">{report.backfill}</span> covers
            all of the optional report columns in one go. Until then those values are dropped as reports are saved
            (the reports themselves are kept).
          </p>
        </>
      )}
    </div>
  );
}

/**
 * A button per outside service — Gemini, Nemotron, Qwen, Telegram, the
 * database — each making one real, minimal call. The same checks run on their
 * own once a day (the "api-health" job); the card opens on that run's results,
 * so a failure overnight is on screen before anyone presses anything.
 */
interface HealthRow {
  key: string;
  label: string;
  ok: boolean;
  skipped?: boolean;
  ms: number;
  detail: string;
}

function ApiChecks() {
  const [checks, setChecks] = useState<{ key: string; label: string }[]>([]);
  const [results, setResults] = useState<Record<string, HealthRow>>({});
  const [lastRun, setLastRun] = useState<{ at: string; ok: boolean | null; summary: string | null } | null>(null);
  const [running, setRunning] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch("/api/admin/health")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setChecks(d.checks ?? []);
        if (d.lastRun) {
          setLastRun(d.lastRun);
          setResults(Object.fromEntries((d.lastRun.results as HealthRow[]).map((r) => [r.key, r])));
        }
      })
      .catch(() => {});
  }, []);

  const run = async (key?: string) => {
    const keys = key ? [key] : checks.map((c) => c.key);
    setRunning((r) => ({ ...r, ...Object.fromEntries(keys.map((k) => [k, true])) }));
    try {
      const res = await fetch("/api/admin/health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(key ? { key } : {}),
      });
      const d = await res.json().catch(() => null);
      for (const r of (d?.results ?? []) as HealthRow[]) setResults((prev) => ({ ...prev, [r.key]: r }));
    } finally {
      setRunning((r) => ({ ...r, ...Object.fromEntries(keys.map((k) => [k, false])) }));
    }
  };

  if (checks.length === 0) return <div className="card h-14 animate-pulse bg-clay-50" />;
  const anyRunning = Object.values(running).some(Boolean);

  return (
    <div className="card space-y-2 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-xs font-bold text-stone-800">🔌 API checks</p>
          <p className="text-[10px] text-stone-400">
            {lastRun
              ? `Automatic, once a day · last run ${new Date(lastRun.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}${lastRun.ok === false ? " — something failed" : ""}`
              : "Automatic, once a day · no run recorded yet"}
          </p>
        </div>
        <button
          onClick={() => run()}
          disabled={anyRunning}
          className="rounded-full bg-clay-700 px-3 py-1 text-[11px] font-bold text-white disabled:opacity-50"
        >
          {anyRunning ? "Testing…" : "Test all"}
        </button>
      </div>
      <div className="divide-y divide-clay-50">
        {checks.map((c) => {
          const r = results[c.key];
          const busy = running[c.key];
          const icon = busy ? "⏳" : !r ? "▫️" : r.skipped ? "➖" : r.ok ? "✅" : "❌";
          return (
            <div key={c.key} className="flex items-start justify-between gap-2 py-1.5">
              <div className="min-w-0">
                <p className="text-[11px] font-bold text-stone-700">
                  {icon} {c.label}
                  {r && !busy && <span className="ml-1 font-normal text-stone-400">{(r.ms / 1000).toFixed(1)} s</span>}
                </p>
                {r && !busy && (
                  <p className={`break-words text-[10px] ${r.ok ? "text-stone-500" : r.skipped ? "text-stone-400" : "text-red-700"}`}>
                    {r.skipped ? `Not configured — ${r.detail}` : r.detail}
                  </p>
                )}
              </div>
              <button
                onClick={() => run(c.key)}
                disabled={busy}
                className="shrink-0 rounded-full bg-stone-100 px-2.5 py-1 text-[10px] font-bold text-stone-600 disabled:opacity-50"
              >
                {busy ? "…" : "Test"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ErrorsTab() {
  const [rows, setRows] = useState<ErrorRow[] | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setRows(null);
    const res = await fetch(`/api/errors${showResolved ? "?all=1" : ""}`);
    if (!res.ok) {
      setRows([]);
      return;
    }
    const json = await res.json();
    setRows(Array.isArray(json.rows) ? json.rows : []);
  }, [showResolved]);

  useEffect(() => {
    load();
  }, [load]);

  const resolve = async (id: string) => {
    setBusy(true);
    await fetch("/api/errors", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => {});
    setBusy(false);
    await load();
  };

  return (
    <div className="space-y-3 pb-10">
      {/* Above the error list on purpose: a missing column is the CAUSE of the
          schema_column_missing rows below it, and reading those without it is
          how the drift went unnoticed for days. */}
      <SchemaCheck />
      {/* The same place for the same reason: a dead key is the cause of a run of
          provider errors below, and pressing one button says which. */}
      <ApiChecks />

      <div className="flex items-center justify-between gap-2 px-1">
        <p className="text-[11px] text-stone-500">
          {rows === null ? "Loading…" : `${rows.length} ${showResolved ? "recorded" : "open"}`}
        </p>
        <button
          onClick={() => setShowResolved((v) => !v)}
          className="rounded-full bg-clay-50 px-3 py-1 text-[11px] font-bold text-clay-700"
        >
          {showResolved ? "Open only" : "Include resolved"}
        </button>
      </div>

      {rows === null ? (
        <div className="card h-24 animate-pulse bg-clay-50" />
      ) : rows.length === 0 ? (
        <p className="card p-4 text-sm text-stone-400">
          {showResolved ? "Nothing recorded." : "Nothing failing. 🎉"}
        </p>
      ) : (
        rows.map((r) => (
          <div key={r.id} className="card space-y-1.5 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">
                {r.kind}
              </span>
              <span className="text-[11px] font-bold text-stone-500">{r.source}</span>
              {r.last24h > 1 && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                  {r.last24h}× in 24h
                </span>
              )}
              {r.resolvedAt && (
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-700">
                  resolved
                </span>
              )}
              <span className="ml-auto text-[10px] text-stone-400">{fmtTime(r.createdAt)}</span>
            </div>

            <p className="whitespace-pre-wrap break-words text-xs text-stone-700">{r.message}</p>

            {(r.actor || r.chatId) && (
              <p className="text-[10px] text-stone-400">
                {r.actor ?? "—"}
                {r.chatId ? ` · chat ${r.chatId}` : ""}
              </p>
            )}

            {r.detail && Object.keys(r.detail).length > 0 && (
              <pre className="overflow-x-auto rounded bg-clay-50 p-2 text-[10px] text-stone-600">
                {JSON.stringify(r.detail, null, 1)}
              </pre>
            )}

            {!r.resolvedAt && (
              <div className="border-t border-clay-50 pt-2">
                <SmallBtn label="✓ Mark resolved" tone="green" disabled={busy} onClick={() => resolve(r.id)} />
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}


/* ─────────────────────────────────── Devices ──────────────────────────────── */

interface WebSession {
  _id: string;
  label: string | null;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

function DevicesTab() {
  const [sessions, setSessions] = useState<WebSession[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/web-sessions");
    if (res.ok) setSessions((await res.json()).sessions);
    else setSessions([]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const revoke = async (s: WebSession) => {
    if (!confirm(s.current ? "Revoke THIS device? You'll be logged out." : "Revoke this device's access?")) return;
    setBusy(true);
    await fetch(`/api/web-sessions/${s._id}`, { method: "DELETE" }).catch(() => {});
    setBusy(false);
    await load();
  };

  if (!sessions) return <p className="py-10 text-center text-sm text-stone-400">Loading…</p>;

  return (
    <div className="space-y-3">
      <p className="text-xs text-stone-500">
        Browsers currently signed into the dashboard. Revoke any you don&apos;t recognise — that device is signed out
        on its next request.
      </p>
      {sessions.length === 0 && <p className="py-8 text-center text-sm text-stone-400">No active devices.</p>}
      {sessions.map((s) => (
        <div key={s._id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-stone-200 bg-white p-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-bold text-stone-900">{s.label || "Device"}</h3>
              {s.current && (
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-bold text-green-800">
                  This device
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[11px] text-stone-400">
              {s.ip ? `IP ${s.ip} · ` : ""}last active {fmtTime(s.lastSeenAt)} · since {fmtTime(s.createdAt)}
            </p>
          </div>
          <SmallBtn label={s.current ? "Log out" : "Revoke"} tone="red" disabled={busy} onClick={() => revoke(s)} />
        </div>
      ))}
    </div>
  );
}

/* ────────────────────────────────── Employees ─────────────────────────────── */

function UsersTab() {
  // HR sees the list only; the Chief manages bot users but deletes nothing.
  const canEdit = useCanEdit();
  const isSuper = useIsSuper();
  const [users, setUsers] = useState<BotUser[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);

  const load = useCallback(async () => {
    const res = await fetch("/api/bot-users");
    if (res.ok) setUsers(await res.json());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/bot-users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fullName, password, ...selectionBody(selection) }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "Could not create employee.");
      return;
    }
    setFullName("");
    setPassword("");
    setSelection(EMPTY_SELECTION);
    await load();
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/bot-users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) setError((await res.json().catch(() => ({}))).error || "Update failed.");
    await load();
  };

  const archive = async (id: string, name: string) => {
    if (
      !confirm(
        `Archive ${name}? Their Telegram access is revoked immediately, but their record and all submitted reports stay on the dashboard. You can restore them later.`
      )
    )
      return;
    setBusy(true);
    await fetch(`/api/bot-users/${id}`, { method: "DELETE" });
    setBusy(false);
    await load();
  };

  const purge = async (id: string, name: string) => {
    if (
      !confirm(
        `Permanently delete ${name}? Their account record is removed and they disappear from this list. All reports they submitted stay on the dashboard. This cannot be undone.`
      )
    )
      return;
    setBusy(true);
    await fetch(`/api/bot-users/${id}?hard=true`, { method: "DELETE" });
    setBusy(false);
    await load();
  };

  const resetPassword = async (id: string, name: string) => {
    const pw = prompt(`New password for ${name} (min 6 characters).\nThey will be signed out of Telegram immediately.`);
    if (!pw) return;
    await patch(id, { password: pw });
  };

  return (
    <div className="space-y-5">
      {/* Add employee */}
      {canEdit && (
      <form onSubmit={create} className="rounded-2xl border border-stone-200 bg-white p-4">
        <h2 className="text-sm font-bold text-stone-900">Add a Telegram user</h2>
        <p className="mt-0.5 text-xs text-stone-500">
          The employee signs into the bot with exactly this full name and password.
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Full name (e.g. Abebe Kebede)"
            className="rounded-xl border border-stone-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-clay-500"
          />
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="text"
            placeholder="Password (min 6 characters)"
            className="rounded-xl border border-stone-200 px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-clay-500"
          />
        </div>

        <div className="mt-3">
          <FunctionalityPicker value={selection} onChange={setSelection} />
        </div>

        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

        <button
          disabled={busy || !fullName || !password || selectionEmpty(selection)}
          className="mt-3 rounded-xl bg-clay-700 px-4 py-2.5 text-sm font-bold text-white transition active:scale-[0.98] disabled:opacity-50"
        >
          {busy ? "Saving…" : "Add employee"}
        </button>
      </form>
      )}

      {/* Existing employees */}
      {users.length === 0 && <p className="py-10 text-center text-sm text-stone-400">No Telegram users yet.</p>}

      <div className="space-y-3">
        {users
          .filter((u) => !u.archivedAt)
          .map((u) => {
          const locked = u.lockedUntil && new Date(u.lockedUntil).getTime() > Date.now();
          return (
            <div key={u._id} className="rounded-2xl border border-stone-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-bold text-stone-900">{u.fullName}</h3>
                    {!u.active && (
                      <span className="rounded-full bg-stone-200 px-2 py-0.5 text-[11px] font-bold text-stone-600">
                        Deactivated
                      </span>
                    )}
                    {u.active && u.loggedIn && (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-bold text-green-800">
                        Signed in
                      </span>
                    )}
                    {locked && (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700">
                        Locked
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-stone-500">{selectionSummary(u)}</p>
                  <p className="mt-0.5 text-[11px] text-stone-400">
                    {u.lastLoginAt ? `Last login ${fmtTime(u.lastLoginAt)}` : "Never signed in"}
                    {u.chatId ? ` · chat ${u.chatId}` : ""}
                  </p>
                </div>
              </div>

              {canEdit && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                <SmallBtn label="Edit functionalities" onClick={() => setEditing(editing === u._id ? null : u._id)} />
                <SmallBtn label="Reset password" onClick={() => resetPassword(u._id, u.fullName)} />
                {u.loggedIn && <SmallBtn label="Force sign-out" onClick={() => patch(u._id, { forceLogout: true })} />}
                {locked && <SmallBtn label="Unlock" onClick={() => patch(u._id, { unlock: true })} />}
                <SmallBtn
                  label={u.active ? "Deactivate" : "Reactivate"}
                  tone={u.active ? "amber" : "green"}
                  onClick={() => patch(u._id, { active: !u.active })}
                />
                {isSuper && <SmallBtn label="Archive" tone="red" onClick={() => archive(u._id, u.fullName)} />}
              </div>
              )}

              {editing === u._id && (
                <PositionEditor
                  initial={positionsToSelection(u.positions, u.capabilities)}
                  onCancel={() => setEditing(null)}
                  onSave={async (next) => {
                    // The buttons are always sent as the explicit list; HR or
                    // Admin with none ticked sends [] and is receive-only.
                    await patch(u._id, selectionBody(next));
                    setEditing(null);
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Archived employees — bot access revoked, record & history retained */}
      {users.some((u) => u.archivedAt) && (
        <div>
          <h2 className="mb-2 mt-2 text-xs font-bold uppercase tracking-widest text-stone-400">
            Archived ({users.filter((u) => u.archivedAt).length})
          </h2>
          <p className="mb-3 text-[11px] text-stone-400">
            These employees can no longer sign into the bot, but their reports stay on the dashboard.
          </p>
          <div className="space-y-2">
            {users
              .filter((u) => u.archivedAt)
              .map((u) => (
                <div
                  key={u._id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-stone-200 bg-stone-50 p-4"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-bold text-stone-700">{u.fullName}</h3>
                      <span className="rounded-full bg-stone-200 px-2 py-0.5 text-[11px] font-bold text-stone-600">
                        Archived
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-stone-400">{selectionSummary(u)}</p>
                    <p className="mt-0.5 text-[11px] text-stone-400">
                      {u.archivedAt ? `Archived ${fmtTime(u.archivedAt)}` : ""} · reports kept
                    </p>
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-2">
                      <SmallBtn label="Restore" tone="green" onClick={() => patch(u._id, { restore: true })} />
                      {isSuper && <SmallBtn label="Delete" tone="red" onClick={() => purge(u._id, u.fullName)} />}
                    </div>
                  )}
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PositionEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: Selection;
  onSave: (next: Selection) => void;
  onCancel: () => void;
}) {
  const [next, setNext] = useState<Selection>(initial);

  return (
    <div className="mt-3 rounded-xl bg-stone-50 p-3">
      <FunctionalityPicker value={next} onChange={setNext} />
      <div className="mt-3 flex gap-2">
        <SmallBtn
          label="Save"
          tone="green"
          onClick={() => onSave(next)}
          // Nothing ticked is no menu and no digest: deactivate instead.
          disabled={selectionEmpty(next)}
        />
        <SmallBtn label="Cancel" onClick={onCancel} />
      </div>
    </div>
  );
}

/* ───────────────────────── Bot functionality picker ───────────────────────── */

/**
 * One flat list: every bot button, then HR and ADMIN. What is ticked is exactly
 * the employee's bot menu. The department roles behind it are worked out on save
 * (selectionToPositions) and never shown: picking roles and then buttons inside
 * them was the confusing part.
 */
function FunctionalityPicker({ value, onChange }: { value: Selection; onChange: (next: Selection) => void }) {
  const toggleCap = (key: CapabilityKey) => {
    const on = value.caps.includes(key);
    const caps = on ? value.caps.filter((k) => k !== key) : [...value.caps, key];
    // Kept in list order, so the saved menu matches what is shown here.
    onChange({ ...value, caps: BOT_FUNCTIONALITIES.filter((k) => caps.includes(k)) });
  };

  const row = (key: string, checked: boolean, onToggle: () => void, label: string, note?: string) => (
    <label
      key={key}
      className={`flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-xs transition ${
        checked ? "bg-clay-50 text-stone-900" : "text-stone-600 hover:bg-stone-50"
      }`}
    >
      <input type="checkbox" checked={checked} onChange={onToggle} className="mt-0.5 accent-clay-700" />
      <span className="min-w-0">
        <span className="block">{label}</span>
        {note && <span className="block text-[11px] text-stone-400">{note}</span>}
      </span>
    </label>
  );

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-3">
      <p className="text-[11px] font-bold uppercase tracking-widest text-stone-500">Bot functionalities</p>
      <p className="mt-0.5 text-[11px] text-stone-400">What is ticked is exactly this employee&apos;s bot menu.</p>
      <div className="mt-2 grid gap-0.5 sm:grid-cols-2">
        {BOT_FUNCTIONALITIES.map((key) =>
          row(key, value.caps.includes(key), () => toggleCap(key), CAPABILITIES[key].button)
        )}
      </div>
      <div className="mt-2 grid gap-0.5 border-t border-stone-100 pt-2 sm:grid-cols-2">
        {row(
          "hr",
          value.hr,
          () => onChange({ ...value, hr: !value.hr }),
          "👥 የሰው ኃይል (HR)",
          "Gets the daily report on departmental activities only."
        )}
        {row(
          "admin",
          value.admin,
          () => onChange({ ...value, admin: !value.admin }),
          "🛡 ADMIN",
          "Gets the report on everything, including system status."
        )}
      </div>
      {(value.hr || value.admin) && value.caps.length === 0 && (
        <p className="mt-2 text-[11px] text-stone-500">No buttons ticked: this person only receives reports.</p>
      )}
    </div>
  );
}

/* ──────────────────────────────── Bot activity ────────────────────────────── */

function ActivityTab() {
  const [items, setItems] = useState<Activity[]>([]);
  const [last24h, setLast24h] = useState<Record<string, number>>({});

  useEffect(() => {
    fetch("/api/bot-activity")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setItems(d.items);
          setLast24h(d.last24h);
        }
      })
      .catch(() => {});
  }, []);

  const alerts = (last24h.login_failed || 0) + (last24h.unauthorized || 0) + (last24h.login_locked || 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Metric label="Submissions 24h" value={last24h.submission || 0} tone="text-blue-700" />
        <Metric label="Logins 24h" value={last24h.login_success || 0} tone="text-green-700" />
        <Metric label="Security events" value={alerts} tone={alerts ? "text-red-700" : "text-stone-400"} />
      </div>

      {items.length === 0 && <p className="py-10 text-center text-sm text-stone-400">No bot activity yet.</p>}

      <div className="space-y-1.5">
        {items.map((a) => (
          <div
            key={a._id}
            className={`flex flex-wrap items-center gap-2 rounded-xl border bg-white px-3 py-2.5 ${
              a.ok ? "border-stone-100" : "border-red-200"
            }`}
          >
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                ACTION_STYLES[a.action] || "bg-stone-100 text-stone-500"
              }`}
            >
              {a.action.replace(/_/g, " ")}
            </span>
            <span className="text-xs font-semibold text-stone-800">{a.actor}</span>
            {a.detail && <span className="font-mono text-[11px] text-stone-500">{a.detail}</span>}
            <span className="ml-auto text-[11px] text-stone-400">
              {a.audience === "external" ? "external · " : ""}
              {fmtTime(a.createdAt)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400">{label}</p>
      <p className={`mt-1 font-display text-xl font-bold ${tone}`}>{value}</p>
    </div>
  );
}

const TONES: Record<string, string> = {
  neutral: "bg-stone-100 text-stone-700 hover:bg-stone-200",
  green: "bg-green-600 text-white hover:bg-green-700",
  amber: "bg-amber-500 text-white hover:bg-amber-600",
  red: "bg-red-500 text-white hover:bg-red-600",
};

function SmallBtn({
  label,
  onClick,
  tone = "neutral",
  disabled,
}: {
  label: string;
  onClick: () => void;
  tone?: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-full px-3 py-1.5 text-xs font-bold transition active:scale-95 disabled:opacity-40 ${TONES[tone]}`}
    >
      {label}
    </button>
  );
}
