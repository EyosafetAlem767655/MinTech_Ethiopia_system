"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AXIS, TOOLTIP } from "@/components/panels/TableChart";
import { PRODUCT_COLOR, productLabel } from "@/lib/products";

/**
 * The per-brand charts shared by Production and Stock on hand.
 *
 * Both take `width` and `height` and hand them to the chart. They sit inside
 * Recharts' ResponsiveContainer, which sizes its DIRECT child by injecting
 * those two props — a wrapper that drops them renders a chart of size zero,
 * which is exactly how both graphs vanished the first time these shipped.
 *
 * Two shapes, chosen by how many points there are:
 *   - one day → BrandDayBars: a bar per brand. A line over a single bucket is
 *     a lone dot, which is what the Daily range used to show;
 *   - several days → BrandLines: a line per brand.
 */

const tons = (n: number) => `${(Math.round(n * 100) / 100).toLocaleString()} t`;
const colour = (code: string) => PRODUCT_COLOR[code] || "#6b6a66";

/**
 * The hover card: the date, every brand with a figure, heaviest first, and what
 * they add up to.
 */
export function BrandTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { dataKey?: string | number; value?: number; color?: string }[];
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const rows = payload
    .filter((p) => typeof p.value === "number" && p.value > 0)
    .sort((a, b) => (b.value || 0) - (a.value || 0));
  if (rows.length === 0) return null;
  const total = rows.reduce((a, p) => a + (p.value || 0), 0);

  return (
    <div className="rounded-xl border border-clay-100 bg-white/95 px-3 py-2 shadow-lg backdrop-blur">
      <p className="mb-1 text-[11px] font-bold text-stone-800">{label}</p>
      <table className="text-[11px]">
        <tbody>
          {rows.map((p) => (
            <tr key={String(p.dataKey)}>
              <td className="pr-2">
                <span className="inline-block h-2 w-2 rounded-full align-middle" style={{ backgroundColor: p.color }} />
              </td>
              {/* The label wears text ink, never the series colour — the dot
                  beside it carries the identity. */}
              <td className="pr-3 text-stone-600">{productLabel(String(p.dataKey))}</td>
              <td className="text-right font-bold tabular-nums text-stone-800">{tons(p.value || 0)}</td>
            </tr>
          ))}
          {rows.length > 1 && (
            <tr className="border-t border-clay-100">
              <td />
              <td className="pr-3 pt-1 text-stone-400">Total</td>
              <td className="pt-1 text-right font-bold tabular-nums text-clay-900">{tons(total)}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** One day: a bar per brand, labelled with its tonnage. Brands at zero are left out. */
export function BrandDayBars({
  totals,
  valueName,
  width,
  height,
}: {
  totals: Record<string, number>;
  valueName: string;
  width?: number;
  height?: number;
}) {
  const data = Object.entries(totals)
    .filter(([, v]) => v > 0)
    .map(([code, v]) => ({ code, label: productLabel(code), tons: Math.round(v * 100) / 100 }));
  return (
    <BarChart width={width} height={height} data={data} margin={{ top: 18, right: 8, bottom: 0, left: 0 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="#f3e3dd" vertical={false} />
      <XAxis dataKey="label" {...AXIS} interval={0} />
      <YAxis {...AXIS} width={40} tickFormatter={(v: number) => String(Math.round(v))} />
      <Tooltip
        cursor={{ fill: "#f9f1ee" }}
        contentStyle={TOOLTIP}
        formatter={(v: number) => [tons(Number(v)), valueName]}
      />
      <Bar dataKey="tons" radius={[4, 4, 0, 0]} maxBarSize={56} isAnimationActive={false}>
        {data.map((d) => (
          <Cell key={d.code} fill={colour(d.code)} />
        ))}
        <LabelList
          dataKey="tons"
          position="top"
          style={{ fontSize: 10, fill: "#57534e" }}
          formatter={(v: number) => String(Math.round(v * 10) / 10)}
        />
      </Bar>
    </BarChart>
  );
}

/** Several days: a line per brand. A gap where a brand has no figure, never a drop to zero. */
export function BrandLines({
  series,
  brands,
  width,
  height,
}: {
  series: Record<string, string | number>[];
  brands: string[];
  width?: number;
  height?: number;
}) {
  return (
    <LineChart width={width} height={height} data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="#f3e3dd" vertical={false} />
      <XAxis dataKey="label" {...AXIS} minTickGap={16} />
      <YAxis {...AXIS} width={40} tickFormatter={(v: number) => String(Math.round(v))} />
      <Tooltip cursor={{ stroke: "#d6c3bd", strokeWidth: 1 }} content={<BrandTooltip />} />
      {/* A legend whenever there is more than one line: identity must never
          rest on colour alone. One brand needs none — the heading names it. */}
      {brands.length > 1 && (
        <Legend
          iconType="plainline"
          iconSize={12}
          wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
          formatter={(code: string) => productLabel(code)}
        />
      )}
      {brands.map((code) => (
        <Line
          key={code}
          type="monotone"
          dataKey={code}
          name={code}
          stroke={colour(code)}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 5, strokeWidth: 2, stroke: "#ffffff" }}
          connectNulls={false}
          isAnimationActive={false}
        />
      ))}
    </LineChart>
  );
}
