/**
 * The whiteness each product is supposed to come off the line at.
 *
 * MinTech's product sheet, as data. Until now the system recorded whiteness
 * readings and averaged them, but had no idea what a good one was — a 2-EL at
 * 88% and a 2-EL at 95% were two numbers in the same column, and only the
 * person who knew the sheet could tell that one of them is a batch that cannot
 * be sold as Premium.
 *
 * Pure, and importable from anywhere: the bot alert, the exceptions on the
 * Brief and the panel all judge a reading through `belowSpec` here, so the
 * alarm and the screen can never disagree about what is out of spec.
 *
 * NOT EVERY PRODUCT HAS A BAND. W-2-EL, Talc, EC-15 and EC-90 are absent
 * because the sheet does not give one. `specFor` returns null for them and
 * `belowSpec` returns nothing, which is the honest answer — inventing a floor
 * would raise alarms against a standard nobody set. Adding one later is one
 * line here and nothing anywhere else.
 */

export interface WhitenessSpec {
  /** Product code as PRODUCT_ORDER spells it (src/lib/products.ts). */
  code: string;
  /** Particle fineness from the sheet, shown for context; never compared. */
  fineness: string;
  /** The published band, for display. */
  min: number;
  max: number;
  /**
   * The value an alarm fires below — the same as `min`, EXCEPT for the two
   * products the sheet grades twice. See the note on ETL9/ETL15 below.
   */
  alertFloor: number;
  /** Grade wording from the sheet, shown beside the band. */
  grade: string;
}

/**
 * ETL-9 and ETL-15 each appear TWICE on the sheet: Standard (Moyale) at
 * 88.0–92.0 and Industrial (Kuni) at 84.0–88.0. The check records a product and
 * a line, never which grade was being run, so nothing in the data can tell the
 * two apart.
 *
 * The owner's decision is to alarm below 84.0 for both — the Industrial floor.
 * A run at 86% is then silently accepted even if it was meant to be Moyale,
 * which is a real miss; alarming at 88.0 instead would fire on every legitimate
 * Kuni run, and an alarm that is usually wrong stops being read at all. If the
 * flow ever asks for the grade, these two get their own rows and the floor goes
 * back up.
 */
export const WHITENESS_SPECS: WhitenessSpec[] = [
  { code: "2EL", fineness: "10 µm", min: 92.0, max: 96.0, alertFloor: 92.0, grade: "Premium (Grade-1)" },
  { code: "3EL", fineness: "15 µm", min: 90.0, max: 94.0, alertFloor: 90.0, grade: "Premium (Grade-1)" },
  { code: "5EL", fineness: "25 µm", min: 90.0, max: 94.0, alertFloor: 90.0, grade: "Premium (Grade-1)" },
  { code: "ETL6", fineness: "45 µm", min: 88.0, max: 92.0, alertFloor: 88.0, grade: "Standard (Grade-2)" },
  {
    code: "ETL9",
    fineness: "90 µm",
    min: 84.0,
    max: 92.0,
    alertFloor: 84.0,
    grade: "Standard/Moyale 88–92 · Industrial/Kuni 84–88",
  },
  {
    code: "ETL15",
    fineness: "150 µm",
    min: 84.0,
    max: 92.0,
    alertFloor: 84.0,
    grade: "Standard/Moyale 88–92 · Industrial/Kuni 84–88",
  },
];

const BY_CODE = new Map(WHITENESS_SPECS.map((s) => [s.code, s]));

/** The band for a product, or null when the sheet does not give one. */
export function specFor(code: string): WhitenessSpec | null {
  return BY_CODE.get(String(code || "")) ?? null;
}

/** "88.0–92.0%" — the band as it is written on the sheet. */
export function bandLabel(spec: WhitenessSpec): string {
  return `${spec.min.toFixed(1)}–${spec.max.toFixed(1)}%`;
}

/**
 * Is this one reading below the product's floor?
 *
 * Only a NUMBER can be below a floor. A blank slot is not a reading, and MNT,
 * OUTAGE and OFF are a stopped line rather than a bad one — reporting a line
 * down for maintenance as a quality failure would train everybody to ignore the
 * alarm, which is the one way to make it worthless.
 */
export function readingBelow(code: string, raw: string | number | null | undefined): number | null {
  const spec = specFor(code);
  if (!spec) return null;
  const t = String(raw ?? "").trim();
  if (t === "") return null;
  const n = Number(t);
  if (!isFinite(n)) return null;
  return n < spec.alertFloor ? n : null;
}

export interface WhitenessBreach {
  /** The slot it was read in: wb1…wb6. */
  slot: string;
  value: number;
}

/**
 * Every failing slot in one check, in slot order.
 *
 * Slot by slot rather than on the stored average on purpose: an average hides a
 * single bad reading among five good ones, and one out-of-spec sample is the
 * thing somebody on the floor can still act on while the batch is running.
 */
export function belowSpec(
  code: string,
  readings: Record<string, string | number | null | undefined> | null | undefined
): WhitenessBreach[] {
  const spec = specFor(code);
  if (!spec || !readings) return [];
  const out: WhitenessBreach[] = [];
  for (const slot of ["wb1", "wb2", "wb3", "wb4", "wb5", "wb6"]) {
    const value = readingBelow(code, readings[slot]);
    if (value !== null) out.push({ slot, value });
  }
  return out;
}
