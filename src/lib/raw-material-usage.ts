import sql from "@/lib/sql";
import { FINANCE_RAW_MATERIALS, G1, PRODUCT_ORDER, g1Key } from "@/lib/products";
import { rawMaterialOpening } from "@/lib/raw-material-opening";

/**
 * Raw material, from October 2026 on: worked out from what was produced.
 *
 * Nobody reports what production used. Each day's produced tons, plus 5% for
 * wastage, come off the material that product is made from, and asset management
 * files only what arrives (🧱). 🚚 credit purchases add nothing here: they are a
 * record of who is owed.
 *
 *     remaining = opening + received − produced × 1.05
 *
 * October opens as it did before this rule (the last September count). After
 * that a month opens with the balance filed for it, or else with the calculated
 * closing of the month before. Because the walk is recomputed from the reports,
 * correcting a production report corrects every figure after it.
 *
 * Grade 1 is a stream of its own: its stone arrives apart, is priced apart and
 * is used only by Grade 1 tons. It rides in the same jsonb under `g1:` keys, so
 * every reader that knows only the three material names is unaffected.
 */

export const WASTAGE = 1.05;
export const RAW_USAGE_SINCE = "2026-10";

export const MATERIAL_OF_PRODUCT: Record<string, string> = {
  ETL15: "Dolomite",
  ETL9: "Dolomite",
  ETL6: "Dolomite",
  "5EL": "Dolomite",
  "3EL": "Dolomite",
  W2EL: "Dolomite",
  "2EL": "Dolomite",
  EC15: "Lime Stone",
  EC90: "Lime Stone",
  Talk: "Talc",
};

type Tons = Record<string, number>;
type Source = "counted" | "submitted" | "carried" | "none";

export interface LedgerDay {
  /** YYYY-MM-DD, EAT. */
  day: string;
  /** Tons produced from each material, before wastage. */
  produced: Tons;
  /** produced × 1.05. */
  used: Tons;
  received: Tons;
  /** What is left at the end of the day. */
  remaining: Tons;
}

export interface LedgerStream {
  opening: Tons;
  openingSource: Source;
  /** The count day, or the month the figure came from. */
  openingFrom: string | null;
  received: Tons;
  used: Tons;
  closing: Tons;
  days: LedgerDay[];
}

/** Grade 1 finished product, per product code. */
export interface Grade1Finished {
  produced: Tons;
  delivered: Tons;
  /** Production's last reported Grade 1 stock in or before the month. */
  stock: Tons;
  stockFrom: string | null;
}

export interface RawLedger {
  month: string;
  normal: LedgerStream;
  /** Null when the month has no Grade 1 anywhere: the display stays hidden. */
  grade1: LedgerStream | null;
  finished: Grade1Finished | null;
}

const n = (v: unknown) => Number(v) || 0;
const round3 = (v: number) => Math.round(v * 1000) / 1000;
const zero = (): Tons => Object.fromEntries(FINANCE_RAW_MATERIALS.map((m) => [m, 0]));
const anyTons = (t: Tons) => Object.values(t).some((v) => v !== 0);
const missing = (e: unknown) => (e as { code?: string })?.code === "42P01";

/** Tons of each raw material a day's products used, wastage included. */
export function rawUsedFrom(products: Record<string, unknown> | null | undefined): Tons {
  const out = producedFrom(products);
  for (const m of FINANCE_RAW_MATERIALS) out[m] = round3(out[m] * WASTAGE);
  return out;
}

/** Tons produced from each raw material, before wastage. A product not on the list uses none. */
function producedFrom(products: Record<string, unknown> | null | undefined): Tons {
  const out = zero();
  for (const [code, tons] of Object.entries(products || {})) {
    const material = MATERIAL_OF_PRODUCT[code];
    if (material) out[material] = round3(out[material] + n(tons));
  }
  return out;
}

/** The EAT day of a stored date: 21:00Z the evening before is the next day. */
const dayOf = (d: Date | string) => new Date(new Date(d).getTime() + 3 * 3_600_000).toISOString().slice(0, 10);

