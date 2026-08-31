import sql from "@/lib/sql";
import {
  BAG_KINDS,
  BAG_SIZES,
  BAG_SIZE_LABEL,
  BAG_STOCK,
  DELIVERY_PRODUCTS,
  FINANCE_RAW_MATERIALS,
  PRODUCT_ORDER,
  PRODUCTION_PRODUCTS,
  bagLabel,
  productLabel,
  RAW_MATERIALS,
  type BagSize,
} from "@/lib/products";
import { upsertOpsDay, opsDateLabel } from "@/lib/ops-report";
import { bagKey, productionTemplate, PROD_PREFIX, STOCK_PREFIX } from "@/lib/production-paste";
import {
  BAG_PREFIX,
  BRAND_PREFIX,
  MATERIAL_PREFIX,
  bagFinanceKey,
  baseBalanceTemplate,
  brandKey,
  materialKey,
  priceListTemplate,
} from "@/lib/finance-paste";
import { monthLabel, nextMonth, priceListItems } from "@/lib/finance-report";
import type { BagPurchaseRead, ToolPhotoCheck } from "@/lib/llm";

/**
 * Guided step-by-step data entry for the reports filed from the bot — the three
 * Asset Management ones and the daily production report.
 *
 * These used to be captured as free text and handed to an LLM to guess the
 * columns, which is why the resulting tables were unreliable. The bot now asks
 * for each column by name, so what lands in the database is what the person
 * actually typed — no inference anywhere in the path.
 *
 * The steps are a data table rather than a chain of if-blocks: the webhook only
 * has to ask `nextStep()` what comes next, which keeps the 2 300-line handler
 * from growing four more state machines. The file keeps its "asset" name because
 * renaming the state, the session column and every call site would be pure
 * churn; read it as "guided flows".
 */

export type AssetFlowKind =
  | "raw_material"
  | "delivery"
  | "tool_request"
  | "pp_bag_damage"
  | "production_daily"
  // Asset management, feeding the monthly finance report.
  | "base_balance"
  | "material_issue"
  // The bags themselves: asset counts what arrived, finance files the receipt.
  | "pp_bag_report"
  // Finance.
  | "tool_purchase"
  | "pp_bag_purchase"
  | "price_list"
  | "wht_holder";

export interface AssetFlowState {
  kind: AssetFlowKind;
  /** Step id currently being answered; "review" once every step is done. */
  step: string;
  draft: Record<string, string | number>;
  /** stored_files id of the damaged-item photo (tool_request/maintenance). */
  photoFileId?: string;
  /** stored_files ids for flows that collect several photos (pp_bag_damage). */
  photoFileIds?: string[];
  /** Gemini's verdict on that photo. */
  check?: ToolPhotoCheck;
  /** What the AI read off a PP bag purchase's paperwork, kept for the audit trail. */
  extraction?: BagExtractionRecord;
}

/**
 * The record of an extraction attempt on a PP bag purchase.
 *
 * `checked: false` means the read did not happen — the model was unreachable, or
 * the photos could not be loaded back. It is never a statement about the
 * paperwork, the same distinction every other AI check in this system draws.
 */
export interface BagExtractionRecord {
  checked: boolean;
  confidence: number;
  notes: string;
  /** Lines the model could not map to one of the six kinds, as printed. */
  unmatched: string[];
  /** Draft keys the model filled — marked on the review card. */
  filled: string[];
  error?: string;
}

/** Max photos a multi-photo step will accept. */
export const MAX_FLOW_PHOTOS = 3;

export type StepValidation = { ok: true; value: string } | { ok: false; error: string };

export interface AssetStep {
  id: string;
  /** Amharic question shown to the user. */
  prompt: string;
  /**
   * "photos" collects several and waits for a done button; "photo" takes one;
   * "paste" sends a fill-in template and reads a whole block back at once.
   */
  type: "date" | "text" | "number" | "choice" | "photo" | "photos" | "paste";
  choices?: { label: string; value: string }[];
  /** Skip the step unless this holds — used for the maintenance/new-item branch. */
  when?: (draft: Record<string, string | number>) => boolean;
  /** Accept "-" / "የለም" as empty instead of demanding a value. */
  skippable?: boolean;
  /**
   * Extra check for a text step, returning the normalised value or a reason to
   * re-ask. Needed where a field is digits but NOT a quantity: `parseQty` strips
   * commas, so a comma-separated FGR pair would be silently fused into one
   * number.
   */
  validate?: (raw: string) => StepValidation;
}

/* ─────────────────────────────── Step tables ──────────────────────────────── */

const RAW_MATERIAL_STEPS: AssetStep[] = [
  { id: "date", prompt: "📅 የገባበትን ቀን ይምረጡ።", type: "date" },
  { id: "supplier", prompt: "🏢 አቅራቢውን (Supplier) ይፃፉ።", type: "text" },
  { id: "dnNo", prompt: "📄 የአቅራቢውን የመላኪያ ደረሰኝ ቁጥር (Sup. Dn. No.) ይፃፉ።", type: "text", skippable: true },
  { id: "truckPlate", prompt: "🚚 የመኪናውን ሰሌዳ ቁጥር (Truck Plate No.) ይፃፉ።", type: "text", skippable: true },
  { id: "mrvNo", prompt: "🔖 የM.R.V ቁጥሩን ይፃፉ።", type: "text", skippable: true },
  ...RAW_MATERIALS.map<AssetStep>((m) => ({
    id: `mat:${m}`,
    prompt: `⚖️ የ<b>${m}</b> ብዛት በቶን ይፃፉ። ከሌለ 0 ይፃፉ።`,
    type: "number",
  })),
];

const DELIVERY_STEPS: AssetStep[] = [
  { id: "date", prompt: "📅 የተላከበትን ቀን ይምረጡ።", type: "date" },
  { id: "customer", prompt: "👤 ለማን እንደተላከ (Deliver to) ይፃፉ።", type: "text" },
  { id: "invoiceCash", prompt: "💵 በጥሬ ገንዘብ የተቆረጠውን ደረሰኝ መጠን በብር ይፃፉ። ከሌለ 0።", type: "number" },
  { id: "invoiceCredit", prompt: "🧾 በብድር (credit) የተቆረጠውን ደረሰኝ መጠን በብር ይፃፉ። ከሌለ 0።", type: "number" },
  { id: "deliveryNo", prompt: "📄 የማድረሻ ቁጥሩን (Deli.) ይፃፉ።", type: "text", skippable: true },
  ...DELIVERY_PRODUCTS.map<AssetStep>((code) => ({
    id: `prod:${code}`,
    prompt: `⚖️ የ<b>${productLabel(code)}</b> ብዛት በቶን ይፃፉ። ከሌለ 0 ይፃፉ።`,
    type: "number",
  })),
];

