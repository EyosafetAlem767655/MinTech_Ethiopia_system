import {
  BAG_SIZES,
  BAG_STOCK,
  PRODUCTION_PRODUCTS,
  bagLabel,
  productLabel,
  type BagSize,
} from "@/lib/products";

/**
 * The fill-in template for the daily production report, and its parser.
 *
 * Answering the guided flow one question at a time is 28 messages, so the bot
 * offers this instead: one message out, one message back. The format is modelled
 * on the ops-report paste (`parseOpsReportText`) — a section header switches
 * context, then `Label=Value` lines are read under it.
 *
 * Sections are not decoration here, they are load-bearing: the same ten product
 * names appear THREE times — produced, delivered, and in stock. Without a section
 * marker each block would silently overwrite the one before it, and a day's
 * output would end up recorded as its closing stock.
 *
 * Pure by design — no `sql`, no network — so the parser is testable on its own
 * and the flow engine stays small.
 */

/** Draft keys this parser fills, matching the step ids in asset-flows.ts. */
export const FGR_KEY = "fgrNo";
export const PROD_PREFIX = "prod:";
export const STOCK_PREFIX = "stock:";
/**
 * What was delivered out that day.
 *
 * Written to `daily_ops_reports.delivered`, which is where dispatched tonnage
 * has always lived — not a new table. Produced, delivered and left in stock are
 * three readings of the same ten products on the same day, and keeping the third
 * one somewhere else would leave nothing able to check them against each other.
 */
export const DELIVERED_PREFIX = "deliver:";
export const BAG_PREFIX = "bag:";

/** Draft key for one bag cell, e.g. "bag:kg25:Yellow". */
export function bagKey(size: BagSize, colour: string): string {
  return `${BAG_PREFIX}${size}:${colour}`;
}

// Deliberately English, and deliberately the wording the plant already uses on
// its own sheet. This block is filled in by copying it back with numbers in it,
// and a header nobody recognises is a header people delete — which would leave
// the parser unable to tell produced tonnage from stock tonnage.
const H_PRODUCTION = "--- Daily production(Ton) ---";
const H_STOCK = "--- Stock ---";
const H_DELIVERED = "--- Delivered amount(Ton) ---";
const H_BAGS = "--- PP Bag count ---";

/**
 * The blank template the bot sends.
 *
 * Values are left empty rather than pre-filled with 0: a blank line means "not
 * answered" and falls through to a question, whereas a 0 the user never looked
 * at would be recorded as a real measurement.
 */
export function productionTemplate(): string {
  const products = PRODUCTION_PRODUCTS.map((c) => `${productLabel(c)}=`).join("\n");
  const bags = BAG_SIZES.flatMap((size) =>
    BAG_STOCK[size].map((colour) => `${bagLabel(size, colour)}=`)
  ).join("\n");

  return [
    "FGR=",
    H_PRODUCTION,
    products,
    H_STOCK,
    products,
    H_DELIVERED,
    products,
    H_BAGS,
    bags,
  ].join("\n");
}

/* ─────────────────────────────── Parsing ──────────────────────────────────── */

type Section = "production" | "stock" | "delivered" | "bags" | null;

/** Which draft prefix each of the three product tables writes into. */
const PRODUCT_SECTION_PREFIX: Record<"production" | "stock" | "delivered", string> = {
  production: PROD_PREFIX,
  stock: STOCK_PREFIX,
  delivered: DELIVERED_PREFIX,
};

/** Loose key match: case, spaces, hyphens and dots are all noise. */
const norm = (s: string) => s.toLowerCase().replace(/[\s\-_.]/g, "");

/**
 * Lookup from any spelling of a column to its draft key, built once.
 *
 * Both the display label and the raw storage code are accepted ("ETL-15" and
 * "ETL15"), because people copy from the sheet and from the database alike.
 */
function buildLookup(): {
  products: Map<string, string>;
  bags: Map<string, { size: BagSize; colour: string }>;
} {
  const products = new Map<string, string>();
  for (const code of PRODUCTION_PRODUCTS) {
    products.set(norm(code), code);
    products.set(norm(productLabel(code)), code);
  }

  const bags = new Map<string, { size: BagSize; colour: string }>();
  for (const size of BAG_SIZES) {
    for (const colour of BAG_STOCK[size]) {
      bags.set(norm(bagLabel(size, colour)), { size, colour });
      // "kg25 Yellow" — the stored shape, in case someone copies from the API.
      bags.set(norm(`${size} ${colour}`), { size, colour });
    }
  }
  return { products, bags };
}

const LOOKUP = buildLookup();

/**
 * Lines that are guidance, not data.
 *
 * The prompt shows an example of the format ("eg: ETL-15 = 12"), and an example
 * that gets pasted back with the rest of the block would otherwise be reported
 * as an unreadable line — a warning about the very thing that was meant to help.
 * A leading marker or the word "example"/"eg" is enough to tell them apart,
 * because no product or bag label contains either.
 */
