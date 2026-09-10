import sql from "@/lib/sql";
import {
  BAG_KINDS,
  BAG_KIND_KEYS,
  BAG_SIZES,
  BAG_SIZE_LABEL,
  BAG_STOCK,
  DELIVERY_PRODUCTS,
  FINANCE_RAW_MATERIALS,
  PRODUCT_ORDER,
  PRODUCTION_PRODUCTS,
  bagLabel,
  bagLedgerKey,
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
import { runAfter } from "@/lib/after";
import { insertRow } from "@/lib/insert";
import {
  computeTotals,
  METHOD_LABEL,
  PAYMENT_METHODS,
  paymentKey,
  printedMismatch,
  refundKey,
  summaryColumns,
} from "@/lib/daily-sales";
import { chaseHolder } from "@/lib/wht-sms";
import { bagKey, productionTemplate, DELIVERED_PREFIX, PROD_PREFIX, STOCK_PREFIX } from "@/lib/production-paste";
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
// Names and the kind union live in a client-safe module — see flow-titles.ts.
import { FLOW_TITLE, type AssetFlowKind } from "@/lib/flow-titles";
export { FLOW_TITLE };
export type { AssetFlowKind };

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

export interface AssetFlowState {
  kind: AssetFlowKind;
  /** Step id currently being answered; "review" once every step is done. */
  step: string;
  draft: Record<string, string | number>;
  /** stored_files id of the damaged-item photo (tool_request/maintenance). */
  photoFileId?: string;
  /**
   * stored_files id per photo STEP, for flows with more than one.
   *
   * The damage report photographs each pile separately, and each photo has to
   * stay tied to the kind and quantity claimed beside it — a single
   * `photoFileId` could only ever hold the last one.
   */
  photoByStep?: Record<string, string>;
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
   * A short name for this field, for the edit list.
   *
   * The prompt is a whole sentence; a numbered list of forty sentences is not a
   * list anyone can correct against. Optional — `stepLabel` derives a decent one
   * from the prompt when it is absent, and this is set on the families of steps
   * built in loops, where one line covers ten fields.
   */
  label?: string;
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

/** Piles one damage report can carry. The report is weekly, so several. */
export const MAX_DAMAGE_PILES = 6;

/** Draft keys for one photographed pile. */
export const pileKeys = (i: number) => ({
  photo: `pilePhoto${i}`,
  kind: `pileKind${i}`,
  quantity: `pileQty${i}`,
  more: `pileMore${i}`,
});

function pileAsked(draft: Record<string, string | number>, i: number): boolean {
  if (i === 1) return true;
  return draft[pileKeys(i - 1).more] === "yes";
}

/**
 * PP bag damage — filed weekly, one entry per photographed pile.
 *
 * Each pile carries its own photo, bag kind and quantity, captured together.
 * That grouping is the whole point: with a loose set of photos and one total,
 * the AI could only be asked "is this damage?", which almost anything passes.
 * Tied together, it can be asked whether this pile plausibly holds this many
 * bags of this kind.
 */
const PP_BAG_DAMAGE_STEPS: AssetStep[] = [
  { id: "date", prompt: "📅 ሪፖርቱ የሚሸፍነውን ቀን ይምረጡ።", type: "date" },
  ...Array.from({ length: MAX_DAMAGE_PILES }).flatMap<AssetStep>((_, idx) => {
    const i = idx + 1;
    const k = pileKeys(i);
    const asked = (d: Record<string, string | number>) => pileAsked(d, i);
    const steps: AssetStep[] = [
      {
        id: k.photo,
        prompt: `📷 ክምር ${i} — የተበላሹትን ከረጢቶች ፎቶ ይላኩ።`,
        type: "photo",
        when: asked,
      },
      {
        id: k.kind,
        prompt: `🧺 ክምር ${i} — የትኛው ከረጢት ነው?`,
        type: "choice",
        choices: BAG_KINDS.map(({ size, colour }) => ({
          label: `${bagLabel(size, colour)} PP`,
          value: bagLedgerKey(size, colour),
        })),
        when: asked,
      },
      {
        id: k.quantity,
        label: `ክምር ${i} · ብዛት`,
        prompt: `🔢 ክምር ${i} — በዚህ ፎቶ ላይ ያሉት የተበላሹ ከረጢቶች ብዛት።`,
        type: "number",
        when: asked,
      },
    ];
    if (i < MAX_DAMAGE_PILES) {
      steps.push({
        id: k.more,
        label: `ክምር ${i} · ሌላ ክምር?`,
        prompt: "➕ ሌላ ክምር አለ?",
        type: "choice",
        choices: [
          { label: "➕ አዎ፣ ሌላ ክምር", value: "yes" },
          { label: "✅ በቃ", value: "no" },
        ],
        when: asked,
      });
    }
    return steps;
  }),
  { id: "reason", prompt: "❓ ከረጢቶቹ ለምን እንደተበላሹ ይግለጹ።", type: "text" },
];

export interface DamagePile {
  fileId: string;
  ledgerKey: string;
  quantity: number;
  label: string;
}

/** The filled piles, in order. Stops at the first without a photo. */
export function damagePiles(
  draft: Record<string, string | number>,
  photos: Record<string, string> = {}
): DamagePile[] {
  const out: DamagePile[] = [];
  for (let i = 1; i <= MAX_DAMAGE_PILES; i++) {
    const k = pileKeys(i);
    const fileId = String(photos[k.photo] || draft[k.photo] || "");
    const ledgerKey = String(draft[k.kind] || "");
    if (!fileId || !ledgerKey) break;
    out.push({
      fileId,
      ledgerKey,
      quantity: Math.round(Number(draft[k.quantity]) || 0),
      label: ledgerLabel("bag", ledgerKey),
    });
  }
  return out;
}

/*
 * The FGR rule (one or two four-digit numbers) now lives in
 * `parseProductionPaste`, which is the only place it can be broken since the
 * per-field question was removed. It was duplicated here as a step validator;
 * two copies of the same rule is how one of them quietly stops matching.
 */

/**
 * One button, two tables: what was produced today, then what is on hand.
 *
 * Pick a date, fill in one block, done. There is no question-at-a-time route any
 * more and no choice between the two — this report is 28 figures, and asking for
 * them one message at a time was a quarter of an hour of typing that nobody
 * finished in one sitting. The template is the report.
 *
 * Anything left blank in the block is simply not recorded, and the review card
 * names it. That is the honest outcome: a line the reporter skipped is unknown,
 * and turning it into a question they must answer before anything can be saved
 * is what made the old flow unfinishable.
 */
const PRODUCTION_STEPS: AssetStep[] = [
  { id: "date", prompt: "📅 የሪፖርቱን ቀን ይምረጡ።", type: "date" },
  {
    id: "paste",
    // The example is worth the two extra lines. The block is filled in by
    // editing it on a phone, and the one thing that makes a line unreadable is
    // putting the number somewhere other than after the "=". Showing the shape
    // once costs less than reporting an unreadable line afterwards.
    prompt:
      "📋 የሚከተለውን ቅጂ ሞልተው ይመልሱት።\n\n" +
      "<i>ቁጥሩን ከ = በኋላ ይፃፉ። ለምሳሌ፦</i>\n" +
      "<code>ETL-15 = 12\n3-EL = 10</code>\n" +
      "<i>ያልተመረተውን 0 ይፃፉ ወይም ባዶ ይተዉት። የሌለውን መስመር አይሰርዙ።</i>",
    type: "paste",
  },
];


/* ─────────────────────── Monthly base balance (asset mgmt) ────────────────── */

/**
 * The opening balance of the month about to start, counted three days before the
 * current month ends.
 *
 * One block, like the daily production report — nineteen figures asked one at a
 * time was nineteen messages once a month, and it is the same person filling in
 * both. The six bag kinds are listed separately rather than by size: they carry
 * different unit prices and are packed apart, so a balance per size would value
 * three products at one number and leave the stock check unable to name which
 * colour went missing.
 */
const BASE_BALANCE_STEPS: AssetStep[] = [
  {
    id: "paste",
    prompt: "📋 የሚከተለውን ቅጂ ሞልተው ይመልሱት።",
    type: "paste",
  },
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
function voucherItemSteps(opts: {
  kinds: readonly LedgerKind[];
  costSkippable: boolean;
  /**
   * Whether to ask what the line cost.
   *
   * False for the store issue voucher. Finance prices every issued item from the
   * monthly price list, so asking the storekeeper invites a second number that
   * disagrees with the one the report is actually built from. The GRV still
   * asks: there the supplier's invoice IS the price.
   */
  askUnitCost: boolean;
}): AssetStep[] {
  return Array.from({ length: MAX_VOUCHER_ITEMS }).flatMap<AssetStep>((_, idx) => {
    const i = idx + 1;
    const k = itemKeys(i);
    const asked = (d: Record<string, string | number>) => voucherItemAsked(d, i);

    const steps: AssetStep[] = [
      {
        id: k.description,
        label: `ዕቃ ${i} · Description`,
        prompt: `📝 ዕቃ ${i} — ስሙንና ዝርዝሩን (Description/Specification) ይፃፉ።`,
        type: "text",
        when: asked,
      },
      {
        id: k.stockCode,
        label: `ዕቃ ${i} · Stock Code`,
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
      ...(opts.askUnitCost
        ? [
            {
              id: k.unitCost,
              label: `ዕቃ ${i} · Unit Cost`,
              prompt: `💲 ዕቃ ${i} — የነጠላ ዋጋ (Unit Cost)። ${
                opts.costSkippable ? 'ካልታወቀ "-" ይላክ።' : "ካልታወቀ 0 ይጻፉ።"
              }`,
              type: "number" as const,
              skippable: opts.costSkippable,
              when: asked,
            },
          ]
        : []),
      {
        id: k.ledger,
        label: `ዕቃ ${i} · Stock item`,
        prompt:
          `📦 ዕቃ ${i} — ይህ ከየትኛው የክምችት ዕቃ ነው?\n` +
          `<i>የክምችት ሒሳብ የሚያዘው በዚህ መልስ ብቻ ነው።</i>`,
        type: "choice",
        choices: ledgerStepChoices(opts.kinds),
        when: (d) => suggestsStockItem(d, i),
      },
      {
        id: k.ledgerQty,
        label: `ዕቃ ${i} · Stock qty`,
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
  ...voucherItemSteps({ kinds: ["bag"], costSkippable: false, askUnitCost: true }),
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
 * TYPED ONLY — no photograph anywhere, unlike the GRV.
 *
 * On a goods receiving voucher the supplier's paper IS the source, and reading
 * it saves the reporter transcribing someone else's document. Here the person is
 * standing in the store with the items in front of them: they know what they
 * issued. A photo was collected at the end for a while and checked against the
 * entry, but it asked for a photograph to verify work nobody doubted, and it was
 * dropped. What is typed is the record.
 *
 * Unit cost is not asked either. The store issues goods, finance prices them,
 * and the monthly report values every issue from its own price list — a figure
 * typed here could only ever be a second number to disagree with that one.
 *
 * Both bag kinds and raw materials are offered, because this replaced the daily
 * raw-material issue and has to keep filling the Issue column of the monthly
 * report.
 */
const STORE_ISSUE_STEPS: AssetStep[] = [
  { id: "date", prompt: "📅 ዕቃው የወጣበትን ቀን ይምረጡ።", type: "date" },
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
  ...voucherItemSteps({ kinds: ["bag", "material"], costSkippable: true, askUnitCost: false }),
  { id: "remarks", prompt: "📝 አስተያየት (Remarks) ካለ ይፃፉ።", type: "text", skippable: true },
  { id: "issuedBy", prompt: "🧑 ያወጣው (Issued by) ማን ነው?", type: "text", skippable: true },
  { id: "approvedBy", prompt: "🧑 ያፀደቀው (Approved by) ማን ነው?", type: "text", skippable: true },
  { id: "receivedBy", prompt: "🧑 የተረከበው (Received by) ማን ነው?", type: "text", skippable: true },
  // No photo step. It was collected last and checked against the entry, but the
  // person filling this in is standing at the shelf and already knows what they
  // took — it asked for a photograph to verify work nobody doubted.
];

/* ────────────────────────── Monthly price list (finance) ─────────────────── */

/** Which namespace a price-list item belongs to — brands and raw materials both
 *  contain "Talc", so the key must record which table it is priced on. */
function priceKey(key: string): string {
  // A bag kind arrives as "kg25:Yellow" from priceListItems().
  const bag = key.includes(":") ? key.split(":") : null;
  if (bag && (BAG_SIZES as readonly string[]).includes(bag[0])) {
    return bagFinanceKey(bag[0] as BagSize, bag[1]);
  }
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
    label: item.label,
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

/* ─────────────────────── PP bags used, daily (production) ────────────────── */

/** Bag kinds one day's usage can list. */
export const MAX_USAGE_ITEMS = 6;

export const usageKeys = (i: number) => ({
  kind: `useKind${i}`,
  reference: `useRef${i}`,
  quantity: `useQty${i}`,
  more: `useMore${i}`,
});

function usageAsked(draft: Record<string, string | number>, i: number): boolean {
  if (i === 1) return true;
  return draft[usageKeys(i - 1).more] === "yes";
}

/**
 * What production actually filled today, by bag kind.
 *
 * Repeating, because a day routinely draws several kinds — the flow stops at the
 * first "no" rather than marching through six.
 */
const PP_BAG_USED_STEPS: AssetStep[] = [
  { id: "date", prompt: "📅 የዋለበትን ቀን ይምረጡ።", type: "date" },
  ...Array.from({ length: MAX_USAGE_ITEMS }).flatMap<AssetStep>((_, idx) => {
    const i = idx + 1;
    const k = usageKeys(i);
    const asked = (d: Record<string, string | number>) => usageAsked(d, i);
    const steps: AssetStep[] = [
      {
        id: k.kind,
        label: `ዕቃ ${i} · ከረጢት`,
        prompt: `🧺 ዕቃ ${i} — የትኛው ከረጢት ዋለ?`,
        type: "choice",
        choices: BAG_KINDS.map(({ size, colour }) => ({
          label: `${bagLabel(size, colour)} PP`,
          value: bagLedgerKey(size, colour),
        })),
        when: asked,
      },
      {
        id: k.reference,
        label: `ዕቃ ${i} · Reference No.`,
        prompt: `🔢 ዕቃ ${i} — የማጣቀሻ ቁጥር (Reference No.) ይፃፉ።`,
        type: "number",
        when: asked,
      },
      {
        id: k.quantity,
        label: `ዕቃ ${i} · ብዛት`,
        prompt: `📦 ዕቃ ${i} — የዋለው ብዛት (ቁጥር)።`,
        type: "number",
        when: asked,
      },
    ];
    if (i < MAX_USAGE_ITEMS) {
      steps.push({
        id: k.more,
        label: `ዕቃ ${i} · ሌላ ከረጢት?`,
        prompt: "➕ ሌላ ዓይነት ከረጢት ዋለ?",
        type: "choice",
        choices: [
          { label: "➕ አዎ፣ ሌላ", value: "yes" },
          { label: "✅ በቃ", value: "no" },
        ],
        when: asked,
      });
    }
    return steps;
  }),
];

export interface BagUsageItem {
  ledgerKey: string;
  label: string;
  referenceNo: string | null;
  quantity: number;
}

/** The filled usage rows, in order. Stops at the first without a kind. */
export function bagUsageItems(draft: Record<string, string | number>): BagUsageItem[] {
  const out: BagUsageItem[] = [];
  for (let i = 1; i <= MAX_USAGE_ITEMS; i++) {
    const k = usageKeys(i);
    const ledgerKey = String(draft[k.kind] || "");
    if (!ledgerKey) break;
    const ref = String(draft[k.reference] ?? "").trim();
    out.push({
      ledgerKey,
      label: ledgerLabel("bag", ledgerKey),
      referenceNo: ref || null,
      quantity: Number(draft[k.quantity]) || 0,
    });
  }
  return out;
}

/* ──────────────── Whiteness quality check, 4× daily (production) ─────────── */

/** The six readings taken at each check. */
export const WB_SLOTS = ["wb1", "wb2", "wb3", "wb4", "wb5", "wb6"] as const;

/** The four checks a day. */
export const WHITENESS_QUARTERS = ["1", "2", "3", "4"] as const;

/**
 * Non-numeric readings that are legitimate answers, not missing data.
 *
 * A line down for maintenance is NOT a whiteness of zero, and recording it as
 * one would drag the day's average down and report a stopped line as a badly
 * performing one. They are stored as typed and excluded from the mean.
 */
export const WB_NON_NUMERIC = ["MNT", "OUTAGE", "OFF"] as const;

const WB_ALIASES: Record<string, string> = {
  mnt: "MNT",
  maintenance: "MNT",
  ጥገና: "MNT",
  outage: "OUTAGE",
  power: "OUTAGE",
  መብራት: "OUTAGE",
  off: "OFF",
  ዝግ: "OFF",
};

/**
 * Read one whiteness slot.
 *
 * Deliberately a TEXT step rather than a number: a percentage, one of the three
 * words above, or nothing at all are all valid, and a number step would reject
 * two of those three.
 */
export function parseWhitenessReading(raw: string): string {
  const t = String(raw ?? "").trim();
  if (!t || isSkip(t)) return "";
  const alias = WB_ALIASES[t.toLowerCase()];
  if (alias) return alias;
  if ((WB_NON_NUMERIC as readonly string[]).includes(t.toUpperCase())) return t.toUpperCase();
  const n = Number(t.replace(/[%\s,]/g, ""));
  if (isFinite(n) && n >= 0 && n <= 100) return String(Math.round(n * 100) / 100);
  // Anything else is kept verbatim: an unexpected note is still what the
  // operator wrote down, and dropping it would lose the only record of it.
  return t.slice(0, 20);
}

/**
 * The average of the numeric readings, divided by HOW MANY THERE WERE.
 *
 * Not by six. A line that ran two of its six slots and was down for the rest
 * averaged over six would read as a third of its real whiteness — which is a
 * quality failure that never happened.
 *
 * Returns null when nothing numeric was recorded, which is a different fact from
 * an average of zero and must not be stored as one.
 */
export function whitenessAverage(readings: Record<string, string>): number | null {
  const nums: number[] = [];
  for (const slot of WB_SLOTS) {
    const v = readings[slot];
    if (v === undefined || v === null || String(v).trim() === "") continue;
    const n = Number(v);
    if (isFinite(n)) nums.push(n);
  }
  if (nums.length === 0) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
}

/** The readings map as the flow collected it. */
export function whitenessReadings(draft: Record<string, string | number>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const slot of WB_SLOTS) out[slot] = String(draft[slot] ?? "");
  return out;
}

const WHITENESS_STEPS: AssetStep[] = [
  { id: "date", prompt: "📅 የምርመራውን ቀን ይምረጡ።", type: "date" },
  {
    id: "quarter",
    prompt: "🕐 የስንተኛው ዙር ሪፖርት ነው? (በቀን 4 ጊዜ)",
    type: "choice",
    choices: WHITENESS_QUARTERS.map((q) => ({ label: `${q}ኛ ዙር`, value: q })),
  },
  {
    id: "productCode",
    prompt: "📦 ምርቱን ይምረጡ።",
    type: "choice",
    choices: PRODUCT_ORDER.map((code) => ({ label: productLabel(code), value: code })),
  },
  { id: "line", prompt: "🏭 የመስመሩን ቁጥር (Line) ይፃፉ።", type: "number" },
  ...WB_SLOTS.map<AssetStep>((slot, i) => ({
    id: slot,
    label: slot.toUpperCase(),
    prompt:
      `⚪ ${slot.toUpperCase()} — የነጭነት መጠን በ% ይፃፉ።\n` +
      (i === 0
        ? `<i>ካልተነበበ MNT (ጥገና)፣ outage (መብራት) ወይም off ይፃፉ። ከሌለ "-" ይላኩ።</i>`
        : ""),
    type: "text",
    skippable: true,
  })),
];


/* ────────────────────── The day's sales, in one photo ─────────────────────── */

/**
 * The whole sales report: pick the date, photograph the till's Payment Summary.
 *
 * It used to be one report per transaction — photograph the receipts, read them,
 * fill the gaps, approve, and start again for the next sale. On a busy day that
 * is the same six steps a dozen times over, which is what was reported as
 * exhausting. The till already totals the day itself.
 *
 * The ten figures are read off the photo and then EDITED on the review card
 * rather than asked for one by one: a read that got nine of ten right should
 * cost one correction, not ten questions.
 */
const DAILY_SALES_STEPS: AssetStep[] = [
  { id: "date", prompt: "📅 የሽያጩን ቀን ይምረጡ።", type: "date" },
  {
    id: "photos",
    prompt:
      `🧾 የቀኑን Payment Summary ፎቶ ይላኩ።\n` +
      `<i>ፎቶው ተነብቦ ቁጥሮቹ በራሳቸው ይሞላሉ — እርስዎ አርመው ያረጋግጣሉ።</i>\n` +
      `ከጨረሱ "✅ ጨርሻለሁ" ይጫኑ።`,
    type: "photos",
    // The photograph IS the report. Without it there is nothing to read and
    // nothing to check the typed figures against.
    required: true,
  },
  // Ten money steps, so every figure the read produced is a real answer that the
  // generic editor can list and correct like any other.
  ...PAYMENT_METHODS.flatMap<AssetStep>((m) => [
    {
      id: paymentKey(m),
      label: `${METHOD_LABEL[m]} payment`,
      prompt: `💰 ${METHOD_LABEL[m]} — Payment Amount። ከሌለ 0 ይፃፉ።`,
      type: "number",
    },
    {
      id: refundKey(m),
      label: `${METHOD_LABEL[m]} refund`,
      prompt: `↩️ ${METHOD_LABEL[m]} — Refund Amount። ከሌለ 0 ይፃፉ።`,
      type: "number",
    },
  ]),
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
  pp_bag_used: PP_BAG_USED_STEPS,
  whiteness_check: WHITENESS_STEPS,
  price_list: PRICE_LIST_STEPS,
  wht_holder: WHT_HOLDER_STEPS,
  daily_sales: DAILY_SALES_STEPS,
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

/**
 * A short name for a field, for the edit list.
 *
 * Prompts are whole sentences — "📝 ዕቃ 1 — ስሙንና ዝርዝሩን (Description/Specification)
 * ይፃፉ።" — and forty of those is not a list anyone can correct against. Three
 * fallbacks, in order of how much they can be trusted:
 *
 *  1. an explicit `label`, set on the families built in loops;
 *  2. the parenthesised English term the prompts already carry, which is what
 *     the paper form itself calls the field;
 *  3. the prompt with its emoji and its trailing Amharic verb stripped.
 */
/** Every step a flow declares, `when` guards ignored. */
export function allStepsFor(kind: AssetFlowKind): AssetStep[] {
  return STEPS[kind];
}

/**
 * A readable name for a draft key that has no step behind it.
 *
 * Two kinds of key end up here. The paste-only reports — daily production and
 * the opening balance — have exactly two steps between them and thirty-odd
 * figures, none of which the step table knows about. And a handful of keys are
 * written by an extraction rather than asked for, `unit` on a voucher line being
 * one. Both were invisible to the editor, which is what "no edit is happening"
 * looked like from the bot.
 */
export function draftKeyLabel(key: string): string {
  const bag = (rest: string) => {
    const parsed = parseBagLedgerKey(rest);
    return parsed ? `${bagLabel(parsed.size, parsed.colour)}` : rest;
  };

  if (key.startsWith(PROD_PREFIX)) return `ምርት · ${productLabel(key.slice(PROD_PREFIX.length))}`;
  if (key.startsWith(STOCK_PREFIX)) return `ክምችት · ${productLabel(key.slice(STOCK_PREFIX.length))}`;
  if (key.startsWith(DELIVERED_PREFIX)) return `Delivered · ${productLabel(key.slice(DELIVERED_PREFIX.length))}`;
  if (key.startsWith(BRAND_PREFIX)) return `ምርቶች · ${productLabel(key.slice(BRAND_PREFIX.length))}`;
  if (key.startsWith(MATERIAL_PREFIX)) return `ጥሬ ዕቃ · ${key.slice(MATERIAL_PREFIX.length)}`;
  // Both paste families namespace bags the same way, so one branch serves both.
  if (key.startsWith(BAG_PREFIX)) return `ከረጪት · ${bag(key.slice(BAG_PREFIX.length))}`;

  // A voucher line's unit of measure: "unit3" → "ዕቃ 3 · Unit".
  const item = key.match(/^([a-z]+)(\d+)$/);
  if (item) {
    const NAMES: Record<string, string> = {
      unit: "Unit",
      desc: "Description",
      stock: "Stock Code",
      qty: "Qty",
      cost: "Unit Cost",
      class: "Stock item",
      lqty: "Stock qty",
      more: "ሴላ ዕቃ?",
    };
    const name = NAMES[item[1]];
    if (name) return `ዕቃ ${item[2]} · ${name}`;
  }

  return key;
}

export function stepLabel(step: AssetStep): string {
  if (step.label) return step.label;

  // Only the first line: some prompts carry an <i>…</i> hint underneath.
  const first = step.prompt.split("\n")[0].replace(/<[^>]+>/g, "").trim();

  /** Strip the leading emoji, the closing punctuation and the trailing verb. */
  const tidy = (s: string) =>
    s
      .replace(/^[^\p{L}\p{N}]+/u, "")
      .replace(/[።?]\s*$/, "")
      // "…ይፃፉ", "…ይምረጡ", "…ይላኩ", "…ይጫኑ" — every prompt ends in one of these.
      .replace(/\s*(ይፃፉ|ይምረጡ|ይላኩ|ይጫኑ)[።?]?\s*$/, "")
      .trim();

  const paren = first.match(/\(([^)]+)\)/);
  if (paren) {
    // "ዕቃ 1 — … (Description/Specification) ይፃፉ።" → "ዕቃ 1 · Description"
    const term = paren[1].split("/")[0].trim();
    // Only the part BEFORE the em dash, and only when there is one. Without that
    // guard a prompt with no dash returns its whole sentence as the "lead" and
    // the label ends up longer than the prompt it was meant to shorten.
    const lead = first.includes("—") ? tidy(first.split("—")[0]) : "";
    return lead && lead !== term ? `${lead} · ${term}` : term;
  }

  return tidy(first).slice(0, 60) || step.id;
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
    // A blank line in the template is a zero, so it is shown as one. The card
    // used to print "—" and warn that N lines were blank; on a report where a
    // blank plainly means none produced, none in stock or none dispatched, that
    // was a warning about the normal case.
    const cell = (key: string, label: string) => `  • ${label}: ${qty(Number(d[key]) || 0)}`;

    const prod = PRODUCTION_PRODUCTS.map((c) => cell(`${PROD_PREFIX}${c}`, productLabel(c))).join("\n");
    // Stock lists every product even at zero: "we have none left" is a real and
    // important answer, unlike a product simply not produced that day.
    const stock = PRODUCTION_PRODUCTS.map((c) => cell(`${STOCK_PREFIX}${c}`, productLabel(c))).join("\n");
    const delivered = PRODUCTION_PRODUCTS.map((c) => cell(`${DELIVERED_PREFIX}${c}`, productLabel(c))).join("\n");
    const deliveredTotal = PRODUCTION_PRODUCTS.reduce(
      (a, c) => a + (Number(d[`${DELIVERED_PREFIX}${c}`]) || 0),
      0
    );
    const bags = BAG_SIZES.flatMap((size) =>
      BAG_STOCK[size].map((colour) => cell(bagKey(size, colour), bagLabel(size, colour)))
    ).join("\n");

    return (
      head +
      `📅 Date: ${esc(d.date)}\n` +
      `🔢 FGR No: ${esc(d.fgrNo) || "—"}\n\n` +
      `🏭 <b>የቀኑ ምርት (ቶን)</b>\n${prod}\n` +
      `  ─────────\n  <b>Total: ${qty(productionTotal(d))}</b>\n\n` +
      `🚚 <b>Delivered amount (ቶን)</b>\n${delivered}\n` +
      `  ─────────\n  <b>Total: ${qty(deliveredTotal)}</b>\n\n` +
      `📦 <b>ክምችት (ቶን)</b>\n${stock}\n\n` +
      `🧺 <b>ቀሪ ከረጢት (ብዛት)</b>\n${bags}\n`
    );
  }

  if (state.kind === "daily_sales") {
    const t = computeTotals(d);
    const rows = PAYMENT_METHODS.map((m) => {
      const pay = Number(d[paymentKey(m)]) || 0;
      const ref = Number(d[refundKey(m)]) || 0;
      return `  ${METHOD_LABEL[m].padEnd(8)} ${money(pay)}${ref ? `  (↩️ ${money(ref)})` : ""}`;
    }).join("\n");

    // A printed total that disagrees with the rows above it is the single most
    // useful thing this read can surface, so it is stated rather than quietly
    // overwritten in either direction.
    const mismatch = printedMismatch(d);

    return (
      head +
      `📅 Date: ${esc(d.date)}\n\n` +
      `💳 <b>Payment Summary</b>\n${rows}\n` +
      `  ─────────\n` +
      `  <b>Payments: ${money(t.totalPayment)}</b>\n` +
      (t.totalRefund ? `  <b>Refunds: ${money(t.totalRefund)}</b>\n` : "") +
      `  <b>Net: ${money(t.netTotal)} ETB</b>\n` +
      (mismatch
        ? `\n⚠️ በደረሰኙ ላይ የታተመው ጠቅላላ ${money(mismatch.printed)} ነው — ` +
          `ከመስመሮቹ ድምር (${money(mismatch.computed)}) ይለያያል።\n`
        : "")
    );
  }

  if (state.kind === "pp_bag_damage") {
    const piles = damagePiles(d, state.photoByStep || {});
    const total = piles.reduce((a, p) => a + p.quantity, 0);
    const lines = piles.map((p, i) => `  ${i + 1}. ${p.label}: <b>${qty(p.quantity)}</b> ከረጢት`);
    return (
      head +
      `📅 Date: ${esc(d.date)}\n` +
      `❓ ምክንያት: ${esc(d.reason)}\n\n` +
      `🧺 <b>በክምር</b>\n${lines.join("\n") || "  —"}\n` +
      `  ─────────\n  <b>ጠቅላላ: ${qty(total)} ከረጢት</b>\n\n` +
      `<i>የእያንዳንዱ ክምር ፎቶ ከተቀመጠ በኋላ በAI ይጣራል — ውጤቱን እንልክልዎታለን።</i>\n`
    );
  }

  if (state.kind === "pp_bag_used") {
    const items = bagUsageItems(d);
    const lines = items.map(
      (it, i) =>
        `  ${i + 1}. ${it.label}: <b>${qty(it.quantity)}</b>` +
        (it.referenceNo ? ` · Ref ${esc(it.referenceNo)}` : "")
    );
    const total = items.reduce((a, it) => a + it.quantity, 0);
    return (
      head +
      `📅 Date: ${esc(d.date)}\n\n` +
      `🧺 <b>የዋሉ ከረጢቶች</b>\n${lines.join("\n") || "  —"}\n` +
      `  ─────────\n  <b>ጠቅላላ: ${qty(total)} ከረጢት</b>\n`
    );
  }

  if (state.kind === "whiteness_check") {
    const readings = whitenessReadings(d);
    const avg = whitenessAverage(readings);
    const slots = WB_SLOTS.map((s) => `  ${s.toUpperCase()}: <b>${esc(readings[s] || "—")}</b>`);
    return (
      head +
      `📅 Date: ${esc(d.date)}\n` +
      `🕐 ዙር: <b>${esc(d.quarter)}</b>\n` +
      `📦 ምርት: <b>${productLabel(String(d.productCode || ""))}</b>\n` +
      `🏭 Line: <b>${esc(d.line)}</b>\n\n` +
      `⚪ <b>ንባቦች</b>\n${slots.join("\n")}\n` +
      `  ─────────\n` +
      // Stated rather than shown as 0: an average of nothing is not zero, and a
      // shift that was down for maintenance must not read as a quality failure.
      `  <b>Avg: ${avg === null ? "—" : `${qty(avg)}%`}</b>` +
      (avg === null ? `\n<i>ምንም የቁጥር ንባብ አልተመዘገበም።</i>` : "") +
      `\n`
    );
  }

  if (state.kind === "base_balance") {
    // Same rule as the daily production card: a line left blank in the template
    // is shown as blank, not as a zero somebody might read as a real count.
    const blanks: string[] = [];
    const cell = (key: string, label: string, unit = "") => {
      const v = d[key];
      if (v === undefined || v === "") {
        blanks.push(label);
        return `${label}: —`;
      }
      return `${label}: <b>${qty(Number(v) || 0)}</b>${unit}`;
    };

    const brands = PRODUCT_ORDER.map((c) => cell(brandKey(c), productLabel(c), " ቶን"));
    const mats = FINANCE_RAW_MATERIALS.map((m) => cell(materialKey(m), m, " ቶን"));
    const bags = BAG_KINDS.map(({ size, colour }) =>
      cell(bagFinanceKey(size, colour), `${bagLabel(size, colour)} PP`)
    );

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
      ...(blanks.length > 0
        ? ["", `⚠️ <b>${blanks.length} መስመር ባዶ ነው</b> — በ0 ይመዘገባል።`, "<i>ቅጂውን ሞልተው ድጋሚ መላክ ይችላሉ።</i>"]
        : []),
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

    // Stock and delivered both belong to the day's ops row, which is where the
    // pasted ops report has always written them. One number per day per column,
    // whoever entered it — a second table would let the two disagree with
    // nothing to reconcile them.
    //
    // The delivered amount goes to `delivered`, the column dispatched tonnage
    // has always used, rather than to a new one. Produced, delivered and left in
    // stock are three readings of the same ten products on the same day, and
    // splitting the third off would leave nothing able to check them against
    // each other.
    const stock = jsonMap(d, STOCK_PREFIX, PRODUCTION_PRODUCTS);
    const deliveredMap = jsonMap(d, DELIVERED_PREFIX, PRODUCTION_PRODUCTS);
    const bags = bagMap(d);
    if (Object.keys(stock).length > 0 || Object.keys(deliveredMap).length > 0 || Object.keys(bags).length > 0) {
      await upsertOpsDay({
        dateLabel: opsDateLabel(date),
        date,
        reportedBy,
        stock,
        delivered: deliveredMap,
        bags,
        rawText: `የቀኑ የምርት ሪፖርት · FGR ${String(d.fgrNo || "—")}`,
      });
    }
    return { id: row.id, table: "production_reports" };
  }

  if (state.kind === "pp_bag_damage") {
    const piles = damagePiles(d, state.photoByStep || {});
    // The report's own `quantity` stays the sum of its piles, so every existing
    // reader — the brief, the metrics, the exception list — keeps working
    // without knowing the report gained a breakdown.
    const total = piles.reduce((a, p) => a + p.quantity, 0);

    // Saved without a verdict: the AI chain runs after this returns, so the user
    // is never left waiting on three providers inside the webhook.
    const [row] = await sql<{ id: string }[]>`
      insert into pp_bag_damage_reports (date, reason, quantity, reported_by, source)
      values (${reportDate(d.date)}, ${String(d.reason || "")}, ${total},
              ${reportedBy}, 'telegram')
      returning id`;

    if (piles.length > 0) {
      await sql`
        insert into pp_bag_damage_items ${sql(
          piles.map((p, i) => ({
            report_id: row.id,
            position: i,
            ledger_key: p.ledgerKey,
            quantity: p.quantity,
            file_id: p.fileId,
          }))
        )}`.catch((e) => {
        // pp_bag_damage_items arrives in 0022. The report itself, and its total,
        // must still land on a database one migration behind.
        const code = (e as { code?: string })?.code;
        if (code !== "42P01") throw e;
        console.warn("pp_bag_damage_items not present yet");
      });
    }
    return { id: row.id, table: "pp_bag_damage_reports" };
  }

  if (state.kind === "daily_sales") {
    const date = reportDate(d.date);
    const cols = summaryColumns(d);
    // One row per day, upserted. Two rows for one day would be added together by
    // every figure on the dashboard, and a correction filed the next morning
    // would read as a second day's trading.
    const [row] = await sql<{ id: string }[]>`
      insert into daily_sales_summaries (
        date_label, date,
        cash_payment, cash_refund, cheque_payment, cheque_refund,
        card_payment, card_refund, credit_payment, credit_refund,
        voucher_payment, voucher_refund,
        total_payment, total_refund, net_total, printed_total,
        tg_file_ids, extraction, reported_by, source
      )
      values (
        ${opsDateLabel(date)}, ${date},
        ${cols.cash_payment}, ${cols.cash_refund}, ${cols.cheque_payment}, ${cols.cheque_refund},
        ${cols.card_payment}, ${cols.card_refund}, ${cols.credit_payment}, ${cols.credit_refund},
        ${cols.voucher_payment}, ${cols.voucher_refund},
        ${cols.total_payment}, ${cols.total_refund}, ${cols.net_total},
        ${Number(d.printedTotal) || null},
        -- The payment summary keeps NO reference to its own photograph.
        --
        -- It was never uploaded — only Telegram's file id was kept, which cost
        -- nothing and still resolved back to the image on the dashboard. That
        -- resolving was the problem: a receipt visible on the webapp reads as a
        -- receipt filed on the webapp, and the rule for this report is that the
        -- ten numbers ARE the record. The reporter now checks the read on the
        -- edit card before approving it, which is where a misread should be
        -- caught anyway — while the person who took the photo is still looking
        -- at the till. Written empty rather than omitted so that re-filing a day
        -- CLEARS whatever an older row was carrying.
        ${[] as string[]},
        ${state.extraction ? sql.json({ ...state.extraction }) : null},
        ${reportedBy}, 'telegram'
      )
      on conflict (date_label) do update set
        cash_payment    = excluded.cash_payment,
        cash_refund     = excluded.cash_refund,
        cheque_payment  = excluded.cheque_payment,
        cheque_refund   = excluded.cheque_refund,
        card_payment    = excluded.card_payment,
        card_refund     = excluded.card_refund,
        credit_payment  = excluded.credit_payment,
        credit_refund   = excluded.credit_refund,
        voucher_payment = excluded.voucher_payment,
        voucher_refund  = excluded.voucher_refund,
        total_payment   = excluded.total_payment,
        total_refund    = excluded.total_refund,
        net_total       = excluded.net_total,
        printed_total   = excluded.printed_total,
        tg_file_ids     = excluded.tg_file_ids,
        extraction      = excluded.extraction,
        reported_by     = excluded.reported_by,
        updated_at      = now()
      returning id`;
    return { id: row.id, table: "daily_sales_summaries" };
  }

  if (state.kind === "pp_bag_used") {
    const date = reportDate(d.date);
    const items = bagUsageItems(d);
    // One row per day, upserted, like daily_ops_reports: two people reporting
    // the same day must not produce two consumption figures nothing can
    // reconcile. Re-filing replaces the day's lines rather than adding to them.
    const [row] = await sql<{ id: string }[]>`
      insert into pp_bag_usage (date_label, date, reported_by, source)
      values (${opsDateLabel(date)}, ${date}, ${reportedBy}, 'telegram')
      on conflict (date_label) do update set
        reported_by = excluded.reported_by,
        updated_at = now()
      returning id`;

    await sql`delete from pp_bag_usage_items where usage_id = ${row.id}`.catch(() => {});
    if (items.length > 0) {
      await sql`
        insert into pp_bag_usage_items ${sql(
          items.map((it, i) => ({
            usage_id: row.id,
            position: i,
            ledger_key: it.ledgerKey,
            reference_no: it.referenceNo,
            quantity: it.quantity,
          }))
        )}`;
    }
    return { id: row.id, table: "pp_bag_usage" };
  }

  if (state.kind === "whiteness_check") {
    const date = reportDate(d.date);
    const readings = whitenessReadings(d);
    // One reading set per quarter per product per line. A correction replaces
    // the reading it corrects — a second row would be counted twice by the
    // weekly average with nothing to choose between them.
    const [row] = await sql<{ id: string }[]>`
      insert into whiteness_checks (date, date_label, quarter, product_code, line,
                                    readings, avg, reported_by, source)
      values (${date}, ${opsDateLabel(date)}, ${Number(d.quarter) || 1},
              ${String(d.productCode || "")}, ${Math.round(Number(d.line) || 0)},
              ${sql.json(readings)}, ${whitenessAverage(readings)},
              ${reportedBy}, 'telegram')
      on conflict (date_label, quarter, product_code, line) do update set
        readings = excluded.readings,
        avg = excluded.avg,
        reported_by = excluded.reported_by,
        updated_at = now()
      returning id`;
    return { id: row.id, table: "whiteness_checks" };
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
              ${sql.json(jsonMap(d, BAG_PREFIX, BAG_KIND_KEYS))},
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
    // Telegram file ids, not stored-file uuids: voucher photos are read once and
    // never uploaded. They go into `tg_file_ids` (text[]) rather than
    // `photo_file_ids` (uuid[]), which the recycle bin, the archive and both
    // storage purges all join against stored_files.
    const photos = state.photoFileIds || [];
    const date = reportDate(d.date);
    // A blank voucher number must be stored as NULL, not "". The unique index is
    // partial on `not null`, so an empty string would make the SECOND unnumbered
    // voucher collide with the first and be refused as a duplicate.
    const voucherNo = String((isGrv ? d.grvNo : d.sivNo) || "").trim() || null;

    // Both go through insertRow so that `tg_file_ids` (migration 0023) missing
    // costs the photo references rather than the whole voucher — a GRV is
    // twenty typed fields and up to eight line items, and losing that to a
    // column is not a trade worth making.
    const header = isGrv
      ? await insertRow(
          "goods_receiving_vouchers",
          {
            grv_no: voucherNo,
            date,
            supplier: String(d.supplier || "") || null,
            supplier_invoice_no: String(d.supplierInvoiceNo || "") || null,
            purchase_order_no: String(d.purchaseOrderNo || "") || null,
            receiving_store_no: String(d.receivingStoreNo || "") || null,
            currency: d.currency === "USD" ? "USD" : "ETB",
            total_amount: Number(d.totalAmount) || null,
            remarks: String(d.remarks || "") || null,
            prepared_by: String(d.preparedBy || "") || null,
            received_by: String(d.receivedBy || "") || null,
            approved_by: String(d.approvedBy || "") || null,
            reported_by: reportedBy,
            tg_file_ids: photos,
            extraction,
            source: "telegram",
          },
          { optional: ["tg_file_ids"], source: "asset-flows" }
        )
      : await insertRow(
          "store_issue_vouchers",
          {
            siv_no: voucherNo,
            date,
            issuing_store: String(d.issuingStore || "") || null,
            issued_to: String(d.issuedTo || "") || null,
            department_section: String(d.departmentSection || "") || null,
            store_requisition_no: String(d.requisitionNo || "") || null,
            remarks: String(d.remarks || "") || null,
            issued_by: String(d.issuedBy || "") || null,
            approved_by: String(d.approvedBy || "") || null,
            received_by: String(d.receivedBy || "") || null,
            reported_by: reportedBy,
            tg_file_ids: photos,
            extraction,
            source: "telegram",
          },
          { optional: ["tg_file_ids"], source: "asset-flows" }
        );

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
      ...jsonMap(d, BAG_PREFIX, BAG_KIND_KEYS),
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
    const company = String(d.company || "");
    const phone = String(d.phone || "");
    const description = String(d.description || "") || null;
    const [row] = await sql<{ id: string }[]>`
      insert into wht_holders (company, phone, description, registered_by, source)
      values (${company}, ${phone}, ${description}, ${reportedBy}, 'telegram')
      returning id`;

    // The customer is texted the moment they are registered rather than at the
    // next morning's cron. Sent after the reply, not before it: the bot's answer
    // must not sit behind an outbound HTTP call, and chaseHolder claims today's
    // slot so tomorrow's cron skips this holder instead of asking twice.
    runAfter(chaseHolder({ id: row.id, company, phone, description }));

    return { id: row.id, table: "wht_holders" };
  }

  // insertRow, not a tagged template, so that a database still missing
  // `tg_file_id` (migration 0025) costs the photo REFERENCE rather than the
  // whole request. This is the exact insert that was losing tool requests.
  const row = await insertRow(
    "purchase_requests",
    {
      title: String(d.title || ""),
      quantity: Number(d.quantity) || null,
      kind: String(d.kind || ""),
      justification: String(d.reason || "") || null,
      tg_file_id: state.photoFileId || null,
      requested_by: reportedBy,
      source: "telegram",
      status: "pending",
      legitimacy: state.check ? sql.json({ ...state.check }) : null,
    },
    { optional: ["tg_file_id"], source: "asset-flows" }
  );
  return { id: row.id, table: "purchase_requests" };
}
