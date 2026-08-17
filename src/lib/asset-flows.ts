import sql from "@/lib/sql";
import { DELIVERY_PRODUCTS, productLabel, RAW_MATERIALS } from "@/lib/products";
import type { ToolPhotoCheck } from "@/lib/llm";

/**
 * Guided step-by-step data entry for the three Asset Management reports.
 *
 * These used to be captured as free text and handed to an LLM to guess the
 * columns, which is why the resulting tables were unreliable. The bot now asks
 * for each column by name, so what lands in the database is what the asset
 * manager actually typed — no inference anywhere in the path.
 *
 * The steps are a data table rather than a chain of if-blocks: the webhook only
 * has to ask `nextStep()` what comes next, which keeps the 2 300-line handler
 * from growing three more state machines.
 */

export type AssetFlowKind = "raw_material" | "delivery" | "tool_request";

export interface AssetFlowState {
  kind: AssetFlowKind;
  /** Step id currently being answered; "review" once every step is done. */
  step: string;
  draft: Record<string, string | number>;
  /** stored_files id of the damaged-item photo (tool_request/maintenance). */
  photoFileId?: string;
  /** Gemini's verdict on that photo. */
  check?: ToolPhotoCheck;
}

export interface AssetStep {
  id: string;
  /** Amharic question shown to the user. */
  prompt: string;
  type: "date" | "text" | "number" | "choice" | "photo";
  choices?: { label: string; value: string }[];
  /** Skip the step unless this holds — used for the maintenance/new-item branch. */
  when?: (draft: Record<string, string | number>) => boolean;
  /** Accept "-" / "የለም" as empty instead of demanding a value. */
  skippable?: boolean;
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

const STEPS: Record<AssetFlowKind, AssetStep[]> = {
  raw_material: RAW_MATERIAL_STEPS,
  delivery: DELIVERY_STEPS,
  tool_request: TOOL_REQUEST_STEPS,
};

export const FLOW_TITLE: Record<AssetFlowKind, string> = {
  raw_material: "🚚 የጥሬ ዕቃ ገቢ ሪፖርት",
  delivery: "🚛 የማድረሻ ሪፖርት",
  tool_request: "🔧 የመሣሪያ ግዢ ጥያቄ",
};

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
