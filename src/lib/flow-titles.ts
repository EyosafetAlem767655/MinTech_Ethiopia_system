/**
 * The guided flows' names, and nothing else.
 *
 * Split out of asset-flows.ts because that module imports the Postgres client:
 * a client component asking only for a label would drag the whole database
 * driver into the browser bundle, which fails the build outright with
 * "Can't resolve 'net'". The same reason RAW_MATERIALS lives in products.ts.
 *
 * asset-flows.ts re-exports both, so nothing else has to know this file exists.
 */

export type AssetFlowKind =
  | "raw_material"
  | "delivery"
  | "tool_request"
  | "pp_bag_damage"
  | "production_daily"
  // Asset management, feeding the monthly finance report.
  | "base_balance"
  // The two paper vouchers. They replaced four buttons that each captured a
  // slice of the same events; the retired tables stay readable in Settings.
  | "store_issue"
  | "grv"
  // Production's own daily and per-shift records.
  | "pp_bag_used"
  | "whiteness_check"
  // The spare-parts store, counted block by block.
  | "store_count"
  // A delivery of PP bags, on its own form.
  | "pp_bag_receipt"
  // Hours the plant was stopped, and why.
  | "downtime"
  // Money collected against a credit sale.
  | "credit_payment"
  // What came in through each bank, once a month.
  | "bank_collection"
  // Finance.
  | "price_list"
  | "wht_holder"
  // Sales: one transaction, read off its receipts and completed by hand.
  | "sales_invoice";

export const FLOW_TITLE: Record<AssetFlowKind, string> = {
  raw_material: "🧱 የቀኑ የጥሬ ዕቃ ሪፖርት",
  delivery: "🚛 የማድረሻ ሪፖርት",
  tool_request: "🛒 የግዢ ጥያቄ",
  pp_bag_damage: "💔 የPP ከረጢት ብልሽት ሪፖርት",
  production_daily: "🏭 የቀኑ የምርት ሪፖርት",
  base_balance: "📊 የወሩ የመነሻ ሚዛን",
  store_issue: "📤 የመጋዘን ወጪ ቫውቸር (SIV)",
  grv: "📥 የዕቃ ገቢ ቫውቸር (GRV)",
  pp_bag_used: "🧺 የቀኑ የPP ከረጢት ፍጆታ",
  whiteness_check: "⚪ የነጭነት ጥራት ምርመራ",
  store_count: "🧰 የመጋዘን ዕቃዎች ቆጠራ",
  pp_bag_receipt: "🧺 የPP ከረጢት ገቢ",
  downtime: "⏱ የወሩ የምርት መቋረጥ ሪፖርት",
  credit_payment: "💳 የብድር ክፍያ መከታተያ",
  bank_collection: "🏦 የወሩ የባንክ ገቢ",
  price_list: "💲 የወሩ unit price ዝርዝር",
  wht_holder: "📄 WHT ደረሰኝ ያዢ",
  sales_invoice: "🧾 የሽያጭ ሪፖርት",
};
