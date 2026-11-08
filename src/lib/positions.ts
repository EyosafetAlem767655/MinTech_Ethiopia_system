/**
 * Employee report roles (grouped by department) and what each may submit through
 * the Telegram bot.
 *
 * A user holds one or more roles; their bot menu is the union of the capabilities
 * of those roles. Roles can span departments (a person may report both sales and
 * production). Finance holds the three things the department actually does:
 * tool purchase reports, the monthly asset report, and chasing WHT receipts.
 */

export type CapabilityKey =
  | "daily_report"
  | "damage"
  | "receipt"
  | "purchase"
  | "ops"
  | "hr"
  // Structured department report formats (text / photo / Excel).
  | "production_report"
  | "pp_bag_used"
  | "whiteness_check"
  | "raw_material_received"
  // The spare-parts store, counted block by block.
  | "store_count"
  // A delivery of PP bags.
  | "pp_bag_receipt"
  // Hours the plant was stopped, and why.
  | "downtime"
  // Money collected against a credit sale.
  | "credit_payment"
  | "purchase_items"
  | "sales_report"
  | "pp_bag_damage"
  // Asset management feeds the monthly finance report.
  | "base_balance"
  // The two paper vouchers, one per department.
  | "store_issue"
  | "grv"
  // Finance.
  | "price_list"
  // Just the PP bag prices, without re-filing the whole monthly list.
  | "pp_bag_price"
  | "wht_holder"
  // Raw material bought on credit, and paying it off.
  | "rm_credit_purchase"
  | "rm_credit_payment"
  // An item bought: matched to the store list, priced by the unit or the total.
  | "item_purchase"
  // Stationery taken out of the store, by the one person who issues it.
  | "stationery_issue"
  // Yesterday's sales each morning, to approve or correct (sales-review.ts).
  | "sales_manager";

/** How the bot collects a capability's payload. */
export type CaptureMode =
  /** Classified by the vision/text LLM, then written to a typed collection. */
  | "llm"
  /** Free text (+ optional photos) stored verbatim. */
  | "capture"
  /** Pasted multi-day operations report. */
  | "ops_paste"
  /** Guided column-by-column asset report (raw material / vouchers / tool request). */
  | "asset_entry"
  /** Not a report: opens a list to review (the sales data manager). */
  | "manager";

export interface Capability {
  key: CapabilityKey;
  /** Reply-keyboard label. Routing normalises this, so the emoji is cosmetic. */
  button: string;
  /** The English name the dashboard shows. The bot keeps `button`. */
  en: string;
  captureMode: CaptureMode;
  /** docType handed to classifyIngestion; only meaningful for captureMode "llm". */
  docType?: string;
  /** "photo" rejects text-only submissions; "any" accepts either. */
  input: "photo" | "any";
  question: string;
}

