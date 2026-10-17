/**
 * Per-department report: KPIs, a bucketed trend series, the raw bot submissions
 * that landed in the window, and a contributor roster.
 *
 * Everything that attributes a submission to a person reads the DENORMALISED
 * name stored on the report row (full_name / worker / requested_by / …), never a
 * live join to telegram_users. That is what makes the report survive a user
 * being archived or deleted: the rows keep their names, so history stays whole.
 *
 * Reuses the metrics layer: getDayNumbers (windowed KPIs), getBucketedSeries
 * (windowed trend) and the per-department queries below.
 */

import sql from "@/lib/sql";
import {
  getBucketedSeries,
  getDayNumbers,
  type TrendPoint,
} from "@/lib/metrics";
import { DEPARTMENTS, DEPARTMENT_KEYS, type DepartmentKey } from "@/lib/departments";
import { eatDateLabel } from "@/lib/dates";
import { rangeWindow, RANGES, type RangeKey } from "@/lib/ranges";
import { cashSales, creditTotals, millions, monthNetWorth } from "@/lib/finance-summary";

export interface Kpi {
  label: string;
  value: number;
  icon: string;
  prefix?: string;
  suffix?: string;
  decimals?: number;
}

export interface Submission {
  id: string;
  /** Source table, used for the icon/label in the feed. */
  source: "daily_report" | "production" | "material" | "purchase" | "damage" | "receipt" | "invoice" | "payment";
  who: string;
  when: string; // ISO timestamp
  title: string;
  detail?: string;
  badge?: string;
  photos: string[];
}

export interface RosterEntry {
  name: string;
  submissions: number;
}

export interface DepartmentReport {
  department: DepartmentKey;
  range: RangeKey;
  window: { start: string; end: string; label: string; bucket: string };
  /** The metric this department's trend chart should plot. */
  metric: "production" | "sales" | "collections";
  kpis: Kpi[];
  series: TrendPoint[];
  submissions: Submission[];
  roster: RosterEntry[];
}

const iso = (d: Date | string) => (d instanceof Date ? d.toISOString() : new Date(d).toISOString());

export async function getDepartmentReport(
  dept: DepartmentKey,
  rangeKey: RangeKey,
  now = new Date()
): Promise<DepartmentReport> {
  const { start, end, bucket } = rangeWindow(rangeKey, now);

  const [series, base, submissions] = await Promise.all([
    getBucketedSeries(start, end, bucket),
    getDayNumbers(start, end),
    departmentSubmissions(dept, start, end),
  ]);

  const kpis = await departmentKpis(dept, start, end, base);
  const roster = rosterFrom(submissions);
  const metric: DepartmentReport["metric"] =
    dept === "production" ? "production" : dept === "finance" ? "collections" : "sales";

  return {
    department: dept,
    range: rangeKey,
    window: {
      start: eatDateLabel(start),
      // end is start-of-tomorrow; label the last included day
      end: eatDateLabel(new Date(end.getTime() - 1)),
      label: RANGES[rangeKey].label,
      bucket,
    },
    metric,
    kpis,
    series,
    submissions,
    roster,
  };
}

/* ─────────────────────────────────── KPIs ─────────────────────────────────── */

