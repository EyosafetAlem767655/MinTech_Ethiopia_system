/**
 * "Have we bought this before?" — the one question a worn-out-tool request has
 * to survive.
 *
 * Until now the screen could not answer it: a belt replaced three times in two
 * months looked exactly like a belt replaced once. These match earlier requests
 * by ITEM NAME, which is all the bot records — there is no part number, and
 * pretending otherwise would be worse than matching on words.
 *
 * Pure and apart from the panel so it can be tested without rendering anything,
 * and so the rule lives in one place if the same history is ever wanted on the
 * bot side.
 */

/** Words worth matching on: lowercased, punctuation gone, noise words dropped. */
export function itemWords(title: string): Set<string> {
  const stop = new Set(["the", "a", "an", "of", "for", "and", "new", "old", "pcs", "pc", "pack"]);
  return new Set(
    String(title || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]+/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !stop.has(w))
  );
}

/**
 * Two titles naming the same thing.
 *
 * Every significant word of the shorter name must appear in the longer one — so
 * "belt" matches "grinder belt" (asked loosely once, precisely the next time)
 * while "grinder motor" does not match "grinder belt", because "motor" is
 * missing.
 *
 * Deliberately NOT a substring test: that makes "belt" match "belt tensioner
 * bolt", and a false match here is worse than a miss — it would have somebody
 * refuse a request on the strength of a purchase that was for something else.
 */
export function sameItem(a: string, b: string): boolean {
  const wa = itemWords(a);
  const wb = itemWords(b);
  if (wa.size === 0 || wb.size === 0) return false;
  const [small, big] = wa.size <= wb.size ? [wa, wb] : [wb, wa];
  for (const w of small) if (!big.has(w)) return false;
  return true;
}

/** Edit distance, for one-letter typos between a request and a voucher line. */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const keep = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = keep;
    }
  }
  return row[b.length];
}

/**
 * A request and the voucher line that bought it, typed by different people.
 *
 * Looser than sameItem, for a different question ("did this arrive?" rather
 * than "was this asked for before?"):
 *   - every part number (a word with a digit) in either must be in the other,
 *     so a 6210 bearing never matches a 6201;
 *   - with a shared part number, one more word in common is enough ("Ball
 *     bearing 6210" is "6210 bearing SKF"); without one, at least 60% of the
 *     shorter name's words must be found, so "grinder motor" never matches
 *     "grinder belt". A word of five letters or more may be one letter off.
 */
export function similarItem(a: string, b: string): boolean {
  const wa = itemWords(a);
  const wb = itemWords(b);
  if (wa.size === 0 || wb.size === 0) return false;
  const hasDigit = (w: string) => /\d/.test(w);
  for (const w of wa) if (hasDigit(w) && !wb.has(w)) return false;
  for (const w of wb) if (hasDigit(w) && !wa.has(w)) return false;
  const [small, big] = wa.size <= wb.size ? [wa, wb] : [wb, wa];
  const near = (w: string) =>
    big.has(w) || (w.length >= 5 && !hasDigit(w) && [...big].some((x) => x.length >= 5 && distance(w, x) <= 1));
  const words = [...small].filter((w) => !hasDigit(w));
  if (words.length === 0) return true;
  const found = words.filter(near).length;
  // A shared part number already names the item; one word then confirms the kind.
  const sharedNumber = [...wa].some((w) => hasDigit(w) && wb.has(w));
  return found >= 1 && (sharedNumber || found / words.length >= 0.6);
}

/** The shape this needs from a request row; the panel's Row satisfies it. */
export interface HistoryRow {
  _id: string;
  title: string;
  createdAt: string;
}

/**
 * Earlier requests for the same item, newest first.
 *
 * Strictly EARLIER: a request never lists itself, and never lists one filed
 * after it — reading a June request must show what June could have known.
 */
export function priorRequests<T extends HistoryRow>(row: T, all: T[]): T[] {
  const at = new Date(row.createdAt).getTime();
  return all
    .filter((r) => r._id !== row._id && new Date(r.createdAt).getTime() < at && sameItem(r.title, row.title))
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
}

/** "4 months ago" — how long ago, in the words the question is asked in. */
export function agoLabel(iso: string, now = Date.now()): string {
  const days = Math.floor((now - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.round(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}
