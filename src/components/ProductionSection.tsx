"use client";

import { useMemo, useState } from "react";
import OpsReportCharts, { type OpsReport } from "@/components/OpsReportCharts";
import ProductionTrend from "@/components/ProductionTrend";

/**
 * The production visualization block: one time-range control governs BOTH the
 * production trend line and the per-brand ops charts below it.
 *
 * The window is anchored to the most recent report, not to "today". The ops
 * report is a historical ledger that can lag real time by days, so a "7 days"
 * window measured from today would go empty — measuring back from the latest
 * report always shows the latest N days of actual data (and behaves identically
 * once reporting is live and the latest report ≈ today).
 */

const RANGES = [
  { key: "1d", label: "1D", days: 1 },
  { key: "7d", label: "7D", days: 7 },
  { key: "30d", label: "30D", days: 30 },
  { key: "90d", label: "90D", days: 90 },
  { key: "6m", label: "6M", days: 182 },
  { key: "1y", label: "1Y", days: 365 },
] as const;

type RangeKey = (typeof RANGES)[number]["key"];

const DAY = 86400000;
const productKeys = (m?: Record<string, number>) => (m ? Object.keys(m) : []);

export default function ProductionSection({ reports }: { reports: OpsReport[] }) {
  // Default to the widest useful window so all loaded history is visible; the
  // owner can then narrow it.
  const [range, setRange] = useState<RangeKey>("6m");

  const { filtered, products, latest, anchorLabel } = useMemo(() => {
    if (reports.length === 0) {
      return { filtered: [] as OpsReport[], products: [] as string[], latest: null as OpsReport | null, anchorLabel: "" };
    }
    const days = RANGES.find((r) => r.key === range)!.days;
    const times = reports.map((r) => new Date(r.date).getTime());
    const anchor = Math.max(...times);
    // Inclusive window: 1D keeps only the latest day, 7D the latest 7, etc.
    const cutoff = anchor - (days - 1) * DAY;

    const filtered = reports
      .filter((r) => new Date(r.date).getTime() >= cutoff)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const productSet = new Set<string>();
    for (const r of filtered) {
      for (const k of productKeys(r.delivered)) productSet.add(k);
      for (const k of productKeys(r.received)) productSet.add(k);
      for (const k of productKeys(r.stock)) productSet.add(k);
    }
    const latest = filtered.length ? filtered[filtered.length - 1] : null;
    return {
      filtered,
      products: Array.from(productSet).sort(),
      latest,
      anchorLabel: new Date(anchor).toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
    };
  }, [reports, range]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display font-bold text-lg px-1">Production</h2>
        <div className="flex gap-0.5 rounded-full bg-clay-50 p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-bold transition-all ${
                range === r.key ? "bg-clay-700 text-white shadow" : "text-clay-500 hover:text-clay-700"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length > 0 && (
        <p className="px-1 text-[11px] text-stone-400">
          {filtered.length} report{filtered.length > 1 ? "s" : ""} · latest {anchorLabel}
        </p>
      )}

      <ProductionTrend reports={filtered} />
      <OpsReportCharts reports={filtered} products={products} latest={latest} />
    </div>
  );
}
