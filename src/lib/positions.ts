/**
 * Employee report roles (grouped by department) and what each may submit through
 * the Telegram bot.
 *
 * A user holds one or more roles; their bot menu is the union of the capabilities
 * of those roles. Roles can span departments (a person may report both sales and
 * production). `finance_daily` includes `wht`, so filing withholding receipts is
 * part of the daily finance role rather than a separate one.
 */

export type CapabilityKey =
  | "daily_report"
  | "damage"
  | "receipt"
  | "purchase"
  | "wht"
  | "sales"
  | "truck"
  | "shift"
  | "ops"
  | "materials"
  | "hr"
  | "question";

/** How the bot collects a capability's payload. */
export type CaptureMode =
  /** Classified by the vision/text LLM, then written to a typed collection. */
  | "llm"
  /** Free text (+ optional photos) stored verbatim. */
  | "capture"
  /** Pasted multi-day operations report. */
  | "ops_paste"
  /** Free-form question answered by the company chat model. */
  | "chat";

export interface Capability {
  key: CapabilityKey;
  /** Reply-keyboard label. Routing normalises this, so the emoji is cosmetic. */
  button: string;
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
    button: "📝 የቀኑ ሪፖርት",
    captureMode: "capture",
    input: "any",
    question:
      "📝 የዛሬውን ሪፖርት ይፃፉ። ፎቶ ካለዎት አብረው ይላኩ (ፎቶውን ከመግለጫ ጋር መላክ ይችላሉ)።",
  },
  damage: {
    key: "damage",
    button: "🛡️ የተበላሹ ጆንያዎች",
    captureMode: "llm",
    docType: "damage_claim",
    input: "photo",
    question:
      "📷 የተበላሹትን ከረጢቶች ፎቶ ይላኩ። በፎቶው መግለጫ (caption) ላይ የተበላሹትን ከረጢቶች ብዛት ይፃፉ።",
  },
  receipt: {
    key: "receipt",
    button: "🧾 ደረሰኝ",
    captureMode: "llm",
    docType: "receipt",
    input: "photo",
    question: "🧾 QR ኮድ ያለው ኦፊሴላዊ ደረሰኝ ፎቶ ይላኩ። ያለ QR ኮድ ደረሰኝ ተቀባይነት የለውም።",
  },
  purchase: {
    key: "purchase",
    button: "🛒 የግዢ ጥያቄ",
    captureMode: "llm",
    docType: "purchase_request",
    input: "any",
    question:
      "📝 ዕቃውን ወይም አገልግሎቱን፣ የገንዘቡን መጠን እና ምክንያቱን ይፃፉ። ደጋፊ ማስረጃ ካለዎት ፎቶ ያያይዙ።",
  },
  wht: {
    key: "wht",
    button: "📄 WHT ደረሰኝ",
    captureMode: "llm",
    docType: "withholding_receipt",
    input: "photo",
    question:
      "📄 የ3% ታክስ (WHT) ደረሰኝ ፎቶውን ከደረሰኝ ቁጥሩ (invoice number)፣ ከደንበኛው ስም እና ከገንዘቡ መጠን ጋር ይላኩ።",
  },
  sales: {
    key: "sales",
    button: "💵 ሽያጭ / ክፍያ",
    captureMode: "llm",
    docType: "payment",
    input: "any",
    question:
      "💵 የክፍያ ማረጋገጫ ፎቶ ይላኩ፣ ወይም የደረሰኝ ቁጥሩን (invoice number)፣ ደንበኛውን፣ የገንዘቡን መጠን፣ የክፍያ ቀኑን እና የክፍያ መንገዱን ይፃፉ።",
  },
  truck: {
    key: "truck",
    button: "🚚 የጭነት መኪና ሁኔታ",
    captureMode: "llm",
    docType: "stone_delivery",
    input: "photo",
    question:
      "🚚 የጭነት መኪናውን ወይም የድንጋዩን ፎቶ ከሰሌዳ ቁጥሩ፣ ከጭነት ብዛቱ፣ ከተጫነበት ማዕድን ማውጫ (ኳሪ) እና ከታወቀ የአሽከርካሪው ስም ጋር ይላኩ።",
  },
  shift: {
    key: "shift",
    button: "🏭 የፈረቃ ሪፖርት",
    captureMode: "llm",
    docType: "shift_report",
    input: "any",
    question:
      "🏭 የተሞሉ ከረጢቶችን ብዛት፣ የከረጢቱን ክብደት (25 ወይም 40 ኪ.ግ)፣ የሥራ መቋረጥ ደቂቃዎችን፣ ፈረቃውን እና ማናቸውንም ማስታወሻዎች ይፃፉ።",
  },
  ops: {
    key: "ops",
    button: "📊 የዕለታዊ ክንውን ሪፖርት",
    captureMode: "ops_paste",
    input: "any",
    question:
      "📊 የዕለታዊ ክንውን ሪፖርቱን እዚህ ይለጥፉ (paste)። ቀናትን፣ የገቡ/የወጡ/የቀሩ ዕቃዎችን ክፍሎች እና የከረጢት ብዛትን ያካትቱ።",
  },
  materials: {
    key: "materials",
    button: "📦 የዕቃ ቆጠራ",
    captureMode: "capture",
    input: "any",
    question:
      "📦 የገቡትን የPP ከረጢቶች እና ሌሎች ዕቃዎችን ቆጠራ ይፃፉ (ዓይነት እና ብዛት)። የቆጠራውን ፎቶ አብረው ይላኩ።",
  },
  hr: {
    key: "hr",
    button: "👥 የሰው ኃይል / ደንበኛ",
    captureMode: "capture",
    input: "any",
    question: "👥 የሪፖርቱን ዓይነት ይምረጡ።",
  },
  question: {
    key: "question",
    button: "🤖 የድርጅት ጥያቄ",
    captureMode: "chat",
    input: "any",
    question: "💬 የድርጅት ጥያቄዎን በአንድ መልዕክት ብቻ ይፃፉ።",
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
  | "sales_daily"
  | "finance_daily"
  | "finance_monthly"
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
}