const TOOL_REQUEST_STEPS: AssetStep[] = [
  { id: "title", prompt: "🔧 የመሣሪያውን ስም እና መግለጫ ይፃፉ።", type: "text" },
  { id: "quantity", prompt: "🔢 ብዛቱን ይፃፉ።", type: "number" },
  {
    id: "kind",
    prompt: "❓ የጥያቄው ዓይነት ይምረጡ።",
    type: "choice",
    choices: [
      { label: "🛠 ጥገና (Maintenance)", value: "maintenance" },
      { label: "🆕 አዲስ ዕቃ (New item)", value: "new_item" },
    ],
  },
  {
    id: "photo",
    prompt: "📷 የተበላሸውን ዕቃ ፎቶ ይላኩ። ፎቶው በAI ይመረመራል።",
    type: "photo",
    when: (d) => d.kind === "maintenance",
  },
  {
    id: "reason",
    prompt: "📝 አዲስ ዕቃ የሚያስፈልግበትን ምክንያት ይፃፉ።",
    type: "text",
    when: (d) => d.kind === "new_item",
  },
];

const PP_BAG_DAMAGE_STEPS: AssetStep[] = [
  { id: "date", prompt: "📅 ብልሽቱ የተከሰተበትን ቀን ይምረጡ።", type: "date" },
  { id: "reason", prompt: "❓ ከረጢቶቹ ለምን እንደተበላሹ ይግለጹ።", type: "text" },
  { id: "quantity", prompt: "🔢 የተበላሹትን ከረጢቶች ብዛት ይፃፉ።", type: "number" },
  {
    id: "photos",
    prompt: `📷 የተበላሹትን ከረጢቶች ፎቶ ይላኩ — እስከ ${MAX_FLOW_PHOTOS} ፎቶ። ከጨረሱ በኋላ "✅ ጨርሻለሁ" ይጫኑ።`,
    type: "photos",
  },
];

/**
 * FGR numbers: one or two four-digit document numbers.
 *
 * Deliberately NOT a `number` step — `parseQty` strips commas, so "1234, 1235"
 * would be recorded as the single number 12341235 with nothing to show anything
 * had gone wrong.
 */
export function validateFgr(raw: string): StepValidation {
  const parts = raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0 || parts.length > 2) {
    return { ok: false, error: "❌ አንድ ወይም ሁለት የFGR ቁጥር ብቻ — ሁለት ከሆኑ በኮማ ይለያዩ (ለምሳሌ 1234, 1235)።" };
  }
  if (!parts.every((p) => /^\d{4}$/.test(p))) {
    return { ok: false, error: "❌ እያንዳንዱ የFGR ቁጥር በ4 አሃዝ መሆን አለበት (ለምሳሌ 1234)።" };
  }
  return { ok: true, value: parts.join(", ") };
}

/**
 * One button, two tables: what was produced today, then what is on hand.
 *
 * The paste step comes second, straight after the date, because answering all of
 * this one question at a time is 28 messages. Whatever the paste leaves blank
 * falls through to the individual questions below it.
 */
const PRODUCTION_STEPS: AssetStep[] = [
  { id: "date", prompt: "📅 የሪፖርቱን ቀን ይምረጡ።", type: "date" },
  {
    id: "fill",
    prompt: "📋 እንዴት ማስገባት ይፈልጋሉ?",
    type: "choice",
    choices: [
      { label: "📋 በአንድ ላይ (ሠንጠረዥ)", value: "paste" },
      { label: "1️⃣ በደረጃ በደረጃ", value: "steps" },
    ],
  },
  {
    id: "paste",
    prompt: "📋 የሚከተለውን ቅጂ ሞልተው ይመልሱት። ያልሞሉት መስመር በጥያቄ ይጠየቃል።",
    type: "paste",
    when: (d) => d.fill === "paste",
  },
  {
    id: "fgrNo",
    prompt: "🔢 የFGR ቁጥር ይፃፉ። ሁለት ከሆኑ በኮማ ይለያዩ (ለምሳሌ 1234, 1235)።",
    type: "text",
    validate: validateFgr,
  },
  ...PRODUCTION_PRODUCTS.map<AssetStep>((code) => ({
    id: `${PROD_PREFIX}${code}`,
    prompt: `🏭 የዛሬ ምርት — የ<b>${productLabel(code)}</b> ብዛት በቶን። ከሌለ 0 ይፃፉ።`,
    type: "number",
  })),
  ...PRODUCTION_PRODUCTS.map<AssetStep>((code) => ({
    id: `${STOCK_PREFIX}${code}`,
    prompt: `📦 ክምችት — የ<b>${productLabel(code)}</b> ቀሪ ብዛት በቶን። ከሌለ 0 ይፃፉ።`,
    type: "number",
  })),
  ...BAG_SIZES.flatMap((size) =>
    BAG_STOCK[size].map<AssetStep>((colour) => ({
      id: bagKey(size, colour),
      prompt: `🧺 ቀሪ — የ<b>${bagLabel(size, colour)}</b> ከረጢት ብዛት (ቁጥር)። ከሌለ 0 ይፃፉ።`,
      type: "number",
    }))
  ),
];


/* ─────────────────────── Monthly base balance (asset mgmt) ────────────────── */

/**
 * The opening balance of the month about to start, counted three days before the
 * current month ends. Fifteen figures, so a paste template is offered first.
 */
const BASE_BALANCE_STEPS: AssetStep[] = [
  {
    id: "fill",
    prompt: "📋 እንዴት ማስገባት ይፈልጋሉ?",
    type: "choice",
    choices: [
      { label: "📋 በአንድ ላይ (ሠንጠረዥ)", value: "paste" },
      { label: "1️⃣ በደረጃ በደረጃ", value: "steps" },
    ],
  },
  {
    id: "paste",
    prompt: "📋 የሚከተለውን ቅጂ ሞልተው ይመልሱት። ያልሞሉት መስመር በጥያቄ ይጠየቃል።",
    type: "paste",
    when: (d) => d.fill === "paste",
  },
  ...PRODUCT_ORDER.map<AssetStep>((code) => ({
    id: brandKey(code),
    prompt: `📦 የመነሻ ሚዛን — የ<b>${productLabel(code)}</b> ብዛት በቶን። ከሌለ 0 ይፃፉ።`,
    type: "number",
  })),
  ...FINANCE_RAW_MATERIALS.map<AssetStep>((m) => ({
    id: materialKey(m),
    prompt: `⛏ የመነሻ ሚዛን — የ<b>${m}</b> ብዛት በቶን። ከሌለ 0 ይፃፉ።`,
    type: "number",
  })),
  ...BAG_SIZES.map<AssetStep>((size) => ({
    id: bagFinanceKey(size),
    prompt: `🧺 የመነሻ ሚዛን — የ<b>${BAG_SIZE_LABEL[size]} PP</b> ከረጢት ብዛት (ቁጥር)። ከሌለ 0 ይፃፉ።`,
    type: "number",
  })),
];

/* ───────────────────── Daily raw-material issue (asset mgmt) ──────────────── */

