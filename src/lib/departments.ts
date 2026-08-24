/**
 * The four MinTech departments.
 *
 * The system has never had a `department` entity — employees hold one or more
 * `positions` (see src/lib/positions.ts), and every submitted report denormalizes
 * the submitter's `full_name` and `positions` onto the row. A department is simply
 * a grouping of positions plus the data sources that group owns. Because the
 * grouping keys off the denormalized `positions[]` on each report row (not a live
 * join to telegram_users), a department's history survives a user being archived
 * or deleted — which is exactly the retention guarantee the dashboard needs.
 *
 * Finance and Sales deliberately share the two finance-reporter positions: those
 * people file both the sales side (invoices/revenue) and the money side
 * (payments/withholding). A department lists the tables it owns, so the overlap
 * is harmless — each side reads different tables.
 */

import type { PositionKey } from "@/lib/positions";

export type DepartmentKey = "production" | "asset_management" | "sales" | "finance";

export interface Department {
  key: DepartmentKey;
  /** English label shown in the UI. */
  name: string;
  /** Amharic label, to match the rest of the bot-facing product. */
  am: string;
  icon: string;
  /** Tailwind background class for the department badge/active tab. */
  accent: string;
  /** Hex used by Recharts series for this department. */
  color: string;
  /** One-line description of what the department covers. */
  blurb: string;
  /**
   * Positions that belong to this department. Used both for the roster and to
   * filter the free-text daily-report feed (a report belongs to a department
   * when the submitter held any of these positions at submission time).
   */
  positions: PositionKey[];
}

export const DEPARTMENTS: Record<DepartmentKey, Department> = {
  production: {
    key: "production",
    name: "Production",
    am: "ምርት",
    icon: "🏭",
    accent: "bg-blue-600",
    color: "#2a78d6",
    blurb: "Output, shifts and stone intake at the gate.",
    positions: ["prod_daily"],
  },
  asset_management: {
    key: "asset_management",
    name: "Asset Management",
    am: "የንብረት አስተዳደር",
    icon: "📦",
    accent: "bg-amber-600",
    color: "#d08700",
    blurb: "Materials, bag inventory, purchases and damage.",
    positions: ["asset_materials", "asset_purchase"],
  },
  sales: {
    key: "sales",
    name: "Sales",
    am: "ሽያጭ",
    icon: "🤝",
    accent: "bg-emerald-600",
    color: "#008300",
    blurb: "Invoiced revenue and tons sold.",
    positions: ["sales_daily"],
  },
  finance: {
    key: "finance",
    name: "Finance",
    am: "ፋይናንስ",
    icon: "💵",
    accent: "bg-violet-600",
    color: "#7c3aed",
    blurb: "Tool purchases, the monthly asset report and WHT receipts.",
    positions: ["finance"],
  },
};

export const DEPARTMENT_KEYS = Object.keys(DEPARTMENTS) as DepartmentKey[];

export function isDepartmentKey(value: unknown): value is DepartmentKey {
  return typeof value === "string" && value in DEPARTMENTS;
}
