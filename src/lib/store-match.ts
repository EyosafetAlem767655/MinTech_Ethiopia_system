import { extractJson, geminiGenerate } from "@/lib/llm";
import { isProviderBusy } from "@/lib/errors";
import { ADDED_GROUP, GROUP_BY_KEY, STORE_GROUPS, allStoreItems, type StoreItem } from "@/lib/store-items";
import { itemLabel } from "@/lib/store-voucher";
import { templateName } from "@/lib/store-count-paste";
import { storeUnit } from "@/lib/store-custom";
import type { GrvLine, TypedGrvLine } from "@/lib/grv-lines";
import type { Retryable } from "@/lib/llm-retry";

/**
 * Which store item each typed GRV line is.
 *
 * Three passes, cheapest first:
 *  1. EXACT — the line spells an item's name or label (case and punctuation
 *     ignored). No model needed, and no model can get it wrong.
 *  2. AI — one call with the whole list (key · group · name · unit, about 450
 *     lines) and every line still open. The model answers with a key or null
 *     (new), and for a new item the group and unit to file it under.
 *  3. FUZZY — only when the AI is unreachable for a reason other than "busy":
 *     word overlap, accepted only when one item clearly wins. Anything less is
 *     a new item, which the card shows and the person can redirect.
 *
 * A BUSY AI is returned as a failure so the caller's minute-apart retries
 * (readWithBusyRetry) can wait it out rather than settling for a guess.
 */

const norm = (s: string) => s.toLowerCase().replace(/[\s\-_.,*#()/"']/g, "");

const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9.]+/g, " ")
      .split(" ")
      .filter((w) => w.length >= 2)
  );

function exactMatch(line: TypedGrvLine, items: StoreItem[]): StoreItem | null {
  const forms = [norm(line.name), norm(`${line.name} ${line.desc}`), norm(line.desc)].filter(Boolean);
  const hits = items.filter((it) => {
    const names = [norm(it.name), norm(templateName(it)), norm(itemLabel(it)), norm(it.key)];
    return forms.some((f) => names.includes(f));
  });
  return hits.length === 1 ? hits[0] : null;
}

function fuzzyMatch(line: TypedGrvLine, items: StoreItem[]): StoreItem | null {
  const typed = words(`${line.name} ${line.desc}`);
  if (typed.size === 0) return null;
  let best: { item: StoreItem; score: number } | null = null;
  let second = 0;
  for (const it of items) {
    const have = words(itemLabel(it));
    let common = 0;
    for (const w of typed) if (have.has(w)) common++;
    const score = common / Math.max(typed.size, have.size);
    if (!best || score > best.score) {
      second = best?.score ?? 0;
      best = { item: it, score };
    } else if (score > second) second = score;
  }
  return best && best.score >= 0.6 && best.score - second >= 0.2 ? best.item : null;
}

const SYSTEM =
  "You match the lines of a Goods Receiving Voucher at an Ethiopian mineral-grinding plant to the plant's " +
  "spare-parts store list, and return STRICT JSON only.\n" +
  'Return exactly: { "matches": [ { "line": number, "key": string | null, "group": string, "unit": string } ] } ' +
  "with ONE entry per voucher line.\n" +
  "key: the store item's key when the line is that SAME part — same type AND same size/rating/code " +
  '(a "6210" bearing is not a "6212"; a 16A breaker is not a 25A one). If no item is that exact part, key is null ' +
  "and the line becomes a NEW item. Never pick a near miss.\n" +
  "group: for a new item, the best group key from the group list; for a match, the item's group.\n" +
  "unit: for a new item, how it is counted — one of pcs, l, m, roll, pak, kg, set, bottle, drum, tin, berga; " +
  "for a match, the item's unit.";

/**
 * Match every line still pending. A line already decided — matched earlier, or
 * corrected by hand on the card — is kept as it is, so "➕ add more" only asks
 * about the new lines.
 */
export async function matchGrvLines(typed: (TypedGrvLine | GrvLine)[]): Promise<Retryable<GrvLine[]>> {
  const items = allStoreItems();
  const out: GrvLine[] = typed.map((l) => {
    const prior = l as Partial<GrvLine>;
    if (prior.how && prior.how !== "pending") return l as GrvLine;
    const hit = exactMatch(l, items);
    return {
      name: l.name,
      desc: l.desc,
      qty: l.qty,
      cost: l.cost,
      match: hit?.key ?? null,
      group: hit?.group ?? ADDED_GROUP,
      unit: hit?.unit ?? "pcs",
      how: hit ? "exact" : "pending",
    };
  });

  const open = out.map((l, i) => ({ l, i })).filter(({ l }) => l.how === "pending");
  if (open.length === 0) return { ok: true, data: out };

  const catalogue = items.map((it) => `${it.key} | ${GROUP_BY_KEY.get(it.group)?.label ?? it.group} | ${it.name} | ${it.unit}`).join("\n");
  const groups = STORE_GROUPS.map((g) => `${g.key} = ${g.label}`).join("\n");
  const asked = open.map(({ l, i }) => `${i + 1}. ${l.name}${l.desc ? ` — ${l.desc}` : ""}`).join("\n");

  const res = await geminiGenerate(
    [
      {
        role: "user",
        parts: [{ text: `GROUPS:\n${groups}\n\nSTORE LIST (key | group | name | unit):\n${catalogue}\n\nVOUCHER LINES:\n${asked}` }],
      },
    ],
    { json: true, systemInstruction: SYSTEM, errorSource: "grv-match", maxOutputTokens: 8192, timeoutMs: 40_000 }
  );

  if (!res.ok && isProviderBusy(res.error)) return { ok: false, error: res.error || "busy" };

  const byLine = new Map<number, { key: string | null; group: string; unit: string }>();
  if (res.ok) {
    try {
      const p = extractJson(res.text) as { matches?: { line?: unknown; key?: unknown; group?: unknown; unit?: unknown }[] };
      for (const m of p.matches ?? []) {
        const n = Number(m.line);
        if (!Number.isInteger(n)) continue;
        byLine.set(n, {
          key: typeof m.key === "string" && m.key ? m.key : null,
          group: String(m.group || ""),
          unit: String(m.unit || ""),
        });
      }
    } catch (e) {
      console.error("matchGrvLines could not parse the answer:", e);
    }
  }

  const known = new Map(items.map((it) => [it.key, it]));
  for (const { l, i } of open) {
    const ai = byLine.get(i + 1);
    const item = ai?.key ? known.get(ai.key) : undefined;
    if (item) {
      Object.assign(l, { match: item.key, group: item.group, unit: item.unit, how: "ai" });
      continue;
    }
    if (ai) {
      // The model said "new" (or named a key that does not exist — treated the same).
      Object.assign(l, {
        match: null,
        group: GROUP_BY_KEY.has(ai.group) ? ai.group : ADDED_GROUP,
        unit: storeUnit(ai.unit),
        how: "ai",
      });
      continue;
    }
    // No AI answer for this line: the best a word count can do, or new.
    const guess = fuzzyMatch(l, items);
    Object.assign(
      l,
      guess
        ? { match: guess.key, group: guess.group, unit: guess.unit, how: "fuzzy" }
        : { match: null, group: ADDED_GROUP, unit: "pcs", how: "fuzzy" }
    );
  }
  return { ok: true, data: out };
}
