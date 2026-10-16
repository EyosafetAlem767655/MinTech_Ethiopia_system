import { GROUP_BY_KEY, STORE_ITEM_BY_KEY, type StoreUnit } from "@/lib/store-items";
import { itemLabel } from "@/lib/store-voucher";

/**
 * The GRV's items, typed: one line per item, matched to the store list by AI.
 *
 *   Name | description | quantity | unit price
 *   Ball bearing | 6210 2RS SKF | 4 | 1500
 *
 * The tick-lists (department → group → item) made a receiving clerk hunt
 * through three keyboards for a bearing they were holding the paper for. Now
 * they type what the supplier's invoice says, the AI says which store item
 * each line is, and a line that is none of them becomes a new item — so the
 * list grows with what the store actually buys.
 *
 * Each line lives in the draft as JSON under `gl:<n>` (1-based, contiguous).
 * Pure — no `sql` — so the parser, the card and the save share it.
 */

/** The fill-in step. No ":" in step ids — see store-voucher.ts. */
export const GRV_LINES_STEP = "grvLines";
/** "Are these matches right?" */
export const GRV_MATCH_STEP = "grvMatch";
/** Set while lines are being ADDED to those already there ("➕ add more"). */
export const GRV_APPEND_KEY = "grvAppend";

export const GRV_MATCH_OK = "ok";
export const GRV_MATCH_MORE = "more";
export const GRV_MATCH_REDO = "redo";

/** Lines per voucher. A card of more than this would pass Telegram's 4096 characters. */
export const MAX_GRV_LINES = 40;

export type GrvHow = "pending" | "exact" | "ai" | "fuzzy" | "manual";

export interface GrvLine {
  name: string;
  desc: string;
  qty: number;
  /** Unit price on the supplier's invoice; null when not given. */
  cost: number | null;
  /** The store item's key, or null for a NEW item. */
  match: string | null;
  /** For a new item: the group it is filed under and the unit it is counted in. */
  group: string;
  unit: StoreUnit;
  /** How the match was decided — "pending" until the matcher has run. */
  how: GrvHow;
}

export const grvLineKey = (n: number) => `gl:${n}`;

/** Every typed line, in order. */
export function grvLines(draft: Record<string, string | number>): GrvLine[] {
  const out: GrvLine[] = [];
  for (let n = 1; n <= MAX_GRV_LINES; n++) {
    const raw = draft[grvLineKey(n)];
    if (raw === undefined || raw === "") break;
    try {
      out.push(JSON.parse(String(raw)) as GrvLine);
    } catch {
      break;
    }
  }
  return out;
}

/** Replace the lines in the draft. */
export function setGrvLines(draft: Record<string, string | number>, lines: GrvLine[]): void {
  for (let n = 1; n <= MAX_GRV_LINES; n++) delete draft[grvLineKey(n)];
  lines.slice(0, MAX_GRV_LINES).forEach((l, i) => {
    draft[grvLineKey(i + 1)] = JSON.stringify(l);
  });
}

export const hasGrvLines = (draft: Record<string, string | number>) => draft[grvLineKey(1)] !== undefined;

