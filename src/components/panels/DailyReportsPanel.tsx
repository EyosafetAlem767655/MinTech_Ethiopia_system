"use client";

import { useEffect, useState } from "react";

/**
 * Daily-report compliance — who submitted and who missed — plus the day's
 * submitted reports. Moved out of Settings onto the Brief. Reads the existing
 * /api/daily-reports endpoint (compliance is already filtered to roles that
 * require a daily report).
 *
 * The HR and material-count feeds that used to sit below were dropped: they are
 * two of a dozen report types and had no more claim to the Brief than the rest.
 * Every collection is still listed, editable and deletable under
 * Settings → Submissions, which is the one place that shows all of them.
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

interface ComplianceRow {
  _id: string;
  fullName: string;
  positions: string[];
  /** The DAILY OBLIGATION: their role's own report, filed today. */
  submittedToday: boolean;
  lastSubmitted: string | null;
  submitted7: number;
  missed7: number;
  missedStreak: number;
  /** ACTIVITY: anything at all, from any flow. A different question. */
  activeToday: boolean;
  activeDays7: number;
  submissions7: number;
  lastActive: string | null;
}

interface CalendarRow {
  _id: string;
  fullName: string;
  /** One entry per day of the month, in order. */
  counts: number[];
  total: number;
}

const fmtTime = (d: string) =>
  new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

type Collection = "daily";

/** "YYYY-MM" for a date, in EAT. */
const eatMonthOf = (d = new Date()) => new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 7);

/** Step one month, keeping the "YYYY-MM" shape. */
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const monthLabel = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
};

