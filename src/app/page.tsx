"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import CountUp from "@/components/CountUp";
import TrendCharts, { type TrendPoint } from "@/components/TrendCharts";
import AgingChart from "@/components/AgingChart";
import OpsReportCharts, { type OpsReport } from "@/components/OpsReportCharts";
import ShiftCharts, { type ShiftReport } from "@/components/ShiftCharts";
import { enablePushNotifications } from "@/components/PwaSetup";
import { MINTECH_MODULES } from "@/lib/modules";

interface LegitimacyInfo {
  score: number;
  flags: string[];
  reasoning: string;
}

interface PurchaseRequestItem {
  _id: string;
  title: string;
  amount: number;
  requestedBy: string;
  justification?: string;
  status: string;
  legitimacy?: LegitimacyInfo;
}

interface DashboardData {
  yesterday: {
    date: string;
    truckloads: number;
    tonsProduced: number;
    tonsSold: number;
    revenueInvoiced: number;
    cashCollected: number;
    damagedClaimed: number;
    damagedVerified: number;
  };
  exceptions: string[];
  series: { d7: TrendPoint[]; d30: TrendPoint[]; d90: TrendPoint[] };
  bestWorst: Record<string, { best: { date: string; value: number }; worst: { date: string; value: number } } | null>;
  monthOnMonth: {
    current: Record<string, number>;
    previous: Record<string, number>;
    changePct: Record<string, number | null>;
  };
  receivables: {
    buckets: { current: number; d1_30: number; d31_60: number; d61_90: number; d90_plus: number };
    overdueClients: { client: string; invoiceNumber: string; outstanding: number; daysOverdue: number }[];
  };
  missingWithholding: { _id: string; invoiceNumber: string; client: string; amount: number }[];
  purchaseRequests: PurchaseRequestItem[];
  brief: { date: string; narrative: string; fiveLines: string[] } | null;
  flaggedLots: { _id: string; lotCode: string; supplier: string; handlers: string[]; balance?: { gap: number } }[];
  pendingClaims: number;
}

interface OpsData {
  reports: OpsReport[];
  products: string[];
  latest: OpsReport | null;
}

const fmtETB = (n: number) => `ETB ${Math.round(n).toLocaleString()}`;

