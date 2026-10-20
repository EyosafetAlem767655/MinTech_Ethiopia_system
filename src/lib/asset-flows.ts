import sql from "@/lib/sql";
import {
  BAG_KINDS,
  BAG_KIND_KEYS,
  BAG_SIZES,
  BAG_SIZE_LABEL,
  BAG_STOCK,
  DELIVERY_PRODUCTS,
  FINANCE_RAW_MATERIALS,
  RAW_MATERIALS,
  PRODUCT_ORDER,
  PRODUCTION_PRODUCTS,
  bagLabel,
  bagLedgerKey,
  ledgerLabel,
  looksLikeStockItem,
  parseBagLedgerKey,
  productLabel,
  type BagSize,
  type LedgerKind,
} from "@/lib/products";
import { upsertOpsDay, opsDateLabel } from "@/lib/ops-report";
import { runAfter } from "@/lib/after";
import { costsAt, recordCosts, type ItemCost } from "@/lib/store-costs";
import { insertRow } from "@/lib/insert";
import {
  SALES_KEYS,
  SALES_PRODUCT_PREFIX,
  bankChoices,
  salesBank,
  salesBanks,
  salesBanksTicked,
  salesBankAmountKey,
  needsBankAmounts,
  salesTin,
  normaliseTin,
  salesProductKey,
  salesQty,
  salesTemplate,
} from "@/lib/sales-invoice";
import { BANKS, BANK_OTHER } from "@/lib/banks";
import { linkCustomerTin } from "@/lib/sales-tin";
import {
  GRV_LINES_EXAMPLE,
  GRV_LINES_STEP,
  GRV_MATCH_MORE,
  GRV_MATCH_OK,
  GRV_MATCH_DROP,
  GRV_MATCH_REDO,
  SIV_COUNT_STEP,
  sivTemplate,
  GRV_MATCH_STEP,
  grvLines,
  hasGrvLines,
  setGrvLines,
  MAX_GRV_LINES,
} from "@/lib/grv-lines";
import { NO_MACHINE, decodeMachines } from "@/lib/machines";
import { createCustomItems } from "@/lib/store-custom";
import { eatDateLabel } from "@/lib/dates";
import { chosenCustomerName, chosenInvoice, customerChoices, invoiceChoices, invoicesFor } from "@/lib/credit-bot";
import { PART_LABEL, chosenOwed, loadRemaining, owedChoices } from "@/lib/rm-credit";
import { SETTLED_TOLERANCE_ETB } from "@/lib/credit";
import {
  HOURS_KINDS,
  HOURS_LABEL,
  cellKeyLabel,
  fmtHours,
  hasHoursCells,
  hoursBlock,
  hoursWarnings,
  lostMinutes,
  parseHoursBlock,
  rowsFromDraft,
} from "@/lib/downtime-sheet";
import {
  bagKey as ppBagKey,
  bagTotal as ppBagTotal,
  bagsReceived,
  ppBagTemplate,
} from "@/lib/pp-bag-paste";
import { chaseHolder } from "@/lib/wht-sms";
import { bagKey, productionTemplate, DELIVERED_PREFIX, PROD_PREFIX, STOCK_PREFIX } from "@/lib/production-paste";
import {
  BAG_PREFIX,
  BRAND_PREFIX,
  MATERIAL_PREFIX,
  bagFinanceKey,
  baseBalanceTemplate,
  brandKey,
  ppBagPriceTemplate,
  materialKey,
  priceListTemplate,
} from "@/lib/finance-paste";
import { monthLabel, nextMonth, priceListItems } from "@/lib/finance-report";
import { PURCHASE_DEPARTMENTS } from "@/lib/purchase-departments";
import { rawMaterialTemplate, sectionMap } from "@/lib/raw-material-paste";
import {
  STORE_BLOCKS,
  STORE_GROUPS,
  allStoreItems,
  STORE_ITEM_BY_KEY,
  groupsOfBlock,
  itemsOfBlock,
  itemsOfGroup,
  type StoreBlockKey,
} from "@/lib/store-items";
import { itemKey, storeGroupTemplate } from "@/lib/store-count-paste";
import {
  STORE_DEPTS_STEP,
  STORE_QTY_STEP,
  itemLabel,
  storeCostKey,
  storeLines,
  storeVoucherTemplate,
  tickedStoreItems,
  wantsOtherItems,
} from "@/lib/store-voucher";
import type { ToolPhotoCheck } from "@/lib/llm";
import { savePurchase, suggestStoreItems } from "@/lib/item-purchases";
import { priceBasisFor, purchaseAmounts } from "@/lib/purchase-price";
import type { StoreItem } from "@/lib/store-items";
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
  /**
   * The capability key of a report the person asked for while THIS one was
   * still unfinished.
   *
   * Set only while the "continue or start over" question is on screen, and
   * cleared by either answer. It lives on the flow state rather than on the
   * session because `asset_flow` is already jsonb — a new session column would
   * be a migration for a field that exists for one exchange.
   */
  pendingCap?: string;
  /**
   * When a background read of this flow's photos (or the GRV's typed lines)
   * started. While set — and younger than a few minutes — the step answers
   * "still reading" instead of starting a second read, and the read's result is
   * only written back if it is still the same read (the person may have
   * cancelled meanwhile).
   */
  readingSince?: string;
  /**
   * When ✅ started saving this flow. A second tap while it is set (a double
   * tap, or a tap while a slow save is still running) is answered "saving…"
   * instead of saving the report twice. Cleared when a save fails.
   */
  savingSince?: string;
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
   * "paste" sends a fill-in template and reads a whole block back at once;
   * "month" is the date picker with the days taken off, for a report that
   * belongs to a month rather than a day.
   */
  type: "date" | "month" | "text" | "number" | "choice" | "multichoice" | "photo" | "photos" | "paste";
  choices?: { label: string; value: string }[];
  /**
   * Buttons per row on a tick-list. One by default; the warehouse item lists
   * use two, or Electrical's 77 items would be a 77-row keyboard.
   */
  columns?: number;
  /**
   * Choices computed from the draft, for a step whose options are whatever the
   * database holds right now — the unpaid invoices, say. The list is seeded
   * into the draft when the flow starts, so this stays synchronous and the
   * keyboard builder does not have to know it was dynamic.
   */
  choicesFrom?: (draft: Record<string, string | number>) => { label: string; value: string }[];
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
  /**
   * A choice step that also takes a typed answer: the buttons are suggestions
   * (the machine names already used), and a new name is simply typed.
   */
  freeText?: boolean;
}

/* ─────────────────────────────── Step tables ──────────────────────────────── */

/**
 * The daily raw-material report: one day, three materials, three readings each.
 *
 * It used to record one TRUCK — supplier, delivery note, plate, M.R.V — with
 * tonnage split five ways (Talc, Kuni, Chips, Guji, Lime Stone). What the plant
 * needs on the dashboard is the day: what came in, what production consumed and
 * what is left on the ground, in the three materials finance already accounts
 * in. Deliveries are still documented on the Goods Receiving Voucher, which is
 * where a supplier and a plate belong.
 *
 * One paste block rather than nine questions, in the shape the request was
 * written in. Historic per-truck rows stay readable under Settings.
 */
const RAW_MATERIAL_STEPS: AssetStep[] = [
  { id: "date", prompt: "📅 የሪፖርቱን ቀን ይምረጡ።", type: "date" },
  {
    id: "paste",
    prompt:
      "📋 የሚከተለውን ቅጂ ሞልተው ይመልሱት።\n\n" +
      "<i>ቁጥሩን ከ = በኋላ በቶን ይፃፉ። ለምሳሌ፦</i>\n" +
      "<code>Dolomite = 12.5</code>\n" +
      "<i>የሌለውን 0 ይፃፉ ወይም ባዶ ይተዉት። የክፍሉን ርዕስ (--- Received ---) አይሰርዙ።</i>",
    type: "paste",
  },
];

/* ─────────────────────── The spare-parts store count ──────────────────────── */

/**
 * Sections → groups → one paste step per ticked GROUP, each skippable.
 *
 * Per group, not per section, since the full store list: Electrical alone is
 * 169 items, and a block that long passes Telegram's 4,096-character message
 * limit — and nobody counts a whole department in one go anyway.
 *
 * A count is routinely partial in BOTH directions — the bearings today and the
 * electrics on Thursday, and within a block only the shelves that moved. So the
 * list arrives empty: a line with no number changes nothing, and an item keeps
 * its figure and its "last counted" date until somebody actually counts it.
 * `groups` on the saved row records which blocks this count covered, which is
 * what keeps "counted and found none" (a stored 0) apart from "not counted".
 */
export const STORE_SECTIONS_STEP = "sections";

const STORE_COUNT_STEPS: AssetStep[] = [
  { id: "date", prompt: "📅 የቆጠራውን ቀን ይምረጡ።", type: "date" },
  {
    id: STORE_SECTIONS_STEP,
    label: "Sections",
    prompt:
      "🧰 የትኞቹን ክፍሎች ነው የሚያዘምኑት? የሚፈልጉትን ይንኩ፣ ከዚያ ጨርሻለሁ ይጫኑ።\n\n" +
      "<i>የነኩዋቸው ክፍሎች ዝርዝር ብቻ ይላካል።</i>",
    type: "multichoice",
    choices: STORE_BLOCKS.map((b) => ({ label: `${b.icon} ${b.label}`, value: b.key })),
  },
  ...STORE_BLOCKS.flatMap<AssetStep>((b) => [
    {
      id: countGroupsStep(b.key),
      label: `${b.label} groups`,
      prompt: `${b.icon} <b>${b.label}</b> — የትኞቹን ዓይነቶች ቆጠሩ? ይንኩ፣ ከዚያ ✅ ጨርሻለሁ ይጫኑ።`,
      type: "multichoice" as const,
      // A getter, not a value: items a GRV added are registered after this
      // table is built, and the list has to include them when it is SHOWN.
      // Empty groups (a new "Added from GRV" before anything was added) are hidden.
      get choices() {
        return groupsOfBlock(b.key)
          .filter((g) => itemsOfGroup(g.key).length > 0)
          .map((g) => ({ label: `${g.label} (${itemsOfGroup(g.key).length})`, value: g.key }));
      },
      when: (d: Record<string, string | number>) => ticked(d, STORE_SECTIONS_STEP).includes(b.key),
    },
    // Only the ticked groups are sent. Walking somebody through every shelf
    // when they came to update the oils is how a count sheet gets filled in
    // from memory.
    ...groupsOfBlock(b.key).map<AssetStep>((g) => ({
      id: storeGroupStep(g.key),
      label: g.label,
      when: (d: Record<string, string | number>) =>
        ticked(d, STORE_SECTIONS_STEP).includes(b.key) && ticked(d, countGroupsStep(b.key)).includes(g.key),
      prompt:
        `${b.icon} <b>${g.label}</b> — የቆጠሩትን ብቻ ይሙሉ።\n\n` +
        "<i>ያልቆጠሩትን ባዶ ይተዉት — ምንም አይቀየርም። ምንም ከሌለ 0 ይፃፉ።</i>\n" +
        '<i>ይህን ዓይነት ጨርሶ ካልቆጠሩ "-" ይላኩ።</i>',
      type: "paste",
      skippable: true,
    })),
  ]),
];

/**
 * A `multichoice` answer: the ticked values, comma-joined in the draft.
 *
 * Stored as one string rather than an array because the draft is
 * Record<string, string | number> — the same shape every other answer lives in,
 * which keeps the edit path, the review card and the save from needing to know
 * this step type exists.
 */
