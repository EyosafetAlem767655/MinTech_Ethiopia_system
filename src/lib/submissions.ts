/**
 * Registry of everything filed through the Telegram bot, so the web app can list,
 * correct and remove submissions from one place.
 *
 * Each table grew its own shape over time — the date lives in `date_key`, `date`
 * or only `created_at`; the author is `full_name`, `counted_by`, `reported_by` or
 * `requested_by`; photos are a `uuid[]` on three tables and a single `uuid` on
 * one. Rather than spreading those differences through the API and the UI, they
 * are declared once here and everything else reads this table.
 *
 * This file is imported by client components, so it must stay free of `sql` and
 * anything else server-only.
 */

export const SUBMISSION_COLLECTIONS = [
  "daily",
  "hr",
  "materials",
  "ops",
  "production",
  "stock_status",
  "raw_material",
  "delivery",
  "purchase_items",
  "tool_request",
  "pp_bag_damage",
  "sales_receipt",
  "damage_claim",
  "expense_receipt",
  "stone_delivery",
  "shift",
  "invoice",
  "payment",
  // Finance, rebuilt.
  "tool_purchase",
  "pp_bag_purchase",
  "base_balance",
  "price_list",
  "material_issue",
  "wht_holder",
] as const;

export type SubmissionCollection = (typeof SUBMISSION_COLLECTIONS)[number];

export interface SubmissionField {
  /** Column name in the database. */
  column: string;
  /** Key used in the JSON payload and the edit form. */
  key: string;
  label: string;
  type: "text" | "longtext" | "number" | "date";
}

export interface SubmissionSpec {
  table: string;
  label: string;
  icon: string;
  /** Column the list is filtered and sorted by. */
  dateColumn: string;
  /** True when dateColumn is a text "YYYY-MM-DD" rather than a timestamptz. */
  dateIsText?: boolean;
  /**
   * Who filed it. Optional because `payments` records no author at all — the row
   * exists, but nobody can be named as having entered it.
   */
  authorColumn?: string;
  /** Columns searched by the `q` filter. */
  searchColumns: string[];
  /** Columns shown in the list, in order. */
  displayFields: SubmissionField[];
  /** Subset of displayFields that PATCH will accept. */
  editableKeys: string[];
  /** uuid[] column of attached photos, if any. */
  photosColumn?: string;
  /** single uuid column of an attached photo, if any. */
  photoColumn?: string;
  /**
   * Photos held in a child table rather than on the row itself, which is how the
   * two evidence-backed reports store them (one row per photo, carrying its own
   * hash and AI verdict). Aggregated into a `photo_ids` array by the API so the
   * UI treats them exactly like a `uuid[]` column.
   */
  photoJoin?: { table: string; foreignKey: string; fileColumn: string };
}

const TEXT = (column: string, label: string): SubmissionField => ({
  column,
  key: column,
  label,
  type: "text",
});
const LONG = (column: string, label: string): SubmissionField => ({
  column,
  key: column,
  label,
  type: "longtext",
});
const NUM = (column: string, label: string): SubmissionField => ({
  column,
  key: column,
  label,
  type: "number",
});