export const CAPABILITIES: Record<CapabilityKey, Capability> = {
  daily_report: {
    key: "daily_report",
    en: "📝 Daily report",
    button: "📝 የቀኑ ሪፖርት",
    captureMode: "capture",
    input: "any",
    question:
      "📝 የዛሬውን ሪፖርት ይፃፉ። ፎቶ ካለዎት አብረው ይላኩ (ፎቶውን ከመግለጫ ጋር መላክ ይችላሉ)።",
  },
  damage: {
    key: "damage",
    en: "🛡️ Damaged bags claim",
    button: "🛡️ የተበላሹ ጆንያዎች",
    captureMode: "llm",
    docType: "damage_claim",
    input: "photo",
    question:
      "📷 የተበላሹትን ከረጢቶች ፎቶ ይላኩ። በፎቶው መግለጫ (caption) ላይ የተበላሹትን ከረጢቶች ብዛት ይፃፉ።",
  },
  receipt: {
    key: "receipt",
    en: "🧾 Receipt",
    button: "🧾 ደረሰኝ",
    captureMode: "llm",
    docType: "receipt",
    input: "photo",
    question: "🧾 QR ኮድ ያለው ኦፊሴላዊ ደረሰኝ ፎቶ ይላኩ። ያለ QR ኮድ ደረሰኝ ተቀባይነት የለውም።",
  },
  purchase: {
    key: "purchase",
    en: "🛒 Purchase request",
    // ONE button for every purchase request, guided. It used to be a free-text
    // capture handed to a model to sort into columns, with a second button
    // ("🔧 tool request") running the guided flow for the asset role — two ways
    // to file the same thing, one of them unreliable. The guided flow now asks
    // first which kind of request it is: a damaged item, photographed and
    // checked by the AI, or a new tool, described in full.
    button: "🛒 የግዢ ጥያቄ",
    captureMode: "asset_entry",
    input: "any",
    question: "🛒 የግዢ ጥያቄ በደረጃ እናስገባለን። መጀመሪያ የጥያቄውን ዓይነት ይምረጡ።",
  },
  ops: {
    key: "ops",
    en: "📊 Daily operations report",
    button: "📊 የዕለታዊ ክንውን ሪፖርት",
    captureMode: "ops_paste",
    input: "any",
    question:
      "📊 የዕለታዊ ክንውን ሪፖርቱን እዚህ ይለጥፉ (paste)። ቀናትን፣ የገቡ/የወጡ/የቀሩ ዕቃዎችን ክፍሎች እና የከረጢት ብዛትን ያካትቱ።",
  },
  production_report: {
    key: "production_report",
    en: "🏭 Daily production report",
    button: "🏭 የቀኑ የምርት ሪፖርት",
    // Was "llm": a free-text/photo/Excel report the model guessed columns from.
    // Now guided, for the same reason the asset reports were converted — what
    // lands in the table is what was typed, not what was inferred.
    captureMode: "asset_entry",
    input: "any",
    question: "🏭 የቀኑን የምርትና የክምችት ሪፖርት በደረጃ እናስገባለን።",
  },
  pp_bag_used: {
    key: "pp_bag_used",
    en: "🧺 Daily PP bag usage",
    button: "🧺 የቀኑ የPP ከረጢት ፍጆታ",
    captureMode: "asset_entry",
    input: "any",
    question: "🧺 ዛሬ የዋሉትን የPP ከረጢቶች በዓይነት እናስመዘግባለን።",
  },
  whiteness_check: {
    key: "whiteness_check",
    en: "⚪ Whiteness quality check",
    button: "⚪ የነጭነት ጥራት ምርመራ",
    captureMode: "asset_entry",
    input: "any",
    question: "⚪ የነጭነት ምርመራ መረጃውን በደረጃ እናስገባለን።",
  },
  // The key is unchanged so no session, roster row or registry entry has to move
  // with the report. What it collects is now only what ARRIVED: raw material
  // used is worked out from production (raw-material-usage.ts).
  raw_material_received: {
    key: "raw_material_received",
    en: "🧱 Raw material received",
    button: "🧱 የጥሬ ዕቃ ገቢ",
    captureMode: "asset_entry",
    input: "any",
    question: "🧱 አዲስ የገባውን ጥሬ ዕቃ እናስመዘግባለን።",
  },
  credit_payment: {
    key: "credit_payment",
    en: "💳 Credit payment tracking",
    button: "💳 የብድር ክፍያ መከታተያ",
    captureMode: "asset_entry",
    input: "any",
    question: "💳 በብድር የተሸጠውን ክፍያ እንመዘግባለን።",
  },
  downtime: {
    key: "downtime",
    en: "⏱ Monthly production downtime report",
    // Once a month, off the floor's own sheet: photographed, read, checked.
    button: "⏱ የወሩ የምርት መቋረጥ ሪፖርት",
    captureMode: "asset_entry",
    input: "any",
    question: "⏱ የወሩን የምርት መቋረጥ ሉህ ፎቶ አንስተን እናስገባለን።",
  },
  pp_bag_receipt: {
    key: "pp_bag_receipt",
    en: "🧺 PP bags received",
    button: "🧺 የPP ከረጢት ገቢ",
    captureMode: "asset_entry",
    input: "any",
    question: "🧺 የገቡትን የPP ከረጢቶች በዓይነት እናስገባለን።",
  },
  store_count: {
    key: "store_count",
    en: "🧰 Store items count",
    button: "🧰 የመጋዘን ዕቃዎች ቆጠራ",
    captureMode: "asset_entry",
    input: "any",
    question: "🧰 የመጋዘን ዕቃዎችን በክፍል በክፍል እንቆጥራለን። ያልቆጠሩትን ክፍል መዝለል ይችላሉ።",
  },
  pp_bag_damage: {
    key: "pp_bag_damage",
    en: "💔 PP bag damage report",
    button: "💔 የPP ከረጢት ብልሽት ሪፖርት",
    captureMode: "asset_entry",
    input: "photo",
    question: "💔 የPP ከረጢት ብልሽት ሪፖርት በደረጃ እናስገባለን።",
  },
  base_balance: {
    key: "base_balance",
    en: "📊 Monthly beginning balance",
    button: "📊 የወሩ የመነሻ ሚዛን",
    captureMode: "asset_entry",
    input: "any",
    question: "📊 የሚቀጥለውን ወር የመነሻ ሚዛን በደረጃ እናስገባለን።",
  },
  store_issue: {
    key: "store_issue",
    en: "📤 Store issue voucher (SIV)",
    // The Store Issue Voucher, as printed. It replaced the daily raw-material
    // issue: the paper covers everything leaving the warehouse, not just the
    // three materials that feed the monthly report.
    button: "📤 የመጋዘን ወጪ ቫውቸር",
    captureMode: "asset_entry",
    input: "any",
    question: "📤 ከመጋዘን የወጣውን ዕቃ በቫውቸሩ እናስመዘግባለን።",
  },
  grv: {
    key: "grv",
    en: "📥 Goods receiving voucher (GRV)",
    // The Goods Receiving Voucher, as printed. It replaced the tool purchase
    // report, the PP bag receipt and the asset PP bag count — three buttons for
    // slices of one event, none of them matching the paper being filled in.
    button: "📥 የዕቃ ገቢ ቫውቸር",
    captureMode: "asset_entry",
    input: "any",
    question: "📥 የገቡትን ዕቃዎች ከቫውቸሩና ከደረሰኙ ጋር እናስመዘግባለን።",
  },
  price_list: {
    key: "price_list",
    en: "💲 Monthly unit price list",
    button: "💲 የወሩ unit price ዝርዝር",
    captureMode: "asset_entry",
    input: "any",
    question: "💲 የወሩን የነጠላ ዋጋ ዝርዝር በደረጃ እናስገባለን።",
  },
  rm_credit_purchase: {
    key: "rm_credit_purchase",
    en: "🚚 Raw material credit purchase",
    button: "🚚 የጥሬ ዕቃ Credit ግዢ",
    captureMode: "asset_entry",
    input: "any",
    question: "🚚 የገባውን የጥሬ ዕቃ ጭነት እንመዘግባለን — የቋራ ባለቤት፣ የሽያጭ ወኪል፣ ሹፌርና ታርጋ፣ ዓይነት፣ ቶን፣ ዋጋና የሹፌር ክፍያ።",
  },
  rm_credit_payment: {
    key: "rm_credit_payment",
    en: "💸 Raw material credit payment",
    button: "💸 የጥሬ ዕቃ credit ክፍያ",
    captureMode: "asset_entry",
    input: "any",
    question: "💸 ያልተከፈሉ የጥሬ ዕቃና የሹፌር ክፍያዎች ዝርዝር ይመጣል — የተከፈለውን ይምረጡ።",
  },
  stationery_issue: {
    key: "stationery_issue",
    en: "📎 Stationery issue voucher",
    button: "📎 Stationary items issue voucher",
    captureMode: "asset_entry",
    input: "any",
    question: "📎 ከመጋዘን የወጡትን የጽሕፈት መሣሪያዎች እንመዘግባለን — ዕቃዎቹን ይምረጡ፣ ብዛቱን ይፃፉ።",
  },
  item_purchase: {
    key: "item_purchase",
    en: "🛍 Item purchase",
    button: "🛍 የዕቃ ግዢ",
    captureMode: "asset_entry",
    input: "any",
    question: "🛍 የተገዛውን ዕቃ እንመዘግባለን — ቀን፣ ዕቃ፣ ብዛት እና ዋጋ።",
  },
  pp_bag_price: {
    key: "pp_bag_price",
    en: "🧺 PP bag unit price update",
    button: "🧺 PP Bag unit price update",
    captureMode: "asset_entry",
    input: "any",
    question: "🧺 የዚህን ወር የPP ከረጢት የነጠላ ዋጋ እናዘምናለን። የተቀየረውን ብቻ ያርሙ።",
  },
  wht_holder: {
    key: "wht_holder",
    en: "📄 WHT receipt holder",
    button: "📄 WHT ደረሰኝ ያዢ",
    captureMode: "asset_entry",
    input: "any",
    question: "📄 የWHT ደረሰኝ ያልመለሰ ደንበኛ እናስመዘግባለን።",
  },
  purchase_items: {
    key: "purchase_items",
    en: "🧾 Purchased items report",
    button: "🧾 የግዢ ዕቃዎች ሪፖርት",
    captureMode: "llm",
    docType: "purchase_items",
    input: "any",
    question:
      "🧾 የተገዙ ዕቃዎችን ይላኩ — ጽሑፍ፣ ፎቶ ወይም Excel። መግለጫ፣ መለኪያ (uom)፣ ብዛት፣ አቅራቢ፣ ዋጋ፣ የወጪ ማዕከል እና ገዢ ያካትቱ።",
  },
  sales_report: {
    key: "sales_report",
    en: "🧾 Sales report",
    // One row per sale, in the columns of the sales sheet. Typed: the whole
    // row is filled in as one copyable block (no photos, no AI read), and
    // corrected on the review card. It was one Payment Summary
    // a day for a while, which said how much came in but not from whom or for
    // what — the questions the sales analytics exist to answer.
    button: "🧾 የሽያጭ ሪፖርት",
    captureMode: "asset_entry",
    input: "any",
    question: "🧾 ቀኑን ይምረጡ። ከዚያ የሽያጩን ሰንጠረዥ ሞልተው ይልካሉ።",
  },
  sales_manager: {
    key: "sales_manager",
    en: "📋 Sales data manager",
    // In English, as the owner asked for this one.
    button: "📋 Sales data manager",
    captureMode: "manager",
    input: "any",
    question: "📋 Sales to review.",
  },
  hr: {
    key: "hr",
    en: "👥 HR / customer report",
    button: "👥 የሰው ኃይል / ደንበኛ",
    captureMode: "capture",
    input: "any",
    question: "👥 የሪፖርቱን ዓይነት ይምረጡ።",
  },
};