async function departmentKpis(
  dept: DepartmentKey,
  start: Date,
  end: Date,
  base: Awaited<ReturnType<typeof getDayNumbers>>
): Promise<Kpi[]> {
  switch (dept) {
    case "production": {
      // Shift analysis and stone traceability were removed from the system, so
      // their KPIs went with them. What is left is what the guided daily report
      // actually records: tonnage produced and how many days were filed.
      const [r] = await sql<{ reports: string }[]>`
        select count(*) as reports from production_reports
         where date >= ${start} and date < ${end}
      `;
      return [
        { icon: "🏭", label: "Tons produced", value: base.tonsProduced, suffix: " t", decimals: 2 },
        { icon: "📋", label: "Production reports", value: Number(r.reports) || 0 },
      ];
    }

    case "asset_management": {
      // What this role actually files. It used to count `material_counts` — a
      // table nothing has written since that capability was retired — so the
      // card showed two figures, one of them permanently zero, while the raw
      // material, voucher and bag-damage reports it files every day
      // were nowhere on it.
      //
      // The voucher counts are guarded separately: they arrive in 0019, and a
      // database one migration behind must still show the other four.
      const [[r], vouchers] = await Promise.all([
        sql<{ raw: string; damage: string; pr_count: string }[]>`
          select
            (select count(*) from raw_material_receipts where date >= ${start} and date < ${end})       as raw,
            (select count(*) from pp_bag_damage_reports where date >= ${start} and date < ${end})       as damage,
            (select count(*) from purchase_requests     where created_at >= ${start} and created_at < ${end}) as pr_count
        `,
        // By when they were filed — see the Brief card below for why.
        Promise.all([
          countRows("goods_receiving_vouchers", "created_at", start, end),
          countRows("store_issue_vouchers", "created_at", start, end),
        ]).then(([grv, siv]) => [{ grv: String(grv), siv: String(siv) }]),
      ]);
      const v = vouchers[0] ?? { grv: "0", siv: "0" };
      return [
        { icon: "🚚", label: "Raw material in", value: base.rawMaterialTons, suffix: " t", decimals: 2 },
        { icon: "📥", label: "Goods received", value: Number(v.grv) || 0 },
        { icon: "📤", label: "Store issues", value: Number(v.siv) || 0 },
        { icon: "💔", label: "PP bag damage", value: Number(r.damage) || 0 },
        { icon: "🛒", label: "Purchase requests", value: Number(r.pr_count) || 0 },
      ];
    }

    case "sales": {
      // Invoicing went with the old finance module; the sales team's own bot
      // reports — one row per sale — are the record now.
      const [r] = await sql<{ n: string; grand: string; tons: string }[]>`
        select count(*) as n,
               coalesce(sum(invoice_cash + invoice_credit), 0) as grand,
               coalesce(sum(qty), 0) as tons
          from sales_invoices where date >= ${start} and date < ${end}
      `.catch(() => [{ n: "0", grand: "0", tons: "0" }]);
      return [
        { icon: "🤝", label: "Tons sold", value: Number(r.tons) || 0, suffix: " t", decimals: 2 },
        { icon: "🧾", label: "Sales invoiced", value: Number(r.grand) || 0, prefix: "ETB " },
        { icon: "📄", label: "Sales", value: Number(r.n) || 0 },
      ];
    }

    case "finance": {
      // Money owed and money held — the credit book and the monthly report —
      // rather than the purchase-batch count, which has had no writer since
      // the GRV replaced it and read 0 every day.
      const [credit, cash, worth, [w]] = await Promise.all([
        creditTotals(),
        cashSales(start, end),
        monthNetWorth(),
        sql<{ wht: string }[]>`select count(*) as wht from wht_holders where status = 'pending'`.catch(() => [{ wht: "0" }]),
      ]);
      return [
        { icon: "💳", label: "Credit outstanding (ETB)", value: credit.outstanding },
        { icon: "⏰", label: `Overdue · ${credit.overdueSales} sale${credit.overdueSales === 1 ? "" : "s"} (ETB)`, value: credit.overdue },
        { icon: "💵", label: "Cash sales (ETB)", value: cash },
        { icon: "📊", label: "Stock net worth this month (ETB)", value: worth },
        { icon: "📄", label: "WHT receipts owed", value: Number(w?.wht) || 0 },
      ];
    }
  }
}

/* ──────────────────────────────── Submissions ─────────────────────────────── */

