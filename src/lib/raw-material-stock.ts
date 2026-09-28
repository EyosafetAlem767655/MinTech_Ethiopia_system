import sql from "@/lib/sql";
import { FINANCE_RAW_MATERIALS } from "@/lib/products";
import { monthBounds, monthLabel } from "@/lib/finance-report";

/**
 * Does the raw material counted on the ground agree with the paperwork?
 *
 * Opening balance + everything received − everything issued is what SHOULD be
 * on the ground. The daily report also carries what somebody actually saw
 * there. The two are recorded by the same person on the same form, which is
 * exactly why they are worth comparing: a gap is not a typo in one figure, it
 * is material that moved without being written down.
 *
 * The same argument as the PP bag stock check, and the same presentation.
 */

export interface MaterialCheckRow {
  material: string;
  baseBalance: number;
  received: number;
  issued: number;
  /** Opening + received − issued. */
  expected: number;
  /** The last figure actually counted, or null if none was. */
  counted: number | null;
  gap: number | null;
}

export interface RawMaterialCheck {
  month: string;
  /** The date of the stock figures being compared, or null. */
  countedOn: string | null;
  rows: MaterialCheckRow[];
  discrepancies: MaterialCheckRow[];
}

const n = (v: unknown) => Number(v) || 0;
const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** A gap smaller than this is rounding, not a missing tonne. */
const TOLERANCE_T = 0.05;

export async function rawMaterialCheck(month = monthLabel()): Promise<RawMaterialCheck> {
  const { start, end } = monthBounds(month);

  const [base, daily] = await Promise.all([
    sql<{ raw_materials: Record<string, number> }[]>`
      select raw_materials from monthly_base_balances where month = ${month}
    `.catch(() => []),
    sql<{ date: string; received: Record<string, number>; issued: Record<string, number>; stock: Record<string, number> }[]>`
      select date, received, issued, stock
        from raw_material_daily
       where date >= ${start} and date < ${end}
       order by date asc
    `.catch(() => []),
  ]);

  const opening = base[0]?.raw_materials ?? {};

  // The LAST report of the month that actually carried a stock figure. A day
  // filed with the stock block left blank is not a count of zero, and taking
  // it as one would invent a gap the size of the whole yard.
  const counted = [...daily].reverse().find((r) => Object.values(r.stock || {}).some((v) => n(v) > 0));

  const rows = FINANCE_RAW_MATERIALS.map<MaterialCheckRow>((material) => {
    const baseBalance = round3(n(opening[material]));
    const received = round3(daily.reduce((a, r) => a + n(r.received?.[material]), 0));
    const issued = round3(daily.reduce((a, r) => a + n(r.issued?.[material]), 0));
    const expected = round3(baseBalance + received - issued);
    const stock = counted ? round3(n(counted.stock?.[material])) : null;
    return {
      material,
      baseBalance,
      received,
      issued,
      expected,
      counted: stock,
      gap: stock === null ? null : round3(stock - expected),
    };
  });

  return {
    month,
    countedOn: counted ? new Date(counted.date).toISOString() : null,
    rows,
    discrepancies: rows.filter((r) => r.gap !== null && Math.abs(r.gap) > TOLERANCE_T),
  };
}
