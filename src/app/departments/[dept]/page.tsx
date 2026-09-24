"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import type { ComponentType } from "react";
import DepartmentReport from "@/components/DepartmentReport";
import { isDepartmentKey, type DepartmentKey } from "@/lib/departments";
import BagControlPanel from "@/components/panels/BagControlPanel";
import RawMaterialReceivedPanel from "@/components/panels/RawMaterialReceivedPanel";
import DeliveryReportPanel from "@/components/panels/DeliveryReportPanel";
import ProductionPanels from "@/components/panels/ProductionPanels";
import StockOnHandPanel from "@/components/panels/StockOnHandPanel";
import WhitenessPanel from "@/components/panels/WhitenessPanel";
import FinancePanels from "@/components/panels/FinancePanels";
import VoucherPanels from "@/components/panels/VoucherPanels";
import ToolRequestsPanel from "@/components/panels/ToolRequestsPanel";
import PpBagDamagePanel from "@/components/panels/PpBagDamagePanel";
import PpBagUsagePanel from "@/components/panels/PpBagUsagePanel";
import SalesInvoicesPanel from "@/components/panels/SalesInvoicesPanel";
import SalesAnalyticsPanel from "@/components/panels/SalesAnalyticsPanel";

/**
 * Detailed reports per department, below the range summary. The company report
 * formats come first (production grid, stock status, raw-material received,
 * deliveries, purchased items), then the existing operational panels.
 */
/**
 * Panels that must keep the full width of the page on a desktop.
 *
 * Everything on this tab is a report, and most reports here are wide tables —
 * the delivery sheet alone is sixteen columns. Halving their width to fit two
 * abreast would trade a readable table for a tidy grid, so the wide ones span
 * both columns and only the card-shaped panels pair up.
 */
/** The voucher panel as finance shows it — see the finance entry in PANELS. */
const FinanceVouchers = () => <VoucherPanels showStockCheck={false} />;

const FULL_WIDTH = new Set<ComponentType>([
  ProductionPanels,
  WhitenessPanel,
  StockOnHandPanel,
  RawMaterialReceivedPanel,
  DeliveryReportPanel,
  VoucherPanels,
  FinanceVouchers,
  FinancePanels,
  SalesInvoicesPanel,
  SalesAnalyticsPanel,
  ToolRequestsPanel,
]);

const PANELS: Record<DepartmentKey, ComponentType[]> = {
  // Two questions, and only two: how much came off the lines, and how white it
  // was. Stock levels and the empty-bag counts used to sit here too; they are
  // inventory rather than output and now live on the asset tab, beside the
  // vouchers that predict them.
  production: [ProductionPanels, WhitenessPanel],
  // The three reports the asset manager files come first, then the wider bag /
  // purchase context. Stock status and purchased items are gone: the asset role
  // no longer files either, so a panel for them would only ever show stale rows.
  asset_management: [
    RawMaterialReceivedPanel,
    DeliveryReportPanel,
    // Goods in, goods out, and whether the two agree with the floor. First,
    // because the stock check is the question the rest of the tab answers
    // pieces of.
    VoucherPanels,
    // ...and immediately after it, the count itself. The reconciliation above
    // works out what should be on the floor from the opening balance and the
    // vouchers; this is what was actually counted there, so the two are read
    // one after the other or not at all.
    StockOnHandPanel,
    // Consumption sits directly under the vouchers on purpose: goods issued and
    // bags actually used are the two halves of the same question, and the whole
    // reason both exist is to be read against each other.
    PpBagUsagePanel,
    PpBagDamagePanel,
    // One panel for purchase requests. The older card list that sat under it
    // showed the same rows with an amount nobody files and an AI verdict in a
    // shape the bot no longer writes — the check appeared blank there.
    ToolRequestsPanel,
    BagControlPanel,
  ],
  // Analytics first: the question the tab answers, then the sheet it is built from.
  sales: [SalesAnalyticsPanel, SalesInvoicesPanel],
  // Finance files the goods receiving voucher, so it reads the same panel —
  // one record of a purchase, seen from both departments. Without the stock
  // check, which finance shows inside its monthly report: this tab is a set of
  // sub-tabs, and a check hanging below all of them read as part of whichever
  // was open.
  finance: [FinancePanels, FinanceVouchers],
};

/**
 * Departments shown as their submitted reports alone — no KPI row, no generic
 * trend, no contributor strip. Production joined them once its KPIs lost their
 * source: they counted shift reports, downtime and truckloads, none of which
 * exist any more. Its own two charts live inside ProductionPanels.
 */
const REPORT_ONLY = new Set<DepartmentKey>(["sales", "asset_management", "production", "finance"]);

export default function DepartmentPage() {
  const params = useParams();
  const dept = Array.isArray(params.dept) ? params.dept[0] : params.dept;

  if (!isDepartmentKey(dept)) {
    return (
      <main className="app-shell px-4 pt-10 text-center">
        <p className="text-sm text-stone-500">Unknown department.</p>
        <Link href="/" className="mt-3 inline-block text-sm font-bold text-clay-700">
          ← Back to Brief
        </Link>
      </main>
    );
  }

  const panels = PANELS[dept];

  return (
    <main className="app-shell px-4 pb-6 pt-4">
      <Link href="/" className="mb-2 inline-flex items-center gap-1 text-xs font-bold text-clay-600">
        ← Brief
      </Link>

      {/* Range-driven summary (KPIs, trend, contributors, submissions).
          Sales and Asset Management are intentionally report-only. Asset's KPI
          row counted material counts and purchase requests — sources that role
          no longer files — and its trend charted sales, which it does not own;
          the panels below are the reports it actually submits. */}
      {!REPORT_ONLY.has(dept) && <DepartmentReport dept={dept} />}

      {/* Detailed module reports. One column on a phone, exactly as before; a
          two-column grid from lg up, with the wide tables spanning both. */}
      <div className="mt-4 space-y-8 lg:grid lg:grid-cols-2 lg:items-start lg:gap-8 lg:space-y-0">
        {panels.map((Panel, i) => (
          <div key={i} className={FULL_WIDTH.has(Panel) ? "lg:col-span-2" : ""}>
            <Panel />
          </div>
        ))}
      </div>
    </main>
  );
}
