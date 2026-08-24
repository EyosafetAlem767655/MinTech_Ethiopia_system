import sql from "@/lib/sql";
import { submissionTablesFor } from "@/lib/positions";

/**
 * Who has reported today, across every kind of submission.
 *
 * Compliance used to be measured by a `daily_reports` row alone — but that table
 * is only ever written by the free-text `daily_report` capability. Roles that
 * report through the guided flows (asset management, sales) had no way to
 * produce one, so they could never be marked as done: reminded again every
 * morning after filing, permanently in the HR/Admin "missing" list, stuck at 0/7
 * on the compliance panel. This asks each role's own tables instead.
 */

/**
 * How each table records who filed and when. The author column genuinely varies
 * per table, which is why this map exists rather than a convention.
 *
 * `payments` is deliberately absent: it has no author column at all, so a
 * payment can never be attributed to the person who entered it.
 */
const SOURCES: Record<string, { who: string; when: string }> = {
  daily_reports: { who: "full_name", when: "created_at" },
  hr_reports: { who: "full_name", when: "created_at" },
  material_counts: { who: "counted_by", when: "created_at" },
  daily_ops_reports: { who: "reported_by", when: "created_at" },
  production_reports: { who: "reported_by", when: "created_at" },
  stock_status_reports: { who: "reported_by", when: "created_at" },
  purchase_item_reports: { who: "reported_by", when: "created_at" },
  raw_material_receipts: { who: "reported_by", when: "created_at" },
  delivery_reports: { who: "reported_by", when: "created_at" },
  pp_bag_damage_reports: { who: "reported_by", when: "created_at" },
  material_issues: { who: "reported_by", when: "created_at" },
  monthly_base_balances: { who: "reported_by", when: "created_at" },
  finance_purchase_batches: { who: "reported_by", when: "created_at" },
  pp_bag_purchases: { who: "reported_by", when: "created_at" },
  wht_holders: { who: "registered_by", when: "created_at" },
  purchase_requests: { who: "requested_by", when: "created_at" },
  sales_receipts: { who: "reported_by", when: "created_at" },
  receipts: { who: "submitted_by", when: "created_at" },
};

/** EAT day bounds for a "YYYY-MM-DD" label. */
export function eatDayBounds(dayLabel: string): { start: Date; end: Date } {
  const start = new Date(`${dayLabel}T00:00:00+03:00`);
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

/**
 * Who filed into each of `tables` on the given EAT day, as table → names.
 *
 * Matched by name because that is the only identifier all of these tables share
 * — most carry a `reported_by` string rather than a user id. Names are lowercased
 * so a capitalisation difference between the roster and a report does not read as
 * a missed submission.
 */
export async function reportersByTable(
  dayLabel: string,
  tables: string[]
): Promise<Map<string, Set<string>>> {
  const { start, end } = eatDayBounds(dayLabel);
  const out = new Map<string, Set<string>>();

  await Promise.all(
    tables.map(async (table) => {
      const src = SOURCES[table];
      if (!src) return;
      try {
        const rows = await sql<{ who: string }[]>`
          select distinct ${sql(src.who)} as who
            from ${sql(table)}
           where ${sql(src.when)} >= ${start} and ${sql(src.when)} < ${end}
        `;
        out.set(table, new Set(rows.map((r) => String(r.who || "").trim().toLowerCase()).filter(Boolean)));
      } catch (e) {
        // A table from an unapplied migration must not break the whole digest.
        const code = (e as { code?: string })?.code;
        if (code !== "42P01" && code !== "42703") console.error(`reportersByTable(${table}) failed:`, e);
        out.set(table, new Set());
      }
    })
  );
  return out;
}

/**
 * Which EAT days each person reported on, per table, over a window.
 *
 * One query per table for the whole roster and the whole window, rather than one
 * per person per day. Keys are lowercased names, matching reportersByTable.
 */
export async function reporterDaysByTable(
  fromLabel: string,
  tables: string[]
): Promise<Map<string, Map<string, Set<string>>>> {
  const start = new Date(`${fromLabel}T00:00:00+03:00`);
  const out = new Map<string, Map<string, Set<string>>>();

  await Promise.all(
    tables.map(async (table) => {
      const src = SOURCES[table];
      if (!src) return;
      try {
        const rows = await sql<{ who: string; day: string }[]>`
          select distinct ${sql(src.who)} as who,
                 to_char((${sql(src.when)} at time zone 'Africa/Addis_Ababa')::date, 'YYYY-MM-DD') as day
            from ${sql(table)}
           where ${sql(src.when)} >= ${start}
        `;
        const byName = new Map<string, Set<string>>();
        for (const r of rows) {
          const name = String(r.who || "").trim().toLowerCase();
          if (!name) continue;
          if (!byName.has(name)) byName.set(name, new Set());
          byName.get(name)!.add(r.day);
        }
        out.set(table, byName);
      } catch (e) {
        const code = (e as { code?: string })?.code;
        if (code !== "42P01" && code !== "42703") console.error(`reporterDaysByTable(${table}) failed:`, e);
        out.set(table, new Map());
      }
    })
  );
  return out;
}

/** Union of the days this person reported on, across their own tables. */
export function daysFor(
  byTable: Map<string, Map<string, Set<string>>>,
  fullName: string,
  positions: string[]
): Set<string> {
  const name = fullName.trim().toLowerCase();
  const days = new Set<string>();
  for (const table of submissionTablesFor(positions)) {
    for (const d of byTable.get(table)?.get(name) ?? []) days.add(d);
  }
  return days;
}

/**
 * Split a roster into those who reported and those who did not, using each
 * person's own roles to decide what counts.
 *
 * One query per table for the whole roster, then a pure in-memory check per
 * person — filing a purchase request must not discharge a raw-material
 * obligation, so each person is only credited for their own tables.
 */
export async function splitByCompliance<T extends { full_name: string; positions: string[] }>(
  dayLabel: string,
  people: T[]
): Promise<{ submitted: T[]; missing: T[] }> {
  const allTables = [...new Set(people.flatMap((p) => submissionTablesFor(p.positions)))];
  const byTable = await reportersByTable(dayLabel, allTables);

  const submitted: T[] = [];
  const missing: T[] = [];
  for (const p of people) {
    const mine = submissionTablesFor(p.positions);
    const name = p.full_name.trim().toLowerCase();
    const filed = mine.length === 0 || mine.some((t) => byTable.get(t)?.has(name));
    (filed ? submitted : missing).push(p);
  }
  return { submitted, missing };
}
