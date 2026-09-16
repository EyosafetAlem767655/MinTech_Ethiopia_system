"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import CountUp from "@/components/CountUp";
import RangeSelector from "@/components/RangeSelector";
import { productLabel } from "@/lib/products";
import { RANGES, type RangeKey } from "@/lib/ranges";
import type { SalesAnalytics } from "@/lib/sales-analytics";

/**
 * Customer analytics for the Sales tab, over 1 / 3 / 6 / 12 months.
 *
 * Four questions, four charts, one range control: who buys the most, which
 * brand sells most and least, cash against credit, and which bank the money
 * lands in. Every figure comes from `sales_invoices` through
 * /api/sales-analytics; nothing is computed here beyond picking the top and
 * bottom of a list the server already sorted.
 *
 * Colour is used only where it carries meaning. Customers, brands and banks are
 * ranked single-series bars in one ink — the label beside each bar is its
 * identity — and cash/credit is the one two-series chart, in a blue/orange pair
 * checked for colour-vision separation.
 */

const RANGE_KEYS: RangeKey[] = ["monthly", "d90", "d180", "yearly"];

const INK = "#008300"; // the Sales department accent
const CASH = "#2a78d6";
const CREDIT = "#eb6834";
const GRID = "#f3e3dd";
const TICK = { fontSize: 10, fill: "#a8a29e" };
const TOOLTIP = {
  borderRadius: 12,
  border: "1px solid #f3e3dd",
  fontSize: 12,
  boxShadow: "0 8px 24px rgba(62,22,13,0.12)",
};

const etb = (v: number) => `${Math.round(v).toLocaleString()} ETB`;
const tons = (v: number) => `${(Math.round(v * 100) / 100).toLocaleString()} t`;
const compact = (v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v)));