async function departmentSubmissions(dept: DepartmentKey, start: Date, end: Date): Promise<Submission[]> {
  const positions = DEPARTMENTS[dept].positions;

  // Free-text daily reports belong to a department when the submitter held any
  // of its positions at submission time. `positions` is denormalised on the row.
  const daily = sql<
    { id: string; full_name: string; text: string; photo_file_ids: string[]; created_at: Date }[]
  >`
    select id, full_name, text,
           -- Both columns: uuids for rows filed before 0025, Telegram ids after.
           -- /api/files serves either, so the panel is unaffected.
           (photo_file_ids::text[] || tg_file_ids) as photo_file_ids, created_at
      from daily_reports
     where created_at >= ${start} and created_at < ${end}
       and positions && ${positions}::text[]
     order by created_at desc
     limit 40
  `;

  const dailySubs = (await daily).map<Submission>((r) => ({
    id: r.id,
    source: "daily_report",
    who: r.full_name,
    when: iso(r.created_at),
    title: "Daily report",
    detail: r.text,
    photos: (r.photo_file_ids as string[]) ?? [],
  }));

  let typed: Submission[] = [];

  switch (dept) {
    case "production": {
      // The production grid is the department's submission now; the shift and
      // gate feeds were removed with their modules.
      const prod = await sql<{ id: string; fgr_no: string | null; reported_by: string; products: Record<string, number>; date: Date }[]>`
        select id, fgr_no, reported_by, products, date
          from production_reports where date >= ${start} and date < ${end}
         order by date desc limit 30`;
      typed = prod.map<Submission>((r) => {
        const tons = Object.values(r.products || {}).reduce((a, b) => a + Number(b || 0), 0);
        return {
          id: r.id,
          source: "production",
          who: r.reported_by,
          when: iso(r.date),
          title: `${tons.toFixed(2)} t produced`,
          badge: r.fgr_no ? `FGR ${r.fgr_no}` : undefined,
          photos: [],
        };
      });
      break;
    }
    case "asset_management": {
      const [materials, purchases, damage] = await Promise.all([
        sql<{ id: string; counted_by: string; raw_text: string; photo_file_ids: string[]; created_at: Date }[]>`
          select id, counted_by, raw_text,
                 (photo_file_ids::text[] || tg_file_ids) as photo_file_ids, created_at
            from material_counts where created_at >= ${start} and created_at < ${end} order by created_at desc limit 30`,
        sql<{ id: string; requested_by: string; title: string; amount: string; status: string; created_at: Date }[]>`
          select id, requested_by, title, amount, status, created_at
            from purchase_requests where created_at >= ${start} and created_at < ${end} order by created_at desc limit 30`,
        sql<{ id: string; worker: string; quantity: number; status: string; created_at: Date }[]>`
          select id, worker, quantity, status, created_at
            from damage_claims where created_at >= ${start} and created_at < ${end} order by created_at desc limit 30`,
      ]);
      typed = [
        ...materials.map<Submission>((r) => ({
          id: r.id,
          source: "material",
          who: r.counted_by,
          when: iso(r.created_at),
          title: "Material count",
          detail: r.raw_text,
          photos: (r.photo_file_ids as string[]) ?? [],
        })),
        ...purchases.map<Submission>((r) => ({
          id: r.id,
          source: "purchase",
          who: r.requested_by,
          when: iso(r.created_at),
          title: r.title,
          badge: r.status,
          detail: `ETB ${Math.round(Number(r.amount)).toLocaleString()}`,
          photos: [],
        })),
        ...damage.map<Submission>((r) => ({
          id: r.id,
          source: "damage",
          who: r.worker,
          when: iso(r.created_at),
          title: `${r.quantity} damaged bag${r.quantity === 1 ? "" : "s"}`,
          badge: r.status,
          photos: [],
        })),
      ];
      break;
    }

    case "sales": {
      const receipts = await sql<{ id: string; submitted_by: string | null; vendor: string; client: string | null; amount: string; created_at: Date }[]>`
        select id, submitted_by, vendor, client, amount, created_at
          from receipts where created_at >= ${start} and created_at < ${end}
         order by created_at desc limit 30`;
      typed = receipts.map<Submission>((r) => ({
        id: r.id,
        source: "receipt",
        who: r.submitted_by || r.client || r.vendor,
        when: iso(r.created_at),
        title: `Receipt · ${r.vendor}`,
        detail: `ETB ${Math.round(Number(r.amount)).toLocaleString()}`,
        photos: [],
      }));
      break;
    }

    case "finance": {
      const batches = await sql<{ id: string; sr_no: number; purchaser: string | null; reported_by: string; currency: string; total_amount: string | null; date: Date }[]>`
        select id, sr_no, purchaser, reported_by, currency, total_amount, date
          from finance_purchase_batches where date >= ${start} and date < ${end}
         order by date desc limit 40`.catch(() => []);
      typed = batches.map<Submission>((r) => ({
        id: r.id,
        source: "purchase",
        who: r.purchaser || r.reported_by,
        when: iso(r.date),
        title: `Purchase batch #${r.sr_no}`,
        detail: r.total_amount ? `${r.currency} ${Math.round(Number(r.total_amount)).toLocaleString()}` : undefined,
        photos: [],
      }));
      break;
    }
  }

  return [...dailySubs, ...typed].sort((a, b) => (a.when < b.when ? 1 : -1)).slice(0, 60);
}

/* ─────────────────────────────── Brief summaries ──────────────────────────── */

/** A compact, at-a-glance summary of one department for the Brief landing. */
export interface DepartmentSummary {
  department: DepartmentKey;
  metric: DepartmentReport["metric"];
  /** The two headline activity counts for the window. */
  headline: Kpi[];
  /** Total submissions in the window across the department's tables. */
  activityCount: number;
}