const TABS = [
  { key: "overview", label: "Overview", icon: "☀️" },
  { key: "production", label: "Production", icon: "🏭" },
  { key: "sales", label: "Sales", icon: "💵" },
  { key: "shift", label: "Shift", icon: "👷" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function OwnerDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [opsData, setOpsData] = useState<OpsData | null>(null);
  const [shifts, setShifts] = useState<ShiftReport[]>([]);
  const [error, setError] = useState("");
  const [pushState, setPushState] = useState<string>("");
  const [tab, setTab] = useState<TabKey>("overview");

  const load = useCallback(async () => {
    try {
      // The dashboard call is the slow one; the rest are supporting data and
      // must not be able to blank the page if they fail.
      const [dashRes, opsRes, shiftRes] = await Promise.all([
        fetch("/api/dashboard"),
        fetch("/api/ops-reports"),
        fetch("/api/shift-report"),
      ]);
      if (!dashRes.ok) throw new Error(`Dashboard HTTP ${dashRes.status}`);
      setData(await dashRes.json());
      if (opsRes.ok) setOpsData(await opsRes.json());
      if (shiftRes.ok) {
        const s = await shiftRes.json();
        if (Array.isArray(s)) setShifts(s);
      }
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <main className="max-w-lg mx-auto">
      {/* ───────────── Hero ───────────── */}
      <header className="hero-gradient text-white px-5 pt-12 pb-20 rounded-b-[2.2rem] relative overflow-hidden">
        <div className="absolute -top-10 -right-10 w-48 h-48 rounded-full bg-white/5 animate-float" />
        <div className="absolute top-24 -left-12 w-36 h-36 rounded-full bg-white/5 animate-float [animation-delay:1.5s]" />
        <div className="relative stagger">
          <p className="text-clay-200 text-xs font-semibold tracking-[0.25em] uppercase">MinTech Ethiopia</p>
          <h1 className="font-display text-3xl font-bold mt-1.5 leading-tight">
            ☀️ Good morning,
            <br />
            Mr. Anteneh
          </h1>
          <p className="text-clay-100/90 text-sm mt-2">{today} · Yesterday at a glance</p>
          <button
            onClick={async () => setPushState(await enablePushNotifications())}
            className="mt-4 text-xs font-semibold bg-white/15 hover:bg-white/25 border border-white/25 rounded-full px-4 py-2 transition-all active:scale-95"
          >
            {pushState === "granted" ? "🔔 Morning push enabled" : "🔕 Enable 6:30 AM push"}
          </button>
        </div>
      </header>

      <div className="px-4 -mt-12 relative space-y-5">
        {error && (
          <div className="card p-4 text-sm text-red-700 bg-red-50 border-red-200">
            Could not load dashboard: {error}
          </div>
        )}
        {!data && !error && (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="card h-28 animate-pulse bg-clay-50" />
            ))}
          </div>
        )}

        {data && (
          <>
            {/* ───────────── Tabs ───────────── */}
            <nav className="flex gap-1 rounded-2xl bg-white/95 p-1 shadow-[0_4px_24px_rgba(62,22,13,0.06)] animate-scale-in">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  aria-current={tab === t.key ? "page" : undefined}
                  className={`flex-1 rounded-xl py-2 text-[11px] font-bold transition-all ${
                    tab === t.key
                      ? "bg-clay-700 text-white shadow-md shadow-clay-200"
                      : "text-clay-500 hover:bg-clay-50"
                  }`}
                >
                  <span className="block text-sm leading-none mb-0.5">{t.icon}</span>
                  {t.label}
                </button>
              ))}
            </nav>

            {/* ═════════════ OVERVIEW ═════════════ */}
            {tab === "overview" && (
              <>
                <section className="grid grid-cols-2 gap-2 animate-scale-in">
                  {MINTECH_MODULES.map((module) => (
                    <Link
                      key={module.code}
                      href={module.href}
                      className="rounded-2xl border border-white/70 bg-white/95 p-3 shadow-[0_4px_24px_rgba(62,22,13,0.06)] transition active:scale-[0.98]"
                    >
                      <span className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-bold text-white ${module.accent}`}>
                        {module.code}
                      </span>
                      <p className="mt-2 text-xs font-bold leading-tight text-stone-900">{module.name}</p>
                      <p className="mt-1 line-clamp-2 text-[10px] leading-snug text-stone-400">{module.mainInterface}</p>
                    </Link>
                  ))}
                </section>

                {/* Exceptions first — the whole point of the page */}
                <section className="animate-scale-in">
                  {data.exceptions.length > 0 ? (
                    <div className="exception-bar rounded-2xl bg-gradient-to-br from-clay-700 to-clay-900 text-white p-4 shadow-lg shadow-clay-300/50 animate-pulse-ring">
                      <p className="text-[11px] font-bold tracking-widest uppercase text-clay-200 mb-2">
                        🚨 {data.exceptions.length} exception{data.exceptions.length > 1 ? "s" : ""} need your attention
                      </p>
                      <ul className="space-y-1.5">
                        {data.exceptions.map((e, i) => (
                          <li key={i} className="text-sm font-medium leading-snug flex gap-2">
                            <span className="text-clay-300">▸</span>
                            {e}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <div className="card p-4 flex items-center gap-3 border-green-100 bg-green-50/60">
                      <span className="text-2xl">✅</span>
                      <p className="text-sm font-semibold text-green-800">No exceptions yesterday. All clear.</p>
                    </div>
                  )}
                </section>

                {data.brief?.narrative && (
                  <section className="card p-4 animate-fade-up border-l-4 border-l-clay-600">
                    <p className="text-[11px] font-bold tracking-widest uppercase text-clay-500 mb-1.5">
                      ✦ AI morning brief · {data.brief.date}
                    </p>
                    <p className="text-sm leading-relaxed text-stone-700 italic">{data.brief.narrative}</p>
                  </section>
                )}

                <section>
                  <h2 className="font-display font-bold text-lg mb-2.5 px-1">Yesterday&apos;s numbers</h2>
                  <div className="grid grid-cols-2 gap-3 stagger">
                    <Kpi icon="🪨" label="Truckloads received" value={data.yesterday.truckloads} />
                    <Kpi icon="🏭" label="Tons produced" value={data.yesterday.tonsProduced} suffix=" t" decimals={2} />
                    <Kpi icon="🤝" label="Tons sold" value={data.yesterday.tonsSold} suffix=" t" decimals={2} />
                    <Kpi icon="🧾" label="Revenue invoiced" value={data.yesterday.revenueInvoiced} prefix="ETB " />
                    <Kpi icon="💵" label="Cash collected" value={data.yesterday.cashCollected} prefix="ETB " />
                    <Kpi
                      icon="🛡"
                      label="Damaged: claimed / verified"
                      value={data.yesterday.damagedClaimed}
                      suffix={` / ${data.yesterday.damagedVerified}`}
                    />
                  </div>
                </section>

                {/* Bag control snapshot */}
                <section className="animate-fade-up pb-6">
                  <h2 className="font-display font-bold text-lg mb-2.5 px-1">Bag control</h2>
                  {data.flaggedLots.length > 0 ? (
                    <div className="card p-4 border-red-200 bg-red-50/60">
                      <p className="text-[11px] font-bold tracking-widest uppercase text-red-700 mb-2">
                        🔴 Unaccounted bags
                      </p>
                      {data.flaggedLots.map((lot) => (
                        <div key={lot._id} className="text-xs py-1.5 border-t border-red-100 first:border-t-0">
                          <span className="font-bold text-red-700">{lot.lotCode}</span> ({lot.supplier}) —{" "}
                          <span className="font-bold">{lot.balance?.gap} bags missing</span>
                          <p className="text-stone-500 mt-0.5">Handled by: {(lot.handlers || []).join(", ") || "—"}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="card p-4 text-sm text-stone-500">All lots reconcile. ✅</div>
                  )}
                  <Link
                    href="/bags"
                    className="block text-center mt-3 card p-3.5 text-sm font-bold text-clay-700 hover:bg-clay-50 transition"
                  >
                    Open PB Bag Control →{" "}
                    {data.pendingClaims > 0 && (
                      <span className="ml-1 bg-clay-700 text-white text-[10px] rounded-full px-2 py-0.5">
                        {data.pendingClaims} claims to review
                      </span>
                    )}
                  </Link>
                </section>
              </>
            )}

            {/* ═════════════ PRODUCTION ═════════════ */}
            {tab === "production" && (
              <>
                <section className="grid grid-cols-2 gap-3">
                  <Kpi icon="🏭" label="Tons produced yesterday" value={data.yesterday.tonsProduced} suffix=" t" decimals={2} />
                  <Kpi icon="🪨" label="Truckloads received" value={data.yesterday.truckloads} />
                </section>

                <section className="animate-fade-up">
                  <h2 className="font-display font-bold text-lg mb-2.5 px-1">Production trend</h2>
                  <TrendCharts series={data.series} metrics={["production"]} />
                  <BestWorst data={data} keys={["production"]} />
                  <MoM data={data} keys={["production"]} title="Production · last 30d vs previous 30d" />
                </section>

                <section className="animate-fade-up pb-6">
                  <h2 className="font-display font-bold text-lg mb-2.5 px-1">Operations data</h2>
                  {opsData ? (
                    <OpsReportCharts reports={opsData.reports} products={opsData.products} latest={opsData.latest} />
                  ) : (
                    <div className="card p-4 text-sm text-stone-400">Operations reports unavailable.</div>
                  )}
                </section>
              </>
            )}

            {/* ═════════════ SALES ═════════════ */}
            {tab === "sales" && (
              <>
                <section className="grid grid-cols-2 gap-3">
                  <Kpi icon="🤝" label="Tons sold yesterday" value={data.yesterday.tonsSold} suffix=" t" decimals={2} />
                  <Kpi icon="🧾" label="Revenue invoiced" value={data.yesterday.revenueInvoiced} prefix="ETB " />
                  <Kpi icon="💵" label="Cash collected" value={data.yesterday.cashCollected} prefix="ETB " />
                  <Kpi icon="⏳" label="Overdue invoices" value={data.receivables.overdueClients.length} />
                </section>

                <section className="animate-fade-up">
                  <h2 className="font-display font-bold text-lg mb-2.5 px-1">Sales trend</h2>
                  <TrendCharts series={data.series} metrics={["sales", "collections"]} />
                  <BestWorst data={data} keys={["sales", "collections"]} />
                  <MoM data={data} keys={["sales", "collections"]} title="Money · last 30d vs previous 30d" />
                </section>

                <section className="animate-fade-up">
                  <h2 className="font-display font-bold text-lg mb-2.5 px-1">Receivables</h2>
                  <div className="card p-4">
                    <p className="text-[11px] font-bold tracking-widest uppercase text-clay-500 mb-1">Receivables aging</p>
                    <AgingChart buckets={data.receivables.buckets} />
                    {data.receivables.overdueClients.slice(0, 6).map((c) => (
                      <div key={c.invoiceNumber} className="flex items-center justify-between text-xs py-2 border-t border-clay-50">
                        <span className="font-semibold">{c.client}</span>
                        <span className="text-stone-400">{c.invoiceNumber}</span>
                        <span className={`font-bold ${c.daysOverdue > 30 ? "text-red-600" : "text-clay-700"}`}>
                          {fmtETB(c.outstanding)} · {c.daysOverdue}d late
                        </span>
                      </div>
                    ))}
                    {data.receivables.overdueClients.length === 0 && (
                      <p className="pt-2 text-xs text-green-700">Nothing overdue. 🎉</p>
                    )}
                  </div>

                  {data.missingWithholding.length > 0 && (
                    <div className="card p-4 mt-3 border-amber-200 bg-amber-50/50">
                      <p className="text-[11px] font-bold tracking-widest uppercase text-amber-700 mb-2">
                        ⚠️ Missing withholding receipts ({data.missingWithholding.length})
                      </p>
                      {data.missingWithholding.slice(0, 5).map((w) => (
                        <p key={w._id} className="text-xs py-1 text-amber-900">
                          {w.invoiceNumber} · {w.client} · {fmtETB(w.amount)}
                        </p>
                      ))}
                    </div>
                  )}
                </section>

                <section className="animate-fade-up pb-6">
                  <Link href="/purchases" className="block card p-4 hover:bg-clay-50 transition">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[11px] font-bold tracking-widest uppercase text-clay-500">Purchase requests</p>
                        {data.purchaseRequests.length === 0 ? (
                          <p className="text-sm font-semibold text-green-700 mt-1">Nothing pending. 🎉</p>
                        ) : (
                          <p className="text-sm font-semibold text-amber-700 mt-1">
                            {data.purchaseRequests.length} awaiting decision
                          </p>
                        )}
                        {data.purchaseRequests.slice(0, 2).map((pr) => (
                          <div key={pr._id} className="mt-2 text-xs text-stone-600 flex items-center gap-2">
                            <span className="truncate max-w-[180px]">{pr.title}</span>
                            <span className="shrink-0 text-stone-400">{fmtETB(pr.amount)}</span>
                            {pr.legitimacy && (
                              <span
                                className={`shrink-0 text-[10px] font-bold ${
                                  pr.legitimacy.score >= 75
                                    ? "text-green-600"
                                    : pr.legitimacy.score >= 50
                                    ? "text-amber-600"
                                    : "text-red-600"
                                }`}
                              >
                                {pr.legitimacy.score}%
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                      <span className="text-clay-400 text-lg">→</span>
                    </div>
                  </Link>
                </section>
              </>
            )}

            {/* ═════════════ SHIFT ═════════════ */}
            {tab === "shift" && (
              <section className="animate-fade-up pb-6">
                <h2 className="font-display font-bold text-lg mb-2.5 px-1">Shift analysis</h2>
                <p className="mb-3 px-1 text-xs text-stone-400">Last {shifts.length || 0} shift reports.</p>
                <ShiftCharts reports={shifts} />
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}

/* ─────────────────────────────── Small pieces ─────────────────────────────── */

function BestWorst({ data, keys }: { data: DashboardData; keys: readonly ("production" | "sales" | "collections")[] }) {
  return (
    <div className="grid grid-cols-1 gap-2 mt-3">
      {keys.map((k) => {
        const bw = data.bestWorst[k];
        if (!bw) return null;
        const unit = k === "production" ? "t" : "ETB";
        return (
          <div key={k} className="card px-4 py-3 flex items-center justify-between text-xs">
            <span className="font-bold capitalize text-clay-800">{k} (30d)</span>
            <span className="text-green-700">
              ▲ best {bw.best.date.slice(5)}: {bw.best.value.toLocaleString()} {unit}
            </span>
            <span className="text-clay-600">
              ▼ worst {bw.worst.date.slice(5)}: {bw.worst.value.toLocaleString()} {unit}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function MoM({
  data,
  keys,
  title,
}: {
  data: DashboardData;
  keys: readonly ("production" | "sales" | "collections")[];
  title: string;
}) {
  return (
    <div className="card p-4 mt-3">
      <p className="text-[11px] font-bold tracking-widest uppercase text-clay-500 mb-2">{title}</p>
      <div className={`grid gap-2 text-center ${keys.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
        {keys.map((k) => {
          const pct = data.monthOnMonth.changePct[k];
          const up = (pct ?? 0) >= 0;
          return (
            <div key={k} className="rounded-xl bg-clay-50/70 py-2.5">
              <p className="text-[10px] uppercase font-bold text-stone-400">{k}</p>
              <p className={`text-base font-display font-bold ${up ? "text-green-700" : "text-clay-700"}`}>
                {pct == null ? "—" : `${up ? "+" : ""}${pct}%`}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  prefix = "",
  suffix = "",
  decimals = 0,
}: {
  icon: string;
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
}) {
  return (
    <div className="card p-4 hover:-translate-y-0.5 transition-transform duration-300">
      <span className="text-xl">{icon}</span>
      <p className="font-display text-xl font-bold mt-1.5 text-clay-900 tabular-nums">
        <CountUp value={value} prefix={prefix} suffix={suffix} decimals={decimals} />
      </p>
      <p className="text-[11px] text-stone-400 font-medium mt-0.5 leading-tight">{label}</p>
    </div>
  );
}