/* ─────────────────────────── HR report subtypes ──────────────────────────── */

export type HrKind = "customer_contact" | "price_adjustment" | "employee_relations";

export const HR_KINDS: Record<HrKind, { button: string; en: string; question: string }> = {
  customer_contact: {
    button: "📞 የደንበኛ ግንኙነት / አስተያየት",
    en: "Customer contact & feedback",
    question: "📞 የደንበኛውን ስም፣ የተነጋገሩበትን ጉዳይ እና አስተያየቱን ይፃፉ።",
  },
  price_adjustment: {
    button: "💲 የዋጋ ማስተካከያ",
    en: "Price adjustment",
    question:
      "💲 ዕቃውን፣ አሁን ያለውን ዋጋ፣ የቀረበውን አዲስ ዋጋ እና ምክንያቱን ይፃፉ።",
  },
  employee_relations: {
    button: "🧑‍🤝‍🧑 የሠራተኛ ጉዳይ",
    en: "Employee relations",
    question:
      "🧑‍🤝‍🧑 የሠራተኛውን ስም እና ጉዳዩን (የመገኘት ሁኔታ፣ አለመግባባት፣ ወዘተ) ይፃፉ።",
  },
};

/* ───────────────────────────────── Positions ─────────────────────────────── */

/**
 * Report roles, grouped by department. An employee may hold roles across several
 * departments — the checkboxes are independent. HR and Admin are recipient
 * roles: they receive the morning digests (see the morning-reminder cron) rather
 * than filing daily reports themselves.
 *
 * The bot's capture engine keys off CAPABILITIES, not these keys, so redefining
 * the roles here does not touch how submissions are ingested.
 */