export async function getDepartmentSummary(
  dept: DepartmentKey,
  rangeKey: RangeKey,
  now = new Date()
): Promise<DepartmentSummary> {
  const { start, end } = rangeWindow(rangeKey, now);

  // The Brief needs ONLY cheap indexed counts. It must never run the per-submission
  // feed (ORDER BY created_at LIMIT scans) or the heavy report queries (bucketed
  // series, day numbers, receivables aging, lot balances): four departments' worth
  // of those in parallel is what pushed this route to a 504. The full submission
  // feed + roster live on the per-department detail page, loaded one at a time.
  const counts = await departmentActivityCounts(dept, start, end);

  const metric: DepartmentReport["metric"] =
    dept === "production" ? "production" : dept === "finance" ? "collections" : "sales";

  return {
    department: dept,
    metric,
    headline: counts.headline,
    activityCount: counts.total,
  };
}

/**
 * Rows of one table in the window, on one column. A table or column a migration
 * has not added yet counts 0 — for this figure only, never the whole card.
 */
async function countRows(table: string, column: "date" | "created_at", start: Date, end: Date): Promise<number> {
  try {
    const [r] = await sql<{ n: string }[]>`
      select count(*) as n from ${sql(table)} where ${sql(column)} >= ${start} and ${sql(column)} < ${end}
    `;
    return Number(r?.n) || 0;
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code !== "42P01" && code !== "42703") throw e;
    console.warn(`countRows(${table}): not migrated yet; counting 0`);
    return 0;
  }
}

/**
 * Cheap COUNT-only activity tallies for a department's Brief summary.
 *
 * ONE RULE GOVERNS THIS FUNCTION: every figure it produces must be findable on
 * that department's tab. A card is a door, and a number on it that the room
 * behind does not contain sends somebody looking for something that is not
 * there.
 *
 * Three of the four cards broke that rule. Production showed "Daily reports" —
 * a count that is structurally almost always zero (the production position does
 * not hold the free-text daily-report capability at all) and that no production
 * panel renders. Asset showed "Material counts", a table nothing has written
 * since that capability was retired; the detail KPIs were fixed for exactly
 * this reason months ago and these were missed. Sales showed "Receipts", which
 * left the sales tab when it was rebuilt around invoices.
 *
 * The windows also match the panels now: every count filters on the report's
 * own `date` where it has one, because that is what the tables on the tab
 * filter on. Counting arrivals here while the tab counts report dates would put
 * a "3 updates" pill above a table showing two rows.
 */
