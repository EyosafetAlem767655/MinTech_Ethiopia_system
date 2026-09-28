import { FINANCE_RAW_MATERIALS } from "@/lib/products";

/**
 * The fill-in template for the daily raw-material report, and its parser.
 *
 * Nine figures — three materials, read three ways — which is nine messages if
 * asked one at a time, every day. The bot sends this block instead: one message
 * out, one message back, in the exact shape the plant wrote the request in.
 *
 * Sections are load-bearing, not decoration. The SAME THREE NAMES appear three
 * times, so without a header to switch context the Stock block would overwrite
 * the Issue block, which would overwrite Received — and a day would be recorded
 * as having consumed everything it received. This is the same trap
 * production-paste.ts documents for its three product tables.
 *
 * Pure by design — no `sql`, no network — so the parser is testable on its own
 * and the flow engine stays small.
 */

export const RECEIVED_PREFIX = "recv:";
export const ISSUED_PREFIX = "issue:";
export const STOCK_PREFIX = "stock:";

export type RawSection = "received" | "issued" | "stock";

export const SECTION_PREFIX: Record<RawSection, string> = {
  received: RECEIVED_PREFIX,
  issued: ISSUED_PREFIX,
  stock: STOCK_PREFIX,
};

/** Draft key for one cell, e.g. "recv:Lime Stone". */
export function materialKey(section: RawSection, material: string): string {
  return `${SECTION_PREFIX[section]}${material}`;
}

// English, and deliberately the wording the request was written in. The block is
// filled in by copying it back with numbers in it, and a header nobody
// recognises is a header people delete — which would leave the parser unable to
// tell what was received from what was consumed.
const H_RECEIVED = "--- Received ---";
const H_ISSUED = "--- Issue ---";
const H_STOCK = "--- Stock ---";

/**
 * The blank template the bot sends.
 *
 * Values are left empty rather than pre-filled with 0 so the block is quick to
 * fill in on a phone — and a line left empty IS zero here: none arrived, none
 * was used, none is left.
 */
export function rawMaterialTemplate(): string {
  const lines = FINANCE_RAW_MATERIALS.map((m) => `${m}=`).join("\n");
  return [
    H_RECEIVED,
    lines,
    H_ISSUED,
    lines,
    H_STOCK,
    lines,
  ].join("\n");
}

/* ─────────────────────────────── Parsing ──────────────────────────────────── */

/** Loose key match: case, spaces, hyphens and dots are all noise. */
const norm = (s: string) => s.toLowerCase().replace(/[\s\-_.]/g, "");

/**
 * Every spelling of a material, built once.
 *
 * "Lime stone", "Lime Stone" and "LIMESTONE" are one material; the plant writes
 * it all three ways on paper. The finance spelling is what gets stored, so the
 * monthly report and this report key on the same string.
 */
function buildLookup(): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of FINANCE_RAW_MATERIALS) out.set(norm(m), m);
  // The three asset-side materials that roll up into Dolomite. Somebody who
  // still thinks in Kuni or Chips writes a line this report has no column for;
  // accepting it into Dolomite is better than reporting it as unreadable, and
  // matches exactly what finance has always done with those names.
  for (const alias of ["Kuni", "Chips", "Guji"]) out.set(norm(alias), "Dolomite");
  return out;
}

const LOOKUP = buildLookup();

/**
 * Lines that are guidance, not data — the same rule the other templates use, so
 * an example pasted back with the block is not reported as an unreadable line.
 */
function isGuidance(line: string): boolean {
  if (/^[#>/(]/.test(line)) return true;
  const key = line.split(/[=:]/)[0];
  return /^\s*(e\.?g\.?|example|for example|ምሳሌ)\s*$/i.test(key);
}

function detectSection(line: string): RawSection | undefined {
  // A line carrying a value is data, never a header. Checking that first is what
  // lets the keyword match look anywhere in the line rather than only at its
  // start, so "--- Received ---" and "Received (on the date)" both work.
  if (/[=:]/.test(line)) return undefined;

  const n = norm(line);
  // Stock first: "Stock" is the only one of the three that no other header
  // contains, and checking it last would let a badly-worded line reach it.
  if (n.includes("stock") || n.includes(norm("ክምችት"))) return "stock";
  if (n.includes("issue") || n.includes("used") || n.includes(norm("ወጪ"))) return "issued";
  if (n.includes("receiv") || n.includes(norm("ገቢ"))) return "received";
  return undefined;
}

/** Split "Dolomite = 12.5" into its two halves, accepting ":" as well as "=". */
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

export interface ParsedRawMaterial {
  /** Draft keys → values, ready to merge into the flow draft. */
  values: Record<string, string | number>;
  /** Lines that looked like data but matched no known material. */
  unknown: string[];
  /** Lines whose value was not a number. */
  invalid: string[];
}

/**
 * Read a filled-in block.
 *
 * A blank material line records 0. There is nowhere for it to fall through to —
 * this report is one block with no follow-up questions — and a blank plainly
 * means none arrived, none was used, or none is left.
 *
 * A line before any section header is reported as unknown rather than guessed
 * at: it could belong to any of the three tables, and putting tonnage in the
 * wrong one is invisible afterwards.
 */
export function parseRawMaterialPaste(text: string): ParsedRawMaterial {
  const values: Record<string, string | number> = {};
  const unknown: string[] = [];
  const invalid: string[] = [];
  let section: RawSection | null = null;

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
    const material = LOOKUP.get(norm(key));

    if (!material || !section) {
      // Only complain about lines that look like they were meant as data.
      if (material || /\d/.test(value)) unknown.push(line);
      continue;
    }

    if (!value) {
      values[materialKey(section, material)] = 0;
      continue;
    }

    const n = parseNumber(value);
    if (n === null) invalid.push(line);
    else values[materialKey(section, material)] = n;
  }

  return { values, unknown, invalid };
}

/** The three figures of one section, as the save and the review card read them. */
export function sectionMap(
  draft: Record<string, string | number>,
  section: RawSection
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of FINANCE_RAW_MATERIALS) out[m] = Number(draft[materialKey(section, m)]) || 0;
  return out;
}
