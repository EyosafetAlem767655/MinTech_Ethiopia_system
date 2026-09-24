/**
 * Who a purchase request is being made for.
 *
 * Lives here, apart from asset-flows.ts, for the same reason RAW_MATERIALS and
 * FLOW_TITLE do: that module imports the Postgres client, and a dashboard panel
 * that imported it would drag `net` into the browser bundle and fail to build.
 *
 * It is also the end of a genuine drift. This list existed three times — the
 * bot's choices, a hand-maintained English map inside ToolRequestsPanel, and
 * the four canonical DepartmentKeys in departments.ts — and the panel's copy had
 * already diverged ("Asset" against "Asset Management"). One list now answers
 * the bot menu, the grouping on the dashboard and the labels on both.
 *
 * Note it is DELIBERATELY wider than `DepartmentKey`: HR has no department tab
 * but does request tools, and "other" is the honest answer for the workshop or
 * the guard house. Anything grouping on these must handle those two, plus the
 * null carried by every request filed before the question was asked of both
 * branches.
 */

export interface PurchaseDepartment {
  /** Stored verbatim in `purchase_requests.department`. */
  value: string;
  /** The bot's bilingual button. */
  label: string;
  /** The dashboard's column and grouping heading. */
  short: string;
}

export const PURCHASE_DEPARTMENTS: PurchaseDepartment[] = [
  { value: "production", label: "🏭 ምርት (Production)", short: "Production" },
  { value: "asset_management", label: "📦 የንብረት አስተዳደር (Asset)", short: "Asset Management" },
  { value: "sales", label: "🤝 ሽያጭ (Sales)", short: "Sales" },
  { value: "finance", label: "💵 ፋይናንስ (Finance)", short: "Finance" },
  { value: "hr", label: "👥 የሰው ኃይል (HR)", short: "HR" },
  { value: "other", label: "➖ ሌላ (Other)", short: "Other" },
];

/** The heading a request with no department is filed under. */
export const NO_DEPARTMENT = "unassigned";

/**
 * Grouping order: the six above, then everything filed before the damaged-item
 * branch asked the question. Unassigned goes LAST — it is a gap in the record,
 * not a department, and putting it first would hand the oldest rows the top of
 * the page.
 */
export const PURCHASE_DEPARTMENT_ORDER: string[] = [
  ...PURCHASE_DEPARTMENTS.map((d) => d.value),
  NO_DEPARTMENT,
];

/** English name for a stored value, falling back to the value itself. */
export function purchaseDeptLabel(value: string | null | undefined): string {
  if (!value) return "Not stated";
  return PURCHASE_DEPARTMENTS.find((d) => d.value === value)?.short ?? value;
}

/** The key a row groups under, collapsing null/blank onto one heading. */
export function purchaseDeptKey(value: string | null | undefined): string {
  return value && value.trim() ? value : NO_DEPARTMENT;
}
