"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CAPABILITIES,
  POSITIONS,
  POSITION_GROUPS,
  capabilitiesFor,
  resolveCapabilities,
  toggleCapability,
  type CapabilityKey,
  type PositionKey,
} from "@/lib/positions";
import {
  SUBMISSIONS,
  SUBMISSION_COLLECTIONS,
  type SubmissionCollection,
} from "@/lib/submissions";
import { InstallButton } from "@/components/InstallPrompt";

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

type Tab = "users" | "submissions" | "activity" | "devices";

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("users");
  const router = useRouter();

  const logout = async () => {
    if (!confirm("Log out of this browser?")) return;
    await fetch("/api/logout", { method: "POST" }).catch(() => {});
    router.push("/login");
  };

  return (
    <main className="max-w-4xl mx-auto px-4 pb-10">
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
        {(["users", "submissions", "activity", "devices"] as const).map((t) => (
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
              : t === "activity"
              ? "Bot activity"
              : "Devices"}
          </button>
        ))}
      </div>

      {tab === "users" && <UsersTab />}
      {tab === "submissions" && <SubmissionsTab />}
      {tab === "activity" && <ActivityTab />}
      {tab === "devices" && <DevicesTab />}
    </main>
  );
}

/* ──────────────────────────────── Submissions ─────────────────────────────── */

/**
 * View, correct and remove anything filed through the Telegram bot.
 *
 * Columns are driven entirely by the registry in lib/submissions.ts, so a new
 * report type appears here without touching this component.
 */
