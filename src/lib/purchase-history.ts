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