export type PositionGroupKey =
  | "production"
  | "asset_management"
  | "sales"
  | "finance"
  | "hr"
  | "admin";

export type PositionKey =
  | "prod_daily"
  | "asset_materials"
  | "asset_purchase"
  | "stationery_issuer"
  | "sales_daily"
  | "finance"
  | "hr"
  | "admin";

export interface Position {
  key: PositionKey;
  department: PositionGroupKey;
  en: string;
  am: string;
  description: string;
  capabilities: CapabilityKey[];
  /**
   * Whether holding this role obliges a daily report. Tool purchase requests are
   * on-demand and the monthly finance report is monthly, so those are false;
   * HR and Admin are recipients, also false.
   */
  dailyRequired: boolean;
  /**
   * Tables that count as "this person reported today".
   *
   * Without this, compliance was measured solely by a `daily_reports` row — which
   * only the `daily_report` capability can create. Roles that report through the
   * guided flows instead could therefore never mark themselves as done: they were
   * re-reminded every morning after filing and sat permanently in the "missing"
   * list. Each role now declares what its own submission looks like.
   */
  submissionTables: string[];
}

/** Capability keys in declaration order — used to grant the admin everything. */
const ALL_CAPABILITIES = Object.keys(CAPABILITIES) as CapabilityKey[];

