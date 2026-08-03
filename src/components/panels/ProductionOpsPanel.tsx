"use client";

import { useEffect, useState } from "react";
import ProductionSection from "@/components/ProductionSection";
import { type OpsReport } from "@/components/OpsReportCharts";

/** Daily operations / production trend for the Production department page.
 *  Mounts the existing ProductionSection over /api/ops-reports. */
export default function ProductionOpsPanel() {
  const [reports, setReports] = useState<OpsReport[]>([]);

  useEffect(() => {
    fetch("/api/ops-reports")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => Array.isArray(d?.reports) && setReports(d.reports))
      .catch(() => {});
  }, []);

  return (
    <section className="space-y-3">
      <h2 className="font-display text-lg font-bold px-1">📊 Production & operations</h2>
      {reports.length > 0 ? (
        <ProductionSection reports={reports} />
      ) : (
        <div className="card p-4 text-sm text-stone-400">No operations reports yet.</div>
      )}
    </section>
  );
}
