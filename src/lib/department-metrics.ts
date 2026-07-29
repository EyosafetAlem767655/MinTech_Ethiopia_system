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
 * (windowed trend), receivablesAging and getLotGaps (current-state money/stock).
 */

import sql from "@/lib/sql";
import {
  getBucketedSeries,
  getDayNumbers,
  getLotGaps,
  missingWithholding,
  receivablesAging,
  type TrendPoint,
} from "@/lib/metrics";
import { DEPARTMENTS, type DepartmentKey } from "@/lib/departments";
import { eatDateLabel } from "@/lib/dates";
import { rangeWindow, RANGES, type RangeKey } from "@/lib/ranges";

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
  source: "daily_report" | "shift" | "stone" | "material" | "purchase" | "damage" | "receipt" | "invoice" | "payment";
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
      const [r] = await sql<{ shifts: string; downtime: string }[]>`
        select
          (select count(*) from shift_reports where date >= ${start} and date < ${end})                    as shifts,
          (select coalesce(sum(downtime_minutes),0) from shift_reports where date >= ${start} and date < ${end}) as downtime
      `;
      return [
        { icon: "🪨", label: "Truckloads received", value: base.truckloads },
        { icon: "🏭", label: "Tons produced", value: base.tonsProduced, suffix: " t", decimals: 2 },
        { icon: "👷", label: "Shift reports", value: Number(r.shifts) || 0 },
        { icon: "⏱️", label: "Downtime", value: Number(r.downtime) || 0, suffix: " min" },
      ];
    }

    case "asset_management": {
      const [[r], gaps] = await Promise.all([
        sql<{ materials: string; pr_count: string; pr_amount: string }[]>`
          select
            (select count(*) from material_counts   where created_at >= ${start} and created_at < ${end}) as materials,
            (select count(*) from purchase_requests where created_at >= ${start} and created_at < ${end}) as pr_count,
            (select coalesce(sum(amount),0) from purchase_requests where created_at >= ${start} and created_at < ${end}) as pr_amount
        `,
        getLotGaps(),
      ]);
      const unaccounted = gaps.reduce((a, l) => a + l.gap, 0);
      return [
        { icon: "📦", label: "Material counts", value: Number(r.materials) || 0 },
        { icon: "🛒", label: "Purchase requests", value: Number(r.pr_count) || 0 },
        { icon: "💰", label: "Purchases value", value: Number(r.pr_amount) || 0, prefix: "ETB " },
        { icon: "🛡", label: "Damaged claimed / verified", value: base.damagedClaimed, suffix: ` / ${base.damagedVerified}` },
        { icon: "🔴", label: "Unaccounted bags", value: unaccounted },
      ];
    }

    case "sales": {
      const [r] = await sql<{ invoices: string }[]>`
        select count(*) as invoices from invoices where invoiced_at >= ${start} and invoiced_at < ${end}
      `;
      return [
        { icon: "🤝", label: "Tons sold", value: base.tonsSold, suffix: " t", decimals: 2 },
        { icon: "🧾", label: "Revenue invoiced", value: base.revenueInvoiced, prefix: "ETB " },
        { icon: "📄", label: "Invoices issued", value: Number(r.invoices) || 0 },
      ];
    }

    case "finance": {
      const [aging, wht] = await Promise.all([receivablesAging(), missingWithholding()]);
      const outstanding =
        aging.buckets.current + aging.buckets.d1_30 + aging.buckets.d31_60 + aging.buckets.d61_90 + aging.buckets.d90_plus;
      return [
        { icon: "💵", label: "Cash collected", value: base.cashCollected, prefix: "ETB " },
        { icon: "🧾", label: "Revenue invoiced", value: base.revenueInvoiced, prefix: "ETB " },
        { icon: "⏳", label: "Receivables outstanding", value: outstanding, prefix: "ETB " },
        { icon: "⚠️", label: "Missing withholding", value: wht.length },
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
    select id, full_name, text, photo_file_ids, created_at
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
      const [shifts, stones] = await Promise.all([
        sql<{ id: string; supervisor: string; filled_sacks: number; downtime_minutes: number; shift: string; notes: string | null; date: Date }[]>`
          select id, supervisor, filled_sacks, downtime_minutes, shift, notes, date
            from shift_reports where date >= ${start} and date < ${end} order by date desc limit 30`,
        sql<{ id: string; truck_plate: string; driver_name: string | null; gate_clerk: string | null; loads: number; quality_grade: string; notes: string | null; date: Date }[]>`
          select id, truck_plate, driver_name, gate_clerk, loads, quality_grade, notes, date
            from stone_deliveries where date >= ${start} and date < ${end} order by date desc limit 30`,
      ]);
      typed = [
        ...shifts.map<Submission>((r) => ({
          id: r.id,
          source: "shift",
          who: r.supervisor,
          when: iso(r.date),
          title: `${r.shift === "night" ? "Night" : "Day"} shift · ${r.filled_sacks} sacks`,
          detail: r.notes ?? undefined,
          badge: r.downtime_minutes > 0 ? `${r.downtime_minutes}m downtime` : undefined,
          photos: [],
        })),
        ...stones.map<Submission>((r) => ({
          id: r.id,
          source: "stone",
          who: r.gate_clerk || r.driver_name || "Gate",
          when: iso(r.date),
          title: `Truck ${r.truck_plate} · ${r.loads} load${r.loads === 1 ? "" : "s"}`,
          detail: r.notes ?? undefined,
          badge: r.quality_grade,
          photos: [],
        })),
      ];
      break;
    }

    case "asset_management": {
      const [materials, purchases, damage] = await Promise.all([
        sql<{ id: string; counted_by: string; raw_text: string; photo_file_ids: string[]; created_at: Date }[]>`
          select id, counted_by, raw_text, photo_file_ids, created_at
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
      const [receipts, invoices] = await Promise.all([
        sql<{ id: string; submitted_by: string | null; vendor: string; client: string | null; amount: string; created_at: Date }[]>`
          select id, submitted_by, vendor, client, amount, created_at
            from receipts where created_at >= ${start} and created_at < ${end} order by created_at desc limit 30`,
        sql<{ id: string; client: string; invoice_number: string; amount: string; invoiced_at: Date }[]>`
          select id, client, invoice_number, amount, invoiced_at
            from invoices where invoiced_at >= ${start} and invoiced_at < ${end} order by invoiced_at desc limit 30`,
      ]);
      typed = [
        ...invoices.map<Submission>((r) => ({
          id: r.id,
          source: "invoice",
          who: r.client,
          when: iso(r.invoiced_at),
          title: `Invoice ${r.invoice_number}`,
          detail: `ETB ${Math.round(Number(r.amount)).toLocaleString()}`,
          photos: [],
        })),
        ...receipts.map<Submission>((r) => ({
          id: r.id,
          source: "receipt",
          who: r.submitted_by || r.client || r.vendor,
          when: iso(r.created_at),
          title: `Receipt · ${r.vendor}`,
          detail: `ETB ${Math.round(Number(r.amount)).toLocaleString()}`,
          photos: [],
        })),
      ];
      break;
    }

    case "finance": {
      const payments = await sql<{ id: string; client: string; amount: string; method: string | null; date: Date }[]>`
        select p.id, i.client, p.amount, p.method, p.date
          from payments p join invoices i on i.id = p.invoice_id
         where p.date >= ${start} and p.date < ${end}
         order by p.date desc limit 40`;
      typed = payments.map<Submission>((r) => ({
        id: r.id,
        source: "payment",
        who: r.client,
        when: iso(r.date),
        title: `Payment received`,
        detail: `ETB ${Math.round(Number(r.amount)).toLocaleString()}${r.method ? ` · ${r.method}` : ""}`,
        photos: [],
      }));
      break;
    }
  }

  return [...dailySubs, ...typed].sort((a, b) => (a.when < b.when ? 1 : -1)).slice(0, 60);
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