/** What production consumed today — the Issue column of the monthly report. */
const MATERIAL_ISSUE_STEPS: AssetStep[] = [
  { id: "date", prompt: "📅 የፍጆታውን ቀን ይምረጡ።", type: "date" },
  ...FINANCE_RAW_MATERIALS.map<AssetStep>((m) => ({
    id: materialKey(m),
    prompt: `🔥 ዛሬ ለምርት የዋለው የ<b>${m}</b> ብዛት በቶን። ከሌለ 0 ይፃፉ።`,
    type: "number",
  })),
  ...BAG_SIZES.map<AssetStep>((size) => ({
    id: bagFinanceKey(size),
    prompt: `🧺 ዛሬ የዋለው የ<b>${BAG_SIZE_LABEL[size]} PP</b> ከረጢት ብዛት (ቁጥር)። ከሌለ 0 ይፃፉ።`,
    type: "number",
  })),
];

/* ──────────────────────── Tool purchase report (finance) ──────────────────── */

/** Item slots on one purchase batch. */
export const MAX_PURCHASE_ITEMS = 8;

/** True once item `i` has been reached — item 1 always, the rest on request. */
function purchaseItemAsked(draft: Record<string, string | number>, i: number): boolean {
  if (i === 1) return true;
  return draft[`more${i - 1}`] === "yes";
}

/**
 * A batch of tools bought together.
 *
 * The engine is a flat step table, so a genuinely unbounded item list is not
 * expressible. Fixed slots gated on an "add another?" answer behave the same
 * way: the flow stops at the first "no" and never asks about the next slot.
 *
 * Money is asked ONCE, at the end, for the whole batch. A multi-item batch has a
 * single figure on the receipt, so per-item cost is genuinely unknown — dividing
 * the total out would invent numbers nobody wrote down.
 */
const TOOL_PURCHASE_STEPS: AssetStep[] = [
  { id: "date", prompt: "📅 የግዢውን ቀን ይምረጡ።", type: "date" },
  ...Array.from({ length: MAX_PURCHASE_ITEMS }).flatMap<AssetStep>((_, idx) => {
    const i = idx + 1;
    const steps: AssetStep[] = [
      {
        id: `desc${i}`,
        prompt: `📝 ዕቃ ${i} — ስሙንና ዝርዝሩን (specification) ይፃፉ።`,
        type: "text",
        when: (d) => purchaseItemAsked(d, i),
      },
      {
        id: `uom${i}`,
        prompt: `📏 ዕቃ ${i} — መለኪያውን ይምረጡ።`,
        type: "choice",
        choices: [
          { label: "🔢 pcs", value: "pcs" },
          { label: "📦 pak", value: "pak" },
        ],
        when: (d) => purchaseItemAsked(d, i),
      },
      {
        id: `qty${i}`,
        prompt: `🔢 ዕቃ ${i} — ብዛቱን ይፃፉ።`,
        type: "number",
        when: (d) => purchaseItemAsked(d, i),
      },
    ];
    // No "add another?" after the last slot — there is nowhere left to go.
    if (i < MAX_PURCHASE_ITEMS) {
      steps.push({
        id: `more${i}`,
        prompt: "➕ ሌላ ዕቃ አለ?",
        type: "choice",
        choices: [
          { label: "➕ አዎ፣ ሌላ ዕቃ", value: "yes" },
          { label: "✅ በቃ", value: "no" },
        ],
        when: (d) => purchaseItemAsked(d, i),
      });
    }
    return steps;
  }),
  { id: "supplier", prompt: "🏢 አቅራቢውን (Supplier) ይፃፉ።", type: "text", skippable: true },
  { id: "costCenter", prompt: "🏷 ለየትኛው ክፍል እንደተገዛ (Cost Center) ይፃፉ።", type: "text", skippable: true },
  { id: "purchaser", prompt: "🧑 ገዢውን (Purchaser) ይፃፉ።", type: "text", skippable: true },
  {
    id: "currency",
    prompt: "💱 በየትኛው ገንዘብ ተከፍሏል?",
    type: "choice",
    choices: [
      { label: "🇪🇹 ብር (ETB)", value: "ETB" },
      { label: "💵 ዶላር (USD)", value: "USD" },
    ],
  },
  { id: "totalAmount", prompt: "💰 የጠቅላላውን ግዢ ዋጋ ይፃፉ።", type: "number" },
  {
    id: "photos",
    prompt: `🧾 የደረሰኙን ፎቶ(ዎች) ይላኩ — እስከ ${MAX_FLOW_PHOTOS} ፎቶ። ከጨረሱ በኋላ "✅ ጨርሻለሁ" ይጫኑ።`,
    type: "photos",
  },
];

/* ─────────────────── PP bag purchase report (asset management) ────────────── */

/**
 * What PP bags arrived, counted by the people who took the delivery.
 *
 * The photos come SECOND, before any count is asked for, because the whole point
 * is that the paperwork answers most of the questions. When the reporter presses
 * "done", the webhook reads the images and fills whatever it can; the flow then
 * resumes at the first field the model missed, exactly as a half-filled paste
 * template does.
 *
 * Nothing here depends on the extraction succeeding. If the model is unreachable
 * or the photos are unreadable, every step below is simply asked by hand — a slow
 * provider must never be able to strand someone mid-report.
 */
const PP_BAG_REPORT_STEPS: AssetStep[] = [
  { id: "date", prompt: "📅 ከረጢቱ የገባበትን ቀን ይምረጡ።", type: "date" },
  {
    id: "photos",
    prompt:
      `🧾 የደረሰኙን/የቅጹን ፎቶ(ዎች) ይላኩ — እስከ ${MAX_FLOW_PHOTOS} ፎቶ። ከጨረሱ በኋላ "✅ ጨርሻለሁ" ይጫኑ።\n` +
      `<i>ፎቶዎቹ ተነብበው ብዛቱን በራሱ ይሞላል — እርስዎ አርመው ያረጋግጣሉ።</i>`,
    type: "photos",
  },
  ...BAG_KINDS.map<AssetStep>(({ size, colour }) => ({
    id: bagKey(size, colour),
    prompt: `🧺 የገባው የ<b>${bagLabel(size, colour)}</b> ከረጢት ብዛት (ቁጥር)። ከሌለ 0 ይፃፉ።`,
    type: "number",
  })),
  { id: "supplier", prompt: "🏢 አቅራቢውን (Supplier) ይፃፉ።", type: "text", skippable: true },
  { id: "dnNo", prompt: "📄 የመላኪያ ደረሰኝ/ቅጽ ቁጥር (D.N No.) ይፃፉ።", type: "text", skippable: true },
  {
    id: "currency",
    prompt: "💱 በየትኛው ገንዘብ ተከፍሏል?",
    type: "choice",
    choices: [
      { label: "🇪🇹 ብር (ETB)", value: "ETB" },
      { label: "💵 ዶላር (USD)", value: "USD" },
    ],
  },
  { id: "totalAmount", prompt: "💰 የጠቅላላውን ግዢ ዋጋ ይፃፉ። ካልታወቀ 0 ይፃፉ።", type: "number" },
];

/* ───────────────────────── PP bag purchase (finance) ──────────────────────── */

