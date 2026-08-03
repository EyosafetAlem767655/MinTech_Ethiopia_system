"use client";

import { useCallback, useEffect, useState } from "react";
import { HR_KINDS, POSITIONS, POSITION_GROUPS, capabilitiesFor, type PositionKey } from "@/lib/positions";
import { InstallButton } from "@/components/InstallPrompt";

interface BotUser {
  _id: string;
  fullName: string;
  positions: PositionKey[];
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

interface DailyReportRow {
  _id: string;
  fullName: string;
  positions: string[];
  dateKey: string;
  text: string;
  photoFileIds: string[];
  createdAt: string;
}

interface HrRow {
  _id: string;
  fullName: string;
  kind: keyof typeof HR_KINDS;
  text: string;
  photoFileIds: string[];
  createdAt: string;
}

interface MaterialRow {
  _id: string;
  countedBy: string;
  dateKey: string;
  rawText: string;
  photoFileIds: string[];
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
  chat_question: "bg-indigo-100 text-indigo-700",
  external_registered: "bg-teal-100 text-teal-800",
  start: "bg-stone-100 text-stone-500",
  error: "bg-red-200 text-red-900",
};

type Tab = "users" | "reports" | "activity";

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("users");

  return (
    <main className="max-w-4xl mx-auto px-4 pb-10">
      <header className="hero-gradient -mx-4 px-5 pb-7 pt-10 text-white sm:mx-0 sm:mt-4 sm:rounded-2xl">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo.png"
          alt="MinTech"
          className="mb-3 h-10 w-auto drop-shadow-[0_3px_10px_rgba(0,0,0,0.25)]"
        />
        <p className="text-xs font-bold tracking-[0.24em] uppercase text-clay-100">Settings</p>
        <h1 className="font-display text-2xl font-bold">Telegram bot access</h1>
        <p className="mt-1 text-sm text-clay-100/90">Employees · positions · passwords · full audit trail</p>
      </header>

      <div className="pt-5">
        <InstallButton />
      </div>

      <div className="flex gap-1.5 py-5">
        {(["users", "reports", "activity"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-full text-xs font-bold capitalize transition-all ${
              tab === t ? "bg-clay-700 text-white" : "bg-stone-100 text-stone-600"
            }`}
          >
            {t === "users" ? "Employees" : t === "reports" ? "Daily reports" : "Bot activity"}
          </button>
        ))}
      </div>

      {tab === "users" && <UsersTab />}
      {tab === "reports" && <ReportsTab />}
      {tab === "activity" && <ActivityTab />}
    </main>
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
      body: JSON.stringify({ fullName, password, positions }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "Could not create employee.");
      return;
    }
    setFullName("");
    setPassword("");
    setPositions([]);
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
          <PositionPicker selected={positions} onToggle={togglePosition} />
        </div>

        {positions.length > 0 && (
          <p className="mt-2 text-[11px] text-stone-500">
            Bot menu:{" "}
            <span className="font-medium text-stone-700">
              {capabilitiesFor(positions)
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
                  onCancel={() => setEditing(null)}
                  onSave={async (next) => {
                    await patch(u._id, { positions: next });
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
                  <SmallBtn label="Restore" tone="green" onClick={() => patch(u._id, { restore: true })} />
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
  initial: PositionKey[];
  onSave: (next: PositionKey[]) => void;
  onCancel: () => void;
}) {
  const [next, setNext] = useState<PositionKey[]>(initial);
  const toggle = (p: PositionKey) =>
    setNext((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));

  return (
    <div className="mt-3 rounded-xl bg-stone-50 p-3">
      <PositionPicker selected={next} onToggle={toggle} />
      <div className="mt-3 flex gap-2">
        <SmallBtn label="Save" tone="green" onClick={() => onSave(next)} disabled={next.length === 0} />
        <SmallBtn label="Cancel" onClick={onCancel} />
      </div>
    </div>
  );
}

/* ─────────────────────── Department-grouped role picker ────────────────────── */

function PositionPicker({
  selected,
  onToggle,
}: {
  selected: PositionKey[];
  onToggle: (p: PositionKey) => void;
}) {
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
                <label
                  key={p}
                  className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-xs transition ${
                    on ? "border-clay-400 bg-clay-50" : "border-stone-200 bg-white"
                  }`}
                >
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
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────────── Daily reports ────────────────────────────── */

interface ComplianceRow {
  _id: string;
  fullName: string;
  positions: string[];
  submittedToday: boolean;
  lastSubmitted: string | null;
  submitted7: number;
  missed7: number;
  missedStreak: number;
}

function ReportsTab() {
  const [data, setData] = useState<{
    today: string;
    daily: DailyReportRow[];
    hr: HrRow[];
    materials: MaterialRow[];
    missingToday: { _id: string; fullName: string }[];
    compliance: ComplianceRow[];
    summary: { total: number; submittedToday: number; missingToday: number };
  } | null>(null);

  useEffect(() => {
    fetch("/api/daily-reports")
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => {});
  }, []);

  if (!data) return <p className="py-10 text-center text-sm text-stone-400">Loading…</p>;

  // Missing first, then whoever is furthest behind.
  const rows = [...(data.compliance ?? [])].sort(
    (a, b) => Number(a.submittedToday) - Number(b.submittedToday) || b.missed7 - a.missed7
  );
  const fmtLast = (d: string | null) => (d ? d.slice(5) : "never");

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-stone-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-widest text-stone-400">
            Daily report compliance · {data.today}
          </p>
          <span className="font-display text-sm font-bold text-stone-800">
            {data.summary?.submittedToday ?? 0}/{data.summary?.total ?? 0} today
          </span>
        </div>

        {rows.length === 0 ? (
          <p className="mt-2 text-sm text-stone-400">No active employees yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[10px] uppercase tracking-widest text-stone-400">
                <tr>
                  <th className="pb-1.5 font-bold">Employee</th>
                  <th className="pb-1.5 text-center font-bold">Today</th>
                  <th className="pb-1.5 text-center font-bold">Last 7d</th>
                  <th className="pb-1.5 text-right font-bold">Last report</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c._id} className="border-t border-stone-100">
                    <td className="py-2 font-semibold text-stone-800">{c.fullName}</td>
                    <td className="py-2 text-center">
                      {c.submittedToday ? (
                        <span className="font-bold text-green-700">✓</span>
                      ) : (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 font-bold text-amber-800">missing</span>
                      )}
                    </td>
                    <td className="py-2 text-center tabular-nums">
                      <span className={c.missed7 > 0 ? "text-amber-700" : "text-stone-500"}>
                        {c.submitted7}/7
                      </span>
                    </td>
                    <td className="py-2 text-right text-stone-500">
                      {fmtLast(c.lastSubmitted)}
                      {c.missedStreak > 1 && (
                        <span className="ml-1.5 rounded-full bg-red-100 px-1.5 py-0.5 font-bold text-red-700">
                          {c.missedStreak}d
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Section title="Daily reports">
        {data.daily.map((r) => (
          <Card key={r._id} who={r.fullName} when={r.createdAt} photos={r.photoFileIds} text={r.text} />
        ))}
      </Section>

      <Section title="HR & customer reports">
        {data.hr.map((r) => (
          <Card
            key={r._id}
            who={r.fullName}
            when={r.createdAt}
            photos={r.photoFileIds}
            text={r.text}
            badge={HR_KINDS[r.kind]?.en}
          />
        ))}
      </Section>

      <Section title="Material counts">
        {data.materials.map((r) => (
          <Card key={r._id} who={r.countedBy} when={r.createdAt} photos={r.photoFileIds} text={r.rawText} />
        ))}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const empty = !Array.isArray(children) || children.length === 0;
  return (
    <section>
      <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-stone-400">{title}</h2>
      {empty ? (
        <p className="rounded-xl bg-stone-50 py-6 text-center text-xs text-stone-400">Nothing yet.</p>
      ) : (
        <div className="space-y-2">{children}</div>
      )}
    </section>
  );
}

function Card({
  who,
  when,
  text,
  photos,
  badge,
}: {
  who: string;
  when: string;
  text: string;
  photos: string[];
  badge?: string;
}) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold text-stone-900">{who}</span>
        {badge && (
          <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-bold text-indigo-700">{badge}</span>
        )}
        <span className="text-[11px] text-stone-400">{fmtTime(when)}</span>
      </div>
      <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-stone-700">{text}</p>
      {photos.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {photos.map((id) => (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img key={id} src={`/api/files/${id}`} alt="" className="h-20 w-20 rounded-lg object-cover" />
          ))}
        </div>
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