export const POSITIONS: Record<PositionKey, Position> = {
  prod_daily: {
    key: "prod_daily",
    department: "production",
    en: "Daily production report",
    am: "የዕለት ምርት ሪፖርት",
    description: "Files the guided daily production and stock report.",
    // One button, deliberately. The free-text daily report, the shift report,
    // the truck/stone gate log, the pasted operations report and the monthly
    // stock sheet all captured pieces of what the guided flow now asks for
    // column by column — five ways to record the same day, none of them
    // agreeing. Shift analysis and stone traceability are gone from the system
    // entirely; their historic rows stay readable under Settings → Submissions.
    capabilities: ["production_report", "pp_bag_used", "whiteness_check", "downtime"],
    dailyRequired: true,
    // production_reports is written on every submission; daily_ops_reports only
    // when the stock half is non-empty, so it cannot stand in as the signal.
    submissionTables: ["production_reports"],
  },
  asset_materials: {
    key: "asset_materials",
    department: "asset_management",
    en: "Raw materials received",
    am: "የጥሬ ዕቃ ገቢ",
    description: "Reports raw material when it arrives, and keeps the store vouchers.",
    // Deliberately just the two guided flows. The free-text daily report, stock
    // status and material count were left over from before those flows existed
    // and only duplicated, less reliably, what the guided steps now capture.
    capabilities: [
      "raw_material_received",
      // The managers asked for every item in the store to be counted. It is the
      // storekeeper who counts it, so it sits with the other store reports —
      // as does the bag delivery they sign for.
      "store_count",
      "pp_bag_receipt",
      "pp_bag_damage",
      // Both feed the monthly finance report: the store issue voucher fills its
      // consumption column, and the base balance opens each month.
      "store_issue",
      "base_balance",
    ],
    // Raw material is filed when it arrives, not every day: use is worked out
    // from production. So nothing here is owed on a given day.
    dailyRequired: false,
    // store_issue_vouchers is deliberately absent: nothing leaves the warehouse
    // on some days, and a table nobody filed would mark this role non-compliant
    // for every quiet day. material_issues stays so historic days still count.
    // pp_bag_damage_reports is deliberately absent: the damage report is filed
    // weekly now, and leaving it here meant one weekly report marked this role
    // compliant for that day — masking a missing daily raw-material report.
    // store_counts is deliberately absent: the count is weekly, and a weekly
    // report here would mark the role compliant for a day it filed no daily
    // raw-material report — exactly the masking the bag damage report caused.
    // raw_material_receipts stays alongside its replacement so days filed
    // before the daily report existed still count as reported.
    // delivery_reports likewise: the delivery report is retired, but the days
    // it was filed on still count as reported.
    submissionTables: [
      "raw_material_daily",
      "raw_material_receipts",
      "delivery_reports",
      "material_issues",
    ],
  },
  asset_purchase: {
    key: "asset_purchase",
    department: "asset_management",
    en: "Tool purchase request",
    am: "የመሣሪያ ግዢ ጥያቄ",
    description: "Raises tool and equipment purchase requests when needed (not daily).",
    capabilities: ["purchase"],
    dailyRequired: false,
    submissionTables: ["purchase_requests"],
  },
  stationery_issuer: {
    key: "stationery_issuer",
    department: "asset_management",
    en: "Stationery issuer",
    am: "የጽሕፈት መሣሪያ አውጪ",
    description: "Issues stationery items from the store on the stationery issue voucher (not daily).",
    capabilities: ["stationery_issue"],
    dailyRequired: false,
    submissionTables: [],
  },
  sales_daily: {
    key: "sales_daily",
    department: "sales",
    en: "Sales report & receipts",
    am: "የሽያጭ ሪፖርትና ደረሰኝ",
    description: "Files the daily sales report together with receipts.",
    capabilities: ["sales_report"],
    dailyRequired: true,
    submissionTables: ["sales_invoices"],
  },
  finance: {
    key: "finance",
    department: "finance",
    en: "Finance",
    am: "ፋይናንስ",
    description:
      "Files the goods receiving voucher for every purchase, the monthly price list, and registers the customers who still owe a WHT receipt.",
    // The GRV replaced the tool purchase report and the PP bag receipt: one
    // voucher covers every kind of purchase, PP bags included as line items.
    // No bank sheet any more: per-bank cash is read off the sales report itself.
    // No 🛍 item purchase any more: Finance → Purchase status reads what was
    // bought off the GRV, so the purchase is not asked for a second time. Its
    // past rows stay (item_purchases, below).
    capabilities: ["grv", "price_list", "pp_bag_price", "wht_holder", "credit_payment", "rm_credit_purchase", "rm_credit_payment"],
    // Purchases are on-demand and the price list is monthly, so there is no
    // daily obligation to chase. The WHT chase is its own cron, not a reminder.
    dailyRequired: false,
    submissionTables: ["goods_receiving_vouchers", "finance_purchase_batches", "wht_holders", "raw_material_credits", "item_purchases"],
  },
  hr: {
    key: "hr",
    department: "hr",
    en: "HR",
    am: "የሰው ኃይል",
    description:
      "Receives the morning report of who did and didn't submit, plus tool purchase requests. Can also file HR/customer reports.",
    capabilities: ["hr", "purchase"],
    dailyRequired: false,
    submissionTables: ["hr_reports"],
  },
  admin: {
    key: "admin",
    department: "admin",
    en: "Administrator",
    am: "አስተዳዳሪ",
    description:
      "Receives a concise daily Telegram digest across Production, Sales, Finance and Asset, plus who missed the daily report. Full access to every report.",
    capabilities: ALL_CAPABILITIES,
    dailyRequired: false,
    submissionTables: [],
  },
};

