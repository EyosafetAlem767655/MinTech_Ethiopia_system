"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import type { ComponentType } from "react";
import DepartmentReport from "@/components/DepartmentReport";
import { isDepartmentKey, type DepartmentKey } from "@/lib/departments";
import BagControlPanel from "@/components/panels/BagControlPanel";
import PurchasesPanel from "@/components/panels/PurchasesPanel";
import ReceivablesPanel from "@/components/panels/ReceivablesPanel";
import GatePanel from "@/components/panels/GatePanel";
import ShiftPanel from "@/components/panels/ShiftPanel";
import ProductionOpsPanel from "@/components/panels/ProductionOpsPanel";
import ProductionGridPanel from "@/components/panels/ProductionGridPanel";
import StockStatusPanel from "@/components/panels/StockStatusPanel";
import RawMaterialReceivedPanel from "@/components/panels/RawMaterialReceivedPanel";
import DeliveryReportPanel from "@/components/panels/DeliveryReportPanel";
import ToolRequestsPanel from "@/components/panels/ToolRequestsPanel";
import PpBagDamagePanel from "@/components/panels/PpBagDamagePanel";
import SalesReceiptsPanel from "@/components/panels/SalesReceiptsPanel";

/**
 * Detailed reports per department, below the range summary. The company report
 * formats come first (production grid, stock status, raw-material received,
 * deliveries, purchased items), then the existing operational panels.
 */
const PANELS: Record<DepartmentKey, ComponentType[]> = {
  production: [ProductionGridPanel, StockStatusPanel, ProductionOpsPanel, ShiftPanel, GatePanel],
  // The three reports the asset manager files come first, then the wider bag /
  // purchase context. Stock status and purchased items are gone: the asset role
  // no longer files either, so a panel for them would only ever show stale rows.
  asset_management: [
    RawMaterialReceivedPanel,
    DeliveryReportPanel,
    PpBagDamagePanel,
    ToolRequestsPanel,
    BagControlPanel,
    PurchasesPanel,
  ],
  sales: [SalesReceiptsPanel],
  finance: [ReceivablesPanel],
};

/** Departments shown as their submitted reports alone — no KPI row, no trend. */
const REPORT_ONLY = new Set<DepartmentKey>(["sales", "asset_management"]);

export default function DepartmentPage() {
  const params = useParams();
  const dept = Array.isArray(params.dept) ? params.dept[0] : params.dept;

  if (!isDepartmentKey(dept)) {
    return (
      <main className="max-w-lg mx-auto px-4 pt-10 text-center">
        <p className="text-sm text-stone-500">Unknown department.</p>
        <Link href="/" className="mt-3 inline-block text-sm font-bold text-clay-700">
          ← Back to Brief
        </Link>
      </main>
    );
  }

  const panels = PANELS[dept];

  return (
    <main className="max-w-lg mx-auto px-4 pb-6 pt-4">
      <Link href="/" className="mb-2 inline-flex items-center gap-1 text-xs font-bold text-clay-600">
        ← Brief
      </Link>

      {/* Range-driven summary (KPIs, trend, contributors, submissions).
          Sales and Asset Management are intentionally report-only. Asset's KPI
          row counted material counts and purchase requests — sources that role
          no longer files — and its trend charted sales, which it does not own;
          the panels below are the reports it actually submits. */}
      {!REPORT_ONLY.has(dept) && <DepartmentReport dept={dept} />}

      {/* Detailed module reports */}
      <div className="mt-4 space-y-8">
        {panels.map((Panel, i) => (
          <Panel key={i} />
        ))}
      </div>
    </main>
  );
}
