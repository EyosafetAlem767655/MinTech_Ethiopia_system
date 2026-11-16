/**
 * The ⬇ Excel datasets, by key, with the name the file and the button use.
 * Client-safe: the button reads this; export-datasets.ts (server) builds them.
 */
export const EXPORT_DATASETS = {
  production: "Production reports",
  downtime: "Downtime",
  whiteness: "Whiteness",
  "raw-material": "Raw material",
  vouchers: "Vouchers (GRV and SIV)",
  "stock-on-hand": "Stock on hand",
  "pp-bag-usage": "PP bag usage",
  "pp-bag-damage": "PP bag damage",
  "purchase-requests": "Purchase requests",
  store: "Store",
  "bag-control": "Bag control",
  sales: "Sales",
  "rm-credit": "RM credit",
  monthly: "Monthly report",
  credit: "Credit sales",
  wht: "WHT",
  banks: "Bank collections",
  purchases: "Purchases",
  submissions: "Submissions",
} as const;

export type ExportDatasetKey = keyof typeof EXPORT_DATASETS;