export const POSITION_KEYS = Object.keys(POSITIONS) as PositionKey[];

export function isPositionKey(value: unknown): value is PositionKey {
  return typeof value === "string" && value in POSITIONS;
}

/* ─────────────── Department grouping for the add-user screen ──────────────── */

export interface PositionGroup {
  key: PositionGroupKey;
  name: string;
  am: string;
  icon: string;
  /** Extra explanation, used for the recipient (HR / Admin) groups. */
  note?: string;
  positions: PositionKey[];
}

export const POSITION_GROUPS: PositionGroup[] = [
  { key: "production", name: "Production", am: "ምርት", icon: "🏭", positions: ["prod_daily"] },
  {
    key: "asset_management",
    name: "Asset Management",
    am: "የንብረት አስተዳደር",
    icon: "📦",
    positions: ["asset_materials", "asset_purchase", "stationery_issuer"],
  },
  { key: "sales", name: "Sales", am: "ሽያጭ", icon: "🤝", positions: ["sales_daily"] },
  { key: "finance", name: "Finance", am: "ፋይናንስ", icon: "💵", positions: ["finance"] },
  {
    key: "hr",
    name: "HR",
    am: "የሰው ኃይል",
    icon: "👥",
    note: "Gets the morning digest of who submitted and who didn't, plus tool purchase requests.",
    positions: ["hr"],
  },
  {
    key: "admin",
    name: "Admin",
    am: "አስተዳዳሪ",
    icon: "🛡",
    note: "Gets a concise daily digest across all departments and who missed their report.",
    positions: ["admin"],
  },
];