function isGuidance(line: string): boolean {
  if (/^[#>/(]/.test(line)) return true;
  const key = line.split(/[=:]/)[0];
  return /^\s*(e\.?g\.?|example|for example|ምሳሌ)\s*$/i.test(key);
}

function detectSection(line: string): Section | undefined {
  // A line carrying a value is data, never a header. Checking this first is what
  // lets the keyword match below look ANYWHERE in the line instead of only at
  // the start — "--- Daily production(Ton) ---" and "---PP Bag count ---" both
  // bury their keyword behind something else, and anchoring to the start missed
  // both of them.
  if (/[=:]/.test(line)) return undefined;

  const n = norm(line);
  // Bags first: "PP Bag count" would otherwise never be reached, and no other
  // section name contains the word.
  if (n.includes(norm("ከረጢት")) || n.includes("bag")) return "bags";
  if (n.includes(norm("ክምችት")) || n.includes("stock")) return "stock";
  // "ship" and "dispatch" are still accepted alongside "deliver": the section
  // was called Shipped before it was renamed, and a template someone saved then
  // has to keep parsing rather than dropping its tonnage into the previous
  // section.
  if (
    n.includes(norm("የተላከ")) ||
    n.includes("deliver") ||
    n.includes("ship") ||
    n.includes("dispatch")
  )
    return "delivered";
  if (n.includes(norm("ምርት")) || n.includes("production")) return "production";
  return undefined;
}

/** Split "ETL-15 = 12.5" into its two halves, accepting ":" as well as "=". */
function splitPair(line: string): [string, string] | null {
  const m = line.match(/^([^=:]+)[=:](.*)$/);
  if (!m) return null;
  return [m[1].trim(), m[2].trim()];
}

function parseNumber(raw: string): number | null {
  const cleaned = raw.replace(/,/g, "").trim();
  if (!cleaned) return null;
  if (!/^-?\d*\.?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return isFinite(n) ? n : null;
}

export interface ParsedPaste {
  /** Draft keys → values, ready to merge into the flow draft. */
  values: Record<string, string | number>;
  /** Lines that looked like data but matched no known column. */
  unknown: string[];
  /** Lines whose value was not a number. */
  invalid: string[];
}

/**
 * Read a filled-in template.
 *
 * Blank values are skipped rather than defaulted, so a half-filled paste leaves
 * the rest of the flow to ask about — the user is never forced to start over
 * because they missed a line.
 */
export function parseProductionPaste(text: string): ParsedPaste {
  const values: Record<string, string | number> = {};
  const unknown: string[] = [];
  const invalid: string[] = [];
  let section: Section = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (isGuidance(line)) continue;

    const found = detectSection(line);
    if (found) {
      section = found;
      continue;
    }

    const pair = splitPair(line);
    if (!pair) continue;
    const [key, value] = pair;
    if (!value) continue; // left blank on purpose — ask for it instead

    const nk = norm(key);

    if (nk === norm("FGR") || nk === norm("FGR No")) {
      // Checked here rather than by a step validator. The guided path that used
      // to enforce the 4-digit shape is gone, so this parser is the only thing
      // between a mistyped FGR and a saved report — and a wrong FGR is what
      // makes a day's tonnage impossible to trace back to its batch.
      // One or two four-digit numbers. Not parsed as a plain number: stripping
      // the comma would turn "1234, 1235" into 12341235 with nothing to show
      // anything had gone wrong.
      const parts = value.split(/[,/;]+/).map((p) => p.trim()).filter(Boolean);
      const valid = parts.length >= 1 && parts.length <= 2 && parts.every((p) => /^\d{4}$/.test(p));
      if (valid) values[FGR_KEY] = parts.join(", ");
      else invalid.push(line);
      continue;
    }

    if (section === "bags") {
      const bag = LOOKUP.bags.get(nk);
      if (!bag) {
        unknown.push(line);
        continue;
      }
      const n = parseNumber(value);
      if (n === null) invalid.push(line);
      // Bags are counted, never fractional.
      else values[bagKey(bag.size, bag.colour)] = Math.round(n);
      continue;
    }

    if (section === "production" || section === "stock" || section === "delivered") {
      const code = LOOKUP.products.get(nk);
      if (!code) {
        unknown.push(line);
        continue;
      }
      const n = parseNumber(value);
      if (n === null) invalid.push(line);
      else values[`${PRODUCT_SECTION_PREFIX[section]}${code}`] = n;
      continue;
    }

    // A product line before any section header is ambiguous — it could be any of
    // the three product tables. Reporting it is honest; guessing would put
    // tonnage in the wrong column with no way to tell afterwards.
    if (LOOKUP.products.has(nk) || LOOKUP.bags.has(nk)) unknown.push(line);
  }

  return { values, unknown, invalid };
}
