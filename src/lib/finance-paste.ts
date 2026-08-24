import {
  BAG_SIZES,
  BAG_SIZE_LABEL,
  FINANCE_RAW_MATERIALS,
  PRODUCT_ORDER,
  productLabel,
  type BagSize,
} from "@/lib/products";

/**
 * Fill-in templates and parsers for the two long monthly lists: the opening
 * base balance and the price list.
 *
 * Both cover the same fifteen items — ten finished brands, three raw materials,
 * two bag sizes — which is fifteen questions a month if asked one at a time. The
 * bot offers a template instead: one message out, one message back.
 *
 * Sections are load-bearing rather than decorative. **"Talc" names two different
 * things**: the finished brand Micro Talc (product code `Talk`, produced and
 * sold) and the raw material Talc (received and consumed). Without a section
 * header the second would silently overwrite the first, and a tonnage would end
 * up on the wrong table with nothing to show it had moved.
 *
 * Pure by design — no `sql`, no network — so the parser is testable on its own.
 */

export const BRAND_PREFIX = "brand:";
export const MATERIAL_PREFIX = "material:";
export const BAG_PREFIX = "bag:";
export const USD_RATE_KEY = "usdRate";

export type FinanceSection = "brands" | "materials" | "bags";

const H_BRANDS = "--- ምርቶች (ቶን) ---";
const H_MATERIALS = "--- ጥሬ ዕቃ (ቶን) ---";
const H_BAGS = "--- ከረጢት (ብዛት) ---";

const H_BRANDS_PRICE = "--- ምርቶች (ብር/ቶን) ---";
const H_MATERIALS_PRICE = "--- ጥሬ ዕቃ (ብር/ቶን) ---";
const H_BAGS_PRICE = "--- ከረጢት (ብር/ቁጥር) ---";

/** Draft key for one item, namespaced by which table it belongs to. */
export function brandKey(code: string): string {
  return `${BRAND_PREFIX}${code}`;
}
export function materialKey(name: string): string {
  return `${MATERIAL_PREFIX}${name}`;
}
export function bagFinanceKey(size: BagSize): string {
  return `${BAG_PREFIX}${size}`;
}

/* ────────────────────────────────── templates ─────────────────────────────── */

function block(headers: [string, string, string]): string {
  const brands = PRODUCT_ORDER.map((c) => `${productLabel(c)}=`).join("\n");
  const materials = FINANCE_RAW_MATERIALS.map((m) => `${m}=`).join("\n");
  const bags = BAG_SIZES.map((s) => `${BAG_SIZE_LABEL[s]} PP bag=`).join("\n");
  return [headers[0], brands, headers[1], materials, headers[2], bags].join("\n");
}

/**
 * The blank templates.
 *
 * Values are left empty rather than pre-filled with 0: a blank line means "not
 * answered" and falls through to a question, whereas a 0 nobody looked at would
 * be recorded as a real measurement.
 */
export function baseBalanceTemplate(): string {
  return block([H_BRANDS, H_MATERIALS, H_BAGS]);
}

export function priceListTemplate(): string {
  return [block([H_BRANDS_PRICE, H_MATERIALS_PRICE, H_BAGS_PRICE]), "USD=" ].join("\n");
}

/* ─────────────────────────────────── parsing ──────────────────────────────── */

/** Loose key match: case, spaces, hyphens and dots are all noise. */
const norm = (s: string) => s.toLowerCase().replace(/[\s\-_.]/g, "");

function buildLookup() {
  const brands = new Map<string, string>();
  for (const code of PRODUCT_ORDER) {
    brands.set(norm(code), code);
    brands.set(norm(productLabel(code)), code);
  }
  // "Micro Talc" is what the sheet calls the Talk brand.
  brands.set(norm("Micro Talc"), "Talk");

  const materials = new Map<string, string>();
  for (const m of FINANCE_RAW_MATERIALS) materials.set(norm(m), m);

  const bags = new Map<string, BagSize>();
  for (const size of BAG_SIZES) {
    bags.set(norm(`${BAG_SIZE_LABEL[size]} PP bag`), size);
    bags.set(norm(`${BAG_SIZE_LABEL[size]} bag`), size);
    bags.set(norm(BAG_SIZE_LABEL[size]), size);
    bags.set(norm(size), size);
  }
  return { brands, materials, bags };
}

const LOOKUP = buildLookup();

function detectSection(line: string): FinanceSection | undefined {
  const n = norm(line);
  // Matched on the Amharic word alone, so the dashes, emoji or bracketed unit
  // can be reworded without invalidating every template already in circulation.
  if (n.includes(norm("ከረጢት"))) return "bags";
  if (n.includes(norm("ጥሬ"))) return "materials";
  // Both spellings: the header reads "ምርቶች" (plural) but the singular "ምርት" is
  // what someone retyping the template by hand tends to write, and neither
  // contains the other as a substring.
  if (n.includes(norm("ምርቶ")) || n.includes(norm("ምርት"))) return "brands";
  if (/^-*\s*(brands?|products?)/i.test(line.trim())) return "brands";
  if (/^-*\s*(raw|materials?)/i.test(line.trim())) return "materials";
  if (/^-*\s*bags?/i.test(line.trim())) return "bags";
  return undefined;
}

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

export interface ParsedFinancePaste {
  values: Record<string, string | number>;
  /** Lines that looked like data but matched no known item. */
  unknown: string[];
  /** Lines whose value was not a number. */
  invalid: string[];
}

/**
 * Read a filled-in template.
 *
 * Blank values are skipped rather than defaulted, so a half-filled paste leaves
 * the rest of the flow to ask about — nobody is forced to start over because
 * they missed a line.
 */
export function parseFinancePaste(text: string, opts: { usdRate?: boolean } = {}): ParsedFinancePaste {
  const values: Record<string, string | number> = {};
  const unknown: string[] = [];
  const invalid: string[] = [];
  let section: FinanceSection | null = null;

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
    if (!value) continue;

    const nk = norm(key);

    if (opts.usdRate && (nk === norm("USD") || nk === norm("USD rate") || nk === norm("ዶላር"))) {
      const n = parseNumber(value);
      if (n === null) invalid.push(line);
      else values[USD_RATE_KEY] = n;
      continue;
    }

    if (section === "bags") {
      const size = LOOKUP.bags.get(nk);
      if (!size) {
        unknown.push(line);
        continue;
      }
      const n = parseNumber(value);
      if (n === null) invalid.push(line);
      else values[bagFinanceKey(size)] = n;
      continue;
    }

    if (section === "materials") {
      const m = LOOKUP.materials.get(nk);
      if (!m) {
        unknown.push(line);
        continue;
      }
      const n = parseNumber(value);
      if (n === null) invalid.push(line);
      else values[materialKey(m)] = n;
      continue;
    }

    if (section === "brands") {
      const code = LOOKUP.brands.get(nk);
      if (!code) {
        unknown.push(line);
        continue;
      }
      const n = parseNumber(value);
      if (n === null) invalid.push(line);
      else values[brandKey(code)] = n;
      continue;
    }

    // Before any header, "Talc" is ambiguous — it is a brand on one table and a
    // raw material on the other. Reporting the line is honest; guessing would
    // put a figure on the wrong table with no way to notice afterwards.
    if (LOOKUP.brands.has(nk) || LOOKUP.materials.has(nk) || LOOKUP.bags.has(nk)) unknown.push(line);
  }

  return { values, unknown, invalid };
}
