"use client";

import { useCallback, useEffect, useState } from "react";
import CountUp from "@/components/CountUp";
import DepartmentTabs, { type TopView } from "@/components/DepartmentTabs";
import DepartmentReport from "@/components/DepartmentReport";
import RangeSelector from "@/components/RangeSelector";
import { enablePushNotifications } from "@/components/PwaSetup";
import { DEPARTMENTS } from "@/lib/departments";
import { RANGES, type RangeKey } from "@/lib/ranges";
import type { DepartmentSummary, Kpi, Submission } from "@/lib/department-metrics";

interface BriefData {
  exceptions: string[];
  brief: { date: string; narrative: string; fiveLines: string[] } | null;
}

const SOURCE_ICON: Record<Submission["source"], string> = {
  daily_report: "📝",
  shift: "👷",
  stone: "🚚",
  material: "📦",
  purchase: "🛒",
  damage: "🛡",
  receipt: "🧾",
  invoice: "📄",
  payment: "💵",
};

const fmtTime = (d: string) =>
  new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function OwnerDashboard() {
  const [view, setView] = useState<TopView>("brief");
  const [range, setRange] = useState<RangeKey>("weekly");
  const [brief, setBrief] = useState<BriefData | null>(null);
  const [summaries, setSummaries] = useState<DepartmentSummary[] | null>(null);
  const [pushState, setPushState] = useState<string>("");
  const [error, setError] = useState("");

  // Exceptions + AI brief — the only two owner-level items kept on the landing.
  useEffect(() => {
    fetch("/api/dashboard")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setBrief({ exceptions: d.exceptions ?? [], brief: d.brief ?? null });
      })
      .catch(() => {});
  }, []);

  // Per-department summaries — reload when the window changes.
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
    if (view === "brief") loadSummaries();
  }, [view, loadSummaries]);

  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

  return (
    <main className="max-w-lg mx-auto">
      {/* ───────────── Hero ───────────── */}
      <header className="hero-gradient text-white px-5 pt-12 pb-20 rounded-b-[2.2rem] relative overflow-hidden">
        <div className="absolute -top-10 -right-10 w-48 h-48 rounded-full bg-white/5 animate-float" />
        <div className="absolute top-24 -left-12 w-36 h-36 rounded-full bg-white/5 animate-float [animation-delay:1.5s]" />
        <div className="relative stagger">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="MinTech Ethiopia"
            className="h-14 w-auto max-w-[86%] drop-shadow-[0_4px_12px_rgba(0,0,0,0.25)]"
          />
          <h1 className="font-display text-3xl font-bold mt-5 leading-tight">
            ☀️ Good morning,
            <br />
            Mr. Anteneh
          </h1>
          <p className="text-clay-100/90 text-sm mt-2">{today} · Department activity</p>
          <button
            onClick={async () => setPushState(await enablePushNotifications())}
            className="mt-4 text-xs font-semibold bg-white/15 hover:bg-white/25 border border-white/25 rounded-full px-4 py-2 transition-all active:scale-95"
          >
            {pushState === "granted" ? "🔔 Morning push enabled" : "🔕 Enable 6:30 AM push"}
          </button>
        </div>
      </header>

      <div className="px-4 -mt-12 relative space-y-5">
        <DepartmentTabs value={view} onChange={setView} />

        {view !== "brief" && <DepartmentReport dept={view} />}

        {view === "brief" && (
          <>
            {/* Exceptions — the one alert strip worth keeping up top */}
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
                    <div key={i} className="card h-40 animate-pulse bg-clay-50" />
                  ))}
                </div>
              )}

              {summaries && (
                <div className="space-y-3 pb-6">
                  {summaries.map((s) => (
                    <SummaryCard key={s.department} summary={s} range={range} onOpen={() => setView(s.department)} />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}

/* ─────────────────────────── Department summary card ───────────────────────── */

function SummaryCard({
  summary,
  range,
  onOpen,
}: {
  summary: DepartmentSummary;
  range: RangeKey;
  onOpen: () => void;
}) {
  const meta = DEPARTMENTS[summary.department];
  const quiet = summary.activityCount === 0;

  return (
    <button
      onClick={onOpen}
      className="card w-full p-0 overflow-hidden text-left transition active:scale-[0.99]"
    >
      {/* Header strip */}
      <div className={`${meta.accent} px-4 py-3 text-white`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">{meta.icon}</span>
            <div>
              <p className="font-display text-base font-bold leading-none">{meta.name}</p>
              <p className="text-[11px] text-white/80 mt-0.5">{meta.blurb}</p>
            </div>
          </div>
          <span className="rounded-full bg-white/20 px-2.5 py-1 text-[11px] font-bold">
            {quiet ? "quiet" : `${summary.activityCount} update${summary.activityCount === 1 ? "" : "s"}`}
          </span>
        </div>
      </div>

      <div className="p-4">
        {/* Headline KPIs */}
        <div className="grid grid-cols-2 gap-2">
          {summary.headline.map((k) => (
            <MiniKpi key={k.label} kpi={k} />
          ))}
        </div>

        {/* Who's active */}
        {summary.contributors.length > 0 ? (
          <div className="mt-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400">
              {summary.contributorCount} {summary.contributorCount === 1 ? "person" : "people"} active
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {summary.contributors.map((c) => (
                <span
                  key={c.name}
                  className="rounded-full border border-clay-100 bg-white px-2.5 py-1 text-[11px] font-semibold text-stone-700"
                >
                  {c.name}
                  <span className="ml-1 text-[10px] font-bold text-clay-500">{c.submissions}</span>
                </span>
              ))}
            </div>
          </div>
        ) : (
          <p className="mt-3 text-xs text-stone-400">
            No submissions in the last {RANGES[range].label.toLowerCase()}.
          </p>
        )}

        {/* Recent activity */}
        {summary.recent.length > 0 && (
          <div className="mt-3 space-y-1.5 border-t border-clay-50 pt-3">
            {summary.recent.map((r) => (
              <div key={`${r.source}-${r.id}`} className="flex items-center gap-2 text-xs">
                <span className="leading-none">{SOURCE_ICON[r.source]}</span>
                <span className="font-semibold text-stone-800">{r.who}</span>
                <span className="truncate text-stone-500">{r.title}</span>
                <span className="ml-auto shrink-0 text-[10px] text-stone-400">{fmtTime(r.when)}</span>
              </div>
            ))}
          </div>
        )}

        <p className="mt-3 text-right text-xs font-bold text-clay-700">Open {meta.name} →</p>
      </div>
    </button>
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