/** "1,500", "1500 birr", "4 pcs" → number; null if not a number. */
function toNumber(raw: string): number | null {
  const cleaned = String(raw || "")
    .replace(/,/g, "")
    .replace(/\b(pcs|pc|ltr|lt|l|kg|m|roll|rolls|pak|pkt|set|sets|drum|drums|bottle|bottles|tin|tins|berga|bag|bags|box|boxes|birr|etb|br)\b\.?|ብር/gi, "")
    .trim();
  if (!cleaned || !/^\d*\.?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return isFinite(n) ? n : null;
}

/** What one typed line says before matching. */
export type TypedGrvLine = Pick<GrvLine, "name" | "desc" | "qty" | "cost">;

/**
 * Read typed lines.
 *
 * Fields are split on "|" (a tab or " - " also works for a phone that hides
 * the bar). The quantity and price are read from the END, so a description
 * that itself contains numbers ("6210 2RS") stays whole:
 *
 *   name | desc | qty | price   → as written
 *   name | qty | price          → no description
 *   name | desc | qty           → no price (asked about on the card)
 *
 * A line with no quantity is reported back, not guessed.
 */
export function parseGrvLines(text: string): { lines: TypedGrvLine[]; bad: string[] } {
  const lines: TypedGrvLine[] = [];
  const bad: string[] = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim().replace(/^\d+[.)]\s+/, ""); // "1. …" numbering
    if (!line || /^[-—#>]/.test(line) || /^name\s*\|/i.test(line)) continue;
    const parts = line.split(/\s*[|\t]\s*|\s+-\s+/).map((p) => p.trim());
    while (parts.length && !parts[parts.length - 1]) parts.pop();
    if (parts.length < 2) {
      bad.push(raw.trim());
      continue;
    }
    const last = toNumber(parts[parts.length - 1]);
    const prev = parts.length >= 3 ? toNumber(parts[parts.length - 2]) : null;
    let qty: number | null;
    let cost: number | null;
    let text: string[];
    if (prev !== null && last !== null) {
      qty = prev;
      cost = last;
      text = parts.slice(0, -2);
    } else {
      qty = last;
      cost = null;
      text = parts.slice(0, -1);
    }
    const name = (text[0] || "").trim();
    if (!name || qty === null || qty <= 0) {
      bad.push(raw.trim());
      continue;
    }
    lines.push({ name, desc: text.slice(1).join(" ").trim(), qty, cost: cost && cost > 0 ? cost : null });
  }
  return { lines, bad };
}

/**
 * Corrections sent back on the match card: "3 = new" makes line 3 a new item,
 * "3 = brg:6210" points it at that store item. Several per message.
 */
export function parseGrvOverrides(
  text: string,
  count: number
): { changes: { n: number; match: string | null }[]; bad: string[] } {
  const changes: { n: number; match: string | null }[] = [];
  const bad: string[] = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(\d+)\s*[=:]\s*(.+)$/);
    if (!m) {
      bad.push(line);
      continue;
    }
    const n = Number(m[1]);
    const target = m[2].trim();
    if (n < 1 || n > count) {
      bad.push(line);
      continue;
    }
    if (/^(new|አዲስ|🆕)$/i.test(target)) changes.push({ n, match: null });
    else if (STORE_ITEM_BY_KEY.has(target)) changes.push({ n, match: target });
    else bad.push(line);
  }
  return { changes, bad };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const money = (n: number) => (Math.round(n * 100) / 100).toLocaleString();

/** One line on the card: what was typed, and what it was matched to. */
export function grvLineSummary(l: GrvLine, n: number): string {
  const typed = `${esc(l.name)}${l.desc ? ` <i>${esc(l.desc)}</i>` : ""} · ${money(l.qty)}${l.cost ? ` × ${money(l.cost)}` : " × <b>?</b>"}`;
  const item = l.match ? STORE_ITEM_BY_KEY.get(l.match) : undefined;
  const target = item
    ? `→ ${esc(itemLabel(item))} <code>${esc(item.key)}</code>`
    : `→ 🆕 new · ${esc(GROUP_BY_KEY.get(l.group)?.label ?? l.group)} · ${l.unit}`;
  return `${n}. ${typed}\n    ${target}`;
}

/** Telegram's limit is 4096 characters a message; the card is split well under it. */
const CARD_LIMIT = 3800;

/**
 * The match card, sent before the "are these right?" question — as several
 * messages when the voucher is long (40 lines of real invoice wording run past
 * Telegram's 4096 characters). Never splits a line.
 */
export function grvMatchCards(lines: GrvLine[]): string[] {
  const news = lines.filter((l) => !l.match).length;
  const unpriced = lines.filter((l) => !l.cost).length;
  const head = `📦 <b>${lines.length} ዕቃ</b> — ከመጋዘን ዝርዝሩ ጋር ተገናኝቷል:\n\n`;
  const tail =
    (news ? `\n\n🆕 ${news} አዲስ ዕቃ ወደ ዝርዝሩ ይገባል።` : "") +
    (unpriced ? `\n⚠️ ${unpriced} ዕቃ ዋጋ የለውም።` : "") +
    "\n\n<i>ለማስተካከል፦ <code>3 = new</code> (አዲስ ዕቃ) ወይም <code>3 = brg:6210</code> (ያለ ዕቃ) ይላኩ።</i>";
  const out: string[] = [];
  let cur = head;
  lines.forEach((l, i) => {
    const entry = grvLineSummary(l, i + 1);
    if (cur.length + entry.length + 1 > CARD_LIMIT) {
      out.push(cur.trimEnd());
      cur = "";
    }
    cur += entry + "\n";
  });
  if (cur.length + tail.length > CARD_LIMIT) {
    out.push(cur.trimEnd());
    cur = "";
  }
  out.push((cur.trimEnd() + tail).trim());
  return out;
}

/** The whole card as one string — short vouchers, and tests. */
export const grvMatchCard = (lines: GrvLine[]) => grvMatchCards(lines).join("\n");

/** The example shown with the fill-in step. */
export const GRV_LINES_EXAMPLE =
  "Name | Description | Qty | Unit price\n" +
  "Ball bearing | 6210 2RS SKF | 4 | 1500\n" +
  "V-Belt | C-150 | 6 | 850";
