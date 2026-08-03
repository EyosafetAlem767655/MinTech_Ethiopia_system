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

  useEffect(() => {
    fetch("/api/daily-reports")
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => {});
  }, []);

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
