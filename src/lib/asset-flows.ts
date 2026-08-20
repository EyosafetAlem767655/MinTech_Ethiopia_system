import sql from "@/lib/sql";
import {
  BAG_SIZES,
  BAG_STOCK,
  DELIVERY_PRODUCTS,
  PRODUCTION_PRODUCTS,
  bagLabel,
  productLabel,
  RAW_MATERIALS,
  type BagSize,
} from "@/lib/products";
import { upsertOpsDay, opsDateLabel } from "@/lib/ops-report";
import { bagKey, productionTemplate, PROD_PREFIX, STOCK_PREFIX } from "@/lib/production-paste";
import type { ToolPhotoCheck } from "@/lib/llm";

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
  | "production_daily";

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
      prompt: `🧺 ክምችት — የ<b>${bagLabel(size, colour)}</b> ከረጢት ብዛት (ቁጥር)። ከሌለ 0 ይፃፉ።`,
      type: "number",
    }))
  ),
];

const STEPS: Record<AssetFlowKind, AssetStep[]> = {
  raw_material: RAW_MATERIAL_STEPS,
  delivery: DELIVERY_STEPS,
  tool_request: TOOL_REQUEST_STEPS,
  pp_bag_damage: PP_BAG_DAMAGE_STEPS,
  production_daily: PRODUCTION_STEPS,
};

export const FLOW_TITLE: Record<AssetFlowKind, string> = {
  raw_material: "🚚 የጥሬ ዕቃ ገቢ ሪፖርት",
  delivery: "🚛 የማድረሻ ሪፖርት",
  tool_request: "🔧 የመሣሪያ ግዢ ጥያቄ",
  pp_bag_damage: "💔 የPP ከረጢት ብልሽት ሪፖርት",
  production_daily: "🏭 የቀኑ የምርት ሪፖርት",
};

/** The template text for a paste step. */
export function pasteTemplate(kind: AssetFlowKind): string {
  return kind === "production_daily" ? productionTemplate() : "";
}

/**
 * The first step still unanswered, or "review".
 *
 * Used after a paste to resume at whatever was left blank instead of marching
 * back through questions the template already answered.
 */
export function firstUnanswered(kind: AssetFlowKind, draft: Record<string, string | number>): string {
  for (const s of stepsFor(kind, draft)) {
    if (s.type === "paste" || s.type === "choice") continue;
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
      `🧺 <b>የከረጢት ክምችት (ብዛት)</b>\n${bags}\n`
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
