import {
  GROUP_BY_KEY,
  STORE_ITEM_BY_KEY,
  groupsOfBlock,
  itemsOfGroup,
  type StoreBlockKey,
} from "@/lib/store-items";

/**
 * The fill-in blocks for the store count, and their parser.
 *
 * 132 items is 132 messages if asked one at a time, so the bot sends three
 * blocks — the same three lists the managers wrote — and reads them back.
 *
 * THE BLOCK IS A LIST, NOT A FORM TO COMPLETE. Nothing is pre-filled and no
 * line has to be answered: a line with no number means no change, and only a
 * number actually typed is recorded. Some of these parts turn over monthly and
 * some in days, so a sheet that demanded all 132 figures every week would be
 * filled in by carrying old numbers forward — and then every item would look
 * freshly counted, which is worse than knowing that half of them were not.
 *
 * A typed `0` still means none left. Blank and zero are different answers here
 * and are kept apart everywhere.
 *
 * Group headers switch context and are load-bearing: the list repeats names
 * across groups (16A is a breaker and a single-phase breaker, 13-18A is an
 * overload relay and a motor protection), so a flat lookup by name would merge
 * different parts.
 *
 * Pure by design — no `sql`, no network.
 */

export const ITEM_PREFIX = "item:";

/** Draft key for one item, e.g. "item:brg:6210". */
export function itemKey(storeKey: string): string {
  return `${ITEM_PREFIX}${storeKey}`;
}

/** The store key back out of a draft key, or null if it is not one. */
export function storeKeyOf(draftKey: string): string | null {
  if (!draftKey.startsWith(ITEM_PREFIX)) return null;
  const key = draftKey.slice(ITEM_PREFIX.length);
  return STORE_ITEM_BY_KEY.has(key) ? key : null;
}

const header = (label: string) => `--- ${label} ---`;

/**
 * How an item is written on a template line.
 *
 * The unit goes BEFORE the `=`, as part of the name, for anything not counted
 * in pieces — a litre figure typed as a drum count is the one mistake this list
 * invites. It used to trail the value instead (`Gas OIL=  (l)`), which meant a
 * line left blank was not empty at all: it fell through to the number parser
 * and came back reported as unreadable. Nothing follows the `=` now, so a blank
 * line is unambiguously blank.
 */
export function templateName(item: { name: string; unit: string }): string {
  return item.unit === "pcs" ? item.name : `${item.name} (${item.unit})`;
}

/**
 * One block, to be copied back with the counted figures filled in.
 *
 * Every line is empty. There is nothing to edit and nothing to delete: type a
 * number against what you counted, leave the rest alone.
 */
export function storeBlockTemplate(block: StoreBlockKey): string {
  const lines: string[] = [];
  for (const group of groupsOfBlock(block)) {
    lines.push(header(group.label));
    for (const item of itemsOfGroup(group.key)) lines.push(`${templateName(item)}=`);
  }
  return lines.join("\n");
}

/* ─────────────────────────────── Parsing ──────────────────────────────────── */

