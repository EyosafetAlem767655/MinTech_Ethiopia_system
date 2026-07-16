/**
 * Employee positions and what each one may submit through the Telegram bot.
 *
 * A user holds one or more positions; their bot menu is the union of the
 * capabilities of those positions. `finance_reporter` deliberately includes
 * `wht` so the finance department can file withholding receipts without also
 * being given the dedicated WHT-submitter position.
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

export type PositionKey =
  | "admin"
  | "quality_checker"
  | "production_reporter"
  | "finance_reporter"
  | "store_keeper"
  | "wht_submitter"
  | "purchase_requester"
  | "hr";

export interface Position {
  key: PositionKey;
  en: string;
  am: string;
  description: string;
  capabilities: CapabilityKey[];
}

/** Every internal employee gets these, regardless of position. */
const BASE_CAPABILITIES: CapabilityKey[] = ["daily_report", "receipt", "question"];

/** Capability keys in declaration order — used to grant the admin everything. */
const ALL_CAPABILITIES = Object.keys(CAPABILITIES) as CapabilityKey[];

export const POSITIONS: Record<PositionKey, Position> = {
  admin: {
    key: "admin",
    en: "Administrator",
    am: "አስተዳዳሪ",
    description:
      "Full access to every report. Receives the yearly data archive on Telegram before old records are deleted.",
    capabilities: ALL_CAPABILITIES,
  },
  quality_checker: {
    key: "quality_checker",
    en: "Stone quality & weight checker",
    am: "የድንጋይ ጥራትና ክብደት ተቆጣጣሪ",
    description: "Checks incoming stone quality and files weight reports. Several people hold this position.",
    capabilities: [...BASE_CAPABILITIES, "truck", "shift"],
  },
  production_reporter: {
    key: "production_reporter",
    en: "Daily production reporter",
    am: "የዕለት ምርት ሪፖርተር",
    description: "Reports daily production output and shift performance.",
    capabilities: [...BASE_CAPABILITIES, "shift", "ops"],
  },
  finance_reporter: {
    key: "finance_reporter",
    en: "Finance reporter (daily & monthly)",
    am: "የፋይናንስ ሪፖርተር",
    description: "Submits sales reports, payments and monthly financials. Also allowed to file WHT receipts.",
    capabilities: [...BASE_CAPABILITIES, "sales", "wht"],
  },
  store_keeper: {
    key: "store_keeper",
    en: "Store keeper",
    am: "የመጋዘን ሹም",
    description: "Counts imported PP bags and other materials; reports damaged bags.",
    capabilities: [...BASE_CAPABILITIES, "materials", "damage", "ops"],
  },
  wht_submitter: {
    key: "wht_submitter",
    en: "WHT receipt submitter",
    am: "የWHT ደረሰኝ አስገቢ",
    description: "Files 3% withholding tax receipts against invoices.",
    capabilities: [...BASE_CAPABILITIES, "wht"],
  },
  purchase_requester: {
    key: "purchase_requester",
    en: "Tool purchase requester",
    am: "የመሣሪያ ግዢ ጠያቂ",
    description: "Raises purchase requests for tools and equipment.",
    capabilities: [...BASE_CAPABILITIES, "purchase"],
  },
  hr: {
    key: "hr",
    en: "HR & customer relations",
    am: "የሰው ኃይልና ደንበኛ ግንኙነት ኃላፊ",
    description: "Customer contact and feedback, price adjustments, attendance and conflict resolution.",
    capabilities: [...BASE_CAPABILITIES, "hr"],
  },
};

export const POSITION_KEYS = Object.keys(POSITIONS) as PositionKey[];

export function isPositionKey(value: unknown): value is PositionKey {
  return typeof value === "string" && value in POSITIONS;
}

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

export function positionLabelsAm(positions: string[]): string {
  return positions.filter(isPositionKey).map((p) => POSITIONS[p].am).join("፣ ");
}
