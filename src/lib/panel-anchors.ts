/**
 * The anchor of every department panel: /departments/asset_management#store
 * lands on the store. One list, read by the department page and by the Guide's
 * link check, so the two cannot disagree.
 */
export const PANEL_ANCHORS = {
  production: "production",
  downtime: "downtime",
  whiteness: "whiteness",
  rawMaterial: "raw-material",
  vouchers: "vouchers",
  stockOnHand: "stock-on-hand",
  ppBagUsage: "pp-bag-usage",
  ppBagDamage: "pp-bag-damage",
  purchaseRequests: "purchase-requests",
  store: "store",
  bagControl: "bag-control",
  salesAnalytics: "sales-analytics",
  salesTable: "sales-table",
  finance: "finance",
} as const;

/** Which department page each anchor lives on. */
export const ANCHOR_PAGE: Record<string, string> = {
  production: "production",
  downtime: "production",
  whiteness: "production",
  "raw-material": "asset_management",
  vouchers: "asset_management",
  "stock-on-hand": "asset_management",
  "pp-bag-usage": "asset_management",
  "pp-bag-damage": "asset_management",
  "purchase-requests": "asset_management",
  store: "asset_management",
  "bag-control": "asset_management",
  "sales-analytics": "sales",
  "sales-table": "sales",
  finance: "finance",
};