/**
 * Finance files the receipt, not the count.
 *
 * The quantities come from asset management, who physically take the delivery and
 * report it through `pp_bag_report`. Asking finance for them as well would put two
 * numbers for one delivery into the column the monthly report sums, with nothing
 * to say which of them is the real one.
 */
const PP_BAG_PURCHASE_STEPS: AssetStep[] = [
  { id: "date", prompt: "📅 የግዢውን ቀን ይምረጡ።", type: "date" },
  { id: "supplier", prompt: "🏢 አቅራቢውን (Supplier) ይፃፉ።", type: "text", skippable: true },
  {
    id: "currency",
    prompt: "💱 በየትኛው ገንዘብ ተከፍሏል?",
    type: "choice",
    choices: [
      { label: "🇪🇹 ብር (ETB)", value: "ETB" },
      { label: "💵 ዶላር (USD)", value: "USD" },
    ],
  },
  { id: "totalAmount", prompt: "💰 የጠቅላላውን ግዢ ዋጋ ይፃፉ።", type: "number" },
  {
    id: "photos",
    prompt: `🧾 የደረሰኙን ፎቶ(ዎች) ይላኩ — እስከ ${MAX_FLOW_PHOTOS} ፎቶ። ከጨረሱ በኋላ "✅ ጨርሻለሁ" ይጫኑ።`,
    type: "photos",
  },
];

/* ────────────────────────── Monthly price list (finance) ─────────────────── */

/** Which namespace a price-list item belongs to — brands and raw materials both
 *  contain "Talc", so the key must record which table it is priced on. */
function priceKey(key: string): string {
  if ((BAG_SIZES as readonly string[]).includes(key)) return bagFinanceKey(key as BagSize);
  if ((PRODUCT_ORDER as readonly string[]).includes(key)) return brandKey(key);
  return materialKey(key);
}

const PRICE_LIST_STEPS: AssetStep[] = [
  {
    id: "fill",
    prompt: "📋 እንዴት ማስገባት ይፈልጋሉ?",
    type: "choice",
    choices: [
      { label: "📋 በአንድ ላይ (ሠንጠረዥ)", value: "paste" },
      { label: "1️⃣ በደረጃ በደረጃ", value: "steps" },
    ],
  },
  {
    id: "paste",
    prompt: "📋 የሚከተለውን ቅጂ ሞልተው ይመልሱት። ያልሞሉት መስመር በጥያቄ ይጠየቃል።",
    type: "paste",
    when: (d) => d.fill === "paste",
  },
  ...priceListItems().map<AssetStep>((item) => ({
    id: priceKey(item.key),
    prompt: `💲 የ<b>${item.label}</b> የነጠላ ዋጋ (${item.unit})። ካልታወቀ 0 ይፃፉ።`,
    type: "number",
  })),
  { id: "usdRate", prompt: "💱 የዶላር ምንዛሪ (1 USD ስንት ብር)? ካልታወቀ 0 ይፃፉ።", type: "number" },
];

/* ──────────────────────── WHT receipt holder (finance) ────────────────────── */

/**
 * A phone number the SMS gateway can actually dial.
 *
 * Accepts the two shapes people write in Ethiopia and normalises both to E.164,
 * because a number stored as "0912…" and the same number stored as "+251912…"
 * would otherwise look like two different customers to the chaser.
 */
export function validatePhone(raw: string): StepValidation {
  const cleaned = raw.replace(/[\s\-()]/g, "");
  if (/^0\d{9}$/.test(cleaned)) return { ok: true, value: `+251${cleaned.slice(1)}` };
  if (/^\+251\d{9}$/.test(cleaned)) return { ok: true, value: cleaned };
  if (/^251\d{9}$/.test(cleaned)) return { ok: true, value: `+${cleaned}` };
  return { ok: false, error: "❌ የስልክ ቁጥሩ ትክክል አይደለም። ለምሳሌ 0912345678 ወይም +251912345678።" };
}

const WHT_HOLDER_STEPS: AssetStep[] = [
  { id: "company", prompt: "🏢 የደንበኛውን/ድርጅቱን ስም ይፃፉ።", type: "text" },
  {
    id: "phone",
    prompt: "📞 የስልክ ቁጥሩን ይፃፉ (ለምሳሌ 0912345678 ወይም +251912345678)።",
    type: "text",
    validate: validatePhone,
  },
  {
    id: "description",
    prompt: "📝 የWHT ደረሰኙን መግለጫ ይፃፉ (የደረሰኝ ቁጥር፣ መጠን፣ ወዘተ)።",
    type: "text",
    skippable: true,
  },
];

const STEPS: Record<AssetFlowKind, AssetStep[]> = {
  raw_material: RAW_MATERIAL_STEPS,
  delivery: DELIVERY_STEPS,
  tool_request: TOOL_REQUEST_STEPS,
  pp_bag_damage: PP_BAG_DAMAGE_STEPS,
  production_daily: PRODUCTION_STEPS,
  base_balance: BASE_BALANCE_STEPS,
  material_issue: MATERIAL_ISSUE_STEPS,
  pp_bag_report: PP_BAG_REPORT_STEPS,
  tool_purchase: TOOL_PURCHASE_STEPS,
  pp_bag_purchase: PP_BAG_PURCHASE_STEPS,
  price_list: PRICE_LIST_STEPS,
  wht_holder: WHT_HOLDER_STEPS,
};

export const FLOW_TITLE: Record<AssetFlowKind, string> = {
  raw_material: "🚚 የጥሬ ዕቃ ገቢ ሪፖርት",
  delivery: "🚛 የማድረሻ ሪፖርት",
  tool_request: "🔧 የመሣሪያ ግዢ ጥያቄ",
  pp_bag_damage: "💔 የPP ከረጢት ብልሽት ሪፖርት",
  production_daily: "🏭 የቀኑ የምርት ሪፖርት",
  base_balance: "📊 የወሩ የመነሻ ሚዛን",
  material_issue: "🔥 የቀኑ ጥሬ ዕቃ ፍጆታ",
  pp_bag_report: "🧺 የPP ከረጢት ግዢ ሪፖርት",
  tool_purchase: "🧾 የመሣሪያ ግዢ ሪፖርት",
  pp_bag_purchase: "🛍 የPP ከረጢት ግዢ ደረሰኝ",
  price_list: "💲 የወሩ የዋጋ ዝርዝር",
  wht_holder: "📄 WHT ደረሰኝ ያዢ",
};

/** The template text for a paste step. */
export function pasteTemplate(kind: AssetFlowKind): string {
  if (kind === "production_daily") return productionTemplate();
  if (kind === "base_balance") return baseBalanceTemplate();
  if (kind === "price_list") return priceListTemplate();
  return "";
}

/**
 * The first step still unanswered, or "review".
 *
 * Used after a paste, or after the photos of a bag purchase have been read, to
 * resume at whatever was left blank instead of marching back through questions
 * already answered.
 *
 * Photo steps are skipped because they are not answered in the draft at all —
 * their result lives in `photoFileIds`, so looking for a draft key would send the
 * flow back to the camera it just came from, forever. Choice steps ARE included:
 * an unanswered currency has to be asked, not quietly defaulted to birr because
 * the model failed to read it off the paper.
 */
