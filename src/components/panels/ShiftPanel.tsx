"use client";

import { useEffect, useState } from "react";
import ShiftCharts, { type ShiftReport } from "@/components/ShiftCharts";

/** Shift analysis for the Production department page. Mounts the existing
 *  ShiftCharts (was the /shift route, which only redirected). */
export default function ShiftPanel() {
  const [reports, setReports] = useState<ShiftReport[]>([]);

  useEffect(() => {
    fetch("/api/shift-report")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => Array.isArray(d) && setReports(d))
      .catch(() => {});
  }, []);

  return (
    <section className="space-y-3">
      <h2 className="font-display text-lg font-bold px-1">👷 Shift analysis</h2>
      <p className="px-1 text-xs text-stone-400">Last {reports.length} shift reports.</p>
      <ShiftCharts reports={reports} />
    </section>
  );
}