/** Every month from `first` to `last`, oldest first. */
function monthsBetween(first: string, last: string): string[] {
  const out: string[] = [];
  let [y, m] = first.split("-").map(Number);
  for (;;) {
    const label = `${y}-${String(m).padStart(2, "0")}`;
    if (label > last) return out;
    out.push(label);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
}

interface DayMoves {
  produced: Tons;
  received: Tons;
}

/** One month of one stream, given its opening. */
function runMonth(
  days: Map<string, DayMoves>,
  opening: Tons,
  openingSource: Source,
  openingFrom: string | null
): LedgerStream {
  const remaining = { ...opening };
  const received = zero();
  const used = zero();
  const rows: LedgerDay[] = [];

  for (const [day, moves] of [...days.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const dayUsed = zero();
    for (const m of FINANCE_RAW_MATERIALS) {
      dayUsed[m] = round3(moves.produced[m] * WASTAGE);
      received[m] = round3(received[m] + moves.received[m]);
      used[m] = round3(used[m] + dayUsed[m]);
      remaining[m] = round3(remaining[m] + moves.received[m] - dayUsed[m]);
    }
    rows.push({ day, produced: moves.produced, used: dayUsed, received: moves.received, remaining: { ...remaining } });
  }

  return { opening, openingSource, openingFrom, received, used, closing: { ...remaining }, days: rows };
}

/** The filed figures for one stream, or null if the month filed none for it. */
function filedFor(raw: Record<string, unknown> | null | undefined, prefix: string): Tons | null {
  const out = zero();
  let filed = false;
  for (const m of FINANCE_RAW_MATERIALS) {
    const key = `${prefix}${m}`;
    if (raw?.[key] === undefined) continue;
    out[m] = n(raw[key]);
    filed = true;
  }
  return filed ? out : null;
}

function moveOn(
  byDay: Map<string, Map<string, DayMoves>>,
  month: string
): Map<string, DayMoves> {
  return byDay.get(month) ?? new Map();
}

function addTo(byMonth: Map<string, Map<string, DayMoves>>, day: string, patch: Partial<DayMoves>) {
  const month = day.slice(0, 7);
  const days = byMonth.get(month) ?? new Map<string, DayMoves>();
  const moves = days.get(day) ?? { produced: zero(), received: zero() };
  for (const m of FINANCE_RAW_MATERIALS) {
    moves.produced[m] = round3(moves.produced[m] + n(patch.produced?.[m]));
    moves.received[m] = round3(moves.received[m] + n(patch.received?.[m]));
  }
  days.set(day, moves);
  byMonth.set(month, days);
}

/** The month's raw material, or null before the rule began. `month` is 'YYYY-MM'. */
export async function rawMaterialLedger(month: string): Promise<RawLedger | null> {
  if (month < RAW_USAGE_SINCE) return null;

  const [sy, sm] = RAW_USAGE_SINCE.split("-").map(Number);
  const since = new Date(Date.UTC(sy, sm - 1, 1) - 3 * 3_600_000);

  const [production, receipts, balances, october] = await Promise.all([
    // to_jsonb so a database without the grade1 column (0046) still reads.
    sql<{ date: Date; products: Tons | null; grade1: { products?: Tons; stock?: Tons; delivered?: Tons } | null }[]>`
      select p.date, p.products, to_jsonb(p) -> 'grade1' as grade1
        from production_reports p
       where p.date >= ${since}
       order by p.date asc
    `.catch((e) => {
      if (!missing(e)) throw e;
      return [];
    }),
    sql<{ date: Date; received: Tons | null }[]>`
      select date, received from raw_material_daily where date >= ${since}
    `.catch((e) => {
      if (!missing(e)) throw e;
      return [];
    }),
    sql<{ month: string; raw_materials: Tons | null }[]>`
      select month, raw_materials from monthly_base_balances where month >= ${RAW_USAGE_SINCE}
    `.catch((e) => {
      if (!missing(e)) throw e;
      return [];
    }),
    rawMaterialOpening(RAW_USAGE_SINCE),
  ]);

  const normalMoves = new Map<string, Map<string, DayMoves>>();
  const grade1Moves = new Map<string, Map<string, DayMoves>>();

  for (const r of production) {
    const day = dayOf(r.date);
    addTo(normalMoves, day, { produced: producedFrom(r.products) });
    if (r.grade1?.products) addTo(grade1Moves, day, { produced: producedFrom(r.grade1.products) });
  }
  for (const r of receipts) {
    const day = dayOf(r.date);
    addTo(normalMoves, day, { received: Object.fromEntries(FINANCE_RAW_MATERIALS.map((m) => [m, n(r.received?.[m])])) });
    const g1 = Object.fromEntries(FINANCE_RAW_MATERIALS.map((m) => [m, n(r.received?.[g1Key(m)])]));
    if (anyTons(g1)) addTo(grade1Moves, day, { received: g1 });
  }

  const filed = new Map(balances.map((b) => [b.month, b.raw_materials]));
  const octoberOpening = zero();
  for (const m of FINANCE_RAW_MATERIALS) octoberOpening[m] = round3(n(october.values[m]));

  let normal: LedgerStream | null = null;
  let grade1: LedgerStream | null = null;
  let previous = "";

  for (const m of monthsBetween(RAW_USAGE_SINCE, month)) {
    const filedNormal = filedFor(filed.get(m), "");
    normal =
      m === RAW_USAGE_SINCE
        ? runMonth(moveOn(normalMoves, m), octoberOpening, october.source, october.countedOn ?? october.fromMonth)
        : filedNormal
          ? runMonth(moveOn(normalMoves, m), filedNormal, "submitted", m)
          : runMonth(moveOn(normalMoves, m), normal!.closing, "carried", previous);

    // Grade 1 has no history before this rule, so it starts from nothing.
    const filedGrade1 = filedFor(filed.get(m), G1);
    grade1 = filedGrade1
      ? runMonth(moveOn(grade1Moves, m), filedGrade1, "submitted", m)
      : grade1
        ? runMonth(moveOn(grade1Moves, m), grade1.closing, "carried", previous)
        : runMonth(moveOn(grade1Moves, m), zero(), "none", null);
    previous = m;
  }

  const showGrade1 =
    grade1 !== null &&
    (anyTons(grade1.opening) || anyTons(grade1.received) || anyTons(grade1.used) || grade1.openingSource === "submitted");

  return {
    month,
    normal: normal!,
    grade1: showGrade1 ? grade1 : null,
    finished: grade1FinishedFrom(production, month),
  };
}

/** Grade 1 finished product for the month: only if some Grade 1 was reported. */
function grade1FinishedFrom(
  rows: { date: Date; grade1: { products?: Tons; stock?: Tons; delivered?: Tons } | null }[],
  month: string
): Grade1Finished | null {
  const produced: Tons = {};
  const delivered: Tons = {};
  let stock: Tons = {};
  let stockFrom: string | null = null;
  let seen = false;

  for (const r of rows) {
    if (!r.grade1) continue;
    const day = dayOf(r.date);
    if (day.slice(0, 7) > month) continue;
    if (Object.keys(r.grade1.stock || {}).length > 0) {
      stock = r.grade1.stock as Tons;
      stockFrom = day;
    }
    if (day.slice(0, 7) !== month) continue;
    seen = true;
    for (const code of PRODUCT_ORDER) {
      produced[code] = round3((produced[code] || 0) + n(r.grade1.products?.[code]));
      delivered[code] = round3((delivered[code] || 0) + n(r.grade1.delivered?.[code]));
    }
  }

  return seen || anyTons(stock) ? { produced, delivered, stock, stockFrom } : null;
}

/** The months the ledger covers, newest first, up to `current`. */
export function ledgerMonths(current: string): string[] {
  return monthsBetween(RAW_USAGE_SINCE, current).reverse();
}