export function firstUnanswered(kind: AssetFlowKind, draft: Record<string, string | number>): string {
  for (const s of stepsFor(kind, draft)) {
    if (s.type === "paste" || s.type === "photo" || s.type === "photos") continue;
    const v = draft[s.id];
    if (v === undefined || v === "") return s.id;
  }
  return "review";
}

export function stepsFor(kind: AssetFlowKind, draft: Record<string, string | number>): AssetStep[] {
  return STEPS[kind].filter((s) => !s.when || s.when(draft));
}

export function findStep(kind: AssetFlowKind, id: string): AssetStep | undefined {
  return STEPS[kind].find((s) => s.id === id);
}

/** The first step of a flow. */
export function firstStep(kind: AssetFlowKind): string {
  return STEPS[kind][0].id;
}

/**
 * The step after `current`, or "review" when the flow is done.
 *
 * Recomputed from the draft each time rather than stored, so choosing
 * "maintenance" vs "new item" reroutes the remainder of the flow correctly.
 */
export function nextStep(kind: AssetFlowKind, current: string, draft: Record<string, string | number>): string {
  const steps = stepsFor(kind, draft);
  const i = steps.findIndex((s) => s.id === current);
  if (i < 0 || i === steps.length - 1) return "review";
  return steps[i + 1].id;
}

/* ────────────────────────────── Value parsing ─────────────────────────────── */

const SKIP_TOKENS = new Set(["-", "--", "none", "no", "n/a", "የለም", "የለ"]);

export function isSkip(text: string): boolean {
  return SKIP_TOKENS.has(text.trim().toLowerCase());
}

/**
 * Parse a typed quantity. Returns null when it is not a number at all, so the
 * bot can re-ask instead of silently recording 0 — a zero that should have been
 * 40 tonnes is far worse than one more question.
 */
export function parseQty(text: string): number | null {
  const cleaned = text.trim().replace(/,/g, "");
  if (isSkip(cleaned)) return 0;
  if (!/^-?\d*\.?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return isFinite(n) ? n : null;
}

/* ─────────────────────────────── Derived values ───────────────────────────── */

/** Total delivered tonnage — the sum of the product columns, never typed. */
export function deliveryTotal(draft: Record<string, string | number>): number {
  const sum = DELIVERY_PRODUCTS.reduce((a, code) => a + (Number(draft[`prod:${code}`]) || 0), 0);
  return Math.round(sum * 1000) / 1000;
}

/** Total produced today — summed from the columns, never asked for. */
export function productionTotal(draft: Record<string, string | number>): number {
  const sum = PRODUCTION_PRODUCTS.reduce((a, code) => a + (Number(draft[`${PROD_PREFIX}${code}`]) || 0), 0);
  return Math.round(sum * 1000) / 1000;
}

/** The stock count as `daily_ops_reports.bags` stores it: { kg25: {…}, kg40: {…} }. */
function bagMap(draft: Record<string, string | number>): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const size of BAG_SIZES) {
    const inner: Record<string, number> = {};
    for (const colour of BAG_STOCK[size]) {
      const v = Number(draft[bagKey(size as BagSize, colour)]) || 0;
      if (v !== 0) inner[colour] = v;
    }
    if (Object.keys(inner).length > 0) out[size] = inner;
  }
  return out;
}

function jsonMap(draft: Record<string, string | number>, prefix: string, keys: readonly string[]) {
  const out: Record<string, number> = {};
  for (const k of keys) {
    const v = Number(draft[`${prefix}${k}`]) || 0;
    if (v !== 0) out[k] = v;
  }
  return out;
}

/* ─────────────────────── PP bag extraction → draft ────────────────────────── */

/**
 * Merge what the model read off the paperwork into the draft.
 *
 * Only fields the reporter has not already answered are touched, and only values
 * actually present: a colour the model returned nothing for stays unanswered so
 * the flow asks about it, rather than being recorded as a confident zero. That
 * distinction is the safety property here — a bag kind that arrived but was
 * misread has to become a question, never a 0 nobody looked at.
 *
 * Pure, so the merge is testable without a webhook or a provider.
 */
export function applyBagExtraction(
  draft: Record<string, string | number>,
  read: BagPurchaseRead
): { filled: string[] } {
  const filled: string[] = [];
  const put = (key: string, value: string | number) => {
    const existing = draft[key];
    if (existing !== undefined && existing !== "") return;
    draft[key] = value;
    filled.push(key);
  };

  for (const { size, colour } of BAG_KINDS) {
    const n = Number(read.bags?.[size]?.[colour]) || 0;
    if (n > 0) put(bagKey(size, colour), Math.round(n));
  }
  if (read.supplier) put("supplier", read.supplier);
  if (read.dnNo) put("dnNo", read.dnNo);
  if (read.currency) put("currency", read.currency);
  if (read.total > 0) put("totalAmount", read.total);

  return { filled };
}

/* ──────────────────────────────── Previews ────────────────────────────────── */

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const money = (n: number) => Math.round(n).toLocaleString("en-US");
const qty = (n: number) => (Math.round(n * 1000) / 1000).toLocaleString("en-US");

