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
  // Finance.
  | "price_list"
  | "wht_holder";

export const FLOW_TITLE: Record<AssetFlowKind, string> = {
  raw_material: "🚚 የጥሬ ዕቃ ገቢ ሪፖርት",
  delivery: "🚛 የማድረሻ ሪፖርት",
  tool_request: "🔧 የመሣሪያ ግዢ ጥያቄ",
  pp_bag_damage: "💔 የPP ከረጢት ብልሽት ሪፖርት",
  production_daily: "🏭 የቀኑ የምርት ሪፖርት",
  base_balance: "📊 የወሩ የመነሻ ሚዛን",
  store_issue: "📤 የመጋዘን ወጪ ቫውቸር (SIV)",
  grv: "📥 የዕቃ ገቢ ቫውቸር (GRV)",
  price_list: "💲 የወሩ የዋጋ ዝርዝር",
  wht_holder: "📄 WHT ደረሰኝ ያዢ",
};
