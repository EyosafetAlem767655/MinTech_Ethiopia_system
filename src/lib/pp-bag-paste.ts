import { BAG_KINDS, bagLabel, bagLedgerKey, parseBagLedgerKey, type BagSize } from "@/lib/products";

/**
 * The fill-in block for a PP bag delivery, and its parser.
 *
 * Bags arriving used to be recorded as a side-question on the Goods Receiving
 * Voucher: the bot asked "which stock item is this?" only when a line happened
 * to mention a bag, and only then did the delivery reach the stock check. A
 * delivery of bags is its own event and now has its own form — one line per
 * kind.
 *
 * Per COLOUR, never per size. The kinds carry different unit prices and are
 * packed separately, so a delivery recorded as "400 × 25KG" values four
 * different products at one number and leaves the stock check unable to say
 * which colour is missing.
 *
 * A blank line records nothing — none of that kind arrived — and a typed 0 is
 * the same thing said out loud. Only a figure actually typed is stored, the
 * same rule the store count follows.
 *
 * Pure by design — no `sql`, no network.
 */

export const BAG_PREFIX = "bag:";

/** Draft key for one bag kind, e.g. "bag:kg25:Yellow". */
export function bagKey(size: BagSize, colour: string): string {
  return `${BAG_PREFIX}${bagLedgerKey(size, colour)}`;
}

/** The ledger key back out of a draft key, or null if it is not one. */
export function ledgerKeyOf(draftKey: string): string | null {
  if (!draftKey.startsWith(BAG_PREFIX)) return null;
  const key = draftKey.slice(BAG_PREFIX.length);
  return parseBagLedgerKey(key) ? key : null;
}

/**
 * The blank block the bot sends.
 *
 * Nothing is pre-filled: a delivery is what arrived today, and a figure carried
 * over from last time would be a receipt nobody took.
 */
export function ppBagTemplate(): string {
  return BAG_KINDS.map(({ size, colour }) => `${bagLabel(size, colour)}=`).join("\n");
}

/* ─────────────────────────────── Parsing ──────────────────────────────────── */

/** Loose key match: case, spaces, hyphens, dots and colons are all noise. */
const norm = (s: string) => s.toLowerCase().replace(/[\s\-_.:]/g, "");

/** Every spelling of a bag kind → its ledger key, built once. */
const LOOKUP: Map<string, string> = (() => {
  const out = new Map<string, string>();
  for (const { size, colour } of BAG_KINDS) {
    const key = bagLedgerKey(size, colour);
    out.set(norm(bagLabel(size, colour)), key);
    out.set(norm(`${bagLabel(size, colour)} PP`), key);
    out.set(norm(`${bagLabel(size, colour)} PP bag`), key);
    // The stored spelling, so a figure copied off the dashboard pastes back in.
    out.set(norm(key), key);
    out.set(norm(`${size} ${colour}`), key);
  }
  return out;
})();

function isGuidance(line: string): boolean {
  if (/^[#>/(]/.test(line)) return true;
  const key = line.split(/[=:]/)[0];
  return /^\s*(e\.?g\.?|example|for example|ምሳሌ)\s*$/i.test(key);
}

/**
 * Split "25KG Yellow = 400" into its two halves.
 *
 * Only the LAST separator splits, because a ledger key spelling contains a
 * colon ("kg25:Yellow=400") and splitting on the first would read the size as
 * the name and "Yellow=400" as the figure.
 */
function splitPair(line: string): [string, string] | null {
  const at = Math.max(line.lastIndexOf("="), line.lastIndexOf(":"));
  if (at <= 0) return null;
  return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
}

function parseCount(raw: string): number | null {
  const cleaned = raw.replace(/\b(pcs|pieces|ከረጢት)\b/gi, "").replace(/,/g, "").trim();
  if (!cleaned) return null;
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  // Bags are counted, never fractional.
  return isFinite(n) ? Math.round(n) : null;
}

export interface ParsedPpBags {
  /** Draft keys → pieces received. */
  values: Record<string, number>;
  /** Lines that looked like data but named no known bag kind. */
  unknown: string[];
  /** Lines whose value was not a number. */
  invalid: string[];
}

export function parsePpBagPaste(text: string): ParsedPpBags {
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

    const key = LOOKUP.get(norm(name));
    if (!key) {
      // Only complain about lines that were plainly meant as data.
      if (/\d/.test(value)) unknown.push(line);
      continue;
    }

    // Nothing of this kind arrived. Recorded nowhere.
    if (!value) continue;

    const n = parseCount(value);
    if (n === null) invalid.push(line);
    else values[`${BAG_PREFIX}${key}`] = n;
  }

  return { values, unknown, invalid };
}

/**
 * The draft as `pp_bag_purchases.bags` stores it: `{ kg25: { Yellow: 400 } }`.
 *
 * Nested by size and colour because that is the shape asset management has
 * always counted bags in, and the one `bagSizeTotals` and the monthly finance
 * report already read. A kind with no figure is left out entirely rather than
 * written as 0 — the row then says what arrived, and nothing else.
 */
export function bagsReceived(draft: Record<string, string | number>): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const { size, colour } of BAG_KINDS) {
    const v = draft[bagKey(size, colour)];
    if (v === undefined || v === "") continue;
    const n = Number(v);
    if (!isFinite(n)) continue;
    out[size] = { ...(out[size] || {}), [colour]: n };
  }
  return out;
}

/** Total pieces in a draft, for the review card. */
export function bagTotal(draft: Record<string, string | number>): number {
  return BAG_KINDS.reduce((a, { size, colour }) => a + (Number(draft[bagKey(size, colour)]) || 0), 0);
}