/** Capability keys in declaration order — used to grant the admin everything. */
const ALL_CAPABILITIES = Object.keys(CAPABILITIES) as CapabilityKey[];

export const POSITIONS: Record<PositionKey, Position> = {
  prod_daily: {
    key: "prod_daily",
    department: "production",
    en: "Daily production report",
    am: "የዕለት ምርት ሪፖርት",
    description: "Reports production output every day (shift and daily operations).",
    capabilities: ["daily_report", "shift", "ops", "question"],
    dailyRequired: true,
  },
  asset_materials: {
    key: "asset_materials",
    department: "asset_management",
    en: "Raw materials weight report",
    am: "የጥሬ ዕቃ ክብደት ሪፖርት",
    description: "Reports the weight of imported raw materials every day.",
    capabilities: ["daily_report", "materials", "question"],
    dailyRequired: true,
  },
  asset_purchase: {
    key: "asset_purchase",
    department: "asset_management",
    en: "Tool purchase request",
    am: "የመሣሪያ ግዢ ጥያቄ",
    description: "Raises tool and equipment purchase requests when needed (not daily).",
    capabilities: ["purchase", "question"],
    dailyRequired: false,
  },
  sales_daily: {
    key: "sales_daily",
    department: "sales",
    en: "Sales report & receipts",
    am: "የሽያጭ ሪፖርትና ደረሰኝ",
    description: "Files the daily sales report together with receipts.",
    capabilities: ["daily_report", "sales", "receipt", "question"],
    dailyRequired: true,
  },
  finance_daily: {
    key: "finance_daily",
    department: "finance",
    en: "Daily financial report",
    am: "የዕለታዊ ፋይናንስ ሪፖርት",
    description: "Files the daily financial report and 3% withholding (WHT) receipts.",
    capabilities: ["daily_report", "sales", "wht", "question"],
    dailyRequired: true,
  },
  finance_monthly: {
    key: "finance_monthly",
    department: "finance",
    en: "Monthly financial report",
    am: "የወርሃዊ ፋይናንስ ሪፖርት",
    description: "Files the monthly financial summary (monthly, not daily).",
    capabilities: ["sales", "question"],
    dailyRequired: false,
  },
  hr: {
    key: "hr",
    department: "hr",
    en: "HR",
    am: "የሰው ኃይል",
    description:
      "Receives the morning report of who did and didn't submit, plus tool purchase requests. Can also file HR/customer reports.",
    capabilities: ["hr", "purchase", "question"],
    dailyRequired: false,
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
    positions: ["asset_materials", "asset_purchase"],
  },
  { key: "sales", name: "Sales", am: "ሽያጭ", icon: "🤝", positions: ["sales_daily"] },
  { key: "finance", name: "Finance", am: "ፋይናንስ", icon: "💵", positions: ["finance_daily", "finance_monthly"] },
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

export function hasCapability(positions: string[], key: CapabilityKey): boolean {
  return capabilitiesFor(positions).some((c) => c.key === key);
}

/** True when any held role obliges a daily report — drives reminders/compliance. */
export function requiresDailyReport(positions: string[]): boolean {
  return positions.some((p) => isPositionKey(p) && POSITIONS[p].dailyRequired);
}

/** True when the user holds a specific role (e.g. hr, admin). */
export function hasPosition(positions: string[], key: PositionKey): boolean {
  return positions.includes(key);
}

/**
 * True when every role the user holds is a recipient role (admin / HR). These
 * users receive the daily digests on Telegram but never submit reports — the bot
 * shows them a receiver-only menu and rejects submission attempts. Someone who
 * also holds a reporting role is NOT receiver-only and keeps their submit menu.
 */
export function isReceiverOnly(positions: string[]): boolean {
  return positions.length > 0 && positions.every((p) => p === "admin" || p === "hr");
}

export function positionLabelsAm(positions: string[]): string {
  return positions.filter(isPositionKey).map((p) => POSITIONS[p].am).join("፣ ");
}