function SubmissionsTab() {
  const [collection, setCollection] = useState<SubmissionCollection>("daily");
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const spec = SUBMISSIONS[collection];

  const load = useCallback(async () => {
    setRows(null);
    setError("");
    const p = new URLSearchParams({ collection });
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (q.trim()) p.set("q", q.trim());
    const res = await fetch(`/api/submissions?${p}`);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "Could not load submissions.");
      setRows([]);
      return;
    }
    const json = await res.json();
    setUnavailable(Boolean(json.unavailable));
    setRows(Array.isArray(json.rows) ? json.rows : []);
  }, [collection, from, to, q]);

  useEffect(() => {
    load();
  }, [load]);

  const startEdit = (row: Record<string, unknown>) => {
    const d: Record<string, string> = {};
    for (const key of spec.editableKeys) d[key] = row[key] == null ? "" : String(row[key]);
    setDraft(d);
    setEditing(String(row.id));
  };

  const save = async (id: string) => {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/submissions/${collection}/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "Update failed.");
      return;
    }
    setEditing(null);
    await load();
  };

  const remove = async (row: Record<string, unknown>) => {
    const who = spec.authorColumn ? String(row[spec.authorColumn] ?? "unknown") : "unknown";
    // A typed confirmation, not a plain OK: this is an unrecoverable delete of
    // someone's filed report, and the row is gone from the reports and the
    // totals along with it.
    const answer = prompt(
      `Permanently DELETE this ${spec.label.toLowerCase()} filed by ${who}?\n\n` +
        `This cannot be undone, and any attached photos are removed too.\n\n` +
        `Type DELETE to confirm.`
    );
    if (answer !== "DELETE") return;

    setBusy(true);
    setError("");
    const res = await fetch(`/api/submissions/${collection}/${row.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "Delete failed.");
      return;
    }
    await load();
  };

  const photoIds = (row: Record<string, unknown>): string[] => {
    const out: string[] = [];
    if (spec.photosColumn && Array.isArray(row[spec.photosColumn])) {
      out.push(...(row[spec.photosColumn] as unknown[]).map(String));
    }
    if (spec.photoColumn && row[spec.photoColumn]) out.push(String(row[spec.photoColumn]));
    // Photos kept in a child table arrive pre-aggregated under this one key.
    if (Array.isArray(row.photo_ids)) out.push(...(row.photo_ids as unknown[]).map(String));
    return out;
  };

  return (
    <div className="space-y-4 pb-10">
      <div className="card space-y-3 p-4">
        <select
          value={collection}
          onChange={(e) => {
            setEditing(null);
            setCollection(e.target.value as SubmissionCollection);
          }}
          className="w-full rounded-lg border border-clay-100 bg-white px-3 py-2 text-sm font-bold"
        >
          {SUBMISSION_COLLECTIONS.map((c) => (
            <option key={c} value={c}>
              {SUBMISSIONS[c].icon} {SUBMISSIONS[c].label}
            </option>
          ))}
        </select>

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

      {unavailable && (
        <p className="card p-3 text-xs text-amber-700">
          This table isn&apos;t in the database yet — apply the outstanding migrations.
        </p>
      )}

      {rows === null ? (
        <div className="card h-32 animate-pulse bg-clay-50" />
      ) : rows.length === 0 ? (
        <p className="card p-4 text-sm text-stone-400">No {spec.label.toLowerCase()} submissions found.</p>
      ) : (
        <div className="space-y-2">
          <p className="px-1 text-[11px] font-bold text-stone-400">{rows.length} submission(s)</p>
          {rows.map((row) => {
            const id = String(row.id);
            const isEditing = editing === id;
            return (
              <div key={id} className="card space-y-2 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    {spec.displayFields.map((f) => {
                      const value = row[f.column];
                      if (value == null || value === "") return null;
                      return (
                        <p key={f.key} className="text-xs">
                          <span className="font-bold text-stone-500">{f.label}: </span>
                          <span className={f.type === "longtext" ? "whitespace-pre-wrap text-stone-700" : "text-stone-700"}>
                            {String(value)}
                          </span>
                        </p>
                      );
                    })}
                    <p className="text-[10px] text-stone-400">{fmtTime(String(row.created_at))}</p>
                  </div>
                </div>

                {photoIds(row).length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {photoIds(row).map((pid) => (
                      <a key={pid} href={`/api/files/${pid}`} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/files/${pid}`} alt="" className="h-16 w-16 rounded-lg object-cover" />
                      </a>
                    ))}
                  </div>
                )}

                {isEditing ? (
                  <div className="space-y-2 border-t border-clay-50 pt-2">
                    {spec.editableKeys.map((key) => {
                      const f = spec.displayFields.find((x) => x.key === key);
                      if (!f) return null;
                      return (
                        <label key={key} className="block text-[11px] font-bold text-stone-500">
                          {f.label}
                          {f.type === "longtext" ? (
                            <textarea
                              value={draft[key] ?? ""}
                              onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                              rows={4}
                              className="mt-1 w-full rounded-lg border border-clay-100 p-2 text-sm font-normal"
                            />
                          ) : (
                            <input
                              type={f.type === "number" ? "number" : "text"}
                              value={draft[key] ?? ""}
                              onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                              className="mt-1 w-full rounded-lg border border-clay-100 px-2 py-1.5 text-sm font-normal"
                            />
                          )}
                        </label>
                      );
                    })}
                    <div className="flex gap-1.5">
                      <SmallBtn label={busy ? "Saving…" : "Save"} tone="green" disabled={busy} onClick={() => save(id)} />
                      <SmallBtn label="Cancel" onClick={() => setEditing(null)} />
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-1.5 border-t border-clay-50 pt-2">
                    {spec.editableKeys.length > 0 && (
                      <SmallBtn label="✏️ Edit" disabled={busy} onClick={() => startEdit(row)} />
                    )}
                    <SmallBtn label="🗑 Delete" tone="red" disabled={busy} onClick={() => remove(row)} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
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
  const [users, setUsers] = useState<BotUser[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [positions, setPositions] = useState<PositionKey[]>([]);
  const [caps, setCaps] = useState<CapabilityKey[] | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/bot-users");
    if (res.ok) setUsers(await res.json());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const togglePosition = (p: PositionKey) =>
    setPositions((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/bot-users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fullName, password, positions, capabilities: caps ?? [] }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "Could not create employee.");
      return;
    }
    setFullName("");
    setPassword("");
    setPositions([]);
    setCaps(null);
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

        <p className="mt-3 text-xs font-bold uppercase tracking-widest text-stone-400">Departments &amp; reports</p>
        <p className="mt-0.5 text-[11px] text-stone-400">
          Tick any reports across departments this employee should handle.
        </p>
        <div className="mt-2">
          <PositionPicker selected={positions} onToggle={togglePosition} caps={caps} onCapsChange={setCaps} />
        </div>

        {positions.length > 0 && (
          <p className="mt-2 text-[11px] text-stone-500">
            Bot menu:{" "}
            <span className="font-medium text-stone-700">
              {resolveCapabilities(positions, caps)
                .map((c) => c.button)
                .join("  ·  ")}
            </span>
          </p>
        )}

        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

        <button
          disabled={busy || !fullName || !password || positions.length === 0}
          className="mt-3 rounded-xl bg-clay-700 px-4 py-2.5 text-sm font-bold text-white transition active:scale-[0.98] disabled:opacity-50"
        >
          {busy ? "Saving…" : "Add employee"}
        </button>
      </form>

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
                  <p className="mt-0.5 text-xs text-stone-500">
                    {u.positions.map((p) => POSITIONS[p]?.en).filter(Boolean).join(" · ") || "No position"}
                  </p>
                  <p className="mt-0.5 text-[11px] text-stone-400">
                    {u.lastLoginAt ? `Last login ${fmtTime(u.lastLoginAt)}` : "Never signed in"}
                    {u.chatId ? ` · chat ${u.chatId}` : ""}
                  </p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                <SmallBtn label="Edit positions" onClick={() => setEditing(editing === u._id ? null : u._id)} />
                <SmallBtn label="Reset password" onClick={() => resetPassword(u._id, u.fullName)} />
                {u.loggedIn && <SmallBtn label="Force sign-out" onClick={() => patch(u._id, { forceLogout: true })} />}
                {locked && <SmallBtn label="Unlock" onClick={() => patch(u._id, { unlock: true })} />}
                <SmallBtn
                  label={u.active ? "Deactivate" : "Reactivate"}
                  tone={u.active ? "amber" : "green"}
                  onClick={() => patch(u._id, { active: !u.active })}
                />
                <SmallBtn label="Archive" tone="red" onClick={() => archive(u._id, u.fullName)} />
              </div>

              {editing === u._id && (
                <PositionEditor
                  initial={u.positions}
                  initialCaps={u.capabilities?.length ? u.capabilities : null}
                  onCancel={() => setEditing(null)}
                  onSave={async (next, nextCaps) => {
                    // Always send capabilities: an empty array clears the
                    // override, which is how "reset to defaults" is expressed.
                    await patch(u._id, { positions: next, capabilities: nextCaps ?? [] });
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
                    <p className="mt-0.5 text-xs text-stone-400">
                      {u.positions.map((p) => POSITIONS[p]?.en).filter(Boolean).join(" · ") || "No position"}
                    </p>
                    <p className="mt-0.5 text-[11px] text-stone-400">
                      {u.archivedAt ? `Archived ${fmtTime(u.archivedAt)}` : ""} · reports kept
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <SmallBtn label="Restore" tone="green" onClick={() => patch(u._id, { restore: true })} />
                    <SmallBtn label="Delete" tone="red" onClick={() => purge(u._id, u.fullName)} />
                  </div>
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
  initialCaps,
  onSave,
  onCancel,
}: {
  initial: PositionKey[];
  initialCaps: CapabilityKey[] | null;
  onSave: (next: PositionKey[], caps: CapabilityKey[] | null) => void;
  onCancel: () => void;
}) {
  const [next, setNext] = useState<PositionKey[]>(initial);
  const [caps, setCaps] = useState<CapabilityKey[] | null>(initialCaps);
  const toggle = (p: PositionKey) =>
    setNext((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));

  const effective = caps ?? capabilitiesFor(next).map((c) => c.key);

  return (
    <div className="mt-3 rounded-xl bg-stone-50 p-3">
      <PositionPicker selected={next} onToggle={toggle} caps={caps} onCapsChange={setCaps} />
      <div className="mt-3 flex gap-2">
        <SmallBtn
          label="Save"
          tone="green"
          onClick={() => onSave(next, caps)}
          // An employee with no functionalities has an empty bot menu and no way
          // to file anything, so it is never a valid state to save.
          disabled={next.length === 0 || effective.length === 0}
        />
        <SmallBtn label="Cancel" onClick={onCancel} />
      </div>
    </div>
  );
}

/* ─────────────────────── Department-grouped role picker ────────────────────── */

/** Every bot functionality this department's roles can grant, in menu order. */
function departmentCapabilities(positions: readonly PositionKey[]): CapabilityKey[] {
  const set = new Set<CapabilityKey>();
  for (const p of positions) POSITIONS[p].capabilities.forEach((k) => set.add(k));
  return (Object.keys(CAPABILITIES) as CapabilityKey[]).filter((k) => set.has(k));
}

/**
 * Positions grant a default set of bot buttons; each button can then be ticked
 * or unticked for this one employee.
 *
 * `caps === null` means "no override — use whatever the ticked positions grant",
 * which is how every employee behaved before overrides existed. The first time a
 * box is unticked the resolved set is frozen into an explicit list.
 */
function PositionPicker({
  selected,
  onToggle,
  caps,
  onCapsChange,
}: {
  selected: PositionKey[];
  onToggle: (p: PositionKey) => void;
  caps: CapabilityKey[] | null;
  onCapsChange: (next: CapabilityKey[] | null) => void;
}) {
  const defaults = capabilitiesFor(selected).map((c) => c.key);
  const effective = caps ?? defaults;

  /**
   * Tick or untick one bot button. The decision itself lives in positions.ts so
   * it can be tested; this only applies the result to the two pieces of state.
   */
  const toggleCap = (key: CapabilityKey, groupPositions: readonly PositionKey[]) => {
    const next = toggleCapability(key, { positions: selected, override: caps }, groupPositions);
    for (const p of next.positions) if (!selected.includes(p)) onToggle(p);
    onCapsChange(next.override);
  };

  return (
    <div className="space-y-2.5">
      {POSITION_GROUPS.map((g) => (
        <div key={g.key} className="rounded-xl border border-stone-200 bg-stone-50/50 p-3">
          <p className="flex items-center gap-1.5 text-xs font-bold text-stone-800">
            <span>{g.icon}</span>
            {g.name}
            <span className="font-normal text-stone-400">· {g.am}</span>
          </p>
          {g.note && <p className="mt-0.5 text-[11px] leading-snug text-stone-400">{g.note}</p>}
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {g.positions.map((p) => {
              const pos = POSITIONS[p];
              const on = selected.includes(p);
              return (
                <div
                  key={p}
                  className={`rounded-lg border p-2.5 text-xs transition ${
                    on ? "border-clay-400 bg-clay-50" : "border-stone-200 bg-white"
                  }`}
                >
                  <label className="flex cursor-pointer items-start gap-2">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => onToggle(p)}
                      className="mt-0.5 accent-clay-700"
                    />
                    <span>
                      <span className="block font-bold text-stone-800">{pos.en}</span>
                      <span className="block text-stone-500">{pos.am}</span>
                      {!pos.dailyRequired && (
                        <span className="mt-1 inline-block rounded-full bg-stone-200 px-1.5 py-0.5 text-[10px] font-bold text-stone-500">
                          not daily
                        </span>
                      )}
                    </span>
                  </label>
                </div>
              );
            })}
          </div>

          {/* Every bot button this department can hand out, always visible and
              always clickable — ticking one that belongs to an unheld role turns
              that role on too. */}
          <div className="mt-2.5 rounded-lg border border-clay-100 bg-white p-2.5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400">Bot functionalities</p>
            <div className="mt-1.5 grid gap-1 sm:grid-cols-2">
              {departmentCapabilities(g.positions).map((key) => {
                const cap = CAPABILITIES[key];
                if (!cap) return null;
                const ticked = effective.includes(key);
                const held = selected.some((p) => POSITIONS[p].capabilities.includes(key));
                return (
                  <label
                    key={key}
                    className={`flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] transition ${
                      ticked ? "bg-clay-50 text-stone-800" : "text-stone-500 hover:bg-stone-50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={ticked}
                      onChange={() => toggleCap(key, g.positions)}
                      className="accent-clay-700"
                    />
                    <span className="min-w-0 flex-1 truncate" title={cap.button}>
                      {cap.button}
                    </span>
                    {!held && !ticked && (
                      <span className="shrink-0 text-[9px] font-bold uppercase text-stone-300">+role</span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      ))}

      {caps !== null && (
        <p className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
          <span>⚠️ Custom functionality set — this employee differs from their role defaults.</span>
          <button
            type="button"
            onClick={() => onCapsChange(null)}
            className="font-bold underline"
          >
            Reset to defaults
          </button>
        </p>
      )}
      {/* An empty set is stored as "no override", so it reverts to the role
          defaults rather than leaving someone with no way to report. Say that
          plainly — the previous wording promised an empty menu the API will not
          actually produce, and with single-button roles it is one click away. */}
      {effective.length === 0 && selected.length > 0 && (
        <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] font-bold text-amber-800">
          Nothing ticked — saving now reverts this employee to their role&apos;s default buttons. To stop
          someone reporting, deactivate them instead.
        </p>
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