/** Union of the capabilities granted by every position the user holds. */
export function capabilitiesFor(positions: string[]): Capability[] {
  const keys = new Set<CapabilityKey>();
  for (const p of positions) {
    if (isPositionKey(p)) POSITIONS[p].capabilities.forEach((c) => keys.add(c));
  }
  // Preserve the declaration order of CAPABILITIES so menus are stable.
  return (Object.keys(CAPABILITIES) as CapabilityKey[])
    .filter((k) => keys.has(k))
    .map((k) => CAPABILITIES[k]);
}

export function isCapabilityKey(value: unknown): value is CapabilityKey {
  return typeof value === "string" && value in CAPABILITIES;
}

/**
 * The functionalities an employee actually gets.
 *
 * `override` is the per-employee list chosen in the dashboard. Null or empty
 * means "whatever the positions grant", which is how every user behaved before
 * overrides existed — so an untouched employee is unaffected.
 */
export function resolveCapabilities(positions: string[], override?: string[] | null): Capability[] {
  const keys = (override || []).filter(isCapabilityKey);
  if (keys.length === 0) return capabilitiesFor(positions);
  const set = new Set<CapabilityKey>(keys);
  // Declaration order, so the bot menu stays stable however the list was saved.
  return (Object.keys(CAPABILITIES) as CapabilityKey[]).filter((k) => set.has(k)).map((k) => CAPABILITIES[k]);
}

/**
 * Tick or untick one bot functionality in the dashboard, returning the roles and
 * the override that should be saved.
 *
 * Ticking a functionality whose role is not held also grants that role: the
 * capability alone would give the employee the button, but the ROLE is what
 * drives the daily-report obligation and the HR/Admin digests, so a button with
 * no role behind it would never be tracked. The role's other buttons stay off —
 * one functionality was asked for, not the whole job.
 *
 * `override: null` means "no override, use the roles' defaults". It is restored
 * whenever the selection lands back exactly on the defaults, so an employee who
 * matches their role keeps tracking it rather than freezing a copy of it.
 *
 * `groupPositions` are the roles of the department whose checkbox was clicked,
 * which is what keeps `admin` — holder of every capability — from being granted
 * by a click anywhere else on the screen.
 */
export function toggleCapability(
  key: CapabilityKey,
  state: { positions: PositionKey[]; override: CapabilityKey[] | null },
  groupPositions: readonly PositionKey[]
): { positions: PositionKey[]; override: CapabilityKey[] | null } {
  const defaults = capabilitiesFor(state.positions).map((c) => c.key);
  const base = state.override ?? defaults;
  const turningOn = !base.includes(key);

  let positions = state.positions;
  if (turningOn && !positions.some((p) => POSITIONS[p].capabilities.includes(key))) {
    const owner = groupPositions.find((p) => POSITIONS[p].capabilities.includes(key));
    if (owner) positions = [...positions, owner];
  }

  const next = turningOn ? [...base, key] : base.filter((k) => k !== key);
  // Compared against the roles as they are AFTER this click, not before.
  const after = capabilitiesFor(positions).map((c) => c.key);
  const same = next.length === after.length && [...next].sort().join("|") === [...after].sort().join("|");
  return { positions, override: same ? null : next };
}

/* ───────────── Flat functionality list (Settings → Employees) ────────────── */

/**
 * Every bot button the dashboard offers, in the owner's order. The employee
 * screen is this list plus HR and ADMIN — no departments. The roles behind it
 * are worked out from what is ticked (selectionToPositions), because roles still
 * drive the daily-report obligation and the HR/Admin digests.
 */
export const BOT_FUNCTIONALITIES: CapabilityKey[] = [
  "damage",
  "purchase",
  "ops",
  "production_report",
  "pp_bag_used",
  "whiteness_check",
  "raw_material_received",
  "credit_payment",
  "downtime",
  "pp_bag_receipt",
  "store_count",
  "pp_bag_damage",
  "base_balance",
  "store_issue",
  "grv",
  "price_list",
  "rm_credit_purchase",
  "rm_credit_payment",
  "stationery_issue",
  "item_purchase",
  "pp_bag_price",
  "wht_holder",
  "sales_report",
  "sales_manager",
];

