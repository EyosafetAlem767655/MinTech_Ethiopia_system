"use client";

import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, TOOLTIP } from "@/components/panels/TableChart";
import type { ChartSpec } from "@/lib/chat-charts";

/** Brand clay first, then three hues that stay apart for colour-blind readers. */
const SERIES_COLOURS = ["#c64d30", "#2f6f8f", "#7a8b3a", "#8a5a9e"];

const compact = (n: number) =>
  Math.abs(n) >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : Math.abs(n) >= 1000
      ? `${Math.round(n / 1000)}k`
      : String(Math.round(n * 100) / 100);

/** A chart the assistant drew, with a table under it so the figures are readable exactly. */
export default function ChatChart({ spec }: { spec: ChartSpec }) {
  const rows = spec.data.map((d) => ({ label: d.label, ...d.values }));
  const many = spec.series.length > 1;
  const label = (s: string) => (s === "value" ? spec.unit || "Value" : s);

  return (
    <figure className="my-2 rounded-xl border border-clay-100 bg-white p-2">
      {spec.title && <figcaption className="px-1 pb-1 text-xs font-bold text-stone-700">{spec.title}</figcaption>}
      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {spec.type === "line" ? (
            <LineChart data={rows} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid stroke="#f5f0ee" vertical={false} />
              <XAxis dataKey="label" {...AXIS} />
              <YAxis {...AXIS} tickFormatter={compact} />
              <Tooltip contentStyle={TOOLTIP} />
              {many && <Legend wrapperStyle={{ fontSize: 11 }} />}
              {spec.series.map((s, i) => (
                <Line key={s} name={label(s)} dataKey={s} stroke={SERIES_COLOURS[i]} strokeWidth={2} dot={{ r: 3 }} />
              ))}
            </LineChart>
          ) : (
            <BarChart data={rows} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid stroke="#f5f0ee" vertical={false} />
              <XAxis dataKey="label" {...AXIS} />
              <YAxis {...AXIS} tickFormatter={compact} />
              <Tooltip contentStyle={TOOLTIP} />
              {many && <Legend wrapperStyle={{ fontSize: 11 }} />}
              {spec.series.map((s, i) => (
                <Bar key={s} name={label(s)} dataKey={s} fill={SERIES_COLOURS[i]} radius={[4, 4, 0, 0]} />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
      <div className="mt-1 max-h-40 overflow-auto">
        <table className="w-full text-right text-[11px]">
          <thead className="text-stone-400">
            <tr>
              <th className="p-1 text-left font-semibold"></th>
              {spec.series.map((s) => (
                <th key={s} className="p-1 font-semibold">
                  {label(s)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {spec.data.map((d, i) => (
              <tr key={i} className="border-t border-clay-50">
                <td className="p-1 text-left text-stone-600">{d.label}</td>
                {spec.series.map((s) => (
                  <td key={s} className="p-1 tabular-nums text-stone-700">
                    {d.values[s].toLocaleString()}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