export default function DailyReportsPanel() {
  const [data, setData] = useState<{
    today: string;
    daily: DailyReportRow[];
    missingToday: { _id: string; fullName: string }[];
    compliance: ComplianceRow[];
    month: string;
    daysInMonth: number;
    calendar: CalendarRow[];
    summary: { total: number; submittedToday: number; missingToday: number };
  } | null>(null);
  const [view, setView] = useState<"list" | "calendar">("list");
  const [month, setMonth] = useState(() => eatMonthOf());
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLoading(true);
    return fetch(`/api/daily-reports?month=${month}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setData(d);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // Reloads when the calendar is paged to another month.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  // Edit / delete a submission, then refresh the feed. Shares the /api/submissions
  // endpoint with the Settings tab, so both go through the same validation, audit
  // log and photo cleanup — the column each collection stores its text in comes
  // from the registry in lib/submissions.ts.
  const saveEdit = async (collection: Collection, id: string, text: string) => {
    const res = await fetch(`/api/submissions/${collection}/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
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
  // Whoever has done least, first: nothing at all, then a daily report owing,
  // then everyone up to date.
  // Whoever has done least, first.
  const rows = [...(data.compliance ?? [])].sort(
    (a, b) => Number(a.activeToday) - Number(b.activeToday) || a.activeDays7 - b.activeDays7
  );
  const fmtLast = (d: string | null) => (d ? d.slice(5) : "never");

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-stone-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-bold uppercase tracking-widest text-stone-400">
            {view === "list" ? `Daily report compliance · ${data.today}` : "Activity calendar"}
          </p>
          <div className="flex items-center gap-2">
            {view === "list" && (
              <span className="font-display text-sm font-bold text-stone-800">
                {data.summary?.submittedToday ?? 0}/{data.summary?.total ?? 0} today
              </span>
            )}
            <div className="flex gap-0.5 rounded-full bg-clay-50 p-0.5">
              {(["list", "calendar"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-bold transition ${
                    view === v ? "bg-white text-clay-800 shadow-sm" : "text-clay-500"
                  }`}
                >
                  {v === "list" ? "List" : "📅 Calendar"}
                </button>
              ))}
            </div>
          </div>
        </div>

        {view === "calendar" ? (
          <ActivityCalendar
            month={data.month}
            daysInMonth={data.daysInMonth}
            rows={data.calendar ?? []}
            today={data.today}
            loading={loading}
            onMonth={setMonth}
          />
        ) : (
        <>

        {rows.length === 0 ? (
          <p className="mt-2 text-sm text-stone-400">No employees are due a daily report.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[10px] uppercase tracking-widest text-stone-400">
                <tr>
                  <th className="pb-1.5 font-bold">Employee</th>
                  <th className="pb-1.5 text-center font-bold">Today</th>
                  <th className="pb-1.5 text-center font-bold">Active 7d</th>
                  <th className="pb-1.5 text-right font-bold">Last active</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c._id} className="border-t border-stone-100">
                    <td className="py-2 font-semibold text-stone-800">{c.fullName}</td>
                    <td className="py-2 text-center">
                      {/* ANY submission counts. Most of these roles have no
                          such thing as "the daily report" — they file a
                          production report, a whiteness check, a store count —
                          so the tick follows whether they used the bot at all
                          today. */}
                      {c.activeToday ? (
                        <span className="font-bold text-green-700">✓</span>
                      ) : (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 font-bold text-amber-800">missing</span>
                      )}
                    </td>
                    <td className="py-2 text-center tabular-nums">
                      <span className={c.activeDays7 === 0 ? "text-amber-700" : "text-stone-600"}>
                        {c.activeDays7}/7
                      </span>
                      {c.submissions7 > 0 && (
                        <span className="ml-1 text-[10px] text-stone-400">({c.submissions7})</span>
                      )}
                    </td>
                    <td className="py-2 text-right text-stone-500">
                      {fmtLast(c.lastActive)}
                      {/* The streak is about the daily report, and only worth a
                          badge when they have also filed nothing else — a
                          person doing other work every day is not absent. */}
                      {c.missedStreak > 1 && c.activeDays7 === 0 && (
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
        {/* Two different questions, so the panel says which is which rather
            than letting one stand in for the other. */}
        <p className="mt-2 text-[10px] leading-snug text-stone-400">
          Any submission counts as the day done — a production report, a whiteness check, a store
          count. Bot submissions only.
        </p>
        </>
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

    </div>
  );
}

/* ─────────────────────────── Activity calendar ─────────────────────────────
 *
 * A contribution grid, a month at a time: one row per employee, one square per
 * day, shaded by how many submissions they filed that day.
 *
 * Counts come from `bot_activity`, which is also what the Recent submissions
 * feed reads — so what this shows and what that lists can never disagree. It is
 * bot submissions only; the few rows filed from the webapp do not pass through
 * it, and the caption says so rather than letting the reader assume otherwise.
 */

/** Five steps, because more shades than that stop being distinguishable. */
function shade(n: number): string {
  if (n <= 0) return "bg-clay-50";
  if (n === 1) return "bg-clay-200";
  if (n <= 3) return "bg-clay-400";
  if (n <= 6) return "bg-clay-600";
  return "bg-clay-800";
}

function ActivityCalendar({
  month,
  daysInMonth,
  rows,
  today,
  loading,
  onMonth,
}: {
  month: string;
  daysInMonth: number;
  rows: CalendarRow[];
  today: string;
  loading: boolean;
  onMonth: (m: string) => void;
}) {
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const todayDay = today.startsWith(month) ? Number(today.slice(8, 10)) : 0;
  const thisMonth = eatMonthOf();

  // A day in the future is left BLANK rather than drawn as an empty square:
  // nobody failed to work on a day that has not happened.
  const future = (d: number) => month > thisMonth || (month === thisMonth && d > todayDay);

  const perDay = days.map((d) => rows.reduce((a, r) => a + (r.counts[d - 1] ?? 0), 0));
  const busiest = Math.max(0, ...perDay);
  const ranked = [...rows].sort((a, b) => b.total - a.total);
  const monthTotal = rows.reduce((a, r) => a + r.total, 0);

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            onClick={() => onMonth(shiftMonth(month, -1))}
            className="rounded-full bg-clay-50 px-2.5 py-1 text-xs font-bold text-clay-700"
          >
            ‹
          </button>
          <span className="min-w-[8.5rem] text-center text-sm font-bold text-stone-800">
            {monthLabel(month)}
          </span>
          <button
            onClick={() => onMonth(shiftMonth(month, 1))}
            disabled={month >= thisMonth}
            className="rounded-full bg-clay-50 px-2.5 py-1 text-xs font-bold text-clay-700 disabled:opacity-40"
          >
            ›
          </button>
          {loading && <span className="ml-1 inline-block animate-spin text-xs text-stone-400">⟳</span>}
        </div>
        <p className="text-[11px] font-bold text-stone-500">
          {monthTotal.toLocaleString()} submission{monthTotal === 1 ? "" : "s"}
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl bg-stone-50 py-6 text-center text-xs text-stone-400">
          Nothing was filed through the bot in {monthLabel(month)}.
        </p>
      ) : (
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <table className="border-separate border-spacing-[3px]">
            <thead>
              <tr>
                <th className="w-32" />
                {days.map((d) => (
                  <th
                    key={d}
                    className={`w-4 text-[8px] font-normal ${
                      d === todayDay ? "font-bold text-clay-700" : "text-stone-400"
                    }`}
                  >
                    {/* Every third day is numbered; all 31 would be unreadable
                        at this size and the grid is read by shape anyway. */}
                    {d % 3 === 1 ? d : ""}
                  </th>
                ))}
                <th className="pl-2 text-[9px] font-bold uppercase text-stone-400">All</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((r) => (
                <tr key={r._id}>
                  <td className="max-w-[8rem] truncate pr-1 text-[11px] font-semibold text-stone-700">
                    {r.fullName}
                  </td>
                  {days.map((d) => {
                    const n = r.counts[d - 1] ?? 0;
                    if (future(d)) return <td key={d} className="h-4 w-4" />;
                    return (
                      <td key={d} className="h-4 w-4 p-0">
                        <div
                          title={`${r.fullName} · ${d} ${monthLabel(month)} · ${n} submission${n === 1 ? "" : "s"}`}
                          className={`h-4 w-4 rounded-[3px] ${shade(n)} ${
                            d === todayDay ? "ring-1 ring-clay-700" : ""
                          }`}
                        />
                      </td>
                    );
                  })}
                  <td className="pl-2 text-right text-[11px] font-bold tabular-nums text-clay-800">
                    {r.total || ""}
                  </td>
                </tr>
              ))}
              {/* Per-day totals, so "which day was busiest" is answerable
                  without counting squares across five rows. */}
              <tr>
                <td className="pr-1 pt-1 text-[10px] font-bold uppercase text-stone-400">Day</td>
                {days.map((d, i) => (
                  <td
                    key={d}
                    className={`pt-1 text-center text-[8px] tabular-nums ${
                      perDay[i] > 0 && perDay[i] === busiest ? "font-bold text-clay-800" : "text-stone-400"
                    }`}
                  >
                    {future(d) ? "" : perDay[i] || ""}
                  </td>
                ))}
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-[10px] text-stone-400">
        <span>Less</span>
        {[0, 1, 2, 5, 9].map((n) => (
          <span key={n} className={`h-3 w-3 rounded-[2px] ${shade(n)}`} />
        ))}
        <span>More</span>
        <span className="ml-auto">Bot submissions only.</span>
      </div>
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