/**
 * The role a ticked button brings with it — only for the buttons whose report
 * IS that role's daily check (its submissionTables). Ticking 🧺 PP bag use alone
 * no longer makes someone owe a daily production report; ticking 🏭 does.
 */
const ROLE_OF: Partial<Record<CapabilityKey, PositionKey>> = {
  production_report: "prod_daily",
  raw_material_received: "asset_materials",
  sales_report: "sales_daily",
  purchase: "asset_purchase",
  stationery_issue: "stationery_issuer",
  grv: "finance",
  price_list: "finance",
  pp_bag_price: "finance",
  wht_holder: "finance",
  credit_payment: "finance",
  rm_credit_purchase: "finance",
  rm_credit_payment: "finance",
  item_purchase: "finance",
};

/** The roles to store for a flat selection: ticked buttons, plus HR / ADMIN. */
export function selectionToPositions(caps: CapabilityKey[], hr: boolean, admin: boolean): PositionKey[] {
  const out = new Set<PositionKey>();
  for (const c of caps) {
    const p = ROLE_OF[c];
    if (p) out.add(p);
  }
  if (hr) out.add("hr");
  if (admin) out.add("admin");
  return POSITION_KEYS.filter((p) => out.has(p));
}

/** What the flat list shows as ticked for an employee as stored. */
export function positionsToSelection(
  positions: string[],
  override?: string[] | null
): { caps: CapabilityKey[]; hr: boolean; admin: boolean } {
  // A receiver-only HR/Admin has no submit menu, whatever their role defaults.
  const caps = isReceiverOnly(positions, override) ? [] : resolveCapabilities(positions, override).map((c) => c.key);
  return {
    caps: BOT_FUNCTIONALITIES.filter((k) => caps.includes(k)),
    hr: positions.includes("hr"),
    admin: positions.includes("admin"),
  };
}

export function hasCapability(positions: string[], key: CapabilityKey): boolean {
  return capabilitiesFor(positions).some((c) => c.key === key);
}

/** True when any held role obliges a daily report — drives reminders/compliance. */
export function requiresDailyReport(positions: string[]): boolean {
  return positions.some((p) => isPositionKey(p) && POSITIONS[p].dailyRequired);
}

/** Every table that counts as "reported" for the roles this person holds. */
export function submissionTablesFor(positions: string[]): string[] {
  const out = new Set<string>();
  for (const p of positions) {
    if (isPositionKey(p)) POSITIONS[p].submissionTables.forEach((t) => out.add(t));
  }
  return [...out];
}

/**
 * True when the person files through the free-text daily report rather than a
 * guided flow. Drives the reminder wording: telling someone to press
 * "📝 የቀኑ ሪፖርት" when they have no such button is worse than saying nothing.
 */
export function filesFreeTextDailyReport(positions: string[], override?: string[] | null): boolean {
  return resolveCapabilities(positions, override).some((c) => c.key === "daily_report");
}

/** True when the user holds a specific role (e.g. hr, admin). */
export function hasPosition(positions: string[], key: PositionKey): boolean {
  return positions.includes(key);
}

/**
 * True when every role the user holds is a recipient role (admin / HR). These
 * users receive the daily digests on Telegram but never submit reports — the bot
 * shows them a receiver-only menu and rejects submission attempts. Someone who
 * also holds a reporting role is NOT receiver-only and keeps their submit menu,
 * and so is an HR/Admin with bot buttons ticked for them in the dashboard
 * (`override`): those buttons have no role of their own behind them.
 */
export function isReceiverOnly(positions: string[], override?: string[] | null): boolean {
  if ((override || []).some(isCapabilityKey)) return false;
  return positions.length > 0 && positions.every((p) => p === "admin" || p === "hr");
}

export function positionLabelsAm(positions: string[]): string {
  return positions.filter(isPositionKey).map((p) => POSITIONS[p].am).join("፣ ");
}
