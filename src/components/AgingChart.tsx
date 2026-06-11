"use client";

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const COLORS = ["#e88c76", "#da674c", "#c64d30", "#a63d25", "#733122"];

export default function AgingChart({
  buckets,
}: {
  buckets: { current: number; d1_30: number; d31_60: number; d61_90: number; d90_plus: number };
}) {
  const data = [
    { name: "Current", value: buckets.current },
    { name: "1–30d", value: buckets.d1_30 },
    { name: "31–60d", value: buckets.d31_60 },
    { name: "61–90d", value: buckets.d61_90 },
    { name: "90d+", value: buckets.d90_plus },
  ];
  return (
    <div className="h-40">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#a8a29e" }} tickLine={false} axisLine={false} />
          <YAxis
            tick={{ fontSize: 10, fill: "#a8a29e" }}
            tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
            tickLine={false}
            axisLine={false}
            width={36}
          />
          <Tooltip
            contentStyle={{ borderRadius: 12, border: "1px solid #f3e3dd", fontSize: 12 }}
            formatter={(v: number) => [`ETB ${v.toLocaleString()}`, "Outstanding"]}
          />
          <Bar dataKey="value" radius={[6, 6, 0, 0]} animationDuration={700}>
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[i]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
