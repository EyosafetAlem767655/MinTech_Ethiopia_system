"use client";

import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import CountUp from "@/components/CountUp";
import { DEPARTMENTS, type DepartmentKey } from "@/lib/departments";
import { RANGES, type RangeKey } from "@/lib/ranges";
import RangeSelector from "@/components/RangeSelector";
import type { DepartmentReport as Report, Kpi, Submission } from "@/lib/department-metrics";

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

export default function DepartmentReport({ dept }: { dept: DepartmentKey }) {
  const meta = DEPARTMENTS[dept];
  const [range, setRange] = useState<RangeKey>("weekly");
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    fetch(`/api/reports?dept=${dept}&range=${range}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        if (alive) setReport(d);
      })
      .catch((e) => {
        if (alive) setError(String(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [dept, range]);

  const unit = report?.metric === "production" ? "t" : "ETB";

  return (
    <div className="space-y-5 pb-6">
      {/* Department header */}
      <section className="animate-scale-in">
        <div className={`rounded-2xl ${meta.accent} text-white p-4 shadow-lg`}>
          <div className="flex items-center gap-3">
            <span className="text-2xl">{meta.icon}</span>
            <div>
              <h2 className="font-display text-lg font-bold leading-tight">{meta.name}</h2>
              <p className="text-[11px] text-white/80">{meta.blurb}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Global range selector */}
      <RangeSelector value={range} onChange={setRange} />

      {error && (
        <div className="card p-4 text-sm text-red-700 bg-red-50 border-red-200">Could not load report: {error}</div>
      )}

      {loading && !report && (
        <div className="grid grid-cols-2 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="card h-24 animate-pulse bg-clay-50" />
          ))}
        </div>
      )}

      {report && (
        <>
          <p className="px-1 text-[11px] text-stone-400">
            {report.window.start === report.window.end
              ? report.window.start
              : `${report.window.start} → ${report.window.end}`}{" "}
            · {RANGES[range].label.toLowerCase()}
          </p>

          {/* KPI grid */}
          <section className="grid grid-cols-2 gap-3 stagger">
            {report.kpis.map((k) => (
              <KpiCard key={k.label} kpi={k} />
            ))}
          </section>

          {/* Trend */}
          <section className="animate-fade-up">
            <div className="card p-4">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-clay-500">
                {report.metric} trend · {report.window.bucket}ly
              </p>
              <div className="h-48 -ml-3">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={report.series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id={`dep-${dept}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={meta.color} stopOpacity={0.35} />
                        <stop offset="100%" stopColor={meta.color} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3e3dd" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: "#a8a29e" }}
                      tickFormatter={(d: string) => d.slice(5)}
                      tickLine={false}
                      axisLine={false}
                      minTickGap={24}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "#a8a29e" }}
                      tickFormatter={(v: number) =>
                        unit === "t" ? Number(v).toFixed(1) : v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)
                      }
                      tickLine={false}
                      axisLine={false}
                      width={36}
                    />
                    <Tooltip
                      contentStyle={{
                        borderRadius: 12,
                        border: "1px solid #f3e3dd",
                        fontSize: 12,
                        boxShadow: "0 8px 24px rgba(62,22,13,0.12)",
                      }}
                      formatter={(v: number) => [
                        unit === "t" ? `${Number(v).toFixed(2)} t` : `${v.toLocaleString()} ETB`,
                        report.metric,
                      ]}
                    />
                    <Area
                      type="monotone"
                      dataKey={report.metric}
                      stroke={meta.color}
                      strokeWidth={2.5}
                      fill={`url(#dep-${dept})`}
                      animationDuration={700}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>

          {/* Roster */}
          {report.roster.length > 0 && (
            <section className="animate-fade-up">
              <h3 className="mb-2 px-1 font-display text-base font-bold">Contributors</h3>
              <div className="flex flex-wrap gap-2">
                {report.roster.map((r) => (
                  <span
                    key={r.name}
                    className="rounded-full border border-clay-100 bg-white px-3 py-1.5 text-xs font-semibold text-stone-700"
                  >
                    {r.name}
                    <span className="ml-1.5 rounded-full bg-clay-50 px-1.5 py-0.5 text-[10px] font-bold text-clay-600">
                      {r.submissions}
                    </span>
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* Submissions feed */}
          <section className="animate-fade-up">
            <h3 className="mb-2 px-1 font-display text-base font-bold">
              Submissions{" "}
              <span className="text-xs font-semibold text-stone-400">({report.submissions.length})</span>
            </h3>
            {report.submissions.length === 0 ? (
              <p className="card p-4 text-sm text-stone-400">No submissions in this period.</p>
            ) : (
              <div className="space-y-2">
                {report.submissions.map((s) => (
                  <SubmissionCard key={`${s.source}-${s.id}`} s={s} />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function KpiCard({ kpi }: { kpi: Kpi }) {
  return (
    <div className="card p-4 hover:-translate-y-0.5 transition-transform duration-300">
      <span className="text-xl">{kpi.icon}</span>
      <p className="mt-1.5 font-display text-xl font-bold tabular-nums text-clay-900">
        <CountUp value={kpi.value} prefix={kpi.prefix ?? ""} suffix={kpi.suffix ?? ""} decimals={kpi.decimals ?? 0} />
      </p>
      <p className="mt-0.5 text-[11px] font-medium leading-tight text-stone-400">{kpi.label}</p>
    </div>
  );
}

function SubmissionCard({ s }: { s: Submission }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-base leading-none">{SOURCE_ICON[s.source]}</span>
        <span className="text-sm font-bold text-stone-900">{s.who}</span>
        {s.badge && (
          <span className="rounded-full bg-clay-50 px-2 py-0.5 text-[10px] font-bold text-clay-700">{s.badge}</span>
        )}
        <span className="ml-auto text-[11px] text-stone-400">{fmtTime(s.when)}</span>
      </div>
      <p className="mt-1 text-xs font-semibold text-stone-700">{s.title}</p>
      {s.detail && <p className="mt-0.5 whitespace-pre-wrap text-xs leading-relaxed text-stone-500">{s.detail}</p>}
      {s.photos.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {s.photos.map((id) => (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img key={id} src={`/api/files/${id}`} alt="" className="h-20 w-20 rounded-lg object-cover" />
          ))}
        </div>
      )}
    </div>
  );
}
