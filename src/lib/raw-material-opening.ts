import sql from "@/lib/sql";
import { FINANCE_RAW_MATERIALS } from "@/lib/products";

/**
 * What raw material a month OPENS with.
 *
 * A beginning balance submitted for the month (monthly_base_balances) is the
 * opening, as it always was. A month with none no longer opens at nothing: it
 * opens with the month before's CLOSING — that month's opening plus everything
 * the daily raw-material reports received, less everything they issued — and
 * so on back to the newest month that was submitted. Before this, a balance
 * filed for September was never carried into October, so an issue on the 2nd
 * of October came off the wrong figure.
 *
 * With no submission anywhere, the chain starts from zero at the first daily
 * report.
 */

export interface RawMaterialOpening {
  /** Tonnes per finance material name. */
  values: Record<string, number>;
  /** "submitted": filed for this month. "carried": last month's closing. "none": nothing to go on. */
  source: "submitted" | "carried" | "none";
  /** The submitted month the carried figure starts from, if any. */
  fromMonth: string | null;
}

const n = (v: unknown) => Number(v) || 0;
const round3 = (v: number) => Math.round(v * 1000) / 1000;
const missing = (e: unknown) => (e as { code?: string })?.code === "42P01";

/** `month` is 'YYYY-MM'. */
export async function rawMaterialOpening(month: string): Promise<RawMaterialOpening> {
  const bases = await sql<{ month: string; raw_materials: Record<string, number> | null }[]>`
    select month, raw_materials from monthly_base_balances
     where month <= ${month}
     order by month desc
     limit 1
  `.catch((e) => {
    if (!missing(e)) throw e;
    return [];
  });
  const base = bases[0];

  const values: Record<string, number> = {};
  for (const m of FINANCE_RAW_MATERIALS) values[m] = round3(n(base?.raw_materials?.[m]));
  if (base && base.month === month) return { values, source: "submitted", fromMonth: month };

  // The daily reports from the submitted month (or the very first one) up to
  // the end of the month before this one.
  const from = base ? `${base.month}-01` : "0000-01-01";
  const daily = await sql<{ received: Record<string, number> | null; issued: Record<string, number> | null }[]>`
    select received, issued from raw_material_daily
     where date_label >= ${from} and date_label < ${`${month}-01`}
  `.catch((e) => {
    if (!missing(e)) throw e;
    return [];
  });

  if (!base && daily.length === 0) return { values, source: "none", fromMonth: null };
  for (const r of daily) {
    for (const m of FINANCE_RAW_MATERIALS) {
      values[m] = round3(values[m] + n(r.received?.[m]) - n(r.issued?.[m]));
    }
  }
  return { values, source: "carried", fromMonth: base?.month ?? null };
}