/** Loose key match: case, spaces, hyphens, dots and asterisks are all noise. */
const norm = (s: string) => s.toLowerCase().replace(/[\s\-_.*#]/g, "");

/** name → item key, per group, built once. */
const BY_GROUP: Map<string, Map<string, string>> = (() => {
  const out = new Map<string, Map<string, string>>();
  for (const group of GROUP_BY_KEY.keys()) {
    const names = new Map<string, string>();
    for (const item of itemsOfGroup(group)) {
      names.set(norm(item.name), item.key);
      // With and without the unit, because the template writes one and a person
      // typing from memory writes the other.
      names.set(norm(templateName(item)), item.key);
      // The stored key is accepted too, so a figure copied off the dashboard
      // pastes back in without being rewritten by hand.
      names.set(norm(item.key), item.key);
    }
    out.set(group, names);
  }
  return out;
})();

function isGuidance(line: string): boolean {
  if (/^[#>/(]/.test(line)) return true;
  const key = line.split(/[=:]/)[0];
  return /^\s*(e\.?g\.?|example|for example|ምሳሌ)\s*$/i.test(key);
}

/**
 * Which group a header line names, within this block.
 *
 * LONGEST LABEL WINS, and that is the whole of it. "BREAKER single phase"
 * contains "BREAKER", so first-match order would file every single-phase
 * figure against the three-phase breakers — and 16A and 10A exist in both, so
 * nothing afterwards could tell. The most specific header that fits is the one
 * that was written.
 */
const GROUPS_BY_SPECIFICITY = new Map<StoreBlockKey, { key: string; norm: string }[]>();

function candidates(block: StoreBlockKey) {
  let list = GROUPS_BY_SPECIFICITY.get(block);
  if (!list) {
    list = groupsOfBlock(block)
      .map((g) => ({ key: g.key, norm: norm(g.label) }))
      .sort((a, b) => b.norm.length - a.norm.length);
    GROUPS_BY_SPECIFICITY.set(block, list);
  }
  return list;
}

function detectGroup(line: string, block: StoreBlockKey): string | undefined {
  if (/[=:]/.test(line)) return undefined; // a line with a value is data
  const n = norm(line);
  if (!n) return undefined;
  for (const g of candidates(block)) {
    if (n.includes(g.norm)) return g.key;
  }
  return undefined;
}

function splitPair(line: string): [string, string] | null {
  const m = line.match(/^([^=:]+)[=:](.*)$/);
  if (!m) return null;
  return [m[1].trim(), m[2].trim()];
}

function parseNumber(raw: string): number | null {
  // A unit typed alongside the figure is tolerated ("200 l", "4 pcs"): the
  // template does not put one there any more, but people write them.
  const cleaned = raw
    .replace(/\((?:pcs|l|m)\)/gi, "")
    .replace(/\b(pcs|ltr|lt|l|m)\b/gi, "")
    .replace(/,/g, "")
    .trim();
  if (!cleaned) return null;
  if (!/^\d*\.?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return isFinite(n) ? n : null;
}

export interface ParsedStoreCount {
  /** Draft keys → quantities. */
  values: Record<string, number>;
  /** Lines that looked like data but matched no item in their group. */
  unknown: string[];
  /** Lines whose value was not a number. */
  invalid: string[];
}

/**
 * Read one filled-in block.
 *
 * A BLANK LINE RECORDS NOTHING. It is not a zero and it is not an error: it is
 * an item that was not counted this time, and it keeps whatever figure and
 * whatever "last counted" date it already had. A typed 0 is a real count of
 * none, and is recorded as one.
 *
 * A line whose name belongs to a DIFFERENT group than the header above it is
 * reported rather than matched — that is how a 16A breaker figure would end up
 * against the single-phase one, and nothing afterwards could tell.
 */
export function parseStoreCountPaste(block: StoreBlockKey, text: string): ParsedStoreCount {
  const values: Record<string, number> = {};
  const unknown: string[] = [];
  const invalid: string[] = [];
  const groups = groupsOfBlock(block).map((g) => g.key);
  let group: string | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (isGuidance(line)) continue;

    const found = detectGroup(line, block);
    if (found) {
      group = found;
      continue;
    }

    const pair = splitPair(line);
    if (!pair) continue;
    const [name, value] = pair;
    const n = norm(name);

    let key: string | undefined;
    if (group) {
      key = BY_GROUP.get(group)?.get(n);
    } else {
      // Before any header: accept only if exactly one group in this block has
      // that name. Anything else is ambiguous, and guessing is unrecoverable.
      const hits = groups.map((g) => BY_GROUP.get(g)?.get(n)).filter(Boolean) as string[];
      if (hits.length === 1) key = hits[0];
    }

    if (!key) {
      unknown.push(line);
      continue;
    }

    // Not counted. Recorded nowhere, reported as nothing.
    if (!value.trim()) continue;

    const qty = parseNumber(value);
    if (qty === null) invalid.push(line);
    else values[itemKey(key)] = qty;
  }

  return { values, unknown, invalid };
}