export function assetPreview(state: AssetFlowState): string {
  const d = state.draft;
  const head = `<b>${FLOW_TITLE[state.kind]}</b>\n`;

  if (state.kind === "raw_material") {
    const lines = RAW_MATERIALS.map((m) => `  • ${m}: ${qty(Number(d[`mat:${m}`]) || 0)}`).join("\n");
    const total = RAW_MATERIALS.reduce((a, m) => a + (Number(d[`mat:${m}`]) || 0), 0);
    return (
      head +
      `📅 Date: ${esc(d.date)}\n` +
      `🏢 Supplier: ${esc(d.supplier) || "—"}\n` +
      `📄 Sup.Dn.No.: ${esc(d.dnNo) || "—"}\n` +
      `🚚 Truck Plate: ${esc(d.truckPlate) || "—"}\n` +
      `🔖 M.R.V: ${esc(d.mrvNo) || "—"}\n\n` +
      `⚖️ <b>ብዛት (ቶን)</b>\n${lines}\n` +
      `  ─────────\n  <b>ጠቅላላ: ${qty(total)}</b>\n`
    );
  }

  if (state.kind === "delivery") {
    const lines = DELIVERY_PRODUCTS.filter((c) => Number(d[`prod:${c}`]) > 0)
      .map((c) => `  • ${productLabel(c)}: ${qty(Number(d[`prod:${c}`]))}`)
      .join("\n");
    return (
      head +
      `📅 Date: ${esc(d.date)}\n` +
      `👤 Deliver to: ${esc(d.customer)}\n` +
      `💵 Invoice in cash: ${money(Number(d.invoiceCash) || 0)} ETB\n` +
      `🧾 Invoice in credit: ${money(Number(d.invoiceCredit) || 0)} ETB\n` +
      `📄 Deli.: ${esc(d.deliveryNo) || "—"}\n\n` +
      `⚖️ <b>ብዛት (ቶን)</b>\n${lines || "  —"}\n` +
      `  ─────────\n  <b>Total quantity: ${qty(deliveryTotal(d))}</b>\n`
    );
  }

  if (state.kind === "production_daily") {
    const prod = PRODUCTION_PRODUCTS.map((c) => `  • ${productLabel(c)}: ${qty(Number(d[`${PROD_PREFIX}${c}`]) || 0)}`).join("\n");
    // Stock lists every product even at zero: "we have none left" is a real and
    // important answer, unlike a product simply not produced that day.
    const stock = PRODUCTION_PRODUCTS.map((c) => `  • ${productLabel(c)}: ${qty(Number(d[`${STOCK_PREFIX}${c}`]) || 0)}`).join("\n");
    const bags = BAG_SIZES.flatMap((size) =>
      BAG_STOCK[size].map((colour) => `  • ${bagLabel(size, colour)}: ${qty(Number(d[bagKey(size, colour)]) || 0)}`)
    ).join("\n");
    return (
      head +
      `📅 Date: ${esc(d.date)}\n` +
      `🔢 FGR No: ${esc(d.fgrNo) || "—"}\n\n` +
      `🏭 <b>የቀኑ ምርት (ቶን)</b>\n${prod}\n` +
      `  ─────────\n  <b>Total: ${qty(productionTotal(d))}</b>\n\n` +
      `📦 <b>ክምችት (ቶን)</b>\n${stock}\n\n` +
      `🧺 <b>ቀሪ ከረጢት (ብዛት)</b>\n${bags}\n`
    );
  }

  if (state.kind === "pp_bag_damage") {
    const n = state.photoFileIds?.length || 0;
    return (
      head +
      `📅 Date: ${esc(d.date)}\n` +
      `❓ ምክንያት: ${esc(d.reason)}\n` +
      `🔢 ብዛት: ${qty(Number(d.quantity) || 0)} ከረጢት\n` +
      `📷 ፎቶ: ${n}\n\n` +
      `<i>ፎቶዎቹ ከተቀመጠ በኋላ በAI ይጣራሉ — ውጤቱን እንልክልዎታለን።</i>\n`
    );
  }

  if (state.kind === "base_balance") {
    const brands = PRODUCT_ORDER.map((c) => `${productLabel(c)}: <b>${qty(Number(d[brandKey(c)]) || 0)}</b> ቶን`);
    const mats = FINANCE_RAW_MATERIALS.map((m) => `${m}: <b>${qty(Number(d[materialKey(m)]) || 0)}</b> ቶን`);
    const bags = BAG_SIZES.map((sz) => `${BAG_SIZE_LABEL[sz]} PP: <b>${qty(Number(d[bagFinanceKey(sz)]) || 0)}</b>`);
    return [
      `📊 <b>የ${nextMonthOf(d)} የመነሻ ሚዛን</b>`,
      "",
      "<b>ምርቶች</b>",
      ...brands,
      "",
      "<b>ጥሬ ዕቃ</b>",
      ...mats,
      "",
      "<b>ከረጢት</b>",
      ...bags,
    ].join("\n");
  }

  if (state.kind === "material_issue") {
    const mats = FINANCE_RAW_MATERIALS.map((m) => `${m}: <b>${qty(Number(d[materialKey(m)]) || 0)}</b> ቶን`);
    const bags = BAG_SIZES.map((sz) => `${BAG_SIZE_LABEL[sz]} PP: <b>${qty(Number(d[bagFinanceKey(sz)]) || 0)}</b>`);
    return [`🔥 <b>የቀኑ ጥሬ ዕቃ ፍጆታ</b>`, `📅 ${esc(d.date)}`, "", ...mats, "", ...bags].join("\n");
  }

  if (state.kind === "tool_purchase") {
    const items = purchaseItems(d).map(
      (it, i) => `${i + 1}. ${esc(it.description)} — ${qty(it.quantity)} ${esc(it.uom)}`
    );
    const photos = state.photoFileIds?.length || 0;
    return [
      `🧾 <b>የመሣሪያ ግዢ ሪፖርት</b>`,
      `📅 ${esc(d.date)}`,
      "",
      ...items,
      "",
      `🏢 አቅራቢ: <b>${esc(d.supplier) || "—"}</b>`,
      `🏷 ክፍል: <b>${esc(d.costCenter) || "—"}</b>`,
      `🧑 ገዢ: <b>${esc(d.purchaser) || "—"}</b>`,
      `💰 ጠቅላላ: <b>${money(Number(d.totalAmount) || 0)} ${esc(d.currency)}</b>`,
      `🧾 ደረሰኝ: <b>${photos}</b> ፎቶ`,
      photos > 0 ? "<i>ደረሰኙ ከተመዘገበ በኋላ በAI ይመረመራል።</i>" : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (state.kind === "pp_bag_report") {
    const ex = state.extraction;
    const read = new Set(ex?.filled || []);
    // Values the model supplied carry a marker. Everything on this card is about
    // to be saved, and a figure nobody typed has to be visibly distinguishable
    // from one somebody did — that is the whole reason the card exists.
    const bags = BAG_KINDS.map(
      ({ size, colour }) =>
        `${bagLabel(size, colour)}: <b>${qty(Number(d[bagKey(size, colour)]) || 0)}</b>` +
        (read.has(bagKey(size, colour)) ? " 🤖" : "")
    );
    const total = BAG_KINDS.reduce((a, { size, colour }) => a + (Number(d[bagKey(size, colour)]) || 0), 0);
    const photos = state.photoFileIds?.length || 0;
    const mark = (key: string) => (read.has(key) ? " 🤖" : "");
    return [
      `🧺 <b>የPP ከረጢት ግዢ ሪፖርት</b>`,
      `📅 ${esc(d.date)}`,
      "",
      ...bags,
      `  ─────────`,
      `  <b>ጠቅላላ: ${qty(total)} ከረጢት</b>`,
      "",
      `🏢 አቅራቢ: <b>${esc(d.supplier) || "—"}</b>${mark("supplier")}`,
      `📄 D.N No.: <b>${esc(d.dnNo) || "—"}</b>${mark("dnNo")}`,
      `💰 ጠቅላላ ዋጋ: <b>${money(Number(d.totalAmount) || 0)} ${esc(d.currency) || "ETB"}</b>${mark("totalAmount")}`,
      `🧾 ደረሰኝ: <b>${photos}</b> ፎቶ`,
      ex?.checked ? `<i>🤖 ምልክት ያለው ከፎቶው የተነበበ ነው (እርግጠኝነት ${ex.confidence}%)። ስህተት ካለ ያስተካክሉ።</i>` : "",
      ex && !ex.checked ? "<i>ፎቶውን ማንበብ አልተቻለም — ሁሉንም በእጅ አስገብተዋል።</i>" : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (state.kind === "pp_bag_purchase") {
    const photos = state.photoFileIds?.length || 0;
    return [
      `🛍 <b>የPP ከረጢት ግዢ ደረሰኝ</b>`,
      `📅 ${esc(d.date)}`,
      "",
      `🏢 አቅራቢ: <b>${esc(d.supplier) || "—"}</b>`,
      `💰 ጠቅላላ: <b>${money(Number(d.totalAmount) || 0)} ${esc(d.currency)}</b>`,
      `🧾 ደረሰኝ: <b>${photos}</b> ፎቶ`,
      "",
      `<i>ብዛቱ የሚመዘገበው በንብረት ክፍል (Asset Management) ሪፖርት ነው።</i>`,
    ].join("\n");
  }

  if (state.kind === "price_list") {
    const rows = priceListItems().map(
      (it) => `${it.label}: <b>${money(Number(d[priceKey(it.key)]) || 0)}</b>`
    );
    return [
      `💲 <b>የ${monthLabel()} የዋጋ ዝርዝር</b>`,
      "",
      ...rows,
      "",
      `💱 1 USD = <b>${money(Number(d.usdRate) || 0)}</b> ብር`,
    ].join("\n");
  }

  if (state.kind === "wht_holder") {
    return [
      `📄 <b>WHT ደረሰኝ ያዢ</b>`,
      `🏢 ${esc(d.company)}`,
      `📞 ${esc(d.phone)}`,
      `📝 ${esc(d.description) || "—"}`,
      "",
      "<i>ደረሰኙ እስኪመለስ ድረስ በየቀኑ አንድ SMS ይላካል።</i>",
    ].join("\n");
  }

  const kindLabel = d.kind === "maintenance" ? "🛠 ጥገና" : "🆕 አዲስ ዕቃ";
  let out =
    head +
    `🔧 መሣሪያ: ${esc(d.title)}\n` +
    `🔢 ብዛት: ${qty(Number(d.quantity) || 0)}\n` +
    `❓ ዓይነት: ${kindLabel}\n`;
  if (d.kind === "new_item") out += `📝 ምክንያት: ${esc(d.reason) || "—"}\n`;
  if (d.kind === "maintenance") {
    out += state.photoFileId ? "📷 ፎቶ: ተያይዟል\n" : "📷 ፎቶ: የለም\n";
    const c = state.check;
    if (c) {
      out += c.checked
        ? `🤖 AI: ${c.plausible ? "ከጥያቄው ጋር ይስማማል" : "አጠራጣሪ"} · ${c.confidence}%\n` +
          (c.observations ? `   <i>${esc(c.observations)}</i>\n` : "")
        : "🤖 AI: ማጣራት አልተቻለም — በእጅ ይጣራል\n";
    }
  }
  return out;
}

/** The month a base balance opens — always the one after the month it is filed in. */
function nextMonthOf(_draft: Record<string, string | number>): string {
  return nextMonth(monthLabel());
}

export interface PurchaseItem {
  description: string;
  uom: string;
  quantity: number;
}

/**
 * The filled item slots of a purchase batch, in order.
 *
 * Stops at the first empty description rather than scanning all eight, so a
 * slot left behind by an earlier edit can never be resurrected.
 */
export function purchaseItems(draft: Record<string, string | number>): PurchaseItem[] {
  const out: PurchaseItem[] = [];
  for (let i = 1; i <= MAX_PURCHASE_ITEMS; i++) {
    const description = String(draft[`desc${i}`] || "").trim();
    if (!description) break;
    out.push({
      description,
      uom: String(draft[`uom${i}`] || "pcs"),
      quantity: Number(draft[`qty${i}`]) || 0,
    });
  }
  return out;
}

/* ──────────────────────────────── Persistence ─────────────────────────────── */

/** Turn the calendar's "YYYY-MM-DD" into the UTC midnight the tables store. */
function reportDate(v: unknown): Date {
  const s = String(v ?? "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T00:00:00Z`);
  const d = new Date(s);
  return isNaN(d.getTime()) ? new Date() : d;
}

export async function saveAssetReport(
  state: AssetFlowState,
  reportedBy: string
): Promise<{ id: string; table: string }> {
  const d = state.draft;

  if (state.kind === "raw_material") {
    const [row] = await sql<{ id: string }[]>`
      insert into raw_material_receipts (date, supplier, dn_no, truck_plate, mrv_no, reported_by, materials, source)
      values (${reportDate(d.date)}, ${String(d.supplier || "") || null}, ${String(d.dnNo || "") || null},
              ${String(d.truckPlate || "") || null}, ${String(d.mrvNo || "") || null}, ${reportedBy},
              ${sql.json(jsonMap(d, "mat:", RAW_MATERIALS))}, 'telegram')
      returning id`;
    return { id: row.id, table: "raw_material_receipts" };
  }

  if (state.kind === "delivery") {
    const cash = Number(d.invoiceCash) || 0;
    const credit = Number(d.invoiceCredit) || 0;
    // payment_type is legacy but still read by older views: derive it rather
    // than leaving it null, and mark a mixed invoice as the larger side.
    const paymentType = cash > 0 && credit > 0 ? (cash >= credit ? "cash" : "credit") : cash > 0 ? "cash" : credit > 0 ? "credit" : null;
    const [row] = await sql<{ id: string }[]>`
      insert into delivery_reports (date, customer, invoice_cash, invoice_credit, payment_type,
                                    qty, delivery_no, reported_by, products, source)
      values (${reportDate(d.date)}, ${String(d.customer || "")}, ${cash}, ${credit}, ${paymentType},
              ${deliveryTotal(d)}, ${String(d.deliveryNo || "") || null}, ${reportedBy},
              ${sql.json(jsonMap(d, "prod:", DELIVERY_PRODUCTS))}, 'telegram')
      returning id`;
    return { id: row.id, table: "delivery_reports" };
  }

  if (state.kind === "production_daily") {
    const date = reportDate(d.date);
    const [row] = await sql<{ id: string }[]>`
      insert into production_reports (date, fgr_no, reported_by, products, source)
      values (${date}, ${String(d.fgrNo || "") || null}, ${reportedBy},
              ${sql.json(jsonMap(d, PROD_PREFIX, PRODUCTION_PRODUCTS))}, 'telegram')
      returning id`;

    // The stock half belongs to the day's ops row, which is where the pasted
    // ops report has always written it. One number per day per column, whoever
    // entered it — a second table would let the two disagree with nothing to
    // reconcile them.
    const stock = jsonMap(d, STOCK_PREFIX, PRODUCTION_PRODUCTS);
    const bags = bagMap(d);
    if (Object.keys(stock).length > 0 || Object.keys(bags).length > 0) {
      await upsertOpsDay({
        dateLabel: opsDateLabel(date),
        date,
        reportedBy,
        stock,
        bags,
        rawText: `የቀኑ የምርት ሪፖርት · FGR ${String(d.fgrNo || "—")}`,
      });
    }
    return { id: row.id, table: "production_reports" };
  }

  if (state.kind === "pp_bag_damage") {
    // Saved without a verdict: the AI chain runs after this returns, so the user
    // is never left waiting on three providers inside the webhook.
    const [row] = await sql<{ id: string }[]>`
      insert into pp_bag_damage_reports (date, reason, quantity, reported_by, source)
      values (${reportDate(d.date)}, ${String(d.reason || "")}, ${Math.round(Number(d.quantity) || 0)},
              ${reportedBy}, 'telegram')
      returning id`;
    return { id: row.id, table: "pp_bag_damage_reports" };
  }

  if (state.kind === "base_balance") {
    const month = nextMonthOf(d);
    // Upserted on the month: a correction re-counts the same opening balance
    // rather than creating a second one nothing can choose between.
    const [row] = await sql<{ id: string }[]>`
      insert into monthly_base_balances (month, products, raw_materials, bags, reported_by, source)
      values (${month},
              ${sql.json(jsonMap(d, BRAND_PREFIX, PRODUCT_ORDER))},
              ${sql.json(jsonMap(d, MATERIAL_PREFIX, FINANCE_RAW_MATERIALS))},
              ${sql.json(jsonMap(d, BAG_PREFIX, BAG_SIZES))},
              ${reportedBy}, 'telegram')
      on conflict (month) do update set
        products = excluded.products,
        raw_materials = excluded.raw_materials,
        bags = excluded.bags,
        reported_by = excluded.reported_by,
        updated_at = now()
      returning id`;
    return { id: row.id, table: "monthly_base_balances" };
  }

  if (state.kind === "material_issue") {
    const date = reportDate(d.date);
    // One row per day, like daily_ops_reports: two people reporting the same
    // day must not produce two consumption figures nothing can reconcile.
    const [row] = await sql<{ id: string }[]>`
      insert into material_issues (date_label, date, materials, bags, reported_by, source)
      values (${opsDateLabel(date)}, ${date},
              ${sql.json(jsonMap(d, MATERIAL_PREFIX, FINANCE_RAW_MATERIALS))},
              ${sql.json(jsonMap(d, BAG_PREFIX, BAG_SIZES))},
              ${reportedBy}, 'telegram')
      on conflict (date_label) do update set
        materials = excluded.materials,
        bags = excluded.bags,
        reported_by = excluded.reported_by,
        updated_at = now()
      returning id`;
    return { id: row.id, table: "material_issues" };
  }

  if (state.kind === "tool_purchase") {
    const items = purchaseItems(d);
    const [batch] = await sql<{ id: string }[]>`
      insert into finance_purchase_batches
        (sr_no, date, supplier, cost_center, purchaser, currency, total_amount,
         reported_by, photo_file_ids, source)
      values (nextval('finance_purchase_sr_seq'), ${reportDate(d.date)},
              ${String(d.supplier || "") || null}, ${String(d.costCenter || "") || null},
              ${String(d.purchaser || "") || reportedBy},
              ${d.currency === "USD" ? "USD" : "ETB"},
              ${Number(d.totalAmount) || null}, ${reportedBy},
              ${state.photoFileIds || []}, 'telegram')
      returning id`;

    if (items.length > 0) {
      await sql`
        insert into finance_purchase_items ${sql(
          items.map((it, i) => ({
            batch_id: batch.id,
            position: i,
            description: it.description,
            uom: it.uom,
            quantity: it.quantity,
          }))
        )}`;
    }
    return { id: batch.id, table: "finance_purchase_batches" };
  }

  if (state.kind === "pp_bag_report") {
    // The asset copy: the counts, by size and colour, in the same nested shape
    // daily_ops_reports.bags uses. This is the row the monthly finance report
    // reads for its bag "Received" line.
    const [row] = await sql<{ id: string }[]>`
      insert into pp_bag_purchases (date, bags, supplier, dn_no, currency, total_amount,
                                    reported_by, photo_file_ids, extraction, filed_by_dept, source)
      values (${reportDate(d.date)}, ${sql.json(bagMap(d))},
              ${String(d.supplier || "") || null}, ${String(d.dnNo || "") || null},
              ${d.currency === "USD" ? "USD" : "ETB"},
              ${Number(d.totalAmount) || null}, ${reportedBy},
              ${state.photoFileIds || []},
              ${state.extraction ? sql.json({ ...state.extraction }) : null},
              'asset', 'telegram')
      returning id`;
    return { id: row.id, table: "pp_bag_purchases" };
  }

  if (state.kind === "pp_bag_purchase") {
    // The finance copy: the receipt and the money, no counts. An empty bags map
    // contributes nothing to the month's received quantity, so the same delivery
    // filed by both departments cannot double it.
    const [row] = await sql<{ id: string }[]>`
      insert into pp_bag_purchases (date, bags, supplier, currency, total_amount,
                                    reported_by, photo_file_ids, filed_by_dept, source)
      values (${reportDate(d.date)}, ${sql.json({})},
              ${String(d.supplier || "") || null},
              ${d.currency === "USD" ? "USD" : "ETB"},
              ${Number(d.totalAmount) || null}, ${reportedBy},
              ${state.photoFileIds || []}, 'finance', 'telegram')
      returning id`;
    return { id: row.id, table: "pp_bag_purchases" };
  }

  if (state.kind === "price_list") {
    const month = monthLabel();
    // One price map, keyed the way the report reads it. Brands and raw materials
    // are merged here because "Talc" is unambiguous once the flow has already
    // recorded which table each answer came from.
    const prices: Record<string, number> = {
      ...jsonMap(d, BRAND_PREFIX, PRODUCT_ORDER),
      ...jsonMap(d, MATERIAL_PREFIX, FINANCE_RAW_MATERIALS),
      ...jsonMap(d, BAG_PREFIX, BAG_SIZES),
    };
    const [row] = await sql<{ id: string }[]>`
      insert into monthly_price_lists (month, prices, usd_rate, reported_by, source)
      values (${month}, ${sql.json(prices)}, ${Number(d.usdRate) || null}, ${reportedBy}, 'telegram')
      on conflict (month) do update set
        prices = excluded.prices,
        usd_rate = excluded.usd_rate,
        reported_by = excluded.reported_by,
        updated_at = now()
      returning id`;
    return { id: row.id, table: "monthly_price_lists" };
  }

  if (state.kind === "wht_holder") {
    const [row] = await sql<{ id: string }[]>`
      insert into wht_holders (company, phone, description, registered_by, source)
      values (${String(d.company || "")}, ${String(d.phone || "")},
              ${String(d.description || "") || null}, ${reportedBy}, 'telegram')
      returning id`;
    return { id: row.id, table: "wht_holders" };
  }

  const [row] = await sql<{ id: string }[]>`
    insert into purchase_requests (title, quantity, kind, justification, photo_file_id,
                                   requested_by, source, status, legitimacy)
    values (${String(d.title || "")}, ${Number(d.quantity) || null}, ${String(d.kind || "")},
            ${String(d.reason || "") || null}, ${state.photoFileId || null},
            ${reportedBy}, 'telegram', 'pending',
            ${state.check ? sql.json({ ...state.check }) : null})
    returning id`;
  return { id: row.id, table: "purchase_requests" };
}