async function departmentActivityCounts(
  dept: DepartmentKey,
  start: Date,
  end: Date
): Promise<{ total: number; headline: Kpi[] }> {
  // Every count below tolerates a table that is not there yet. These four run
  // in parallel behind one Brief, so a single missing relation — the sales
  // table between a deploy and its migration, say — would otherwise 500 the
  // whole page rather than blank one tile. A zero here is honest: nothing
  // could have been filed into a table that does not exist.
  const missing = (e: unknown) => {
    if ((e as { code?: string })?.code !== "42P01") throw e;
    console.warn(`departmentActivityCounts(${dept}): a table is not migrated yet; counting 0`);
  };

  switch (dept) {
    case "production": {
      // The tab is exactly two panels, so the card is exactly two numbers.
      const [a] = await sql<{ production: string; whiteness: string }[]>`
        select
          (select count(*) from production_reports where date >= ${start} and date < ${end}) as production,
          (select count(*) from whiteness_checks   where date >= ${start} and date < ${end}) as whiteness`.catch(
        (e) => {
          missing(e);
          return [{ production: "0", whiteness: "0" }];
        }
      );
      const production = Number(a.production) || 0;
      const whiteness = Number(a.whiteness) || 0;
      return {
        total: production + whiteness,
        headline: [
          { icon: "🏭", label: "Production reports", value: production },
          { icon: "⚪", label: "Whiteness checks", value: whiteness },
        ],
      };
    }
    case "asset_management": {
      // Four tiles, because this tab is four things and a card showing two of
      // them describes a quarter of the department.
      //
      // "Raw material loads" used to head this card, counting
      // `raw_material_receipts` — the per-TRUCK table that nothing has written
      // since the daily raw-material report replaced it. The figure could only
      // ever be stale or zero, and nobody could say what it was counting. It is
      // gone from here; the rows stay readable under Settings → Submissions.
      //
      // Split in two queries on purpose: the second group of tables arrives in
      // 0014, 0019, 0022 and 0033, and a database a migration behind must still
      // show the counts it does have rather than an empty card.
      //
      // Each figure is its OWN count. They used to share one statement whose
      // failure — any one table — zeroed every tile on the card at once.
      //
      // The vouchers are counted by when they were FILED. A store issue keyed in
      // today from last month's paper pad carries last month's date; counted by
      // that date it fell outside the window and the card said 0 store issues
      // on a day several were submitted. The tab's voucher list is not windowed,
      // so this is also what agrees with it.
      const [purchases, claims, raw, grv, bags, siv, usage, damage, stock] = await Promise.all([
        countRows("purchase_requests", "created_at", start, end),
        countRows("damage_claims", "created_at", start, end),
        countRows("raw_material_daily", "date", start, end),
        countRows("goods_receiving_vouchers", "created_at", start, end),
        countRows("pp_bag_purchases", "date", start, end),
        countRows("store_issue_vouchers", "created_at", start, end),
        countRows("pp_bag_usage", "date", start, end),
        countRows("pp_bag_damage_reports", "date", start, end),
        countRows("daily_ops_reports", "date", start, end),
      ]);
      // Goods received is both ways they arrive: the voucher, and the PP bag
      // receiving form that took the bags off it.
      const received = grv + bags;
      const total = raw + purchases + received + siv + claims + usage + damage + stock;
      return {
        total,
        headline: [
          { icon: "🧱", label: "Raw material days", value: raw },
          { icon: "📥", label: "Goods received", value: received },
          { icon: "📤", label: "Store issues", value: siv },
          { icon: "🛒", label: "Purchase requests", value: purchases },
        ],
      };
    }
    case "sales": {
      // Tonnage rather than a second count: the tab leads with the analytics,
      // and how much left the yard is the figure that tab is built around.
      const [a] = await sql<{ sales: string; tons: string }[]>`
        select count(*) as sales, coalesce(sum(qty), 0) as tons
          from sales_invoices where date >= ${start} and date < ${end}`.catch((e) => {
        missing(e);
        return [{ sales: "0", tons: "0" }];
      });
      const sales = Number(a.sales) || 0;
      return {
        total: sales,
        headline: [
          { icon: "🧾", label: "Sales", value: sales },
          { icon: "🤝", label: "Tons sold", value: Number(a.tons) || 0, suffix: " t", decimals: 2 },
        ],
      };
    }
    case "finance": {
      // The card shows what Finance watches — the credit book and this month's
      // report — in millions so a nine-digit birr figure fits a tile. The
      // "updates" badge counts what Finance actually files now: credit
      // collections, goods received and price lists.
      const [credit, cash, worth, [a]] = await Promise.all([
        creditTotals(),
        cashSales(start, end),
        monthNetWorth(),
        sql<{ payments: string; grv: string; prices: string }[]>`
          select
            (select count(*) from sales_credit_payments    where created_at >= ${start} and created_at < ${end}) as payments,
            (select count(*) from goods_receiving_vouchers where date >= ${start} and date < ${end})             as grv,
            (select count(*) from monthly_price_lists      where updated_at >= ${start} and updated_at < ${end}) as prices
        `.catch((e) => {
          missing(e);
          return [{ payments: "0", grv: "0", prices: "0" }];
        }),
      ]);
      const M = { suffix: " M", decimals: 2 } as const;
      return {
        total: (Number(a.payments) || 0) + (Number(a.grv) || 0) + (Number(a.prices) || 0),
        headline: [
          { icon: "💳", label: "Credit outstanding (ETB)", value: millions(credit.outstanding), ...M },
          { icon: "⏰", label: `Overdue · ${credit.overdueSales} sale${credit.overdueSales === 1 ? "" : "s"}`, value: millions(credit.overdue), ...M },
          { icon: "💵", label: "Cash sales (ETB)", value: millions(cash), ...M },
          { icon: "📊", label: "Stock net worth, this month", value: millions(worth), ...M },
        ],
      };
    }
  }
}

/** Summaries for all four departments — the payload behind the Brief. */
export async function getAllDepartmentSummaries(
  rangeKey: RangeKey,
  now = new Date()
): Promise<DepartmentSummary[]> {
  return Promise.all(DEPARTMENT_KEYS.map((k) => getDepartmentSummary(k, rangeKey, now)));
}

/* ──────────────────────────────────── Roster ──────────────────────────────── */

function rosterFrom(submissions: Submission[]): RosterEntry[] {
  const counts = new Map<string, number>();
  for (const s of submissions) {
    const name = s.who?.trim() || "Unknown";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, n]) => ({ name, submissions: n }))
    .sort((a, b) => b.submissions - a.submissions);
}
