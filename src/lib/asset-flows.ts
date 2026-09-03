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
  ledgerChoices,
  ledgerLabel,
  looksLikeStockItem,
  parseBagLedgerKey,
  productLabel,
  RAW_MATERIALS,
  type BagSize,
  type LedgerKind,
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
import type { ToolPhotoCheck, VoucherRead } from "@/lib/llm";

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
  // The two paper vouchers. They replaced four buttons that each captured a
  // slice of the same events; the retired tables stay readable in Settings.
  | "store_issue"
  | "grv"
  // Finance.
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
  /** What the AI read off a voucher's photos, kept for the audit trail. */
  extraction?: VoucherExtractionRecord;
}

/**
 * The record of an extraction attempt on a voucher.
 *
 * `checked: false` means the read did not happen — the model was unreachable, or
 * the photos could not be loaded back. It is never a statement about the
 * paperwork, the same distinction every other AI check in this system draws.
 */
export interface VoucherExtractionRecord {
  checked: boolean;
  confidence: number;
  notes: string;
  /** Rows the model could not read cleanly, as printed. */
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
   * A photos step that must collect at least one photo before moving on.
   *
   * Only the GRV sets it: the whole stock cross-check rests on there being paper
   * behind a figure, so a purchase with no receipt is not a purchase we can act
   * on. Every other photo step stays optional.
   */
  required?: boolean;
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

/* ═══════════════════════════ The two paper vouchers ════════════════════════
 *
 * MinTech documents goods on two pre-printed pads, and these two flows are those
 * pads. They replaced four bot buttons that each captured a slice of the same
 * events — a tool purchase report, a PP bag receipt, a PP bag count and a daily
 * raw-material issue — none of which matched the paper anyone was actually
 * filling in.
 *
 * Their tables and rows are untouched and still readable under
 * Settings → Submissions; only the buttons are gone.
 */

/** Line-item slots on one voucher. The printed pad has six rows. */
export const MAX_VOUCHER_ITEMS = 8;

/** True once item `i` has been reached — item 1 always, the rest on request. */
function voucherItemAsked(draft: Record<string, string | number>, i: number): boolean {
  if (i === 1) return true;
  return draft[`more${i - 1}`] === "yes";
}

/* ── Draft keys for one line ──────────────────────────────────────────────── */
export const itemKeys = (i: number) => ({
  stockCode: `stock${i}`,
  description: `desc${i}`,
  unit: `unit${i}`,
  quantity: `qty${i}`,
  unitCost: `cost${i}`,
  /** Which stock item this line is, confirmed by a person. */
  ledger: `class${i}`,
  /** The canonical quantity for that stock item — pieces or tonnes. */
  ledgerQty: `lqty${i}`,
  more: `more${i}`,
});

/** The "not a stock item" answer. A real value, so the question stays answered. */
export const LEDGER_NONE = "none";

/**
 * Should the bot ask what stock item this line is?
 *
 * Two triggers: the description reads like one, or the extractor suggested one.
 * Both are hints, never conclusions — the question is the only thing that sets
 * the ledger key, and answering "not tracked" is a first-class outcome.
 *
 * A false positive costs one extra question. A false negative just means the
 * line is not counted, which is the safe direction to fail in.
 */
export function suggestsStockItem(draft: Record<string, string | number>, i: number): boolean {
  if (!voucherItemAsked(draft, i)) return false;
  const k = itemKeys(i);
  if (String(draft[`${k.ledger}_hint`] || "")) return true;
  return looksLikeStockItem(String(draft[k.description] || ""));
}

/** The choice list for a classification step, plus the opt-out. */
function ledgerStepChoices(kinds: readonly LedgerKind[]) {
  return [
    ...ledgerChoices(kinds).map((c) => ({
      label: c.kind === "bag" ? `🧺 ${c.label}` : `⛏ ${c.label}`,
      value: c.key,
    })),
    { label: "➖ የክምችት ዕቃ አይደለም", value: LEDGER_NONE },
  ];
}

/** The unit a confirmed ledger key is counted in. */
export function ledgerUnitOf(key: string): "pcs" | "t" | null {
  if (!key || key === LEDGER_NONE) return null;
  if (parseBagLedgerKey(key)) return "pcs";
  if ((FINANCE_RAW_MATERIALS as readonly string[]).includes(key)) return "t";
  return null;
}

/**
 * The repeating line block, shared by both vouchers.
 *
 * `ledgerQty` is asked separately from `quantity` and never derived from it: a
 * line of "100 pak" is not 100 pieces, and inferring a pack size the system was
 * never told is how a bag count silently triples. The prompt shows what was
 * typed so the common case is one keystroke.
 */
function voucherItemSteps(opts: { kinds: readonly LedgerKind[]; costSkippable: boolean }): AssetStep[] {
  return Array.from({ length: MAX_VOUCHER_ITEMS }).flatMap<AssetStep>((_, idx) => {
    const i = idx + 1;
    const k = itemKeys(i);
    const asked = (d: Record<string, string | number>) => voucherItemAsked(d, i);

    const steps: AssetStep[] = [
      {
        id: k.description,
        prompt: `📝 ዕቃ ${i} — ስሙንና ዝርዝሩን (Description/Specification) ይፃፉ።`,
        type: "text",
        when: asked,
      },
      {
        id: k.stockCode,
        prompt: `🔖 ዕቃ ${i} — የStock Code ቁጥር ይፃፉ።`,
        type: "text",
        skippable: true,
        when: asked,
      },
      {
        id: k.unit,
        prompt: `📏 ዕቃ ${i} — መለኪያውን (Unit) ይፃፉ — ለምሳሌ pcs, pak, kg።`,
        type: "text",
        skippable: true,
        when: asked,
      },
      {
        id: k.quantity,
        prompt: `🔢 ዕቃ ${i} — ብዛቱን (Qty) ይፃፉ።`,
        type: "number",
        when: asked,
      },
      {
        id: k.unitCost,
        prompt: `💲 ዕቃ ${i} — የነጠላ ዋጋ (Unit Cost)። ${opts.costSkippable ? 'ካልታወቀ "-" ይላኩ።' : "ካልታወቀ 0 ይፃፉ።"}`,
        type: "number",
        skippable: opts.costSkippable,
        when: asked,
      },
      {
        id: k.ledger,
        prompt:
          `📦 ዕቃ ${i} — ይህ ከየትኛው የክምችት ዕቃ ነው?\n` +
          `<i>የክምችት ሒሳብ የሚያዘው በዚህ መልስ ብቻ ነው።</i>`,
        type: "choice",
        choices: ledgerStepChoices(opts.kinds),
        when: (d) => suggestsStockItem(d, i),
      },
      {
        id: k.ledgerQty,
        prompt: `🔢 ዕቃ ${i} — በክምችት አሃድ ስንት ነው? <i>(የተፃፈው Qty ተመሳሳይ ከሆነ እሱኑ ይፃፉ)</i>`,
        type: "number",
        when: (d) => {
          const key = String(d[itemKeys(i).ledger] || "");
          return Boolean(key) && key !== LEDGER_NONE;
        },
      },
    ];

    // No "add another?" after the last slot — there is nowhere left to go.
    if (i < MAX_VOUCHER_ITEMS) {
      steps.push({
        id: k.more,
        prompt: "➕ ሌላ ዕቃ አለ?",
        type: "choice",
        choices: [
          { label: "➕ አዎ፣ ሌላ ዕቃ", value: "yes" },
          { label: "✅ በቃ", value: "no" },
        ],
        when: asked,
      });
    }
    return steps;
  });
}

/* ── Goods Receiving Voucher (finance) ────────────────────────────────────── */

/**
 * Everything bought and received, PP bags included.
 *
 * The photos come SECOND, before any field is asked for, because the voucher
 * answers most of the questions itself. When the reporter presses "done" the
 * webhook reads the images and fills what it can; the flow then resumes at the
 * first field the model missed, exactly as a half-filled paste template does.
 *
 * Nothing below depends on the extraction succeeding — if the model is
 * unreachable, every step is simply asked by hand.
 *
 * Only bag kinds are offered for classification. Raw material arrives by truck
 * against a delivery note and is already recorded by the raw-material intake
 * form; letting a GRV line count as Dolomite received too would double the
 * month's tonnage with nothing to say which entry was the real one.
 */
const GRV_STEPS: AssetStep[] = [
  { id: "date", prompt: "📅 ዕቃው የገባበትን ቀን ይምረጡ።", type: "date" },
  {
    id: "photos",
    prompt:
      `🧾 የGoods Receiving Voucher እና የደረሰኙን ፎቶ ይላኩ — እስከ ${MAX_FLOW_PHOTOS} ፎቶ። ` +
      `ከጨረሱ በኋላ "✅ ጨርሻለሁ" ይጫኑ።\n` +
      `<i>ፎቶዎቹ ተነብበው ቅጹን በራሱ ይሞላል — እርስዎ አርመው ያረጋግጣሉ።</i>`,
    type: "photos",
    // The user asked for a receipt for confirmation, so this one cannot be
    // skipped: the whole cross-check rests on there being paper behind a figure.
    required: true,
  },
  { id: "grvNo", prompt: "🔢 የቫውቸሩን ቁጥር (No.) ይፃፉ — ለምሳሌ 5516።", type: "text", skippable: true },
  { id: "supplier", prompt: "🏢 አቅራቢውን (Supplier) ይፃፉ።", type: "text", skippable: true },
  {
    id: "supplierInvoiceNo",
    prompt: "📄 የአቅራቢውን የደረሰኝ ቁጥር (Supplier's Invoice No.) ይፃፉ።",
    type: "text",
    skippable: true,
  },
  { id: "purchaseOrderNo", prompt: "📋 የPurchase Order ቁጥር ይፃፉ።", type: "text", skippable: true },
  {
    id: "receivingStoreNo",
    prompt: "🏬 የReceiving Store ቁጥር ይፃፉ።",
    type: "text",
    skippable: true,
  },
  ...voucherItemSteps({ kinds: ["bag"], costSkippable: false }),
  {
    id: "currency",
    prompt: "💱 በየትኛው ገንዘብ ተከፍሏል?",
    type: "choice",
    choices: [
      { label: "🇪🇹 ብር (ETB)", value: "ETB" },
      { label: "💵 ዶላር (USD)", value: "USD" },
    ],
  },
  { id: "totalAmount", prompt: "💰 የጠቅላላውን ዋጋ (Total amount) ይፃፉ።", type: "number" },
  { id: "remarks", prompt: "📝 አስተያየት (Remarks) ካለ ይፃፉ።", type: "text", skippable: true },
  { id: "preparedBy", prompt: "🧑 ያዘጋጀው (Prepared by) ማን ነው?", type: "text", skippable: true },
  { id: "receivedBy", prompt: "🧑 የተረከበው (Received by) ማን ነው?", type: "text", skippable: true },
  { id: "approvedBy", prompt: "🧑 ያፀደቀው (Approved by) ማን ነው?", type: "text", skippable: true },
];

/* ── Store Issue Voucher (asset management) ───────────────────────────────── */

/**
 * Everything taken out of the warehouse.
 *
 * Both bag kinds and raw materials are offered, because this replaced the daily
 * raw-material issue and has to keep filling the Issue column of the monthly
 * report.
 *
 * The photo step is optional here, unlike the GRV: the voucher is often filled
 * at a bench with no camera to hand, and the user asked for "image or one-by-one
 * input". Unit costs are optional for the same reason — the store issues goods,
 * finance prices them, and the monthly report values issues from its own price
 * list regardless.
 */
const STORE_ISSUE_STEPS: AssetStep[] = [
  { id: "date", prompt: "📅 ዕቃው የወጣበትን ቀን ይምረጡ።", type: "date" },
  {
    id: "photos",
    prompt:
      `📷 የStore Issue Voucher ፎቶ ይላኩ — እስከ ${MAX_FLOW_PHOTOS} ፎቶ። ከጨረሱ በኋላ "✅ ጨርሻለሁ" ይጫኑ።\n` +
      `<i>ፎቶ ከሌለ "✅ ጨርሻለሁ" ብለው በደረጃ በደረጃ ማስገባት ይችላሉ።</i>`,
    type: "photos",
  },
  { id: "sivNo", prompt: "🔢 የቫውቸሩን ቁጥር (No.) ይፃፉ — ለምሳሌ 8610።", type: "text", skippable: true },
  { id: "issuingStore", prompt: "🏬 የሚያወጣው መጋዘን (Issuing Store) የትኛው ነው?", type: "text", skippable: true },
  { id: "issuedTo", prompt: "🧑 ለማን ተሰጠ (Issued To)?", type: "text" },
  {
    id: "departmentSection",
    prompt: "🏷 ለየትኛው ክፍል (Department/Section) ነው?",
    type: "text",
    skippable: true,
  },
  {
    id: "requisitionNo",
    prompt: "📋 የStore Requisition Note ቁጥር ይፃፉ።",
    type: "text",
    skippable: true,
  },
  ...voucherItemSteps({ kinds: ["bag", "material"], costSkippable: true }),
  { id: "remarks", prompt: "📝 አስተያየት (Remarks) ካለ ይፃፉ።", type: "text", skippable: true },
  { id: "issuedBy", prompt: "🧑 ያወጣው (Issued by) ማን ነው?", type: "text", skippable: true },
  { id: "approvedBy", prompt: "🧑 ያፀደቀው (Approved by) ማን ነው?", type: "text", skippable: true },
  { id: "receivedBy", prompt: "🧑 የተረከበው (Received by) ማን ነው?", type: "text", skippable: true },
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
  store_issue: STORE_ISSUE_STEPS,
  grv: GRV_STEPS,
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
  store_issue: "📤 የመጋዘን ወጪ ቫውቸር (SIV)",
  grv: "📥 የዕቃ ገቢ ቫውቸር (GRV)",
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

/* ────────────────────── Voucher extraction → draft ────────────────────────── */

/**
 * Merge what the model read off a voucher into the draft.
 *
 * Only fields the reporter has not already answered are touched, and only values
 * actually present: a cell the model returned nothing for stays unanswered so
 * the flow asks about it, rather than being recorded as a confident zero. That
 * distinction is the safety property here — a quantity that was on the paper but
 * misread has to become a question, never a 0 nobody looked at.
 *
 * The ledger suggestion is written to a `_hint` key, NOT to the answer. It only
 * makes the bot ask "which stock item is this?"; the person's reply is the only
 * thing that ever sets a ledger key. A suggestion saved as an answer would put a
 * bag quantity into the month's stock on the model's say-so alone.
 *
 * Pure, so the merge is testable without a webhook or a provider.
 */
export function applyVoucherExtraction(
  draft: Record<string, string | number>,
  read: VoucherRead
): { filled: string[] } {
  const filled: string[] = [];
  const put = (key: string, value: string | number) => {
    const existing = draft[key];
    if (existing !== undefined && existing !== "") return;
    draft[key] = value;
    filled.push(key);
  };

  if (read.voucherNo) {
    put("grvNo", read.voucherNo);
    put("sivNo", read.voucherNo);
  }
  if (read.supplier) put("supplier", read.supplier);
  if (read.supplierInvoiceNo) put("supplierInvoiceNo", read.supplierInvoiceNo);
  if (read.purchaseOrderNo) put("purchaseOrderNo", read.purchaseOrderNo);
  if (read.issuingStore) put("issuingStore", read.issuingStore);
  if (read.issuedTo) put("issuedTo", read.issuedTo);
  if (read.departmentSection) put("departmentSection", read.departmentSection);
  if (read.requisitionNo) put("requisitionNo", read.requisitionNo);
  if (read.remarks) put("remarks", read.remarks);
  if (read.currency) put("currency", read.currency);
  if (read.total > 0) put("totalAmount", read.total);

  read.items.slice(0, MAX_VOUCHER_ITEMS).forEach((item, idx) => {
    const i = idx + 1;
    const k = itemKeys(i);
    if (item.description) put(k.description, item.description);
    if (item.stockCode) put(k.stockCode, item.stockCode);
    if (item.unit) put(k.unit, item.unit);
    if (item.quantity > 0) put(k.quantity, item.quantity);
    if (item.unitCost > 0) put(k.unitCost, item.unitCost);
    // A hint, never an answer — see the note above.
    if (item.ledgerKey) put(`${k.ledger}_hint`, item.ledgerKey);
    // The repeating block is gated on "add another?", so a voucher the model
    // read four lines from has to answer that question for the first three or
    // the flow stops after line one and silently drops the rest.
    if (i < MAX_VOUCHER_ITEMS) put(k.more, idx + 1 < Math.min(read.items.length, MAX_VOUCHER_ITEMS) ? "yes" : "no");
  });

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

  if (state.kind === "grv" || state.kind === "store_issue") {
    const isGrv = state.kind === "grv";
    const ex = state.extraction;
    const read = new Set(ex?.filled || []);
    // Values the model supplied carry a marker. Everything on this card is about
    // to be saved, and a figure nobody typed has to be visibly distinguishable
    // from one somebody did — that is the whole reason the card exists.
    const mark = (key: string) => (read.has(key) ? " 🤖" : "");

    const items = voucherItems(d).map((it, i) => {
      const cost = it.unitCost ? ` × ${money(it.unitCost)}` : "";
      const ledger = it.ledgerKey
        ? `
     └ 📦 ${ledgerLabel(it.ledgerKind, it.ledgerKey)}: <b>${qty(it.ledgerQty)}</b> ${
            it.ledgerKind === "bag" ? "ከረጢት" : "ቶን"
          }`
        : "";
      return (
        `${i + 1}. ${esc(it.description)} — ${qty(it.quantity)} ${esc(it.unit) || "—"}${cost}` +
        mark(itemKeys(i + 1).description) +
        ledger
      );
    });

    const photos = state.photoFileIds?.length || 0;
    const head = isGrv
      ? [
          `📥 <b>የዕቃ ገቢ ቫውቸር (GRV)</b>`,
          `🔢 No.: <b>${esc(d.grvNo) || "—"}</b>${mark("grvNo")}`,
          `📅 ${esc(d.date)}`,
          `🏢 አቅራቢ: <b>${esc(d.supplier) || "—"}</b>${mark("supplier")}`,
          `📄 Invoice No.: <b>${esc(d.supplierInvoiceNo) || "—"}</b>${mark("supplierInvoiceNo")}`,
        ]
      : [
          `📤 <b>የመጋዘን ወጪ ቫውቸር (SIV)</b>`,
          `🔢 No.: <b>${esc(d.sivNo) || "—"}</b>${mark("sivNo")}`,
          `📅 ${esc(d.date)}`,
          `🏬 መጋዘን: <b>${esc(d.issuingStore) || "—"}</b>${mark("issuingStore")}`,
          `🧑 ለ: <b>${esc(d.issuedTo) || "—"}</b>${mark("issuedTo")}`,
          `🏷 ክፍል: <b>${esc(d.departmentSection) || "—"}</b>${mark("departmentSection")}`,
        ];

    const tail = isGrv
      ? [
          `💰 ጠቅላላ: <b>${money(Number(d.totalAmount) || 0)} ${esc(d.currency) || "ETB"}</b>${mark("totalAmount")}`,
          `🧾 ፎቶ: <b>${photos}</b>`,
          photos > 0 ? "<i>ደረሰኙ ከተመዘገበ በኋላ በAI ይመረመራል።</i>" : "",
        ]
      : [`📷 ፎቶ: <b>${photos}</b>`];

    // Lines with no confirmed stock item are named, not hidden. A voucher whose
    // bags were never classified simply does not move the stock balance, and the
    // reporter is the only person who can still fix that — after saving, nobody
    // is looking.
    const unclassified = voucherItems(d).filter((it) => !it.ledgerKey).length;

    return [
      ...head,
      "",
      ...(items.length > 0 ? items : ["  —"]),
      "",
      ...tail,
      unclassified > 0
        ? `<i>ℹ️ ${unclassified} ዕቃ በክምችት ሒሳብ ውስጥ አልገባም (የክምችት ዕቃ አይደለም ተብሏል)።</i>`
        : "",
      ex?.checked ? `<i>🤖 ምልክት ያለው ከፎቶው የተነበበ ነው (እርግጠኝነት ${ex.confidence}%)። ስህተት ካለ ያስተካክሉ።</i>` : "",
      ex && !ex.checked ? "<i>ፎቶውን ማንበብ አልተቻለም — ሁሉንም በእጅ አስገብተዋል።</i>" : "",
    ]
      .filter(Boolean)
      .join("\n");
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

export interface VoucherItem {
  stockCode: string | null;
  description: string;
  unit: string | null;
  quantity: number;
  unitCost: number | null;
  totalAmount: number | null;
  /** Null unless a person confirmed which stock item this line is. */
  ledgerKind: LedgerKind | null;
  ledgerKey: string | null;
  ledgerQty: number;
}

/**
 * The filled item slots of a voucher, in order.
 *
 * Stops at the first empty description rather than scanning all eight, so a slot
 * left behind by an earlier edit can never be resurrected.
 *
 * The ledger fields are populated ONLY from the confirmation answer. A line the
 * extractor suggested but nobody confirmed comes back with them null and moves
 * no balance — which is the whole point of asking.
 */
export function voucherItems(draft: Record<string, string | number>): VoucherItem[] {
  const out: VoucherItem[] = [];
  for (let i = 1; i <= MAX_VOUCHER_ITEMS; i++) {
    const k = itemKeys(i);
    const description = String(draft[k.description] || "").trim();
    if (!description) break;

    const answered = String(draft[k.ledger] || "");
    const confirmed = answered && answered !== LEDGER_NONE ? answered : null;
    const unit = ledgerUnitOf(confirmed || "");
    const quantity = Number(draft[k.quantity]) || 0;
    const unitCost = Number(draft[k.unitCost]) || 0;

    out.push({
      stockCode: String(draft[k.stockCode] || "").trim() || null,
      description,
      unit: String(draft[k.unit] || "").trim() || null,
      quantity,
      unitCost: unitCost > 0 ? unitCost : null,
      // Derived, never asked: the line total is unit cost × quantity by
      // definition, and asking for it invites a third figure that disagrees
      // with the two it is made of.
      totalAmount: unitCost > 0 ? Math.round(unitCost * quantity * 100) / 100 : null,
      ledgerKind: confirmed ? (unit === "pcs" ? "bag" : "material") : null,
      ledgerKey: confirmed,
      ledgerQty: confirmed ? Number(draft[k.ledgerQty]) || 0 : 0,
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

  if (state.kind === "grv" || state.kind === "store_issue") {
    const isGrv = state.kind === "grv";
    const items = voucherItems(d);
    const extraction = state.extraction ? sql.json({ ...state.extraction }) : null;
    const photos = state.photoFileIds || [];
    const date = reportDate(d.date);
    // A blank voucher number must be stored as NULL, not "". The unique index is
    // partial on `not null`, so an empty string would make the SECOND unnumbered
    // voucher collide with the first and be refused as a duplicate.
    const voucherNo = String((isGrv ? d.grvNo : d.sivNo) || "").trim() || null;

    const [header] = isGrv
      ? await sql<{ id: string }[]>`
          insert into goods_receiving_vouchers
            (grv_no, date, supplier, supplier_invoice_no, purchase_order_no, receiving_store_no,
             currency, total_amount, remarks, prepared_by, received_by, approved_by,
             reported_by, photo_file_ids, extraction, source)
          values (${voucherNo}, ${date}, ${String(d.supplier || "") || null},
                  ${String(d.supplierInvoiceNo || "") || null},
                  ${String(d.purchaseOrderNo || "") || null},
                  ${String(d.receivingStoreNo || "") || null},
                  ${d.currency === "USD" ? "USD" : "ETB"},
                  ${Number(d.totalAmount) || null}, ${String(d.remarks || "") || null},
                  ${String(d.preparedBy || "") || null}, ${String(d.receivedBy || "") || null},
                  ${String(d.approvedBy || "") || null},
                  ${reportedBy}, ${photos}, ${extraction}, 'telegram')
          returning id`
      : await sql<{ id: string }[]>`
          insert into store_issue_vouchers
            (siv_no, date, issuing_store, issued_to, department_section, store_requisition_no,
             remarks, issued_by, approved_by, received_by,
             reported_by, photo_file_ids, extraction, source)
          values (${voucherNo}, ${date}, ${String(d.issuingStore || "") || null},
                  ${String(d.issuedTo || "") || null},
                  ${String(d.departmentSection || "") || null},
                  ${String(d.requisitionNo || "") || null},
                  ${String(d.remarks || "") || null},
                  ${String(d.issuedBy || "") || null}, ${String(d.approvedBy || "") || null},
                  ${String(d.receivedBy || "") || null},
                  ${reportedBy}, ${photos}, ${extraction}, 'telegram')
          returning id`;

    if (items.length > 0) {
      const rows = items.map((it, i) => ({
        [isGrv ? "grv_id" : "siv_id"]: header.id,
        position: i,
        stock_code: it.stockCode,
        description: it.description,
        unit: it.unit,
        quantity: it.quantity,
        unit_cost: it.unitCost,
        total_amount: it.totalAmount,
        ledger_kind: it.ledgerKind,
        ledger_key: it.ledgerKey,
        ledger_qty: it.ledgerKey ? it.ledgerQty : null,
      }));
      await sql`insert into ${sql(isGrv ? "goods_receiving_items" : "store_issue_items")} ${sql(rows)}`;
    }

    return { id: header.id, table: isGrv ? "goods_receiving_vouchers" : "store_issue_vouchers" };
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
