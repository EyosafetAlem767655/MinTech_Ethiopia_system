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
  "sales_receipt",
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
  /** Who filed it. */
  authorColumn: string;
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
};

export function isSubmissionCollection(v: unknown): v is SubmissionCollection {
  return typeof v === "string" && (SUBMISSION_COLLECTIONS as readonly string[]).includes(v);
}
