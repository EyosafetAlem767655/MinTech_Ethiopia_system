"use client";

import { useEffect, useState } from "react";
import { HR_KINDS } from "@/lib/positions";

/**
 * Daily-report compliance (who submitted / who missed) plus the day's daily, HR
 * and material reports. Moved out of Settings onto the Brief. Reads the existing
 * /api/daily-reports endpoint (compliance is already filtered to roles that
 * require a daily report).
 */

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

const fmtTime = (d: string) =>
  new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

type Collection = "daily" | "hr" | "materials";

export default function DailyReportsPanel() {
  const [data, setData] = useState<{
    today: string;
    daily: DailyReportRow[];
    hr: HrRow[];
    materials: MaterialRow[];
    missingToday: { _id: string; fullName: string }[];
    compliance: ComplianceRow[];
    summary: { total: number; submittedToday: number; missingToday: number };
  } | null>(null);

  const load = () =>
    fetch("/api/daily-reports")
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => {});

  useEffect(() => {
    load();
  }, []);

  // Edit / delete a submission, then refresh the feed. Shares the /api/submissions
  // endpoint with the Settings tab, so both go through the same validation, audit
  // log and photo cleanup — the column each collection stores its text in comes
  // from the registry in lib/submissions.ts.
  const saveEdit = async (collection: Collection, id: string, text: string) => {
    const key = collection === "materials" ? "raw_text" : "text";
    const res = await fetch(`/api/submissions/${collection}/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [key]: text }),
    });
    if (res.ok) await load();
    return res.ok;
  };
  const deleteRow = async (collection: Collection, id: string) => {
    if (!confirm("Delete this submission? This cannot be undone, and its photos are removed too.")) return;
    const res = await fetch(`/api/submissions/${collection}/${id}`, { method: "DELETE" });
    if (!res.ok) alert("Could not delete this submission. Please try again.");
    await load();
  };

  if (!data) return <div className="card h-40 animate-pulse bg-clay-50" />;

  // Missing first, then whoever is furthest behind.
  const rows = [...(data.compliance ?? [])].sort(
    (a, b) => Number(a.submittedToday) - Number(b.submittedToday) || b.missed7 - a.missed7
  );
  const fmtLast = (d: string | null) => (d ? d.slice(5) : "never");

  return (
    <div className="space-y-4">
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
          <p className="mt-2 text-sm text-stone-400">No employees are due a daily report.</p>
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
                      <span className={c.missed7 > 0 ? "text-amber-700" : "text-stone-500"}>{c.submitted7}/7</span>
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
          <Card
            key={r._id}
            who={r.fullName}
            when={r.createdAt}
            photos={r.photoFileIds}
            text={r.text}
            onSave={(t) => saveEdit("daily", r._id, t)}
            onDelete={() => deleteRow("daily", r._id)}
          />
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
            onSave={(t) => saveEdit("hr", r._id, t)}
            onDelete={() => deleteRow("hr", r._id)}
          />
        ))}
      </Section>

      <Section title="Material counts">
        {data.materials.map((r) => (
          <Card
            key={r._id}
            who={r.countedBy}
            when={r.createdAt}
            photos={r.photoFileIds}
            text={r.rawText}
            onSave={(t) => saveEdit("materials", r._id, t)}
            onDelete={() => deleteRow("materials", r._id)}
          />
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
  onSave,
  onDelete,
}: {
  who: string;
  when: string;
  text: string;
  photos: string[];
  badge?: string;
  onSave: (text: string) => Promise<boolean>;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    const ok = await onSave(draft.trim());
    setBusy(false);
    if (ok) setEditing(false);
  };

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold text-stone-900">{who}</span>
        {badge && (
          <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-bold text-indigo-700">{badge}</span>
        )}
        <span className="text-[11px] text-stone-400">{fmtTime(when)}</span>
        {!editing && (
          <span className="ml-auto flex gap-2">
            <button
              onClick={() => {
                setDraft(text);
                setEditing(true);
              }}
              className="text-[11px] font-bold text-clay-600 hover:text-clay-800"
            >
              ✏️ Edit
            </button>
            <button onClick={onDelete} className="text-[11px] font-bold text-red-600 hover:text-red-700">
              🗑 Delete
            </button>
          </span>
        )}
      </div>

      {editing ? (
        <div className="mt-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            className="w-full rounded-xl border border-clay-200 p-2 text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-clay-400"
          />
          <div className="mt-2 flex gap-2">
            <button
              onClick={save}
              disabled={busy || !draft.trim()}
              className="rounded-lg bg-clay-700 px-3 py-1 text-xs font-bold text-white disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="rounded-lg bg-stone-100 px-3 py-1 text-xs font-bold text-stone-600"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-stone-700">{text}</p>
      )}

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
