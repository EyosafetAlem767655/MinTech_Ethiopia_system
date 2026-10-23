"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Settings → 👤 Web users — the Super Admin's list of dashboard accounts.
 *
 * Create a Chief Manager or HR Manager login, reset a password, revoke or
 * restore access. A new password is shown here once and, if asked, texted
 * (httpSMS) and emailed (Gmail) to the person — shown here first, so a send
 * that fails never loses it.
 */

interface WebUser {
  id: string;
  name: string;
  role: "chief" | "hr";
  phone: string | null;
  email: string | null;
  revokedAt: string | null;
  createdAt: string;
}

interface Sent {
  sms?: { ok: boolean; error?: string };
  email?: { ok: boolean; error?: string };
}

const ROLE: Record<WebUser["role"], string> = { chief: "Chief Manager", hr: "HR Manager (view only)" };

const fmt = (d: string) =>
  new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default function WebUsersPanel() {
  const [users, setUsers] = useState<WebUser[] | null>(null);
  const [channels, setChannels] = useState({ sms: false, email: false });
  const [unavailable, setUnavailable] = useState(false);
  const [form, setForm] = useState({ name: "", role: "chief" as WebUser["role"], phone: "", email: "" });
  const [send, setSend] = useState({ sms: true, email: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** The password just issued — shown once. */
  const [issued, setIssued] = useState<{ name: string; password: string; sent: Sent } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/web-users").catch(() => null);
    const d = res && res.ok ? await res.json() : null;
    setUsers(Array.isArray(d?.users) ? d.users : []);
    setUnavailable(!!d?.unavailable);
    setChannels(d?.channels ?? { sms: false, email: false });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/web-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, sendSms: send.sms, sendEmail: send.email }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error || "Could not create the account.");
        return;
      }
      setIssued({ name: d.user.name, password: d.password, sent: d.sent ?? {} });
      setForm({ name: "", role: form.role, phone: "", email: "" });
      await load();
    } finally {
      setBusy(false);
    }
  };

  /** A test SMS / email, to see what each gateway answers. */
  const [test, setTest] = useState({ phone: "", email: "" });
  const [testResult, setTestResult] = useState("");
  const runTest = async () => {
    setBusy(true);
    setTestResult("");
    try {
      const res = await fetch("/api/web-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test: true, phone: test.phone.trim(), email: test.email.trim() }),
      });
      const d = await res.json().catch(() => ({}));
      setTestResult(res.ok ? sentLine(d.sent ?? {}) || "Nothing to send — give a phone or an email." : d.error || "Test failed.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (u: WebUser) => {
    if (!confirm(`Delete ${u.name}'s account for good? This cannot be undone — they are signed out everywhere.`)) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/web-users?id=${u.id}`, { method: "DELETE" });
      if (!res.ok) {
        setError((await res.json().catch(() => ({}))).error || "Could not delete the account.");
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  const act = async (u: WebUser, action: "revoke" | "restore" | "reset") => {
    const ask =
      action === "revoke"
        ? `Revoke ${u.name}'s access? They are signed out everywhere at once.`
        : action === "reset"
          ? `Give ${u.name} a new password? The old one stops working and they are signed out.`
          : `Restore ${u.name}'s access?`;
    if (!confirm(ask)) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/web-users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: u.id, action, sendSms: send.sms, sendEmail: send.email }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error || "That did not work.");
        return;
      }
      if (action === "reset") setIssued({ name: u.name, password: d.password, sent: d.sent ?? {} });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const sentLine = (s: Sent) =>
    [
      s.sms ? (s.sms.ok ? "📲 SMS queued" : `📲 SMS failed: ${s.sms.error}`) : null,
      s.email ? (s.email.ok ? "✉️ Email sent" : `✉️ Email failed: ${s.email.error}`) : null,
    ]
      .filter(Boolean)
      .join(" · ");

  if (!users) return <div className="card h-40 animate-pulse bg-clay-50" />;

  return (
    <div className="space-y-5">
      {unavailable && (
        <p className="card border-l-4 border-l-amber-500 p-3 text-xs font-bold text-amber-800">
          Run migration 0045_web_users.sql in Supabase first.
        </p>
      )}
      {error && <p className="card border-l-4 border-l-red-500 p-3 text-xs font-bold text-red-700">{error}</p>}

      {issued && (
        <div className="card border-l-4 border-l-green-500 p-4">
          <p className="text-xs font-bold text-green-800">Login for {issued.name}</p>
          <p className="mt-1 text-sm">
            Name: <b>{issued.name}</b> · Password:{" "}
            <code className="rounded bg-stone-100 px-1.5 py-0.5 text-base font-bold tracking-wider">{issued.password}</code>
          </p>
          <p className="mt-1 text-[11px] text-stone-500">
            Shown once — copy it now. {sentLine(issued.sent)}
          </p>
          <button onClick={() => setIssued(null)} className="mt-2 text-[11px] font-bold text-stone-400">
            Done
          </button>
        </div>
      )}

      <div className="rounded-2xl border border-stone-200 bg-white p-4">
        <h2 className="text-sm font-bold text-stone-900">Test sending</h2>
        <p className="mt-0.5 text-xs text-stone-500">
          Sends a short test message and shows exactly what the SMS gateway and Gmail answered.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <input
            value={test.phone}
            onChange={(e) => setTest({ ...test, phone: e.target.value })}
            placeholder="Phone (e.g. 0911234567)"
            className="rounded-lg border border-stone-200 px-3 py-2 text-sm"
          />
          <input
            value={test.email}
            onChange={(e) => setTest({ ...test, email: e.target.value })}
            placeholder="Email"
            className="rounded-lg border border-stone-200 px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={busy || (!test.phone.trim() && !test.email.trim())}
            onClick={runTest}
            className="rounded-lg bg-stone-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            {busy ? "Sending…" : "Send test"}
          </button>
        </div>
        {testResult && <p className="mt-2 break-words text-[11px] font-bold text-stone-700">{testResult}</p>}
      </div>

      <form onSubmit={create} className="rounded-2xl border border-stone-200 bg-white p-4">
        <h2 className="text-sm font-bold text-stone-900">Add a dashboard user</h2>
        <p className="mt-0.5 text-xs text-stone-500">
          They sign in with this name and the password generated for them.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Full name"
            className="rounded-lg border border-stone-200 px-3 py-2 text-sm"
          />
          <select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as WebUser["role"] })}
            className="rounded-lg border border-stone-200 px-3 py-2 text-sm"
          >
            <option value="chief">Chief Manager — edits, no deleting</option>
            <option value="hr">HR Manager — view only</option>
          </select>
          <input
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            placeholder="Phone (for SMS)"
            className="rounded-lg border border-stone-200 px-3 py-2 text-sm"
          />
          <input
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="Email"
            className="rounded-lg border border-stone-200 px-3 py-2 text-sm"
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-stone-600">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={send.sms} onChange={(e) => setSend({ ...send, sms: e.target.checked })} />
            Text the password {channels.sms ? "" : "(SMS gateway not configured)"}
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={send.email}
              onChange={(e) => setSend({ ...send, email: e.target.checked })}
            />
            Email the password {channels.email ? "" : "(set GMAIL_USER and GMAIL_APP_PASSWORD in Vercel)"}
          </label>
        </div>
        <button
          disabled={busy || !form.name.trim()}
          className="mt-3 rounded-lg bg-clay-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {busy ? "Saving…" : "Create account"}
        </button>
      </form>

      {users.length === 0 ? (
        <p className="card p-4 text-sm text-stone-400">No dashboard users yet. The Super Admin is the only login.</p>
      ) : (
        <div className="space-y-2">
          {users.map((u) => (
            <div key={u.id} className={`card p-3 ${u.revokedAt ? "opacity-60" : ""}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-bold text-stone-800">{u.name}</p>
                  <p className="text-[11px] text-stone-500">
                    {ROLE[u.role]}
                    {u.phone ? ` · ${u.phone}` : ""}
                    {u.email ? ` · ${u.email}` : ""}
                  </p>
                  <p className="text-[10px] text-stone-400">
                    Added {fmt(u.createdAt)}
                    {u.revokedAt ? ` · revoked ${fmt(u.revokedAt)}` : ""}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    u.revokedAt ? "bg-red-100 text-red-800" : "bg-green-100 text-green-700"
                  }`}
                >
                  {u.revokedAt ? "Revoked" : "Active"}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {u.revokedAt ? (
                  <button
                    disabled={busy}
                    onClick={() => act(u, "restore")}
                    className="rounded-full bg-green-600 px-3 py-1 text-[11px] font-bold text-white disabled:opacity-50"
                  >
                    Restore access
                  </button>
                ) : (
                  <>
                    <button
                      disabled={busy}
                      onClick={() => act(u, "reset")}
                      className="rounded-full bg-stone-200 px-3 py-1 text-[11px] font-bold text-stone-700 disabled:opacity-50"
                    >
                      New password
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => act(u, "revoke")}
                      className="rounded-full bg-red-500 px-3 py-1 text-[11px] font-bold text-white disabled:opacity-50"
                    >
                      Revoke access
                    </button>
                  </>
                )}
                <button
                  disabled={busy}
                  onClick={() => remove(u)}
                  className="rounded-full border border-red-300 px-3 py-1 text-[11px] font-bold text-red-700 disabled:opacity-50"
                >
                  🗑 Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
