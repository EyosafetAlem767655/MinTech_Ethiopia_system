import { BANKS, matchBank } from "@/lib/banks";

/**
 * The monthly bank collection sheet: its fill-in block, and its parser.
 *
 * The sheet is photographed and read, but a photo that will not read cannot be
 * a dead end — a month's collections are not re-photographable at will. So the
 * same figures can arrive as a block, the shape every other long list in this
 * system uses.
 *
 * Bank names go through `matchBank`, so "ንግድ ባንክ", "CBE" and "Commercial Bank
 * of Ethiopia" all land on one entry. The dashboard then has one spelling per
 * bank to add up, which is the whole reason that matcher exists.
 *
 * Pure by design — no `sql`, no network.
 */

export const BANK_PREFIX = "bank:";

/** Draft key for one bank, e.g. "bank:CBE". */
export function bankKey(bank: string): string {
  return `${BANK_PREFIX}${bank}`;
}

/**
 * The blank block.
 *
 * Every bank is listed, including the ones that collected nothing: a sheet that
 * only names the banks with money on it cannot tell "nothing came through
 * Dashen" from "Dashen was forgotten".
 */
export function bankTemplate(): string {
  return BANKS.map((b) => `${b}=`).join("\n");
}

/* ─────────────────────────────── Parsing ──────────────────────────────────── */

function isGuidance(line: string): boolean {
  if (/^[#>/(]/.test(line)) return true;
  const key = line.split(/[=:]/)[0];
  return /^\s*(e\.?g\.?|example|for example|ምሳሌ)\s*$/i.test(key);
}

/** Split "CBE = 1,240,000" on the LAST separator; bank names carry no "=". */
function splitPair(line: string): [string, string] | null {
  const at = Math.max(line.lastIndexOf("="), line.lastIndexOf(":"));
  if (at <= 0) return null;
  return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
}

function parseAmount(raw: string): number | null {
  const cleaned = raw
    .replace(/\b(etb|birr|ብር)\b/gi, "")
    .replace(/,/g, "")
    .trim();
  if (!cleaned) return null;
  if (!/^\d*\.?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return isFinite(n) ? Math.round(n * 100) / 100 : null;
}

export interface ParsedBankSheet {
  /** Draft keys → birr collected. */
  values: Record<string, number>;
  /** Lines that looked like data but named no bank we know. */
  unknown: string[];
  /** Lines whose value was not a number. */
  invalid: string[];
}

/**
 * Read a filled-in block, or a list the model read off the sheet.
 *
 * A blank line records nothing — that bank is simply not on this month's sheet
 * — and a typed 0 is a real statement that nothing came through it. Keeping
 * those apart is what lets the dashboard show a bank that collected nothing
 * differently from one nobody reported.
 */
export function parseBankSheet(text: string): ParsedBankSheet {
  const values: Record<string, number> = {};
  const unknown: string[] = [];
  const invalid: string[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (isGuidance(line)) continue;

    const pair = splitPair(line);
    if (!pair) continue;
    const [name, value] = pair;

    const bank = matchBank(name);
    if (!bank) {
      if (/\d/.test(value)) unknown.push(line);
      continue;
    }
    if (!value) continue;

    const amount = parseAmount(value);
    if (amount === null) invalid.push(line);
    else values[bankKey(bank)] = (values[bankKey(bank)] ?? 0) + amount;
  }

  return { values, unknown, invalid };
}

/** The draft as `bank_collections.banks` stores it: { "CBE": 1240000, … }. */
export function bankAmounts(draft: Record<string, string | number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const bank of BANKS) {
    const v = draft[bankKey(bank)];
    if (v === undefined || v === "") continue;
    const n = Number(v);
    if (isFinite(n)) out[bank] = n;
  }
  return out;
}

/** Everything collected in a draft, for the review card and the stored total. */
export function bankTotal(draft: Record<string, string | number>): number {
  return Math.round(Object.values(bankAmounts(draft)).reduce((a, b) => a + b, 0) * 100) / 100;
}