export const SUBMISSIONS: Record<SubmissionCollection, SubmissionSpec> = {
  daily: {
    table: "daily_reports",
    label: "Daily report",
    icon: "📝",
    dateColumn: "date_key",
    dateIsText: true,
    authorColumn: "full_name",
    searchColumns: ["full_name", "text"],
    displayFields: [TEXT("date_key", "Date"), TEXT("full_name", "By"), LONG("text", "Report")],
    editableKeys: ["text", "date_key"],
    photosColumn: "photo_file_ids",
  },
  hr: {
    table: "hr_reports",
    label: "HR / customer report",
    icon: "👥",
    dateColumn: "created_at",
    authorColumn: "full_name",
    searchColumns: ["full_name", "text", "kind"],
    displayFields: [TEXT("kind", "Kind"), TEXT("full_name", "By"), LONG("text", "Report")],
    editableKeys: ["text"],
    photosColumn: "photo_file_ids",
  },
  materials: {
    table: "material_counts",
    label: "Material count",
    icon: "📦",
    dateColumn: "date_key",
    dateIsText: true,
    authorColumn: "counted_by",
    searchColumns: ["counted_by", "raw_text"],
    displayFields: [TEXT("date_key", "Date"), TEXT("counted_by", "By"), LONG("raw_text", "Count")],
    editableKeys: ["raw_text", "date_key"],
    photosColumn: "photo_file_ids",
  },
  ops: {
    table: "daily_ops_reports",
    label: "Daily operations report",
    icon: "📊",
    dateColumn: "date",
    authorColumn: "reported_by",
    searchColumns: ["reported_by", "date_label", "raw_text"],
    displayFields: [TEXT("date_label", "Date"), TEXT("reported_by", "By"), LONG("raw_text", "Raw text")],
    editableKeys: ["raw_text"],
  },
  production: {
    table: "production_reports",
    label: "Production report",
    icon: "🏭",
    dateColumn: "date",
    authorColumn: "reported_by",
    searchColumns: ["reported_by", "fgr_no"],
    displayFields: [TEXT("fgr_no", "FGR No"), TEXT("reported_by", "By")],
    editableKeys: ["fgr_no"],
  },
  stock_status: {
    table: "stock_status_reports",
    label: "Stock status",
    icon: "📦",
    dateColumn: "created_at",
    authorColumn: "reported_by",
    searchColumns: ["reported_by", "month"],
    displayFields: [TEXT("month", "Month"), TEXT("reported_by", "By")],
    editableKeys: ["month"],
  },
  raw_material: {
    table: "raw_material_receipts",
    label: "Raw material received",
    icon: "🚚",
    dateColumn: "date",
    authorColumn: "reported_by",
    searchColumns: ["supplier", "truck_plate", "dn_no", "mrv_no", "reported_by"],
    displayFields: [
      TEXT("supplier", "Supplier"),
      TEXT("dn_no", "Sup.Dn.No."),
      TEXT("truck_plate", "Truck Plate"),
      TEXT("mrv_no", "M.R.V"),
      TEXT("reported_by", "By"),
    ],
    editableKeys: ["supplier", "dn_no", "truck_plate", "mrv_no"],
  },
  delivery: {
    table: "delivery_reports",
    label: "Delivery report",
    icon: "🚛",
    dateColumn: "date",
    authorColumn: "reported_by",
    searchColumns: ["customer", "delivery_no", "invoice_no", "reported_by"],
    displayFields: [
      TEXT("customer", "Deliver to"),
      NUM("invoice_cash", "Invoice in cash"),
      NUM("invoice_credit", "Invoice in credit"),
      NUM("qty", "Total quantity"),
      TEXT("delivery_no", "Deli"),
      TEXT("reported_by", "By"),
    ],
    editableKeys: ["customer", "invoice_cash", "invoice_credit", "delivery_no"],
  },
  purchase_items: {
    table: "purchase_item_reports",
    label: "Purchased items",
    icon: "🧾",
    dateColumn: "date",
    authorColumn: "reported_by",
    searchColumns: ["description", "supplier", "purchaser", "reported_by"],
    displayFields: [
      TEXT("description", "Description"),
      TEXT("uom", "UoM"),
      NUM("qty", "Qty"),
      TEXT("supplier", "Supplier"),
      NUM("amount", "Amount"),
      TEXT("purchaser", "Purchaser"),
    ],
    editableKeys: ["description", "uom", "qty", "supplier", "amount", "purchaser"],
  },
  tool_request: {
    table: "purchase_requests",
    label: "Tool purchase request",
    icon: "🔧",
    dateColumn: "created_at",
    authorColumn: "requested_by",
    searchColumns: ["title", "justification", "requested_by"],
    displayFields: [
      TEXT("title", "Tool"),
      NUM("quantity", "Qty"),
      TEXT("kind", "Type"),
      LONG("justification", "Reason"),
      TEXT("status", "Status"),
      TEXT("requested_by", "By"),
    ],
    editableKeys: ["title", "quantity", "justification"],
    photoColumn: "photo_file_id",
  },
  pp_bag_damage: {
    table: "pp_bag_damage_reports",
    label: "PP bag damage",
    icon: "💔",
    dateColumn: "date",
    authorColumn: "reported_by",
    searchColumns: ["reason", "reported_by"],
    displayFields: [
      LONG("reason", "Reason"),
      NUM("quantity", "Quantity"),
      NUM("trust_score", "Trust score"),
      TEXT("status", "Status"),
      TEXT("reported_by", "By"),
    ],
    // trust_score is the AI's own output and status belongs to the review
    // buttons on the asset panel — neither is something to hand-edit here.
    editableKeys: ["reason", "quantity"],
    photoJoin: { table: "pp_bag_damage_photos", foreignKey: "report_id", fileColumn: "file_id" },
  },
  sales_receipt: {
    table: "sales_receipts",
    label: "Sales report",
    icon: "🧾",
    dateColumn: "date",
    authorColumn: "reported_by",
    searchColumns: ["customer_name", "fs_no", "att_no", "reported_by"],
    displayFields: [
      TEXT("customer_name", "Customers Name"),
      TEXT("fs_no", "Fs No"),
      TEXT("att_no", "Att.No"),
      TEXT("product_ty", "Product Ty"),
      NUM("qty", "Qty"),
      NUM("grand_total", "Grand Total"),
      NUM("net_pay", "Net Pay"),
      TEXT("deposited_bank", "Deposited Bank"),
    ],
    // The money columns are derived from qty x unit_price on submission, so they
    // are shown but not editable here — changing one in isolation would leave the
    // row internally inconsistent.
    editableKeys: ["customer_name", "fs_no", "att_no", "product_ty", "deposited_bank"],
  },
  damage_claim: {
    table: "damage_claims",
    label: "Damaged bags claim",
    icon: "🛡",
    dateColumn: "created_at",
    authorColumn: "worker",
    searchColumns: ["worker", "status", "source"],
    displayFields: [
      NUM("quantity", "Bags"),
      TEXT("worker", "By"),
      TEXT("shift", "Shift"),
      TEXT("status", "Status"),
      TEXT("source", "Source"),
    ],
    // status is driven by the verify/reject buttons on the bag-control panel;
    // editing it here would bypass the co-sign rule those buttons enforce.
    editableKeys: ["quantity", "shift"],
    photoJoin: { table: "claim_photos", foreignKey: "claim_id", fileColumn: "file_id" },
  },
  expense_receipt: {
    table: "receipts",
    label: "Receipt / WHT receipt",
    icon: "🧾",
    dateColumn: "created_at",
    authorColumn: "submitted_by",
    searchColumns: ["vendor", "client", "category", "tax_invoice_number", "submitted_by"],
    displayFields: [
      TEXT("vendor", "Vendor"),
      TEXT("client", "Client"),
      NUM("amount", "Amount"),
      TEXT("category", "Category"),
      TEXT("tax_invoice_number", "Tax invoice no"),
      TEXT("submitted_by", "By"),
    ],
    editableKeys: ["vendor", "client", "amount", "category", "tax_invoice_number"],
    photoColumn: "photo_file_id",
  },
  stone_delivery: {
    table: "stone_deliveries",
    label: "Truck / stone delivery",
    icon: "🚚",
    dateColumn: "date",
    authorColumn: "gate_clerk",
    searchColumns: ["truck_plate", "supplier", "quarry", "driver_name", "gate_clerk"],
    displayFields: [
      TEXT("truck_plate", "Truck plate"),
      TEXT("supplier", "Supplier"),
      TEXT("quarry", "Quarry"),
      TEXT("driver_name", "Driver"),
      NUM("loads", "Loads"),
      TEXT("quality_grade", "Grade"),
      TEXT("gate_clerk", "By"),
    ],
    // quality_grade is a checked enum in the database, so a free-text edit here
    // would be rejected by the constraint rather than saved.
    editableKeys: ["truck_plate", "supplier", "quarry", "driver_name", "loads"],
    photoColumn: "photo_file_id",
  },
  shift: {
    table: "shift_reports",
    label: "Shift report",
    icon: "🏭",
    dateColumn: "date",
    authorColumn: "supervisor",
    searchColumns: ["supervisor", "shift", "notes"],
    displayFields: [
      TEXT("shift", "Shift"),
      NUM("filled_sacks", "Filled sacks"),
      NUM("bag_weight_kg", "Bag kg"),
      NUM("downtime_minutes", "Downtime (min)"),
      LONG("notes", "Notes"),
      TEXT("supervisor", "By"),
    ],
    editableKeys: ["filled_sacks", "downtime_minutes", "notes"],
  },
  tool_purchase: {
    table: "finance_purchase_batches",
    label: "Tool purchase batch",
    icon: "🧾",
    dateColumn: "date",
    authorColumn: "reported_by",
    searchColumns: ["supplier", "cost_center", "purchaser", "reported_by"],
    displayFields: [
      NUM("sr_no", "Sr.No"),
      TEXT("supplier", "Supplier"),
      TEXT("cost_center", "Cost centre"),
      TEXT("purchaser", "Purchaser"),
      TEXT("currency", "Currency"),
      NUM("total_amount", "Total"),
    ],
    // sr_no is the batch number written on the paper and allocated by a
    // sequence; editing it here would let two batches claim the same one.
    editableKeys: ["supplier", "cost_center", "purchaser", "total_amount"],
    photosColumn: "photo_file_ids",
  },
  pp_bag_purchase: {
    table: "pp_bag_purchases",
    label: "PP bag purchase",
    icon: "🛍",
    dateColumn: "date",
    authorColumn: "reported_by",
    searchColumns: ["supplier", "reported_by"],
    displayFields: [
      TEXT("supplier", "Supplier"),
      TEXT("currency", "Currency"),
      NUM("total_amount", "Total"),
      TEXT("reported_by", "By"),
    ],
    editableKeys: ["supplier", "total_amount"],
    photosColumn: "photo_file_ids",
  },
  base_balance: {
    table: "monthly_base_balances",
    label: "Monthly base balance",
    icon: "📊",
    dateColumn: "created_at",
    authorColumn: "reported_by",
    searchColumns: ["month", "reported_by"],
    displayFields: [TEXT("month", "Month"), TEXT("reported_by", "By")],
    // The figures live in three jsonb maps; correcting one means re-filing the
    // month through the bot, which upserts on the month rather than duplicating.
    editableKeys: [],
  },
  price_list: {
    table: "monthly_price_lists",
    label: "Monthly price list",
    icon: "💲",
    dateColumn: "created_at",
    authorColumn: "reported_by",
    searchColumns: ["month", "reported_by"],
    displayFields: [TEXT("month", "Month"), NUM("usd_rate", "USD rate"), TEXT("reported_by", "By")],
    editableKeys: ["usd_rate"],
  },
  material_issue: {
    table: "material_issues",
    label: "Raw material issued",
    icon: "🔥",
    dateColumn: "date",
    authorColumn: "reported_by",
    searchColumns: ["date_label", "reported_by"],
    displayFields: [TEXT("date_label", "Date"), TEXT("reported_by", "By")],
    editableKeys: [],
  },
  wht_holder: {
    table: "wht_holders",
    label: "WHT receipt holder",
    icon: "📄",
    dateColumn: "created_at",
    authorColumn: "registered_by",
    searchColumns: ["company", "phone", "description", "registered_by"],
    displayFields: [
      TEXT("company", "Company"),
      TEXT("phone", "Phone"),
      LONG("description", "Description"),
      TEXT("status", "Status"),
      TEXT("registered_by", "By"),
    ],
    // status is driven by the "receipt received" button, which is what stops the
    // daily SMS; editing it as free text here would bypass that.
    editableKeys: ["company", "phone", "description"],
  },
  invoice: {
    table: "invoices",
    label: "Invoice",
    icon: "📄",
    dateColumn: "invoiced_at",
    // No author column: an invoice records the client, not the clerk who filed it.
    searchColumns: ["invoice_number", "client", "client_phone", "notes"],
    displayFields: [
      TEXT("invoice_number", "Invoice no"),
      TEXT("client", "Client"),
      NUM("sacks", "Sacks"),
      NUM("amount", "Amount"),
      TEXT("client_phone", "Phone"),
      LONG("notes", "Notes"),
    ],
    editableKeys: ["invoice_number", "client", "client_phone", "sacks", "amount", "notes"],
    photoColumn: "withholding_receipt_file_id",
  },
  payment: {
    table: "payments",
    label: "Payment received",
    icon: "💵",
    dateColumn: "date",
    // No author column exists on this table, so a payment can never be
    // attributed to whoever entered it — the row is still listed and deletable.
    searchColumns: ["method"],
    displayFields: [NUM("amount", "Amount"), TEXT("method", "Method")],
    editableKeys: ["amount", "method"],
  },
};

export function isSubmissionCollection(v: unknown): v is SubmissionCollection {
  return typeof v === "string" && (SUBMISSION_COLLECTIONS as readonly string[]).includes(v);
}
