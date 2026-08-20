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
 * names appear TWICE, once as what was produced and once as what is in stock.
 * Without a section marker the second block would silently overwrite the first.
 *
 * Pure by design — no `sql`, no network — so the parser is testable on its own
 * and the flow engine stays small.
 */

/** Draft keys this parser fills, matching the step ids in asset-flows.ts. */
export const FGR_KEY = "fgrNo";
export const PROD_PREFIX = "prod:";
export const STOCK_PREFIX = "stock:";
export const BAG_PREFIX = "bag:";

/** Draft key for one bag cell, e.g. "bag:kg25:Yellow". */
export function bagKey(size: BagSize, colour: string): string {
  return `${BAG_PREFIX}${size}:${colour}`;
}

const H_PRODUCTION = "--- ምርት (ቶን) ---";
const H_STOCK = "--- ክምችት (ቶን) ---";
const H_BAGS = "--- ከረጢት (ብዛት) ---";

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
    H_BAGS,
    bags,
  ].join("\n");
}

/* ─────────────────────────────── Parsing ──────────────────────────────────── */

type Section = "production" | "stock" | "bags" | null;

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

function detectSection(line: string): Section | undefined {
  const n = norm(line);
  // Matched on the Amharic word alone so the surrounding dashes, emoji or
  // bracketed unit can be reworded without breaking every saved template.
  if (n.includes(norm("ምርት"))) return "production";
  if (n.includes(norm("ክምችት"))) return "stock";
  if (n.includes(norm("ከረጢት"))) return "bags";
  if (/^-*\s*production/i.test(line.trim())) return "production";
  if (/^-*\s*stock/i.test(line.trim())) return "stock";
  if (/^-*\s*bags?/i.test(line.trim())) return "bags";
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
      values[FGR_KEY] = value;
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

    if (section === "production" || section === "stock") {
      const code = LOOKUP.products.get(nk);
      if (!code) {
        unknown.push(line);
        continue;
      }
      const n = parseNumber(value);
      if (n === null) invalid.push(line);
      else values[`${section === "production" ? PROD_PREFIX : STOCK_PREFIX}${code}`] = n;
      continue;
    }

    // A product line before any section header is ambiguous — it could be
    // either table. Reporting it is honest; guessing would put tonnage in the
    // wrong column with no way to tell afterwards.
    if (LOOKUP.products.has(nk) || LOOKUP.bags.has(nk)) unknown.push(line);
  }

  return { values, unknown, invalid };
}
