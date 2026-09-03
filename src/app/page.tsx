"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import CountUp from "@/components/CountUp";
import RangeSelector from "@/components/RangeSelector";
import DailyReportsPanel from "@/components/panels/DailyReportsPanel";
import { enablePushNotifications } from "@/components/PwaSetup";
import { DEPARTMENTS } from "@/lib/departments";
import { type RangeKey } from "@/lib/ranges";
import { FLOW_TITLE } from "@/lib/flow-titles";
import type { DepartmentSummary, Kpi } from "@/lib/department-metrics";

interface SalesToday {
  count: number;
  grandTotal: number;
  netPayable: number;
  withholding: number;
}

interface BriefData {
  exceptions: string[];
  brief: { date: string; narrative: string; fiveLines: string[] } | null;
  salesToday: SalesToday | null;
}

export default function OwnerDashboard() {
  const [range, setRange] = useState<RangeKey>("daily");
  const [brief, setBrief] = useState<BriefData | null>(null);
  const [summaries, setSummaries] = useState<DepartmentSummary[] | null>(null);
  const [pushState, setPushState] = useState<string>("");
  const [error, setError] = useState("");

  // Exceptions + AI brief — the two owner-level items kept on the landing.
  useEffect(() => {
    fetch("/api/dashboard")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setBrief({ exceptions: d.exceptions ?? [], brief: d.brief ?? null, salesToday: d.salesToday ?? null });
      })
      .catch(() => {});
  }, []);

  // Per-department summaries (cheap counts) — reload when the window changes.
  const loadSummaries = useCallback(async () => {
    setSummaries(null);
    setError("");
    try {
      const res = await fetch(`/api/reports/summary?range=${range}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setSummaries(d.departments);
    } catch (e) {
      setError(String(e));
    }
  }, [range]);

  useEffect(() => {
    loadSummaries();
  }, [loadSummaries]);

  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  const hour = new Date().getHours();
  const greeting =
    hour < 12
      ? { emoji: "☀️", text: "Good morning" }
      : hour < 17
      ? { emoji: "🌤️", text: "Good afternoon" }
      : { emoji: "🌙", text: "Good evening" };

  return (
    <main className="max-w-lg mx-auto">
      {/* ───────────── Hero ───────────── */}
      <header className="hero-gradient text-white px-5 pt-12 pb-20 rounded-b-[2.2rem] relative overflow-hidden">
        <div className="absolute -top-10 -right-10 w-48 h-48 rounded-full bg-white/5 animate-float" />
        <div className="absolute top-24 -left-12 w-36 h-36 rounded-full bg-white/5 animate-float [animation-delay:1.5s]" />
        <div className="relative stagger flex flex-col items-center text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="MinTech Ethiopia"
            className="h-16 w-auto max-w-[88%] drop-shadow-[0_4px_12px_rgba(0,0,0,0.25)]"
          />
          <h1 className="font-display text-3xl font-bold mt-5 leading-tight">
            {greeting.emoji} {greeting.text}, Mr. Anteneh
          </h1>
          <p className="text-clay-100/90 text-sm mt-2">{today} · Department activity</p>
          <button
            onClick={async () => setPushState(await enablePushNotifications())}
            disabled={pushState === "granted"}
            className="mt-4 text-xs font-semibold bg-white/15 hover:bg-white/25 border border-white/25 rounded-full px-4 py-2 transition-all active:scale-95 disabled:opacity-80"
          >
            {pushState === "granted"
              ? "🔔 Morning push enabled"
              : pushState === "denied"
              ? "🔕 Blocked — allow notifications in settings"
              : pushState === "unsupported"
              ? "🔕 Push not available (install the app first)"
              : "🔕 Enable 6:30 AM push"}
          </button>
        </div>
      </header>

      <div className="px-4 -mt-12 relative space-y-5 pb-6">
        {/* Exceptions */}
        {brief && brief.exceptions.length > 0 && (
          <section className="animate-scale-in">
            <div className="exception-bar rounded-2xl bg-gradient-to-br from-clay-700 to-clay-900 text-white p-4 shadow-lg shadow-clay-300/50">
              <p className="text-[11px] font-bold tracking-widest uppercase text-clay-200 mb-2">
                🚨 {brief.exceptions.length} exception{brief.exceptions.length > 1 ? "s" : ""} to review
              </p>
              <ul className="space-y-1.5">
                {brief.exceptions.slice(0, 4).map((e, i) => (
                  <li key={i} className="text-sm font-medium leading-snug flex gap-2">
                    <span className="text-clay-300">▸</span>
                    {e}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {/* Sales of the day summary */}
        {brief?.salesToday && brief.salesToday.count > 0 && (
          <section className="card p-4 animate-fade-up">
            <p className="text-[11px] font-bold uppercase tracking-widest text-clay-500 mb-2">
              💰 Sales today · {brief.salesToday.count} report{brief.salesToday.count > 1 ? "s" : ""}
            </p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="font-display text-lg font-bold text-stone-900">
                  {Math.round(brief.salesToday.grandTotal).toLocaleString()}
                </p>
                <p className="text-[10px] uppercase tracking-wide text-stone-400">Grand total</p>
              </div>
              <div>
                <p className="font-display text-lg font-bold text-clay-800">
                  {Math.round(brief.salesToday.netPayable).toLocaleString()}
                </p>
                <p className="text-[10px] uppercase tracking-wide text-stone-400">Net payable</p>
              </div>
              <div>
                <p className="font-display text-lg font-bold text-stone-900">
                  {Math.round(brief.salesToday.withholding).toLocaleString()}
                </p>
                <p className="text-[10px] uppercase tracking-wide text-stone-400">Withholding</p>
              </div>
            </div>
            <p className="mt-2 text-center text-[10px] text-stone-400">ETB · submitted today</p>
          </section>
        )}

        {/* AI morning brief */}
        {brief?.brief?.narrative && (
          <section className="card p-4 animate-fade-up border-l-4 border-l-clay-600">
            <p className="text-[11px] font-bold tracking-widest uppercase text-clay-500 mb-1.5">
              ✦ AI morning brief · {brief.brief.date}
            </p>
            <p className="text-sm leading-relaxed text-stone-700 italic">{brief.brief.narrative}</p>
          </section>
        )}

        {/* ───────── Per-department summaries ───────── */}
        <section className="animate-fade-up">
          <div className="mb-3 flex items-center justify-between gap-2 px-1">
            <h2 className="font-display text-lg font-bold">Departments</h2>
            <RangeSelector value={range} onChange={setRange} />
          </div>

          {error && (
            <div className="card p-4 text-sm text-red-700 bg-red-50 border-red-200">
              Could not load summaries: {error}
            </div>
          )}

          {!summaries && !error && (
            <div className="space-y-3">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="card h-28 animate-pulse bg-clay-50" />
              ))}
            </div>
          )}

          {summaries && (
            <div className="space-y-3">
              {summaries.map((s) => (
                <SummaryCard key={s.department} summary={s} />
              ))}
            </div>
          )}
        </section>

        {/* ───────── Who submitted what (all types) ───────── */}
        <section className="animate-fade-up">
          <h2 className="mb-3 px-1 font-display text-lg font-bold">Recent submissions</h2>
          <RecentSubmissions />
        </section>

        {/* ───────── Daily reports & who submitted / missed ───────── */}
        <section className="animate-fade-up">
          <h2 className="mb-3 px-1 font-display text-lg font-bold">Daily reports</h2>
          <DailyReportsPanel />
        </section>
      </div>
    </main>
  );
}

/* ─────────────────────────── Department summary card ───────────────────────── */

function SummaryCard({ summary }: { summary: DepartmentSummary }) {
  const meta = DEPARTMENTS[summary.department];
  const quiet = summary.activityCount === 0;

  return (
    <Link
      href={`/departments/${summary.department}`}
      className="card block overflow-hidden p-0 text-left transition active:scale-[0.99]"
    >
      {/* Header strip */}
      <div className={`${meta.accent} flex items-center justify-between px-4 py-3 text-white`}>
        <div className="flex items-center gap-2.5">
          <span className="text-xl">{meta.icon}</span>
          <div>
            <p className="font-display text-base font-bold leading-none">{meta.name}</p>
            <p className="mt-0.5 text-[11px] text-white/80">{meta.blurb}</p>
          </div>
        </div>
        <span className="rounded-full bg-white/20 px-2.5 py-1 text-[11px] font-bold">
          {quiet ? "quiet" : `${summary.activityCount} update${summary.activityCount === 1 ? "" : "s"}`}
        </span>
      </div>

      <div className="p-4">
        <div className="grid grid-cols-2 gap-2">
          {summary.headline.map((k) => (
            <MiniKpi key={k.label} kpi={k} />
          ))}
        </div>
        <p className="mt-3 text-right text-xs font-bold text-clay-700">Open {meta.name} →</p>
      </div>
    </Link>
  );
}

function MiniKpi({ kpi }: { kpi: Kpi }) {
  return (
    <div className="rounded-xl bg-clay-50/70 p-3">
      <p className="font-display text-lg font-bold tabular-nums text-clay-900">
        <CountUp value={kpi.value} prefix={kpi.prefix ?? ""} suffix={kpi.suffix ?? ""} decimals={kpi.decimals ?? 0} />
      </p>
      <p className="mt-0.5 text-[10px] font-medium leading-tight text-stone-400">{kpi.label}</p>
    </div>
  );
}

/* ─────────────────────── Recent submissions (who · what · when) ───────────── */

interface ActivityItem {
  _id: string;
  actor: string;
  detail?: string;
  createdAt: string;
}

/**
 * Labels for the OLD LLM doc types, kept for rows filed before the guided flows.
 *
 * Everything filed since logs its detail as `"<flow kind> <uuid>"`, which is
 * resolved through FLOW_TITLE instead. Without that branch every voucher,
 * production report and base balance on this list rendered as a raw string with
 * a uuid in it — the map below simply had no key that could ever match.
 */
const SUBMISSION_LABELS: Record<string, { icon: string; label: string }> = {
  daily_report: { icon: "📝", label: "Daily report" },
  materials: { icon: "📦", label: "Material count" },
  receipt: { icon: "🧾", label: "Receipt" },
  purchase_request: { icon: "🛒", label: "Purchase request" },
  damage_claim: { icon: "🛡", label: "Damage claim" },
  ops: { icon: "📊", label: "Operations report" },
  sales_receipt: { icon: "🧾", label: "Sales receipt" },
};

/**
 * "grv 0f3c…" → the flow's own title.
 *
 * FLOW_TITLE already carries an emoji and a name for every guided flow, so the
 * two are split out of it rather than duplicated into a second table here that
 * could drift from the bot menu.
 */
function fromFlowTitle(kind: string): { icon: string; label: string } | null {
  const title = (FLOW_TITLE as Record<string, string>)[kind];
  if (!title) return null;
  const [icon, ...rest] = title.split(" ");
  return rest.length > 0 ? { icon, label: rest.join(" ") } : { icon: "📄", label: title };
}

function humanizeDetail(detail?: string): { icon: string; label: string } {
  if (!detail) return { icon: "📄", label: "Submission" };
  if (detail.startsWith("hr:")) return { icon: "👥", label: "HR report" };
  // Guided flows log "<kind> <uuid>"; the older LLM path logged a bare doc type.
  const [head] = detail.split(" ");
  return (
    fromFlowTitle(head) ||
    SUBMISSION_LABELS[head] ||
    SUBMISSION_LABELS[detail] || { icon: "📄", label: head.replace(/_/g, " ") }
  );
}

const fmtTime = (d: string) =>
  new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** The three windows the submissions feed can be read over. */
const FEED_WINDOWS = {
  day: { label: "Today", days: 1 },
  week: { label: "This week", days: 7 },
  month: { label: "This month", days: 30 },
} as const;
type FeedWindow = keyof typeof FEED_WINDOWS;

/** EAT calendar day for a timestamp — the heading rows are grouped on this. */
const eatDayKey = (iso: string) => new Date(new Date(iso).getTime() + 3 * 3600_000).toISOString().slice(0, 10);

const dayHeading = (key: string) => {
  const today = eatDayKey(new Date().toISOString());
  if (key === today) return "Today";
  const yesterday = eatDayKey(new Date(Date.now() - 86_400_000).toISOString());
  if (key === yesterday) return "Yesterday";
  return new Date(`${key}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
};

/**
 * Who filed what, grouped by day within the chosen window.
 *
 * It was one flat list of the last 30 rows, which on a busy week is a scroll
 * with no shape to it — you could not tell whether a run of entries was this
 * morning or last Tuesday. Day headings and a window selector answer both.
 */
function RecentSubmissions() {
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [window, setWindow] = useState<FeedWindow>("day");

  useEffect(() => {
    // One fetch covering the widest window; switching between them is instant
    // and costs no round trip, the same approach the department panels take.
    fetch("/api/bot-activity?action=submission&limit=300")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setItems(Array.isArray(d?.items) ? d.items : []))
      .catch(() => setItems([]));
  }, []);

  const groups = useMemo(() => {
    if (!items) return [];
    const cutoff = Date.now() - FEED_WINDOWS[window].days * 86_400_000;
    const byDay = new Map<string, ActivityItem[]>();
    for (const a of items) {
      const at = new Date(a.createdAt).getTime();
      if (!isFinite(at) || at < cutoff) continue;
      const key = eatDayKey(a.createdAt);
      const list = byDay.get(key) ?? [];
      list.push(a);
      byDay.set(key, list);
    }
    return [...byDay.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [items, window]);

  const total = groups.reduce((a, [, rows]) => a + rows.length, 0);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1 px-1">
        {(Object.keys(FEED_WINDOWS) as FeedWindow[]).map((k) => (
          <button
            key={k}
            onClick={() => setWindow(k)}
            className={`rounded-full px-3 py-1 text-[11px] font-bold transition ${
              window === k ? "bg-clay-700 text-white" : "bg-clay-50 text-clay-700"
            }`}
          >
            {FEED_WINDOWS[k].label}
          </button>
        ))}
        {items && <span className="ml-auto text-[11px] text-stone-400">{total} submission(s)</span>}
      </div>

      {!items ? (
        <div className="card h-24 animate-pulse bg-clay-50" />
      ) : groups.length === 0 ? (
        <p className="card p-4 text-sm text-stone-400">
          Nothing filed {FEED_WINDOWS[window].label.toLowerCase()}.
        </p>
      ) : (
        groups.map(([day, rows]) => (
          <div key={day} className="space-y-1">
            <p className="flex items-baseline justify-between px-1 text-[11px] font-bold text-stone-500">
              <span>{dayHeading(day)}</span>
              <span className="text-stone-400">{rows.length}</span>
            </p>
            <div className="card divide-y divide-clay-50 p-0">
              {rows.map((a) => {
                const h = humanizeDetail(a.detail);
                return (
                  <div key={a._id} className="flex items-center gap-2 p-3 text-xs">
                    <span className="text-base leading-none">{h.icon}</span>
                    <span className="font-bold text-stone-800">{a.actor}</span>
                    <span className="truncate text-stone-500">{h.label}</span>
                    <span className="ml-auto shrink-0 text-[10px] text-stone-400">{fmtTime(a.createdAt)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