export function ticked(draft: Record<string, string | number>, stepId: string): string[] {
  return String(draft[stepId] || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

/** Tick or untick one value, returning the new draft string. */
export function toggleTick(current: string, value: string): string {
  const set = current.split(",").map((v) => v.trim()).filter(Boolean);
  const at = set.indexOf(value);
  if (at >= 0) set.splice(at, 1);
  else set.push(value);
  return set.join(",");
}

/** Step id of a section's group tick-list on the store count (no ":" — see tickKeyboard). */
export function countGroupsStep(block: StoreBlockKey): string {
  return `cntGroups_${block}`;
}

/** Step id for one group's paste block on the store count. */
export function storeGroupStep(group: string): string {
  return `grp:${group}`;
}

/** The group a store-count paste step is for, or null. */
export function storeGroupOfStep(stepId: string): string | null {
  const key = stepId.startsWith("grp:") ? stepId.slice(4) : "";
  return STORE_GROUPS.some((g) => g.key === key) ? key : null;
}

/**
 * Flows nobody can start any more. A session parked in one is reset by the
 * webhook with a message, because its steps no longer exist to continue.
 */
export const RETIRED_FLOWS: ReadonlySet<AssetFlowKind> = new Set<AssetFlowKind>(["delivery", "bank_collection"]);

/** The units a new-tool request can be counted in. */
export const PURCHASE_UNITS = [
  { label: "🔩 pcs", value: "pcs" },
  { label: "📦 pack", value: "pack" },
];

/**
 * Who is asking. The list itself lives in purchase-departments.ts so the
 * dashboard can read the same one — importing this module in the browser pulls
 * the Postgres client in with it.
 */
export { PURCHASE_DEPARTMENTS };

/**
 * A purchase request, one of two shapes chosen up front.
 *
 * The KIND is asked first, because everything after it differs. A damaged item
 * is a claim with evidence: what it is, how many, and a photograph the model
 * checks against that claim, with its confidence shown on the dashboard. A new
 * tool is a case to be made: what, described; how many and in what unit; why;
 * for which department; and anything else worth saying.
 *
 * It used to ask name and quantity before the kind, which read as one form with
 * a branch at the end rather than two requests — and left the new-tool branch
 * with a single "reason" line to carry the whole case.
 */
const isMaintenance = (d: Record<string, string | number>) => d.kind === "maintenance";
const isNewItem = (d: Record<string, string | number>) => d.kind === "new_item";

const TOOL_REQUEST_STEPS: AssetStep[] = [
  {
    id: "kind",
    label: "Type",
    prompt: "❓ የግዢ ጥያቄው ምንድን ነው?",
    type: "choice",
    choices: [
      { label: "🛠 የተበላሸ ዕቃ (Damaged item)", value: "maintenance" },
      { label: "🆕 አዲስ መሣሪያ (New tool)", value: "new_item" },
    ],
  },

  /* ── A. Damaged item ─────────────────────────────────────────────────── */
  { id: "title", label: "Item", prompt: "🛠 የተበላሸው ዕቃ ምንድን ነው? ስሙን ይፃፉ።", type: "text", when: isMaintenance },
  { id: "quantity", label: "Qty", prompt: "🔢 ስንት ናቸው? ብዛቱን ይፃፉ።", type: "number", when: isMaintenance },
  {
    id: "photo",
    prompt: "📷 የተበላሸውን ዕቃ ፎቶ ይላኩ። ብልሽቱ በግልጽ እንዲታይ ያድርጉ — ፎቶው በAI በጥንቃቄ ይመረመራል።",
    type: "photo",
    when: isMaintenance,
  },

  /* ── B. New tool ──────────────────────────────────────────────────────── */
  { id: "title", label: "Tool", prompt: "🆕 የመሣሪያውን ስም ይፃፉ።", type: "text", when: isNewItem },
  {
    id: "description",
    label: "Description",
    prompt: "📝 መግለጫውን ይፃፉ (ዓይነት፣ መጠን፣ ሞዴል፣ ወዘተ)።",
    type: "text",
    when: isNewItem,
  },
  { id: "quantity", label: "Qty", prompt: "🔢 ብዛቱን ይፃፉ።", type: "number", when: isNewItem },
  { id: "unit", label: "Unit", prompt: "📏 መለኪያው ምንድን ነው?", type: "choice", choices: PURCHASE_UNITS, when: isNewItem },
  { id: "reason", label: "Reason", prompt: "❓ የግዢው ምክንያት ምንድን ነው?", type: "text", when: isNewItem },

  /* ── Both ─────────────────────────────────────────────────────────────────
     The department is asked of BOTH kinds. It used to be a new-tool question
     only, which left every damaged-item request filed with no department at
     all — so the dashboard could not say which part of the plant is wearing
     out its tools, which is the whole point of asking. */
  {
    id: "department",
    label: "Department",
    prompt: "🏷 የትኛው ክፍል ነው የሚጠይቀው?",
    type: "choice",
    choices: PURCHASE_DEPARTMENTS,
  },
  // Which machine or car it is for — every request, unless it is PP bags or
  // oil, which no machine is named for (the button says so).
  {
    id: "machine",
    label: "Machine",
    prompt: "🚜 ለየትኛው ማሽን ወይም መኪና ነው? ከታች ይምረጡ ወይም ስሙን ይፃፉ።",
    type: "choice",
    choicesFrom: (d) => [
      ...decodeMachines(d).map((m) => ({ label: m, value: m })),
      { label: "🧺 PP bag / 🛢 Oil — ማሽን የለም", value: NO_MACHINE },
    ],
    freeText: true,
  },
  { id: "notes", label: "Notes", prompt: "🗒 ተጨማሪ ማስታወሻ ካለ ይፃፉ።", type: "text", skippable: true },
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
  // Which month this balance OPENS. It used to be assumed — always the month
  // after the current one — which is right on the day it is normally filed and
  // wrong every other time, with no way to say so from the bot.
  { id: "month", label: "Month", prompt: "📅 ይህ ሚዛን የየትኛው ወር መክፈቻ ነው?", type: "month" },
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
  // Typed lines are for what is NOT on the warehouse list, so they are only
  // asked when "📝 other" was ticked among the departments.
  if (i === 1) return wantsOtherItems(draft);
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

/** The unit a confirmed ledger key is counted in. */
export function ledgerUnitOf(key: string): "pcs" | "t" | null {
  if (!key || key === LEDGER_NONE) return null;
  if (parseBagLedgerKey(key)) return "pcs";
  if ((FINANCE_RAW_MATERIALS as readonly string[]).includes(key)) return "t";
  return null;
}

/* ── Goods Receiving Voucher (finance) ────────────────────────────────────── */

/**
 * Everything bought and received, PP bags included. TYPED, like the SIV.
 *
 * It used to open with a camera: photograph the voucher, let the model read it,
 * then correct what it got wrong. That is a good trade when the paper is dense
 * and the reader is transcribing somebody else's document — and a bad one here,
 * where it put an AI read between the reporter and a form they could simply
 * fill in, and every figure then had to be checked anyway. What is typed is the
 * record.
 *
 * Nothing on it is classified as stock any more. PP bags have their own
 * receiving form and raw material its own daily report; both record what
 * arrived per kind, without depending on how somebody worded a line here. This
 * voucher is the purchase record — what was bought, from whom, for how much.
 */
const GRV_STEPS: AssetStep[] = [
  { id: "date", prompt: "📅 ዕቃው የገባበትን ቀን ይምረጡ።", type: "date" },
  { id: "grvNo", prompt: "🔢 የቫውቸሩን ቁጥር (No.) ይፃፉ — ለምሳሌ 5516።", type: "text", skippable: true },
  { id: "supplier", prompt: "🏢 አቅራቢውን (Supplier) ይፃፉ።", type: "text", skippable: true },
  // The items, TYPED — one line each, as the supplier's invoice has them — and
  // matched to the store list by AI (grv-lines.ts, store-match.ts). No
  // department → group → item keyboards: a clerk holding the paper should not
  // have to find a bearing three menus deep. A line nothing matches becomes a
  // new store item when the voucher is saved.
  {
    id: GRV_LINES_STEP,
    label: "Items",
    // ONE row per message: every item carries its reference number, and a row
    // at a time is how the clerk reads them off the supplier's invoice.
    prompt:
      "📦 ዕቃውን ይፃፉ — በአንድ መልዕክት <b>አንድ ዕቃ</b>፦\n" +
      "<b>ስም | Reference no. | ብዛት | የነጠላ ዋጋ</b>\n" +
      `<i>ለምሳሌ፦</i> <code>${GRV_LINES_EXAMPLE}</code>\n\n` +
      "<i>ከመጋዘን ዝርዝሩ ጋር በራሱ ይገናኛል፤ የሌለ ዕቃ አዲስ ሆኖ ይገባል። ከዚያ ቀጣዩን ዕቃ ይጠየቃሉ።</i>",
    type: "paste",
  },
  {
    id: GRV_MATCH_STEP,
    label: "Item matches",
    prompt: "ሌላ ዕቃ አለ?",
    type: "choice",
    choices: [
      { label: "➕ ቀጣይ ዕቃ", value: GRV_MATCH_MORE },
      { label: "✅ ጨርሻለሁ", value: GRV_MATCH_OK },
      { label: "🗑 የመጨረሻውን አጥፋ", value: GRV_MATCH_DROP },
    ],
    // Only once the lines exist; a draft from before the change keeps its own items.
    when: (d) => hasGrvLines(d),
  },
  {
    id: "currency",
    prompt: "💱 በየትኛው ገንዘብ ተከፍሏል?",
    type: "choice",
    choices: [
      { label: "🇪🇹 ብር (ETB)", value: "ETB" },
      { label: "💵 ዶላር (USD)", value: "USD" },
    ],
  },
  // No total question: the total is the sum of the lines (voucherTotal), and a
  // typed figure could only be a second number to disagree with them.
  { id: "approvedBy", prompt: "🧑 ያፀደቀው (Approved by) ማን ነው?", type: "text", skippable: true },
  { id: "receivedBy", prompt: "🧑 የተረከበው (Received by) ማን ነው?", type: "text", skippable: true },
];

/* ── Store Issue Voucher (asset management) ───────────────────────────────── */

/**
 * Everything taken out of the warehouse — exactly what the paper pad asks.
 *
 * Issuing store, issued-to, the requisition number, remarks and issued-by were
 * all collected and none of them were wanted; the department is what anybody
 * reads this by. Unit cost is not asked either: the store issues goods, finance
 * prices them from the monthly price list, and a figure typed here could only
 * be a second number to disagree with that one.
 *
 * Nor is the stock-item question. Bags LEAVING are recorded per kind by the
 * daily PP bag usage report, which is where the monthly report and the bag
 * stock check now take the issued side from.
 */
/** Draft key of the machine asked for SIV line `n`, when its paste did not name one. */
export function sivMachineKey(n: number): string {
  return `mach:${n}`;
}

const STORE_ISSUE_STEPS: AssetStep[] = [
  { id: "date", prompt: "📅 ዕቃው የወጣበትን ቀን ይምረጡ።", type: "date" },
  { id: "sivNo", prompt: "🔢 የቫውቸሩን ቁጥር (No.) ይፃፉ — ለምሳሌ 8610።", type: "text", skippable: true },
  {
    id: "departmentSection",
    label: "Department",
    prompt: "🏷 የትኛው ክፍል ነው የጠየቀው (Requesting Department)?",
    type: "text",
  },
  // How many items, then their names as one list — matched to the store list
  // (the nearest similar item counts: what leaves the store was on its shelf).
  // Only a line nothing on the list resembles becomes a new item. No more
  // department → group → item keyboards.
  {
    id: SIV_COUNT_STEP,
    label: "Items",
    prompt: "🔢 ስንት ዕቃ ነው የሚወጣው?",
    type: "number",
  },
  {
    id: GRV_LINES_STEP,
    label: "Items",
    prompt:
      "📦 የሚወጡትን ዕቃዎች ይፃፉ — በአንድ መስመር አንድ ዕቃ፦\n" +
      "<b>ስም | መግለጫ | ብዛት | ማሽን/መኪና</b>\n" +
      "<i>ለምሳሌ፦</i> <code>Ball bearing | 6210 | 2 | Crusher 1</code>\n" +
      "<i>ማሽኑን ካልፃፉ ለእያንዳንዱ ዕቃ ይጠየቃሉ።</i>\n\n" +
      "<i>ከታች ያለውን ቅጂ ሞልተው ይላኩ። ከመጋዘን ዝርዝሩ ጋር በራሱ ይገናኛል።</i>",
    type: "paste",
  },
  {
    id: GRV_MATCH_STEP,
    label: "Item matches",
    prompt: "✅ ከላይ ያሉት ግንኙነቶች ትክክል ናቸው?",
    type: "choice",
    choices: [
      { label: "✅ ትክክል ነው", value: GRV_MATCH_OK },
      { label: "✏️ ዝርዝሩን እንደገና", value: GRV_MATCH_REDO },
    ],
    when: (d) => hasGrvLines(d),
  },
  // Which machine or car each item was taken for — asked only for a line that
  // did not say so in its fourth column.
  ...Array.from({ length: MAX_GRV_LINES }, (_, i): AssetStep => ({
    id: sivMachineKey(i + 1),
    label: `Item ${i + 1} machine`,
    get prompt() {
      return `🚜 ዕቃ ${i + 1} — ለየትኛው ማሽን ወይም መኪና ነው የወጣው? ከታች ይምረጡ ወይም ስሙን ይፃፉ።`;
    },
    type: "choice",
    choicesFrom: (d) => decodeMachines(d).map((m) => ({ label: m, value: m })),
    freeText: true,
    when: (d) => {
      const line = grvLines(d)[i];
      return !!line && !line.machine;
    },
  })),
  { id: "approvedBy", prompt: "🧑 ያፀደቀው (Approved by) ማን ነው?", type: "text", skippable: true },
  { id: "receivedBy", prompt: "🧑 የተረከበው (Received by) ማን ነው?", type: "text", skippable: true },
  // No photo step, and none of the fields the pad has that nobody fills in.
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

/* ───────────────────── PP bag unit prices only (finance) ─────────────────── */

/**
 * The six PP bag prices, on their own — without re-filing the whole monthly
 * price list. One block, pre-filled with this month's prices (seeded into the
 * draft as `old:<kind>` when the flow opens); only the bag prices change on
 * save, and only the ones sent back with a figure.
 */
const PP_BAG_PRICE_STEPS: AssetStep[] = [
  {
    id: "paste",
    prompt:
      "🧺 የዚህ ወር የPP ከረጢት ዋጋዎች እነዚህ ናቸው። የተቀየረውን ያርሙ፣ ቅጂውን ይመልሱት።\n\n" +
      "<i>ዋጋውን በብር (ለአንድ ከረጢት) ከ = በኋላ ይፃፉ። ያልተቀየረውን እንዳለ ይተዉት።</i>",
    type: "paste",
  },
];

/** Draft key holding a bag kind's price before this update, for the card. */
export const oldBagPriceKey = (kind: string) => `old:${kind}`;

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

/* ──────────────────── Credit collection (finance) ────────────────────────── */

/**
 * Money collected against a credit sale, recorded where it was collected.
 *
 * The invoice is chosen, not guessed. A customer can be carrying three unpaid
 * sales, and applying a payment to the wrong one leaves two figures wrong — the
 * one that looks settled and the one that still looks overdue — with a receipt
 * that explains neither.
 *
 * The customer and invoice lists are seeded into the draft when the flow starts
 * (see credit-bot.ts), because what is outstanding is a question for the moment
 * the person opens the form, not for the moment the code was written.
 */
const CREDIT_PAYMENT_STEPS: AssetStep[] = [
  { id: "date", prompt: "📅 ገንዘቡ የገባበትን ቀን ይምረጡ።", type: "date" },
  {
    id: "customer",
    label: "Customer",
    prompt: "👤 ከየትኛው ደንበኛ ነው?",
    type: "choice",
    choicesFrom: customerChoices,
  },
  {
    id: "invoiceId",
    label: "Invoice",
    prompt: "🧾 ደንበኛው ከአንድ በላይ ያልተከፈለ ሽያጭ አለው። የትኛውን ነው የከፈሉት? <i>(ቀን · ቀሪ ብር)</i>",
    type: "choice",
    choicesFrom: invoiceChoices,
    // Asked only when there is a choice to make: one open sale IS the answer.
    when: (d) => invoicesFor(d).length > 1,
  },
  {
    id: "photos",
    prompt:
      "📷 የክፍያውን ደረሰኝ ፎቶ ይላኩ — እስከ " +
      `${MAX_FLOW_PHOTOS} ፎቶ። ከጨረሱ በኋላ "✅ ጨርሻለሁ" ይጫኑ።
` +
      "<i>መጠኑ ከደረሰኙ ተነቦ ይሞላል — እርስዎ ያረጋግጣሉ።</i>",
    type: "photos",
  },
  {
    id: "amount",
    label: "Amount",
    prompt: "💰 የተከፈለውን መጠን በብር ይፃፉ።",
    type: "number",
  },
  { id: "note", label: "Note", prompt: "🗒 ማስታወሻ ካለ ይፃፉ።", type: "text", skippable: true },
];

/* ─────────────────── Raw material on credit (finance) ────────────────────── */

/**
 * A load of raw material bought on credit, and the three people behind it.
 *
 * The quarry owner sells it, the sales agent brokers it, the driver brings it
 * (on the plate given). Two amounts are owed and paid separately: the raw
 * material's total price and the driver's fee. Whatever was paid on the spot
 * is asked here — a tick for each part, then how much — and what is left
 * stays on credit for the 💸 payment form.
 */
export const RM_PAID_NOW_STEP = "paidNow";
const paidNow = (d: Record<string, string | number>, part: "material" | "driver") => {
  const t = ticked(d, RM_PAID_NOW_STEP);
  return t.includes(part) && !t.includes("none");
};

const RM_CREDIT_PURCHASE_STEPS: AssetStep[] = [
  { id: "date", prompt: "📅 ጭነቱ የገባበትን ቀን ይምረጡ።", type: "date" },
  { id: "quarryOwner", label: "Quarry owner", prompt: "⛰ የቋራው ባለቤት (Quarry owner) ማን ነው?", type: "text" },
  { id: "salesAgent", label: "Sales agent", prompt: "🤝 የሽያጭ ወኪሉ (Sales agent) ማን ነው?", type: "text", skippable: true },
  { id: "driverName", label: "Driver", prompt: "🧑‍✈️ ሹፌሩ ማን ነው?", type: "text" },
  { id: "truckPlate", label: "Truck plate", prompt: "🚚 የመኪናውን ታርጋ ቁጥር ይፃፉ።", type: "text" },
  {
    id: "material",
    label: "Material",
    prompt: "🧱 የትኛው ጥሬ ዕቃ ነው?",
    type: "choice",
    choices: RAW_MATERIALS.map((m) => ({ label: m, value: m })),
  },
  { id: "tonnes", label: "Tonnes", prompt: "⚖️ ስንት ቶን ገባ?", type: "number" },
  { id: "materialTotal", label: "Raw material total", prompt: "💰 የጥሬ ዕቃው ጠቅላላ ዋጋ ስንት ብር ነው?", type: "number" },
  { id: "driverFee", label: "Driver's fee", prompt: "🧑‍✈️ የሹፌሩ ክፍያ ስንት ብር ነው? (የለም ከሆነ 0)", type: "number" },
  {
    id: RM_PAID_NOW_STEP,
    label: "Paid now",
    prompt: "💵 አሁን የተከፈለው የትኛው ነው? ይንኩ፣ ከዚያ ✅ ጨርሻለሁ ይጫኑ።",
    type: "multichoice",
    choices: [
      { label: "🧱 ጥሬ ዕቃ (Raw material)", value: "material" },
      { label: "🧑‍✈️ የሹፌር ክፍያ (Driver's fee)", value: "driver" },
      { label: "⏳ ምንም አልተከፈለም (Nothing yet)", value: "none" },
    ],
  },
  {
    id: "paidMaterial",
    label: "Paid on raw material",
    prompt: "🧱 ለጥሬ ዕቃው ስንት ብር ተከፈለ?",
    type: "number",
    when: (d) => paidNow(d, "material"),
  },
  {
    id: "paidDriver",
    label: "Paid to driver",
    prompt: "🧑‍✈️ ለሹፌሩ ስንት ብር ተከፈለ?",
    type: "number",
    when: (d) => paidNow(d, "driver"),
  },
  { id: "note", label: "Note", prompt: "🗒 ማስታወሻ ካለ ይፃፉ።", type: "text", skippable: true },
];

/**
 * Money paid later. Everything still unpaid pops up as one list — each load's
 * raw material and its driver's fee as separate buttons — and the amount may
 * be part of what is left.
 */
const RM_CREDIT_PAYMENT_STEPS: AssetStep[] = [
  { id: "date", prompt: "📅 የተከፈለበትን ቀን ይምረጡ።", type: "date" },
  {
    id: "owed",
    label: "Unpaid",
    prompt: "📋 ያልተከፈሉ — የትኛው ነው የተከፈለው? <i>(ቀን · ለማን · ታርጋ · ዓይነት · ቀሪ ብር)</i>",
    type: "choice",
    choicesFrom: owedChoices,
  },
  { id: "amount", label: "Amount", prompt: "💰 ስንት ብር ተከፈለ? (ከፊል ክፍያ ሊሆን ይችላል)", type: "number" },
  { id: "note", label: "Note", prompt: "🗒 ማስታወሻ ካለ ይፃፉ።", type: "text", skippable: true },
];

/* ──────────────────────── An item bought (finance) ───────────────────────── */

/**
 * One item finance bought. The name is matched to the store list as soon as it
 * is typed: an item that IS on the list is linked without a question; one that
 * is not gets the nearest names as buttons, and 🆕 for a new item. Then how
 * many, in pcs or pak (or the item's own unit), and the price — the price of
 * one when bought by the piece, the total paid otherwise (purchase-price.ts).
 *
 * A record only: the GRV moves the store balance when the goods arrive.
 */
export const PURCHASE_ITEM_STEP = "item";
export const PURCHASE_MATCH_STEP = "itemMatch";
export const PURCHASE_NEW = "new";
const PURCHASE_CAND_MAX = 5;
const purchaseCandKey = (n: number) => `cand:${n}`;

/** The store item the purchase is linked to, or null for a new one. */
export function purchaseItemKey(d: Record<string, string | number>): string | null {
  const picked = String(d[PURCHASE_MATCH_STEP] || "");
  const key = String(d.itemKey || "") || (picked && picked !== PURCHASE_NEW ? picked : "");
  return key && STORE_ITEM_BY_KEY.has(key) ? key : null;
}

/**
 * Match the typed name to the store list, into the draft. Returns the item when
 * it is an exact match (no question needed); otherwise leaves the nearest names
 * for the match step to offer. Re-run whenever the name is typed again.
 */
export function applyPurchaseItemMatch(d: Record<string, string | number>): StoreItem | null {
  delete d.itemKey;
  delete d[PURCHASE_MATCH_STEP];
  for (let n = 1; n <= PURCHASE_CAND_MAX; n++) delete d[purchaseCandKey(n)];
  const { exact, similar } = suggestStoreItems(String(d[PURCHASE_ITEM_STEP] || ""), PURCHASE_CAND_MAX);
  if (exact) {
    d.itemKey = exact.key;
    return exact;
  }
  similar.forEach((it, i) => (d[purchaseCandKey(i + 1)] = it.key));
  return null;
}

function purchaseMatchChoices(d: Record<string, string | number>): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  for (let n = 1; n <= PURCHASE_CAND_MAX; n++) {
    const item = STORE_ITEM_BY_KEY.get(String(d[purchaseCandKey(n)] || ""));
    if (item) out.push({ label: `${n}. ${itemLabel(item)}`.slice(0, 60), value: item.key });
  }
  out.push({ label: "🆕 አዲስ ዕቃ (new)", value: PURCHASE_NEW });
  return out;
}

/** pcs and pak, with the linked item's own unit first when it is something else. */
function purchaseUnitChoices(d: Record<string, string | number>): { label: string; value: string }[] {
  const key = purchaseItemKey(d);
  const own = key ? STORE_ITEM_BY_KEY.get(key)?.unit : undefined;
  const units = own ? [own, ...["pcs", "pak"].filter((u) => u !== own)] : ["pcs", "pak"];
  return units.map((u) => ({ label: u, value: u }));
}

const ITEM_PURCHASE_STEPS: AssetStep[] = [
  { id: "date", prompt: "📅 ዕቃው የተገዛበትን ቀን ይምረጡ።", type: "date" },
  { id: PURCHASE_ITEM_STEP, label: "Item", prompt: "🛍 የተገዛውን ዕቃ ስም ይፃፉ።", type: "text" },
  {
    id: PURCHASE_MATCH_STEP,
    label: "Store item",
    prompt: "🔎 ይህ ዕቃ በመጋዘን ዝርዝር ውስጥ በትክክል አልተገኘም። ከእነዚህ አንዱ ነው ወይስ አዲስ ዕቃ?",
    type: "choice",
    choicesFrom: purchaseMatchChoices,
    when: (d) => !d.itemKey,
  },
  { id: "qty", label: "Quantity", prompt: "🔢 ስንት ተገዛ? (ብዛቱን ብቻ ይፃፉ)", type: "number" },
  { id: "unit", label: "Unit", prompt: "📦 በምን ተገዛ — pcs ወይስ pak?", type: "choice", choicesFrom: purchaseUnitChoices },
  {
    id: "unitPrice",
    label: "Unit price",
    prompt: "💲 የአንዱ ዋጋ ስንት ብር ነው?",
    type: "number",
    when: (d) => priceBasisFor(d.unit) === "unit",
  },
  {
    id: "total",
    label: "Total",
    prompt: "💰 በአጠቃላይ ስንት ብር ተከፈለ?",
    type: "number",
    when: (d) => priceBasisFor(d.unit) === "total",
  },
  { id: "note", label: "Note", prompt: "🗒 ማስታወሻ ካለ ይፃፉ (አቅራቢ፣ ደረሰኝ ቁጥር…)።", type: "text", skippable: true },
];

/* ───────────────────── Downtime, monthly (production) ────────────────────── */

/**
 * The month's Production Hours Report, off the plant's own sheet —
 * photographed once a month.
 *
 * One row per production line: working, power interruption, mechanical and
 * electrical maintenance, raw-material shortage and the total, each in hours
 * and days (see downtime-sheet.ts). The model reads the photo into a block,
 * the person checks it and sends it back, and what is saved is the block as
 * sent back, never the read.
 *
 * Re-filing a month replaces that month's rows, so a correction is a second
 * filing rather than a hunt for the wrong row.
 */
export const DOWNTIME_ROWS_STEP = "rows";

const DOWNTIME_STEPS: AssetStep[] = [
  { id: "month", label: "Month", prompt: "📅 የየትኛው ወር የምርት መቋረጥ ሉህ ነው?", type: "month" },
  {
    id: "photos",
    prompt:
      `📷 የወሩን Production Hours Report ፎቶ ይላኩ — እስከ ${MAX_FLOW_PHOTOS} ፎቶ። ከጨረሱ "✅ ጨርሻለሁ" ይጫኑ።\n` +
      "<i>ሉሁ ተነብቦ ይታያል — ትክክል ከሆነ ያረጋግጣሉ፣ ካልሆነ ያርማሉ።</i>",
    type: "photos",
    required: true,
  },
  // Only when the photo could NOT be read: then the lines are typed. A good
  // read goes straight to the review card, held cell by cell (ph:<line>:<kind>),
  // and is confirmed or corrected there — never copied, edited and pasted back.
  {
    id: DOWNTIME_ROWS_STEP,
    label: "Production hours",
    when: (d) => !hasHoursCells(d),
    prompt:
      "📋 ሉሁን ማንበብ አልተቻለም። እባክዎ ከታች ባለው ቅጂ ላይ ሞልተው ይላኩ።\n\n" +
      "<i>በአንድ መስመር አንድ የምርት መስመር፦ ሰዓት (ሰ:ደ) / ቀን</i>\n" +
      "<code>1 | 538:50 / 22.5 | 125:05 / 5.2 | 56:35 / 2.4 | 23:30 / 1 | - | 744 / 31</code>\n" +
      "<i>ዓምዶቹ፦ Line | Working | Power | Mechanical | Electrical | Raw material | Total። ባዶ ከሆነ \"-\"።</i>",
    type: "paste",
  },
];

/* ─────────────────── PP bags received (asset management) ─────────────────── */

/**
 * A delivery of PP bags, on its own form.
 *
 * Bags arriving used to be a side-question on the Goods Receiving Voucher — the
 * bot asked "which stock item is this?" only when a line happened to mention a
 * bag, and only then did the delivery reach the stock check. So whether the
 * month balanced depended on how somebody worded a description.
 *
 * Two questions: the day, and every bag kind. No supplier, no price. The monthly
 * report values bags from the price list, so a figure typed here could only be
 * a second number to disagree with it, and the delivery note is the record of
 * who supplied them.
 *
 * This is the RECEIVED side of the bag balance. The other three sides already
 * exist: the opening balance, the daily usage report (used), and the PP Bag
 * count block of the daily production report (counted on the floor).
 */
const PP_BAG_RECEIPT_STEPS: AssetStep[] = [
  { id: "date", prompt: "📅 ከረጢቶቹ የገቡበትን ቀን ይምረጡ።", type: "date" },
  {
    id: "paste",
    prompt:
      "🧺 የሚከተለውን ቅጂ ሞልተው ይመልሱት።\n\n" +
      "<i>የገባውን ብዛት (ቁጥር) ከ = በኋላ ይፃፉ። ለምሳሌ፦</i>\n" +
      "<code>25KG Yellow = 400</code>\n" +
      "<i>ያልገባውን ባዶ ይተዉት።</i>",
    type: "paste",
  },
];

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


/* ─────────────────────── One sale, receipt-first (sales) ─────────────────── */

/**
 * One transaction, in the columns of the sales sheet.
 *
 * Receipts first: the photographs are read and whatever the model could read
 * is already in the draft when the questions start. What it missed is asked
 * for as ONE fill-in block (the `paste` step, whose template lists only the
 * missing lines), and anything the block still leaves blank is asked one
 * question at a time. Every field then sits on the review card to be corrected.
 *
 * The per-field steps below are what make that work — they carry the label,
 * the validation and the choice list the editor and the paste parser share —
 * but the flow only walks them for what the receipts and the block left out.
 * The total tonnage is not a step: it is the sum of the brand lines.
 */
const SALES_INVOICE_STEPS: AssetStep[] = [
  { id: "date", prompt: "📅 የሽያጩን ቀን ይምረጡ።", type: "date" },
  {
    id: "photos",
    prompt:
      `🧾 የዚህን ሽያጭ ደረሰኞች ፎቶ ይላኩ — እስከ ${MAX_FLOW_PHOTOS} ፎቶ (የሽያጭ ደረሰኝ፣ የማድረሻ ወረቀት፣ የባንክ ደረሰኝ)።\n` +
      `<i>ፎቶዎቹ ተነብበው ቅጹ በራሱ ይሞላል — የቀረውን ብቻ ይጠየቃሉ።</i>\n` +
      `ከጨረሱ "✅ ጨርሻለሁ" ይጫኑ።`,
    type: "photos",
    // The receipts ARE the evidence behind every figure on this row. A sale
    // with no paper is not a sale this report can carry.
    required: true,
  },
  {
    id: "paste",
    prompt:
      "📋 ከደረሰኙ ያልተነበቡት መስኮች እነዚህ ናቸው። ቅጂውን ሞልተው ይመልሱት።\n" +
      "<i>ቁጥሩን ከ = በኋላ ይፃፉ። ያልተሸጠውን ብራንድ ባዶ ይተዉት (0 ይሆናል)።</i>",
    type: "paste",
  },
  { id: SALES_KEYS.customer, label: "Deliver to", prompt: "👤 ለማን እንደተሸጠ (Deliver to / የደንበኛ ስም) ይፃፉ።", type: "text" },
  {
    id: SALES_KEYS.invoiceCash,
    label: "Invoice cash",
    prompt: "💵 በጥሬ ገንዘብ የተቆረጠውን ደረሰኝ መጠን በብር ይፃፉ። ከሌለ 0።",
    type: "number",
  },
  {
    id: SALES_KEYS.invoiceCredit,
    label: "Invoice credit",
    prompt: "🧾 በብድር (credit) የተቆረጠውን ደረሰኝ መጠን በብር ይፃፉ። ከሌለ 0።",
    type: "number",
  },
  {
    id: SALES_KEYS.tin,
    label: "TIN",
    prompt: '🆔 የገዢውን TIN ቁጥር ይፃፉ (10 አሃዝ)። ደረሰኙ TIN ከሌለው "-" ይላኩ።',
    type: "text",
    // "-" is an answer here ("none"), not a skip: a skipped field reads as
    // unanswered and would be asked again after every paste.
    validate: normaliseTin,
  },
  ...DELIVERY_PRODUCTS.map<AssetStep>((code) => ({
    id: salesProductKey(code),
    label: productLabel(code),
    prompt: `⚖️ የ<b>${productLabel(code)}</b> የተሸጠ ብዛት በቶን ይፃፉ። ከሌለ 0 ይፃፉ።`,
    type: "number",
  })),
  {
    id: SALES_KEYS.bank,
    label: "Bank",
    // A sale can be paid into more than one bank, so this is a tick-list.
    prompt: "🏦 ገንዘቡ የገባበትን ባንክ/ባንኮች ይምረጡ፣ ከዚያ ✅ ጨርሻለሁ ይጫኑ።",
    type: "multichoice",
    choices: bankChoices(),
    columns: 3,
  },
  {
    id: SALES_KEYS.bankOther,
    label: "Bank (other)",
    prompt: "🏦 የባንኩን ስም ይፃፉ።",
    type: "text",
    when: (d) => salesBanksTicked(d).includes(BANK_OTHER),
  },
  // Several banks: what each one received, from its own slip. One bank needs no
  // question — it received the cash invoice.
  ...BANKS.map<AssetStep>((b) => ({
    id: salesBankAmountKey(b),
    label: `${b} amount`,
    prompt: `💵 ወደ <b>${b === BANK_OTHER ? "ሌላ ባንክ" : b}</b> የገባው ገንዘብ ስንት ብር ነው?`,
    type: "number",
    when: (d) => needsBankAmounts(d) && salesBanksTicked(d).includes(b),
  })),
];

const STEPS: Record<AssetFlowKind, AssetStep[]> = {
  raw_material: RAW_MATERIAL_STEPS,
  store_count: STORE_COUNT_STEPS,
  pp_bag_receipt: PP_BAG_RECEIPT_STEPS,
  downtime: DOWNTIME_STEPS,
  credit_payment: CREDIT_PAYMENT_STEPS,
  // Retired: per-bank cash now comes from the sales report itself. See RETIRED_FLOWS.
  bank_collection: [],
  // Retired: the 🚛 delivery report was abandoned in favour of the sales
  // report, which records the same sale with its receipts. The kind stays so
  // historic rows keep their name; see RETIRED_FLOWS.
  delivery: [],
  tool_request: TOOL_REQUEST_STEPS,
  pp_bag_damage: PP_BAG_DAMAGE_STEPS,
  production_daily: PRODUCTION_STEPS,
  base_balance: BASE_BALANCE_STEPS,
  store_issue: STORE_ISSUE_STEPS,
  grv: GRV_STEPS,
  pp_bag_used: PP_BAG_USED_STEPS,
  whiteness_check: WHITENESS_STEPS,
  price_list: PRICE_LIST_STEPS,
  pp_bag_price: PP_BAG_PRICE_STEPS,
  rm_credit_purchase: RM_CREDIT_PURCHASE_STEPS,
  rm_credit_payment: RM_CREDIT_PAYMENT_STEPS,
  item_purchase: ITEM_PURCHASE_STEPS,
  wht_holder: WHT_HOLDER_STEPS,
  sales_invoice: SALES_INVOICE_STEPS,
};


/**
 * The template text for a paste step.
 *
 * The sales block depends on the draft: it lists only what the receipts did
 * not answer, so the same flow sends a two-line block after a good read and the
 * whole sheet after a failed one.
 */
export function pasteTemplate(
  kind: AssetFlowKind,
  draft: Record<string, string | number> = {},
  step = ""
): string {
  if (kind === "production_daily") return productionTemplate();
  if (kind === "base_balance") return baseBalanceTemplate();
  if (kind === "price_list") return priceListTemplate();
  if (kind === "pp_bag_price") {
    const prices: Record<string, number> = {};
    for (const k of BAG_KIND_KEYS) {
      const v = Number(draft[oldBagPriceKey(k)]) || 0;
      if (v > 0) prices[k] = v;
    }
    return ppBagPriceTemplate(prices);
  }
  if (kind === "sales_invoice") return salesTemplate(draft);
  if (kind === "raw_material") return rawMaterialTemplate();
  if (kind === "pp_bag_receipt") return ppBagTemplate();
  if (kind === "downtime") {
    // What the sheet read, ready to be checked — or just the header to type under.
    const read = String(draft.readRows || draft[DOWNTIME_ROWS_STEP] || "");
    return read || hoursBlock([]);
  }
  // The store count is the one flow with several paste steps, so its template
  // depends on WHICH block is being asked for, not just the flow.
  // The typed GRV: a header to write under; the examples are in the prompt, so
  // nothing copied back by accident becomes an item.
  if (kind === "grv" && step === GRV_LINES_STEP) return "Name | Reference no. | Qty | Unit price";
  if (kind === "store_issue" && step === GRV_LINES_STEP) {
    return sivTemplate(Number(draft[SIV_COUNT_STEP]) || 1, grvLines(draft).length);
  }
  if ((kind === "grv" || kind === "store_issue") && step === STORE_QTY_STEP) {
    return storeVoucherTemplate(draft, kind === "grv");
  }
  if (kind === "store_count") {
    const group = storeGroupOfStep(step);
    return group ? storeGroupTemplate(group) : "";
  }
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
  // A Production Hours cell: "ph:1:working" → "Line 1 · Working (h / days)".
  const hoursCell = cellKeyLabel(key);
  if (hoursCell) return hoursCell;

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
  if (key.startsWith(BAG_PREFIX)) return `ከረጢት · ${bag(key.slice(BAG_PREFIX.length))}`;

  // A warehouse-list line on a voucher: "sq:brg:6210" → "BEARING 6210 · Qty".
  const store = key.match(/^(sq|sc):(.+)$/);
  if (store) {
    const item = STORE_ITEM_BY_KEY.get(store[2]);
    if (item) return `${itemLabel(item)} · ${store[1] === "sq" ? "Qty" : "Unit Cost"}`;
  }

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
      more: "ሌላ ዕቃ?",
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

/**
 * The step with this id — for THIS draft, when two branches share one.
 *
 * The purchase request asks "title" and "quantity" on both of its branches with
 * different wording, because the answers land in the same column either way.
 * Given the draft, the step whose `when` holds is the one being asked; without
 * it (the editor's label lookup), the first declared stands in.
 */
export function findStep(kind: AssetFlowKind, id: string, draft?: Record<string, string | number>): AssetStep | undefined {
  const matches = STEPS[kind].filter((s) => s.id === id);
  if (draft) return matches.find((s) => !s.when || s.when(draft)) ?? matches[0];
  return matches[0];
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

/* ──────────────────────────────── Previews ────────────────────────────────── */

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const money = (n: number) => Math.round(n).toLocaleString("en-US");
const qty = (n: number) => (Math.round(n * 1000) / 1000).toLocaleString("en-US");

export function assetPreview(state: AssetFlowState): string {
  const d = state.draft;
  const head = `<b>${FLOW_TITLE[state.kind]}</b>\n`;

  if (state.kind === "raw_material") {
    // Three blocks, each totalled. Stock is deliberately NOT totalled against
    // the other two on the card: it is a level counted on the ground, and the
    // only comparison worth making (opening + received − issued against it) is
    // the stock check on the dashboard, which knows the opening balance.
    const block = (label: string, section: "received" | "issued" | "stock") => {
      const map = sectionMap(d, section);
      const lines = FINANCE_RAW_MATERIALS.map((m) => `  • ${m}: ${qty(map[m])}`).join("\n");
      const total = FINANCE_RAW_MATERIALS.reduce((a, m) => a + map[m], 0);
      return `${label}\n${lines}\n  <b>ድምር: ${qty(total)}</b>\n`;
    };
    return (
      head +
      `📅 Date: ${esc(d.date)}\n\n` +
      block("📥 <b>ገቢ (Received, ቶን)</b>", "received") +
      "\n" +
      block("🏭 <b>ወጪ / ለምርት (Issue, ቶን)</b>", "issued") +
      "\n" +
      block("📦 <b>ክምችት (Stock, ቶን)</b>", "stock")
    );
  }

  if (state.kind === "credit_payment") {
    const inv = chosenInvoice(d);
    const paid = Number(d.amount) || 0;
    const left = inv ? Math.round((inv.outstanding - paid) * 100) / 100 : 0;
    const ex = state.extraction;
    const read = new Set(ex?.filled || []);
    return (
      head +
      `📅 Date: ${esc(d.date)}\n` +
      `👤 ደንበኛ: <b>${esc(chosenCustomerName(d))}</b>\n` +
      (inv ? `🧾 ሽያጭ: ${esc(inv.date)} · ዕዳ <b>${money(inv.outstanding)}</b>\n` : "") +
      `💰 የተከፈለ: <b>${money(paid)}</b>${read.has("amount") ? " 🤖" : ""}\n` +
      (inv
        ? left <= 0
          ? "✅ ይህ ሽያጭ ሙሉ በሙሉ ተከፍሏል።\n"
          : `⏳ ከክፍያ በኋላ የሚቀር: <b>${money(left)}</b>\n`
        : "") +
      `📷 ፎቶ: <b>${state.photoFileIds?.length || 0}</b>\n` +
      `🗒 ማስታወሻ: ${esc(d.note) || "—"}\n` +
      (read.has("amount") ? "<i>🤖 ምልክት ያለው ከደረሰኙ የተነበበ ነው። ስህተት ካለ ያስተካክሉ።</i>\n" : "")
    );
  }

  if (state.kind === "downtime") {
    const month = String(d.month || "");
    // The read (or a typed block converted on arrival) lives cell by cell; a
    // draft from before that still has its block.
    const fromCells = hasHoursCells(d) ? rowsFromDraft(d) : null;
    const sheet = fromCells
      ? { rows: fromCells.rows, bad: fromCells.bad, warnings: hoursWarnings(fromCells.rows, month) }
      : parseHoursBlock(String(d[DOWNTIME_ROWS_STEP] || ""), month);
    // One short block per line: phones cannot show the sheet's 13 columns.
    const lines = sheet.rows
      .map((r) => {
        const total = r.cells.total.minutes;
        const pct = (m: number) => (total ? ` (${Math.round((m / total) * 1000) / 10}%)` : "");
        return (
          `🏭 <b>Line ${r.line}</b>\n` +
          HOURS_KINDS.filter((k) => k !== "total")
            .map((k) => `  ${HOURS_LABEL[k]}: <b>${fmtHours(r.cells[k].minutes)}</b> h · ${r.cells[k].days} d${pct(r.cells[k].minutes)}`)
            .join("\n") +
          `\n  ⏹ Lost: <b>${fmtHours(lostMinutes(r))}</b> h · Total: ${fmtHours(total)} h / ${r.cells.total.days} d`
        );
      })
      .join("\n\n");
    const ex = state.extraction;
    return (
      head +
      `📅 ወር: <b>${esc(month)}</b>\n\n` +
      (lines || "—") +
      "\n\n" +
      (sheet.warnings.length ? `⚠️ <i>${sheet.warnings.map(esc).join("\n")}</i>\n` : "") +
      `📷 ፎቶ: <b>${state.photoFileIds?.length || 0}</b>\n` +
      (ex?.checked ? `<i>🤖 ከሉሁ የተነበበ (እርግጠኝነት ${ex.confidence}%)። ስህተት ካለ ቅጂውን አርመው ይላኩ።</i>\n` : "")
    );
  }

  if (state.kind === "pp_bag_receipt") {
    const lines = BAG_KINDS.map(({ size, colour }) => {
      const v = d[ppBagKey(size, colour)];
      // A kind with no figure is shown as a dash, not as 0: none of that colour
      // arrived, which is different from a delivery of none.
      return `  • ${bagLabel(size, colour)}: ${v === undefined || v === "" ? "—" : qty(Number(v))}`;
    }).join("\n");
    return (
      head +
      `📅 Date: ${esc(d.date)}\n\n` +
      `🧺 <b>የገቡ ከረጢቶች (ቁጥር)</b>\n${lines}\n` +
      `  ─────────\n  <b>ጠቅላላ: ${qty(ppBagTotal(d))}</b>\n`
    );
  }

  if (state.kind === "store_count") {
    // What was counted, block by block. A block with nothing in it is named as
    // NOT COUNTED rather than left off the card: "I did not get to the
    // electrics" and "the electrics are all at zero" are different reports, and
    // this is the last chance to notice which one is about to be filed.
    const counted = (i: { key: string }) => {
      const v = d[itemKey(i.key)];
      return v !== undefined && v !== "";
    };
    const lines = STORE_BLOCKS.map((b) => {
      const items = itemsOfBlock(b.key);
      const filed = items.filter(counted);
      return filed.length === 0
        ? `${b.icon} ${b.label}: <i>አልተቆጠረም</i>`
        : `${b.icon} ${b.label}: <b>${filed.length}</b>/${items.length} ዕቃ ተቆጥሯል`;
    }).join("\n");
    return (
      head +
      `📅 Date: ${esc(d.date)}\n\n${lines}\n\n` +
      `🔢 ጠቅላላ: <b>${allStoreItems().filter(counted).length}</b> ዕቃ\n` +
      "<i>ያልተቆጠሩት ዕቃዎች የቀድሞ ቁጥራቸውን ይይዛሉ።</i>\n"
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

  if (state.kind === "sales_invoice") {
    const ex = state.extraction;
    const read = new Set(ex?.filled || []);
    // Figures the model supplied carry a marker, as on the voucher card: a
    // number nobody typed has to be visibly different from one somebody did.
    const mark = (key: string) => (read.has(key) ? " 🤖" : "");

    const brands = DELIVERY_PRODUCTS.filter((c) => Number(d[salesProductKey(c)]) > 0)
      .map((c) => `  • ${productLabel(c)}: ${qty(Number(d[salesProductKey(c)]))}${mark(salesProductKey(c))}`)
      .join("\n");
    const cash = Number(d[SALES_KEYS.invoiceCash]) || 0;
    const credit = Number(d[SALES_KEYS.invoiceCredit]) || 0;
    const banks = salesBanks(d);
    const bankSum = banks.reduce((a, b) => a + b.amount, 0);
    const bankLines =
      banks.length <= 1
        ? `🏦 Bank: <b>${esc(salesBank(d) || "—")}</b>${mark(SALES_KEYS.bank)}\n\n`
        : `🏦 <b>Banks</b>${mark(SALES_KEYS.bank)}\n` +
          banks.map((b) => `  • ${esc(b.bank)}: ${money(b.amount)} ETB`).join("\n") +
          "\n" +
          // Said, not refused: a deposit can legitimately include an earlier
          // balance, but a typo usually shows up exactly here.
          (Math.abs(bankSum - cash) > 0.5
            ? `  ⚠️ <i>የባንኮቹ ድምር ${money(bankSum)} ETB — ከጥሬ ገንዘቡ (${money(cash)}) ጋር አይመሳሰልም።</i>\n`
            : "") +
          "\n";

    return (
      head +
      `📅 Date: ${esc(d.date)}\n` +
      `👤 Deliver to: <b>${esc(d[SALES_KEYS.customer]) || "—"}</b>${mark(SALES_KEYS.customer)}\n` +
      `💵 Invoice in cash: ${money(cash)} ETB${mark(SALES_KEYS.invoiceCash)}\n` +
      `🧾 Invoice in credit: ${money(credit)} ETB${mark(SALES_KEYS.invoiceCredit)}\n` +
      `  <b>ጠቅላላ: ${money(cash + credit)} ETB</b>\n` +
      `🆔 TIN: <b>${esc(salesTin(d) || "—")}</b>${mark(SALES_KEYS.tin)}\n` +
      bankLines +
      `⚖️ <b>ብዛት (ቶን)</b>\n${brands || "  —"}\n` +
      `  ─────────\n  <b>Invoice qty: ${qty(salesQty(d))}</b>\n` +
      (ex?.checked
        ? `\n<i>🤖 ምልክት ያለው ከደረሰኙ የተነበበ ነው (እርግጠኝነት ${ex.confidence}%)። ስህተት ካለ ያስተካክሉ።</i>\n`
        : "") +
      (ex && !ex.checked ? "\n<i>ደረሰኙን ማንበብ አልተቻለም — ሁሉንም በእጅ አስገብተዋል።</i>\n" : "")
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

    /* EVERY ANSWERED FIELD IS PRINTED. The card used to show six of them and
       save twenty, so "approve" was given over data nobody had been shown —
       which is the one thing a confirmation card exists to prevent. A field
       with no value is left off rather than printed as a dash: a column of
       em-dashes is what made the card unreadable enough to trim in the first
       place. */
    const line = (icon: string, label: string, value: unknown) => {
      const text = esc(value as string);
      return text ? `${icon} ${label}: <b>${text}</b>` : "";
    };

    const items = voucherItems(d).map((it, i) => {
      const cost = it.unitCost
        ? ` × ${money(it.unitCost)} = <b>${money(it.totalAmount ?? 0)}</b>`
        : "";
      const ledger = it.ledgerKey && it.ledgerKind !== "store"
        ?`\n     └ 📦 ${ledgerLabel(it.ledgerKind, it.ledgerKey)}: <b>${qty(it.ledgerQty)}</b> ${
            it.ledgerKind === "bag" ? "ከረጢት" : "ቶን"
          }`
        : "";
      const code = it.machine ? ` · 🚜 ${esc(it.machine)}` : it.stockCode ? ` <i>[${esc(it.stockCode)}]</i>` : "";
      // The typed GRV: say which store item each line moves, or that it is new.
      const store =
        hasGrvLines(d)
          ? it.ledgerKey
            ? `\n     └ 📦 ${esc(STORE_ITEM_BY_KEY.get(it.ledgerKey)?.name ?? it.ledgerKey)}`
            : "\n     └ 🆕 አዲስ ዕቃ ሆኖ ይገባል"
          : "";
      return (
        `${i + 1}. ${esc(it.description)}${code} — <b>${qty(it.quantity)}</b> ${esc(it.unit) || "—"}${cost}` +
        ledger +
        store
      );
    });

    const head = isGrv
      ? [
          "📥 <b>የዕቃ ገቢ ቫውቸር (GRV)</b>",
          line("🔢", "No.", d.grvNo),
          line("📅", "ቀን", d.date),
          line("🏢", "አቅራቢ", d.supplier),
        ]
      : [
          "📤 <b>የመጋዘን ወጪ ቫውቸር (SIV)</b>",
          line("🔢", "No.", d.sivNo),
          line("📅", "ቀን", d.date),
          line("🏷", "ክፍል", d.departmentSection),
        ];

    const tail = isGrv
      ? [
          `💰 ጠቅላላ: <b>${money(voucherTotal(d))} ${esc(d.currency) || "ETB"}</b>`,
          line("🧑", "ያፀደቀው", d.approvedBy),
          line("🧑", "የተረከበው", d.receivedBy),
        ]
      : [
          // The SIV is valued from each item's known cost. A line with no known
          // cost yet is left out of the figure and counted, never guessed.
          sivValueLine(d),
          line("🧑", "ያፀደቀው", d.approvedBy),
          line("🧑", "የተረከበው", d.receivedBy),
        ];

    // Historic drafts may still carry the fields neither voucher asks for any
    // more. They are shown when present rather than dropped — a value that was
    // collected and is about to be saved has to be on the card.
    const legacy = [
      line("🏬", "መጋዘን", d.issuingStore),
      line("🧑", "ለ", d.issuedTo),
      line("📄", "Invoice No.", d.supplierInvoiceNo),
      line("📋", "P.O. No.", d.purchaseOrderNo),
      line("🏬", "Receiving Store", d.receivingStoreNo),
      line("📋", "Requisition No.", d.requisitionNo),
      line("📝", "አስተያየት", d.remarks),
      line("🧑", "ያዘጋጀው", d.preparedBy),
      line("🧑", "ያወጣው", d.issuedBy),
    ].filter(Boolean);

    // Lines with no confirmed stock item are named, not hidden. A voucher whose
    // bags were never classified simply does not move the stock balance, and the
    // reporter is the only person who can still fix that — after saving, nobody
    // is looking.
    // (On the typed GRV a line with no key is a NEW item, not an unclassified one.)
    const unclassified = isGrv && !hasGrvLines(d) ? voucherItems(d).filter((it) => !it.ledgerKey).length : 0;

    return [
      ...head,
      ...legacy,
      "",
      ...(items.length > 0 ? items : ["  —"]),
      "",
      ...tail,
      unclassified > 0
        ? `<i>ℹ️ ${unclassified} ዕቃ በክምችት ሒሳብ ውስጥ አልገባም (የክምችት ዕቃ አይደለም ተብሏል)።</i>`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (state.kind === "rm_credit_purchase") {
    const t = Number(d.tonnes) || 0;
    const total = Number(d.materialTotal) || 0;
    const fee = Number(d.driverFee) || 0;
    const paidM = paidNow(d, "material") ? Number(d.paidMaterial) || 0 : 0;
    const paidD = paidNow(d, "driver") ? Number(d.paidDriver) || 0 : 0;
    return (
      head +
      `📅 Date: ${esc(d.date)}\n` +
      `⛰ የቋራ ባለቤት: <b>${esc(d.quarryOwner)}</b>\n` +
      `🤝 የሽያጭ ወኪል: ${esc(d.salesAgent) || "—"}\n` +
      `🧑‍✈️ ሹፌር: <b>${esc(d.driverName)}</b> · 🚚 ${esc(d.truckPlate) || "—"}\n` +
      `🧱 ${esc(d.material)}: <b>${qty(t)} t</b>${t > 0 ? ` <i>(${money(total / t)} ብር/t)</i>` : ""}\n` +
      `💰 ጥሬ ዕቃ: <b>${money(total)}</b> · ተከፈለ ${money(paidM)} · ቀሪ <b>${money(total - paidM)}</b> ብር\n` +
      `🧑‍✈️ ሹፌር: <b>${money(fee)}</b> · ተከፈለ ${money(paidD)} · ቀሪ <b>${money(fee - paidD)}</b> ብር\n` +
      `💳 በብድር የሚቀር: <b>${money(total - paidM + fee - paidD)} ብር</b>\n` +
      `🗒 ማስታወሻ: ${esc(d.note) || "—"}\n`
    );
  }

  if (state.kind === "item_purchase") {
    const key = purchaseItemKey(d);
    const item = key ? STORE_ITEM_BY_KEY.get(key) : undefined;
    const q = Number(d.qty) || 0;
    const basis = priceBasisFor(d.unit);
    const { unitPrice, total } = purchaseAmounts(q, basis, Number(basis === "unit" ? d.unitPrice : d.total) || 0);
    return (
      head +
      `📅 Date: ${esc(d.date)}\n` +
      `🛍 ዕቃ: <b>${esc(d[PURCHASE_ITEM_STEP])}</b>\n` +
      `🔗 መጋዘን: ${item ? esc(itemLabel(item)) : "🆕 አዲስ ዕቃ (new)"}\n` +
      `🔢 ብዛት: <b>${qty(q)} ${esc(d.unit)}</b>\n` +
      `💲 የአንዱ ዋጋ: ${money(unitPrice)} ብር${basis === "total" ? " <i>(ከድምሩ የተሰላ)</i>" : ""}\n` +
      `💰 ድምር: <b>${money(total)} ብር</b>${basis === "unit" ? " <i>(ብዛት × ዋጋ)</i>" : ""}\n` +
      `🗒 ማስታወሻ: ${esc(d.note) || "—"}\n`
    );
  }

  if (state.kind === "rm_credit_payment") {
    const owed = chosenOwed(d);
    const paid = Number(d.amount) || 0;
    const left = owed ? Math.round((owed.left - paid) * 100) / 100 : 0;
    const who = owed ? (owed.part === "driver" ? owed.load.driverName || "ሹፌር" : owed.load.owner || owed.load.supplier) : "";
    return (
      head +
      `📅 Date: ${esc(d.date)}\n` +
      (owed
        ? `🚚 ጭነት: ${esc(owed.load.date)} · ${esc(owed.load.truckPlate || "—")} · ${esc(owed.load.material)} ${qty(owed.load.tonnes)} t\n` +
          `👤 ${PART_LABEL[owed.part]}: <b>${esc(who)}</b> · ዕዳ <b>${money(owed.left)}</b>\n`
        : "") +
      `💰 የተከፈለ: <b>${money(paid)}</b>\n` +
      (owed ? (left <= 1 ? "✅ ይህ ሙሉ በሙሉ ይከፈላል።\n" : `⏳ ከክፍያ በኋላ የሚቀር: <b>${money(left)}</b>\n`) : "") +
      `🗒 ማስታወሻ: ${esc(d.note) || "—"}\n`
    );
  }

  if (state.kind === "pp_bag_price") {
    const rows = BAG_KINDS.map(({ size, colour }) => {
      const kind = `${size}:${colour}`;
      const before = Number(d[oldBagPriceKey(kind)]) || 0;
      const after = Number(d[bagFinanceKey(size, colour)]) || 0;
      const label = `${bagLabel(size, colour)} PP`;
      if (!after) return `${label}: ${before ? money(before) : "—"} <i>(አልተቀየረም)</i>`;
      if (after === before) return `${label}: <b>${money(after)}</b>`;
      return `${label}: ${before ? money(before) : "—"} → <b>${money(after)}</b>`;
    });
    return [`🧺 <b>የ${monthLabel()} PP ከረጢት ዋጋ</b> (ብር/ቁጥር)`, "", ...rows].join("\n");
  }

  if (state.kind === "price_list") {
    const rows = priceListItems().map(
      (it) => `${it.label}: <b>${money(Number(d[priceKey(it.key)]) || 0)}</b>`
    );
    return [
      `💲 <b>የ${monthLabel()} unit price ዝርዝር</b>`,
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

  // The purchase request: two cards, one per kind.
  const unitLabel = PURCHASE_UNITS.find((u) => u.value === d.unit)?.label.replace(/^\S+\s/, "") || "";
  const deptLabel = PURCHASE_DEPARTMENTS.find((x) => x.value === d.department)?.label || "—";
  let out = head;
  if (d.kind === "maintenance") {
    out +=
      `❓ ዓይነት: 🛠 የተበላሸ ዕቃ\n` +
      `🔧 ዕቃ: <b>${esc(d.title)}</b>\n` +
      `🔢 ብዛት: ${qty(Number(d.quantity) || 0)}\n` +
      `🏷 ክፍል: ${esc(deptLabel)}\n` +
      (state.photoFileId ? "📷 ፎቶ: ተያይዟል\n" : "📷 ፎቶ: የለም\n");
    const c = state.check;
    if (c) {
      out += c.checked
        ? `🤖 AI: ${c.plausible ? "ከጥያቄው ጋር ይስማማል" : "አጠራጣሪ"} · <b>${c.confidence}%</b>\n` +
          (c.observations ? `   <i>${esc(c.observations)}</i>\n` : "")
        : "🤖 AI: ማጣራት አልተቻለም — በእጅ ይጣራል\n";
    }
  } else {
    out +=
      `❓ ዓይነት: 🆕 አዲስ መሣሪያ\n` +
      `🔧 መሣሪያ: <b>${esc(d.title)}</b>\n` +
      `📝 መግለጫ: ${esc(d.description) || "—"}\n` +
      `🔢 ብዛት: ${qty(Number(d.quantity) || 0)} ${esc(unitLabel)}\n` +
      `❓ ምክንያት: ${esc(d.reason) || "—"}\n` +
      `🏷 ክፍል: ${esc(deptLabel)}\n`;
  }
  out += `🗒 ማስታወሻ: ${esc(d.notes) || "—"}\n`;
  return out;
}

/**
 * The month a base balance opens.
 *
 * The month the reporter picked, or — when the picker was never answered, which
 * is every draft filed before it existed — the month after the one it is filed
 * in, exactly as before.
 */
function nextMonthOf(draft: Record<string, string | number>): string {
  const picked = String(draft.month || "");
  return /^\d{4}-\d{2}$/.test(picked) ? picked : nextMonth(monthLabel());
}

export interface VoucherItem {
  stockCode: string | null;
  description: string;
  unit: string | null;
  quantity: number;
  unitCost: number | null;
  totalAmount: number | null;
  /**
   * Null unless a person confirmed which stock item this line is. "store" is a
   * warehouse-list line, keyed by the item's permanent store key.
   */
  ledgerKind: LedgerKind | "store" | null;
  ledgerKey: string | null;
  ledgerQty: number;
  /** SIV: the machine or car the item was taken for. */
  machine?: string | null;
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
  // The GRV's typed, AI-matched lines. A line still without a key is a new
  // item, given one when the voucher is saved (saveAssetFlow).
  if (hasGrvLines(draft)) {
    return grvLines(draft).map((l, i) => ({
      machine: l.machine || String(draft[sivMachineKey(i + 1)] || "") || null,
      stockCode: null,
      description: l.desc ? `${l.name} — ${l.desc}` : l.name,
      unit: l.match ? STORE_ITEM_BY_KEY.get(l.match)?.unit ?? l.unit : l.unit,
      quantity: l.qty,
      unitCost: l.cost,
      totalAmount: l.cost ? Math.round(l.cost * l.qty * 100) / 100 : null,
      ledgerKind: "store",
      ledgerKey: l.match,
      ledgerQty: l.qty,
    }));
  }
  // Warehouse-list lines first, in list order, then whatever was typed.
  const out: VoucherItem[] = storeLines(draft).map((l) => ({
    stockCode: null,
    description: itemLabel(l.item),
    unit: l.item.unit,
    quantity: l.quantity,
    unitCost: l.unitCost,
    totalAmount: l.unitCost ? Math.round(l.unitCost * l.quantity * 100) / 100 : null,
    ledgerKind: "store",
    ledgerKey: l.item.key,
    ledgerQty: l.quantity,
  }));
  // Typed lines only count while "📝 other" is ticked, so unticking it on the
  // edit card really does drop them. A draft from before the department step
  // existed has no answer there at all, and keeps the lines it was typed with.
  const typedAllowed = wantsOtherItems(draft) || draft[STORE_DEPTS_STEP] === undefined;
  for (let i = 1; typedAllowed && i <= MAX_VOUCHER_ITEMS; i++) {
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

/** "💰 ዋጋ: 12,000 ETB (2 ዕቃ ዋጋ የለውም)", or "" when nothing on the voucher has a cost. */
function sivValueLine(draft: Record<string, string | number>): string {
  const items = voucherItems(draft);
  const unpriced = items.filter((it) => !it.totalAmount).length;
  if (unpriced === items.length) return "";
  return (
    `💰 ዋጋ: <b>${money(voucherTotal(draft))} ETB</b>` +
    (unpriced > 0 ? ` <i>(${unpriced} ዕቃ ዋጋ የለውም)</i>` : "")
  );
}

/**
 * The voucher's total: the sum of its line totals. Never typed — the GRV used
 * to ask for it, and a typed total is a figure that can disagree with the very
 * lines it claims to add up.
 */
export function voucherTotal(draft: Record<string, string | number>): number {
  const sum = voucherItems(draft).reduce((a, it) => a + (it.totalAmount ?? 0), 0);
  return Math.round(sum * 100) / 100;
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
    // Upserted on the day, like the ops report: filing the same day twice is a
    // correction, not a second reading. All three blocks are replaced together
    // — they were answered together, and merging them per material would leave
    // yesterday's stock standing beside today's received.
    const date = reportDate(d.date);
    const [row] = await sql<{ id: string }[]>`
      insert into raw_material_daily (date, date_label, received, issued, stock, reported_by, source)
      values (${date}, ${eatDateLabel(date)},
              ${sql.json(sectionMap(d, "received"))},
              ${sql.json(sectionMap(d, "issued"))},
              ${sql.json(sectionMap(d, "stock"))},
              ${reportedBy}, 'telegram')
      on conflict (date_label) do update set
        received = excluded.received,
        issued = excluded.issued,
        stock = excluded.stock,
        reported_by = excluded.reported_by,
        updated_at = now()
      returning id`;
    return { id: row.id, table: "raw_material_daily" };
  }

  if (state.kind === "rm_credit_purchase") {
    const date = reportDate(d.date);
    const tonnes = Number(d.tonnes) || 0;
    const total = Math.round((Number(d.materialTotal) || 0) * 100) / 100;
    const fee = Math.round((Number(d.driverFee) || 0) * 100) / 100;
    if (!(tonnes > 0)) throw new Error("A load has to be more than zero tonnes.");
    const material = String(d.material || "");
    if (!(RAW_MATERIALS as readonly string[]).includes(material)) throw new Error("Pick the raw material from the list.");
    const owner = String(d.quarryOwner || "").trim();
    if (!owner) throw new Error("Name the quarry owner.");
    const paidM = paidNow(d, "material") ? Math.round((Number(d.paidMaterial) || 0) * 100) / 100 : 0;
    const paidD = paidNow(d, "driver") ? Math.round((Number(d.paidDriver) || 0) * 100) / 100 : 0;
    if (paidM > total + 1) throw new Error(`More was paid on the raw material than it costs (${money(total)} ETB).`);
    if (paidD > fee + 1) throw new Error(`More was paid to the driver than the fee (${money(fee)} ETB).`);
    const paidOn = eatDateLabel(date);
    // The load and what was paid on the spot, together or not at all.
    const id = await sql.begin(async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        insert into raw_material_credits
          (date, date_label, supplier, quarry_owner, sales_agent, driver_name, truck_plate, material, tonnes,
           price_per_tonne, amount, driver_fee, note, reported_by, source)
        values (${date}, ${paidOn}, ${owner}, ${owner}, ${String(d.salesAgent || "").trim() || null},
                ${String(d.driverName || "").trim() || null}, ${String(d.truckPlate || "").trim() || null},
                ${material}, ${tonnes}, ${Math.round((total / tonnes) * 100) / 100}, ${total}, ${fee},
                ${String(d.note || "") || null}, ${reportedBy}, 'telegram')
        returning id`;
      for (const [part, amount] of [["material", paidM], ["driver", paidD]] as const) {
        if (amount > 0) {
          await tx`
            insert into raw_material_credit_payments (credit_id, part, amount, paid_on, note, recorded_by)
            values (${row.id}::uuid, ${part}, ${amount}, ${paidOn}::date, ${"paid on loading"}, ${reportedBy})`;
        }
      }
      return row.id;
    });
    return { id, table: "raw_material_credits" };
  }

  if (state.kind === "item_purchase") {
    const key = purchaseItemKey(d);
    const basis = priceBasisFor(d.unit);
    const { id } = await savePurchase(
      {
        date: reportDate(d.date),
        itemName: String(d[PURCHASE_ITEM_STEP] || ""),
        itemKey: key,
        isNew: !key && d[PURCHASE_MATCH_STEP] === PURCHASE_NEW,
        qty: Number(d.qty) || 0,
        unit: String(d.unit || "pcs"),
        basis,
        figure: Number(basis === "unit" ? d.unitPrice : d.total) || 0,
        note: String(d.note || ""),
        source: "telegram",
      },
      reportedBy
    );
    return { id, table: "item_purchases" };
  }

  if (state.kind === "rm_credit_payment") {
    const owed = chosenOwed(d);
    const amount = Math.round((Number(d.amount) || 0) * 100) / 100;
    if (!owed) throw new Error("Nothing unpaid was chosen for this payment.");
    if (!(amount > 0)) throw new Error("A payment has to be more than zero.");
    // Read again HERE: somebody may have recorded a payment on the same load
    // while this one was being filled in.
    const outstanding = await loadRemaining(owed.load.id, owed.part);
    if (outstanding === null) throw new Error("That load no longer exists.");
    if (amount > outstanding + 1) {
      throw new Error(`That is more than is owed — ${money(outstanding)} ETB is outstanding on it.`);
    }
    const [row] = await sql<{ id: string }[]>`
      insert into raw_material_credit_payments (credit_id, part, amount, paid_on, note, recorded_by)
      values (${owed.load.id}::uuid, ${owed.part}, ${amount}, ${eatDateLabel(reportDate(d.date))}::date,
              ${String(d.note || "") || null}, ${reportedBy})
      returning id`;
    return { id: row.id, table: "raw_material_credit_payments" };
  }

  if (state.kind === "credit_payment") {
    // The chosen sale, or the customer's only open one.
    const invoiceId = chosenInvoice(d)?.id || "";
    const amount = Math.round((Number(d.amount) || 0) * 100) / 100;
    if (!invoiceId) throw new Error("No sale was chosen for this payment.");
    if (!(amount > 0)) throw new Error("A payment has to be more than zero.");

    // What is outstanding is read again HERE, not trusted from the draft: the
    // list was seeded when the flow opened, and somebody else may have recorded
    // a collection against the same sale while this one was being filled in.
    const [live] = await sql<{ credit: string; paid: string }[]>`
      select i.invoice_credit as credit,
             coalesce((select sum(p.amount) from sales_credit_payments p where p.invoice_id = i.id), 0) as paid
        from sales_invoices i where i.id = ${invoiceId}::uuid
    `;
    if (!live) throw new Error("That sale no longer exists.");
    const outstanding = Math.round(((Number(live.credit) || 0) - (Number(live.paid) || 0)) * 100) / 100;
    if (amount > outstanding + SETTLED_TOLERANCE_ETB) {
      // Named rather than clamped. Over-paying an invoice is either a typo or a
      // payment against a different sale, and both are things the person
      // holding the receipt can sort out in a second.
      throw new Error(
        `That is more than is owed on this sale — ${money(outstanding)} ETB is outstanding.`
      );
    }

    const [row] = await sql<{ id: string }[]>`
      insert into sales_credit_payments (invoice_id, amount, collected_on, note, recorded_by)
      values (${invoiceId}::uuid, ${amount}, ${eatDateLabel(reportDate(d.date))}::date,
              ${String(d.note || "") || null}, ${reportedBy})
      returning id`;
    return { id: row.id, table: "sales_credit_payments" };
  }

  if (state.kind === "downtime") {
    const month = String(d.month || "") || monthLabel();
    const sheet = hasHoursCells(d) ? rowsFromDraft(d) : parseHoursBlock(String(d[DOWNTIME_ROWS_STEP] || ""), month);
    if (sheet.bad.length > 0) throw new Error(`Some figures do not read — correct them first: ${sheet.bad[0]}`);
    if (sheet.rows.length === 0) throw new Error("No production line on the sheet.");
    const lostHours = Math.round((sheet.rows.reduce((a, r) => a + lostMinutes(r), 0) / 60) * 100) / 100;

    // One transaction: the month's lines are replaced and the filing is
    // recorded together, or not at all. A month is the unit — re-filing it is
    // how a mistake is corrected, so its old rows must not survive beside the
    // new ones. `downtime_months` stays the "filed" marker the reminder reads;
    // its stoppages column now counts the lines, total_hours the hours lost.
    const id = await sql.begin(async (tx) => {
      await tx`delete from production_hours where month = ${month}`;
      for (const r of sheet.rows) {
        const c = r.cells;
        await tx`
          insert into production_hours (
            month, line,
            working_minutes, working_days, power_minutes, power_days, mech_minutes, mech_days,
            elec_minutes, elec_days, raw_minutes, raw_days, total_minutes, total_days,
            reported_by, source)
          values (
            ${month}, ${r.line},
            ${c.working.minutes}, ${c.working.days}, ${c.power.minutes}, ${c.power.days}, ${c.mech.minutes}, ${c.mech.days},
            ${c.elec.minutes}, ${c.elec.days}, ${c.raw.minutes}, ${c.raw.days}, ${c.total.minutes}, ${c.total.days},
            ${reportedBy}, 'telegram')`;
      }
      const [row] = await tx<{ id: string }[]>`
        insert into downtime_months (month, stoppages, total_hours, extraction, tg_file_ids, reported_by, source)
        values (${month}, ${sheet.rows.length}, ${lostHours},
                ${state.extraction ? tx.json({ ...state.extraction }) : null},
                ${state.photoFileIds || []}, ${reportedBy}, 'telegram')
        on conflict (month) do update set
          stoppages = excluded.stoppages,
          total_hours = excluded.total_hours,
          extraction = excluded.extraction,
          tg_file_ids = excluded.tg_file_ids,
          reported_by = excluded.reported_by,
          updated_at = now()
        returning id`;
      return row.id;
    });
    return { id, table: "downtime_months" };
  }

  if (state.kind === "pp_bag_receipt") {
    // `pp_bag_purchases` already means exactly this — bags bought and received,
    // per kind — and the monthly finance report already reads it as the bag
    // received column. It simply had no writer between the Goods Receiving
    // Voucher taking the job and this form taking it back.
    // `filed_by_dept` tells the two copies of one purchase apart: an 'asset'
    // row carries the counts by size and colour, a 'finance' row only the
    // receipt. This form is filed by the store, and the column defaults to
    // 'finance' — so it has to be said, or every delivery would be filed under
    // a department that did not file it.
    const [row] = await sql<{ id: string }[]>`
      insert into pp_bag_purchases (date, bags, reported_by, filed_by_dept, source)
      values (${reportDate(d.date)}, ${sql.json(bagsReceived(d))}, ${reportedBy}, 'asset', 'telegram')
      returning id`;
    return { id: row.id, table: "pp_bag_purchases" };
  }

  if (state.kind === "store_count") {
    // Only what was actually counted. An item with no figure is absent from the
    // row entirely, and a group with no figures at all is absent from `groups`
    // — which is what keeps "counted and found none" (a stored 0) apart from
    // "not counted this time" on the dashboard.
    const groups: string[] = [];
    const items: Record<string, number> = {};
    for (const g of STORE_GROUPS) {
      const groupItems = itemsOfGroup(g.key).filter((i) => {
        const v = d[itemKey(i.key)];
        return v !== undefined && v !== "";
      });
      if (groupItems.length === 0) continue;
      groups.push(g.key);
      for (const i of groupItems) items[i.key] = Number(d[itemKey(i.key)]) || 0;
    }

    const date = reportDate(d.date);
    const [row] = await sql<{ id: string }[]>`
      insert into store_counts (date, date_label, groups, items, counted_by, source)
      values (${date}, ${eatDateLabel(date)}, ${groups}, ${sql.json(items)}, ${reportedBy}, 'telegram')
      returning id`;
    return { id: row.id, table: "store_counts" };
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

  if (state.kind === "sales_invoice") {
    const date = reportDate(d.date);
    // One row PER SALE, appended — never upserted on the day. Several sales a
    // day is the whole point of going back to the transaction, and a correction
    // to one of them is made in Settings → Submissions, not by re-filing the day.
    //
    // The row keeps NO reference to its receipts — not a stored file, not a
    // Telegram id. They were read once, the figures on this card are the record,
    // and a receipt that resolves on the dashboard reads as a receipt filed on
    // the dashboard (the objection behind migration 0026).
    const row = await insertRow(
      "sales_invoices",
      {
        date,
        date_label: opsDateLabel(date),
        customer: String(d[SALES_KEYS.customer] || "").trim(),
        invoice_cash: Number(d[SALES_KEYS.invoiceCash]) || 0,
        invoice_credit: Number(d[SALES_KEYS.invoiceCredit]) || 0,
        qty: salesQty(d),
        // No longer asked; a draft from before the change may still carry one.
        delivery_no: String(d[SALES_KEYS.deliveryNo] || "").trim() || null,
        products: sql.json(jsonMap(d, SALES_PRODUCT_PREFIX, DELIVERY_PRODUCTS)),
        bank: salesBank(d),
        banks: sql.json(salesBanks(d)),
        tin: salesTin(d),
        extraction: state.extraction ? sql.json({ ...state.extraction }) : null,
        reported_by: reportedBy,
        source: "telegram",
      },
      { source: "asset-flows", optional: ["banks", "tin"] }
    );
    // The customer's other sales learn the TIN, and this one learns it from
    // them. Never fatal: the sale is already saved.
    await linkCustomerTin(row.id).catch((e) => console.error("TIN back-fill skipped:", e));
    return { id: row.id, table: "sales_invoices" };
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
    const date = reportDate(d.date);
    // Blank is NULL, never "": a number is only a reference (0041 — numbers
    // may repeat), and "" would read as a number that was given.
    const voucherNo = String((isGrv ? d.grvNo : d.sivNo) || "").trim() || null;
    // Both vouchers are typed now, so neither carries a photo or an extraction.
    // The columns stay and are still written: every voucher filed before the
    // change has them, the dashboard reads them, and a NULL here is the honest
    // record that this one was typed.
    const extraction = state.extraction ? sql.json({ ...state.extraction }) : null;
    const photos = state.photoFileIds || [];

    /*
     * ONE TRANSACTION: the new store items, the voucher and its lines are saved
     * together, or none of them is. It used to be three separate writes, and a
     * failure after the first left a voucher header behind — so every ✅ that
     * followed collided with its own leftover row, and the submission sat stuck
     * on the review card, never reaching the dashboard.
     *
     * The work is done on a COPY of the draft: if the transaction rolls back,
     * the keys of the items it was about to create must not survive in the
     * draft and be mistaken for real ones on the retry.
     */
    const work: Record<string, string | number> = { ...d };
    // An issue is valued at what each item cost ON the voucher's date, read
    // fresh here rather than trusted from the draft: the date can be corrected
    // on the review card after the costs were looked up. Read BEFORE the
    // transaction: a query on the shared pool from inside one waits for a
    // connection the transaction itself may be holding. Items created by this
    // voucher have no cost yet, so nothing is missed.
    const costs = isGrv
      ? new Map<string, ItemCost>()
      : await costsAt(
          date,
          voucherItems(work)
            .filter((it) => it.ledgerKind === "store" && it.ledgerKey)
            .map((it) => it.ledgerKey!)
        ).catch(() => new Map<string, ItemCost>());
    let registerNew = () => {};
    const header = await sql.begin(async (tx) => {
      // The typed voucher's new lines become store items FIRST, so every saved
      // line points at a key and moves a balance from this voucher on. On an
      // SIV such an item starts below zero — issued before it was ever counted
      // or received — which the inventory shows rather than hides.
      if (hasGrvLines(work)) {
        const lines = grvLines(work);
        const fresh = lines.filter((l) => !l.match);
        if (fresh.length > 0) {
          const created = await createCustomItems(
            fresh.map((l) => ({ name: l.name, description: l.desc, unit: l.unit, group: l.group })),
            voucherNo,
            reportedBy,
            tx
          );
          fresh.forEach((l, i) => {
            l.match = created.keys[i];
          });
          setGrvLines(work, lines);
          registerNew = created.register;
        }
      }
      let items = voucherItems(work);
      if (!isGrv) {
        items = items.map((it) => {
          if (it.ledgerKind !== "store") return it;
          const unitCost = costs.get(it.ledgerKey!)?.unitCost || it.unitCost || null;
          return { ...it, unitCost, totalAmount: unitCost ? Math.round(unitCost * it.quantity * 100) / 100 : null };
        });
      }
      const total = Math.round(items.reduce((a, it) => a + (it.totalAmount ?? 0), 0) * 100) / 100;

      // Both go through insertRow so that `tg_file_ids` (migration 0023)
      // missing costs the photo references rather than the whole voucher.
      const head = isGrv
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
            // The sum of the lines. A draft from before the total stopped being
            // asked still carries the typed figure, and keeps it.
            total_amount: total || Number(work.totalAmount) || null,
            remarks: String(d.remarks || "") || null,
            prepared_by: String(d.preparedBy || "") || null,
            received_by: String(d.receivedBy || "") || null,
            approved_by: String(d.approvedBy || "") || null,
            reported_by: reportedBy,
            tg_file_ids: photos,
            extraction,
            source: "telegram",
          },
          { optional: ["tg_file_ids"], source: "asset-flows", client: tx }
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
          { optional: ["tg_file_ids"], source: "asset-flows", client: tx }
        );

    if (items.length > 0) {
      const rows = items.map((it, i) => ({
        [isGrv ? "grv_id" : "siv_id"]: head.id,
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
        // The issue line's machine or car (0043). GRV lines have no such column.
        ...(isGrv ? {} : { machine: it.machine ?? null }),
      }));
      await tx`insert into ${tx(isGrv ? "goods_receiving_items" : "store_issue_items")} ${tx(rows)}`;
    }
      return head;
    });
    // Committed: the new items exist, so this instance may now show them, and
    // the draft may learn their keys.
    registerNew();
    setGrvLines(d, grvLines(work));

    // What the GRV paid becomes each item's cost from the voucher's date. Only
    // a price somebody TYPED: a pre-filled one is already on record, and
    // re-recording it would just restate the old price as news. A failure here
    // costs the price history, never the voucher that is already saved.
    if (isGrv) {
      const fromTicks = tickedStoreItems(d)
        .filter((item) => Number(d[storeCostKey(item.key)]) > 0)
        .map((item) => ({ itemKey: item.key, unitCost: Number(d[storeCostKey(item.key)]) }));
      // Every typed line with a price — new items get their first cost here.
      const fromLines = hasGrvLines(d)
        ? grvLines(d)
            .filter((l) => l.match && l.cost && l.cost > 0)
            .map((l) => ({ itemKey: l.match!, unitCost: l.cost! }))
        : [];
      const typed = [...fromTicks, ...fromLines].map((c) => ({
        ...c,
        effectiveFrom: date.toISOString().slice(0, 10),
        source: "grv" as const,
        ref: voucherNo,
        recordedBy: reportedBy,
      }));
      await recordCosts(typed).catch((e) => console.error("GRV prices could not be recorded:", e));
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

  if (state.kind === "pp_bag_price") {
    const month = monthLabel();
    // Only the bag kinds sent back with a figure. Merged into the month's row
    // with jsonb `||`, so the products, raw materials and dollar rate the
    // monthly list holds are never touched — and a month with no list yet gets
    // a row carrying just the bag prices.
    const bags = jsonMap(d, BAG_PREFIX, BAG_KIND_KEYS);
    if (Object.keys(bags).length === 0) throw new Error("No PP bag price was entered.");
    const [row] = await sql<{ id: string }[]>`
      insert into monthly_price_lists (month, prices, reported_by, source)
      values (${month}, ${sql.json(bags)}, ${reportedBy}, 'telegram')
      on conflict (month) do update set
        prices = monthly_price_lists.prices || excluded.prices,
        reported_by = excluded.reported_by,
        source = 'telegram',
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
  //
  // The four new-tool columns (0028) are optional for the same reason: a
  // request filed between the deploy and the migration keeps its title,
  // quantity, kind and reason — the fields every reader already handles.
  const row = await insertRow(
    "purchase_requests",
    {
      title: String(d.title || ""),
      quantity: Number(d.quantity) || null,
      kind: String(d.kind || ""),
      justification: String(d.reason || "") || null,
      description: String(d.description || "") || null,
      unit: String(d.unit || "") || null,
      department: String(d.department || "") || null,
      notes: String(d.notes || "") || null,
      // The machine or car it is for; null for PP bags / oil (0043).
      machine: d.machine && d.machine !== NO_MACHINE ? String(d.machine) : null,
      tg_file_id: state.photoFileId || null,
      requested_by: reportedBy,
      source: "telegram",
      status: "pending",
      legitimacy: state.check ? sql.json({ ...state.check }) : null,
    },
    { optional: ["tg_file_id", "description", "unit", "department", "notes", "machine"], source: "asset-flows" }
  );
  return { id: row.id, table: "purchase_requests" };
}