export default function SalesAnalyticsPanel() {
  const [range, setRange] = useState<RangeKey>("monthly");
  const [data, setData] = useState<SalesAnalytics | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setError("");
    fetch(`/api/sales-analytics?range=${range}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, [range]);

  // Most and least sold, off the server's sheet-ordered list. Ties on the
  // least side go to the first in sheet order, which is as good an answer as any.
  const ranked = useMemo(() => {
    const list = data?.products ?? [];
    const byTons = [...list].sort((a, b) => b.tons - a.tons);
    return { byTons, most: byTons[0], least: byTons[byTons.length - 1] };
  }, [data]);

  const t = data?.totals;
  const cashShare = t && t.etb > 0 ? Math.round((t.cashEtb / t.etb) * 100) : 0;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <h2 className="font-display text-lg font-bold">📈 Customer analytics</h2>
        <span className="text-[11px] text-stone-400">{RANGES[range].label.toLowerCase()}</span>
      </div>
      <RangeSelector value={range} onChange={setRange} keys={RANGE_KEYS} />

      {error && <div className="card p-4 text-sm text-red-700 bg-red-50 border-red-200">Could not load: {error}</div>}

      {!data && !error && (
        <div className="grid grid-cols-2 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="card h-24 animate-pulse bg-clay-50" />
          ))}
        </div>
      )}

      {data && t && (
        <>
          {/* Headline tiles */}
          <div className="grid grid-cols-2 gap-3 stagger">
            <Tile icon="🧾" label="Sales invoiced" value={t.etb} prefix="ETB " />
            <Tile icon="⚖️" label="Tons sold" value={t.tons} suffix=" t" decimals={2} />
            <Tile icon="👥" label="Customers" value={t.customers} />
            <Tile icon="💵" label="Paid in cash" value={cashShare} suffix="%" />
          </div>

          {/* Who buys the most */}
          <Card title="Top customers · by ETB invoiced">
            {data.customers.length === 0 ? (
              <Empty />
            ) : (
              <div style={{ height: 28 * data.customers.length + 24 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.customers} layout="vertical" margin={{ top: 4, right: 48, bottom: 0, left: 4 }} barCategoryGap={6}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
                    <XAxis type="number" tick={TICK} tickFormatter={compact} tickLine={false} axisLine={false} />
                    <YAxis type="category" dataKey="customer" width={110} tick={{ ...TICK, fill: "#57534e" }} tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={TOOLTIP}
                      cursor={{ fill: "rgba(0,131,0,0.06)" }}
                      formatter={(v: number, _n, item) => {
                        const c = item?.payload as SalesAnalytics["customers"][number];
                        return [`${etb(v)} · ${tons(c.tons)} · ${c.sales} sale${c.sales === 1 ? "" : "s"}`, "Invoiced"];
                      }}
                    />
                    <Bar dataKey="etb" fill={INK} radius={[0, 4, 4, 0]} maxBarSize={18} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          {/* Which brand sells */}
          <Card
            title="Brands · tons sold"
            note={
              ranked.most && ranked.most.tons > 0
                ? `Most sold: ${productLabel(ranked.most.code)} (${tons(ranked.most.tons)}, ${ranked.most.share}%) · Least: ${productLabel(
                    ranked.least.code
                  )} (${tons(ranked.least.tons)})`
                : undefined
            }
          >
            {t.tons === 0 ? (
              <Empty />
            ) : (
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={ranked.byTons} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                    <XAxis dataKey="code" tick={TICK} tickFormatter={productLabel} tickLine={false} axisLine={false} interval={0} />
                    <YAxis tick={TICK} tickLine={false} axisLine={false} width={36} tickFormatter={(v: number) => v.toFixed(0)} />
                    <Tooltip
                      contentStyle={TOOLTIP}
                      cursor={{ fill: "rgba(0,131,0,0.06)" }}
                      labelFormatter={(code) => productLabel(String(code))}
                      formatter={(v: number, _n, item) => [`${tons(v)} · ${(item?.payload as { share: number }).share}%`, "Sold"]}
                    />
                    <Bar dataKey="tons" fill={INK} radius={[4, 4, 0, 0]} maxBarSize={38}>
                      {ranked.byTons.map((p) => (
                        // Most and least are called out in the note above; a
                        // lighter fill on the least-sold bar points the eye there.
                        <Cell key={p.code} fill={INK} fillOpacity={p.code === ranked.least?.code && ranked.byTons.length > 1 ? 0.35 : 1} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          {/* Cash vs credit */}
          <Card
            title={`Cash vs credit · ${data.window.bucket}ly`}
            note={t.etb > 0 ? `${etb(t.cashEtb)} cash (${cashShare}%) · ${etb(t.creditEtb)} credit (${100 - cashShare}%)` : undefined}
          >
            {t.etb === 0 ? (
              <Empty />
            ) : (
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.cashVsCredit} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                    <XAxis dataKey="date" tick={TICK} tickFormatter={(d: string) => d.slice(5)} tickLine={false} axisLine={false} minTickGap={24} />
                    <YAxis tick={TICK} tickLine={false} axisLine={false} width={36} tickFormatter={compact} />
                    <Tooltip contentStyle={TOOLTIP} cursor={{ fill: "rgba(0,0,0,0.04)" }} formatter={(v: number) => etb(v)} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="cash" name="Cash" stackId="a" fill={CASH} stroke="#fff" strokeWidth={1} maxBarSize={38} />
                    <Bar dataKey="credit" name="Credit" stackId="a" fill={CREDIT} stroke="#fff" strokeWidth={1} radius={[4, 4, 0, 0]} maxBarSize={38} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          {/* Where the money lands */}
          <Card title="Sales by bank · ETB invoiced">
            {data.banks.length === 0 ? (
              <Empty />
            ) : (
              <div style={{ height: 28 * data.banks.length + 24 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.banks} layout="vertical" margin={{ top: 4, right: 48, bottom: 0, left: 4 }} barCategoryGap={6}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
                    <XAxis type="number" tick={TICK} tickFormatter={compact} tickLine={false} axisLine={false} />
                    <YAxis type="category" dataKey="bank" width={90} tick={{ ...TICK, fill: "#57534e" }} tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={TOOLTIP}
                      cursor={{ fill: "rgba(0,131,0,0.06)" }}
                      formatter={(v: number, _n, item) => {
                        const b = item?.payload as SalesAnalytics["banks"][number];
                        return [`${etb(v)} · ${b.sales} sale${b.sales === 1 ? "" : "s"}`, "Invoiced"];
                      }}
                    />
                    <Bar dataKey="etb" fill={INK} radius={[0, 4, 4, 0]} maxBarSize={18} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>
        </>
      )}
    </section>
  );
}

function Tile({
  icon,
  label,
  value,
  prefix,
  suffix,
  decimals,
}: {
  icon: string;
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
}) {
  return (
    <div className="card p-4">
      <span className="text-xl">{icon}</span>
      <p className="mt-1.5 font-display text-xl font-bold tabular-nums text-clay-900">
        <CountUp value={value} prefix={prefix ?? ""} suffix={suffix ?? ""} decimals={decimals ?? 0} />
      </p>
      <p className="mt-0.5 text-[11px] font-medium leading-tight text-stone-400">{label}</p>
    </div>
  );
}

function Card({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="card p-4 animate-fade-up">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-clay-500">{title}</p>
      {children}
      {note && <p className="mt-2 text-[11px] text-stone-500">{note}</p>}
    </div>
  );
}

function Empty() {
  return <p className="py-6 text-center text-sm text-stone-400">No sales in this period.</p>;
}
