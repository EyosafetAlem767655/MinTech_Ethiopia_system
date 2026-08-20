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
  // Structured department report formats (text / photo / Excel).
  | "production_report"
  | "raw_material_received"
  | "finished_goods_delivery"
  | "purchase_items"
  | "sales_receipt_scan"
  | "sales_report_entry"
  | "tool_request"
  | "pp_bag_damage";

/** How the bot collects a capability's payload. */
export type CaptureMode =
  /** Classified by the vision/text LLM, then written to a typed collection. */
  | "llm"
  /** Free text (+ optional photos) stored verbatim. */
  | "capture"
  /** Pasted multi-day operations report. */
  | "ops_paste"
  /** Scan receipt photo(s) → OCR + Qwen → preview/edit → Excel (sales). */
  | "receipt_scan"
  /** Guided field-by-field sales report entry (+ attached receipts) → Excel. */
  | "sales_entry"
  /** Guided column-by-column asset report (raw material / delivery / tool request). */
  | "asset_entry";

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
  production_report: {
    key: "production_report",
    button: "🏭 የቀኑ የምርት ሪፖርት",
    // Was "llm": a free-text/photo/Excel report the model guessed columns from.
    // Now guided, for the same reason the asset reports were converted — what
    // lands in the table is what was typed, not what was inferred.
    captureMode: "asset_entry",
    input: "any",
    question: "🏭 የቀኑን የምርትና የክምችት ሪፖርት በደረጃ እናስገባለን።",
  },
  raw_material_received: {
    key: "raw_material_received",
    button: "🚚 የጥሬ ዕቃ ገቢ ሪፖርት",
    captureMode: "asset_entry",
    input: "any",
    question: "🚚 የጥሬ ዕቃ ገቢ ሪፖርት በደረጃ እናስገባለን።",
  },
  finished_goods_delivery: {
    key: "finished_goods_delivery",
    button: "🚛 የማድረሻ ሪፖርት",
    captureMode: "asset_entry",
    input: "any",
    question: "🚛 የማድረሻ ሪፖርት በደረጃ እናስገባለን።",
  },
  tool_request: {
    key: "tool_request",
    button: "🔧 የመሣሪያ ግዢ ጥያቄ",
    captureMode: "asset_entry",
    input: "any",
    question: "🔧 የመሣሪያ ግዢ ጥያቄ በደረጃ እናስገባለን።",
  },
  pp_bag_damage: {
    key: "pp_bag_damage",
    button: "💔 የPP ከረጢት ብልሽት ሪፖርት",
    captureMode: "asset_entry",
    input: "photo",
    question: "💔 የPP ከረጢት ብልሽት ሪፖርት በደረጃ እናስገባለን።",
  },
  purchase_items: {
    key: "purchase_items",
    button: "🧾 የግዢ ዕቃዎች ሪፖርት",
    captureMode: "llm",
    docType: "purchase_items",
    input: "any",
    question:
      "🧾 የተገዙ ዕቃዎችን ይላኩ — ጽሑፍ፣ ፎቶ ወይም Excel። መግለጫ፣ መለኪያ (uom)፣ ብዛት፣ አቅራቢ፣ ዋጋ፣ የወጪ ማዕከል እና ገዢ ያካትቱ።",
  },
  sales_report_entry: {
    key: "sales_report_entry",
    button: "🧾 የሽያጭ ሪፖርት",
    captureMode: "sales_entry",
    input: "any",
    question:
      "🧾 የሽያጭ ሪፖርት በደረጃ እናስገባለን። መጀመሪያ የደንበኛውን ስም ይፃፉ።",
  },
  sales_receipt_scan: {
    key: "sales_receipt_scan",
    button: "📷 ደረሰኝ ስካን",
    captureMode: "receipt_scan",
    input: "photo",
    question:
      "📷 የደረሰኙን ፎቶ(ዎች) ይላኩ — እስከ 3 ፎቶ። ከጨረሱ በኋላ \"✅ ጨርሻለሁ\" የሚለውን ይጫኑ።",
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
    description: "Reports production output every day (shift and daily operations).",
    // The monthly stock-status sheet was dropped: the guided daily report now
    // captures the stock count, and the monthly accounting sheet duplicated it
    // less reliably. Its historic rows stay readable in the dashboard and chat.
    capabilities: ["daily_report", "shift", "ops", "production_report"],
    dailyRequired: true,
    submissionTables: ["daily_reports", "shift_reports", "daily_ops_reports", "production_reports"],
  },
  asset_materials: {
    key: "asset_materials",
    department: "asset_management",
    en: "Raw materials weight report",
    am: "የጥሬ ዕቃ ክብደት ሪፖርት",
    description: "Reports raw materials received and finished goods delivered, every day.",
    // Deliberately just the two guided flows. The free-text daily report, stock
    // status and material count were left over from before those flows existed
    // and only duplicated, less reliably, what the guided steps now capture.
    capabilities: ["raw_material_received", "finished_goods_delivery", "pp_bag_damage"],
    dailyRequired: true,
    submissionTables: ["raw_material_receipts", "delivery_reports", "pp_bag_damage_reports"],
  },
  asset_purchase: {
    key: "asset_purchase",
    department: "asset_management",
    en: "Tool purchase request",
    am: "የመሣሪያ ግዢ ጥያቄ",
    description: "Raises tool and equipment purchase requests when needed (not daily).",
    capabilities: ["tool_request"],
    dailyRequired: false,
    submissionTables: ["purchase_requests"],
  },
  sales_daily: {
    key: "sales_daily",
    department: "sales",
    en: "Sales report & receipts",
    am: "የሽያጭ ሪፖርትና ደረሰኝ",
    description: "Files the daily sales report together with receipts.",
    capabilities: ["sales_report_entry", "sales_receipt_scan"],
    dailyRequired: true,
    submissionTables: ["sales_receipts"],
  },
  finance_daily: {
    key: "finance_daily",
    department: "finance",
    en: "Daily financial report",
    am: "የዕለታዊ ፋይናንስ ሪፖርት",
    description: "Files the daily financial report and 3% withholding (WHT) receipts.",
    capabilities: ["daily_report", "sales", "wht"],
    dailyRequired: true,
    // payments has no author column, so it can never be attributed to a person.
    submissionTables: ["daily_reports", "receipts"],
  },
  finance_monthly: {
    key: "finance_monthly",
    department: "finance",
    en: "Monthly financial report",
    am: "የወርሃዊ ፋይናንስ ሪፖርት",
    description: "Files the monthly financial summary (monthly, not daily).",
    capabilities: ["sales"],
    dailyRequired: false,
    submissionTables: [],
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
 * also holds a reporting role is NOT receiver-only and keeps their submit menu.
 */
export function isReceiverOnly(positions: string[]): boolean {
  return positions.length > 0 && positions.every((p) => p === "admin" || p === "hr");
}

export function positionLabelsAm(positions: string[]): string {
  return positions.filter(isPositionKey).map((p) => POSITIONS[p].am).join("፣ ");
}
