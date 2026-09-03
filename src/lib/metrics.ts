import sql from "@/lib/sql";
import { addDays, daysBetween, eatDateLabel, eatDayStart, yesterdayRange } from "@/lib/dates";
import { reconcileBags } from "@/lib/stock-reconciliation";

/**
 * All dashboard numbers. Previously 10 MongoDB aggregation pipelines; now SQL.
 *
 * Two behaviours are preserved deliberately and must not drift:
 *   1. Tons = sacks × (bagWeightKg / 1000), but ONLY when a bag weight is
 *      recorded. Records predating the tons migration have no weight and must
 *      contribute 0 — not be treated as some default. `bag_weight_kg` is
 *      nullable and `null > 0` is null (falsy) in the CASE, so they fall to 0.
 *   2. Day boundaries are Ethiopian (EAT, UTC+3). Mongo faked this by adding
 *      3h of milliseconds before formatting; Postgres has the real timezone.
 */

const EAT = "Africa/Addis_Ababa";

/* ─────────────────────────── Yesterday's numbers ──────────────────────────── */

export interface DayNumbers {
  date: string;
  tonsProduced: number;
  /** Finished goods dispatched, from the asset team's delivery reports. */
  tonsSold: number;
  damagedClaimed: number;
  damagedVerified: number;
  /** Cash sales filed by the sales team through the bot (`sales_receipts`). */
  salesReportedEtb: number;
  salesReportedNetEtb: number;
  salesReportsCount: number;
  /** Asset management: raw material in, finished goods out, open tool requests. */
  rawMaterialTons: number;
  rawMaterialLoads: number;
  deliveredTons: number;
  deliveryCount: number;
  openToolRequests: number;
}

export async function getDayNumbers(start: Date, end: Date): Promise<DayNumbers> {
  // Six separate Mongo aggregates collapse into one round trip.
  const [r] = await sql<
    {
      tons_produced: string;
      tons_sold: string;
      damaged_claimed: string;
      damaged_verified: string;
    }[]
  >`
    select
        -- Production = the tonnage on the guided daily production report, which is
      -- the plant's own record of output. It used to sum daily_ops_reports.delivered,
      -- but the guided flow writes production_reports and only ever touches the ops
      -- row's stock/bags — so every report filed since the switch read as zero tons.
      -- Historic days that only ever had a pasted ops report still fall back to
      -- the delivered map; the coalesce is per-day, so a day with both is never counted twice.
      (select coalesce(sum(d.tons), 0) from (
         select coalesce(p.n, o.n) as tons
           from (select (r.date at time zone ${EAT})::date as d,
                        sum((e.value)::numeric) as n
                   from production_reports r
                   cross join lateral jsonb_each_text(r.products) as e(key, value)
                  where r.date >= ${start} and r.date < ${end}
                  group by 1) p
           full outer join (select (r.date at time zone ${EAT})::date as d,
                                   sum((e.value)::numeric) as n
                              from daily_ops_reports r
                              cross join lateral jsonb_each_text(r.delivered) as e(key, value)
                             where r.date >= ${start} and r.date < ${end}
                             group by 1) o on o.d = p.d
       ) d)                                                                         as tons_produced,

      -- Dispatched tonnage, from the asset team's delivery reports. It used to
      -- come from invoices.sacks x bag_weight_kg, but nothing has created an
      -- invoice since the finance module was retired, so that read as zero.
      (select coalesce(sum((e.value)::numeric), 0)
         from delivery_reports r
         cross join lateral jsonb_each_text(r.products) as e(key, value)
        where r.date >= ${start} and r.date < ${end})                               as tons_sold,

      (select coalesce(sum(quantity), 0)
         from damage_claims where created_at >= ${start} and created_at < ${end})   as damaged_claimed,

      (select coalesce(sum(quantity), 0)
         from damage_claims
        where reviewed_at >= ${start} and reviewed_at < ${end}
          and status = 'verified')                                                  as damaged_verified
  `;

  // Kept as its own guarded round trip rather than three more subqueries above:
  // sales_receipts arrives in a later migration, and a missing table would fail
  // the whole statement — taking the entire dashboard and the morning brief with
  // it, not just the sales line.
  //
  // Bucketed by the receipt's own sale date, not created_at, so a receipt keyed
  // in the next morning still counts against the day it was actually sold.
  const [s] = await sql<{ grand: string; net: string; n: string }[]>`
    select coalesce(sum(grand_total), 0) as grand,
           coalesce(sum(net_pay), 0)     as net,
           count(*)                      as n
      from sales_receipts
     where date >= ${start} and date < ${end}
  `.catch((e) => {
    if ((e as { code?: string })?.code !== "42P01") console.error("getDayNumbers sales_receipts failed:", e);
    return [{ grand: "0", net: "0", n: "0" }];
  });

  // Asset management, guarded the same way and for the same reason: these three
  // tables must never be able to take the dashboard and the cron brief down
  // together. Raw material tonnage sums the jsonb material map.
  const [a] = await sql<
    { raw_tons: string; raw_loads: string; delivered: string; deliveries: string; tools: string }[]
  >`
    select
      (select coalesce(sum((e.value)::numeric), 0)
         from raw_material_receipts r
         cross join lateral jsonb_each_text(r.materials) as e(key, value)
        where r.date >= ${start} and r.date < ${end})                          as raw_tons,
      (select count(*) from raw_material_receipts
        where date >= ${start} and date < ${end})                              as raw_loads,
      (select coalesce(sum(qty), 0) from delivery_reports
        where date >= ${start} and date < ${end})                              as delivered,
      (select count(*) from delivery_reports
        where date >= ${start} and date < ${end})                              as deliveries,
      -- Open requests are a running backlog, not a same-day figure, so this one
      -- is deliberately not windowed.
      (select count(*) from purchase_requests where status = 'pending')        as tools
  `.catch((e) => {
    if ((e as { code?: string })?.code !== "42P01") console.error("getDayNumbers asset tables failed:", e);
    return [{ raw_tons: "0", raw_loads: "0", delivered: "0", deliveries: "0", tools: "0" }];
  });

  return {
    date: eatDateLabel(start),
    tonsProduced: Math.round(Number(r.tons_produced) * 1000) / 1000,
    tonsSold: Math.round(Number(r.tons_sold) * 1000) / 1000,
    damagedClaimed: Number(r.damaged_claimed) || 0,
    damagedVerified: Number(r.damaged_verified) || 0,
    salesReportedEtb: Number(s?.grand) || 0,
    salesReportedNetEtb: Number(s?.net) || 0,
    salesReportsCount: Number(s?.n) || 0,
    rawMaterialTons: Math.round((Number(a?.raw_tons) || 0) * 1000) / 1000,
    rawMaterialLoads: Number(a?.raw_loads) || 0,
    deliveredTons: Math.round((Number(a?.delivered) || 0) * 1000) / 1000,
    deliveryCount: Number(a?.deliveries) || 0,
    openToolRequests: Number(a?.tools) || 0,
  };
}

export async function getYesterdayNumbers(now = new Date()): Promise<DayNumbers> {
  const { start, end } = yesterdayRange(now);
  return getDayNumbers(start, end);
}

/* ─────────────────────────────── Trend series ─────────────────────────────── */

export interface TrendPoint {
  date: string;
  production: number;
  sales: number;
  collections: number;
}

export async function getDailySeries(days: number, now = new Date()): Promise<TrendPoint[]> {
  const end = eatDayStart(now);
  const start = addDays(end, -days);

  // generate_series does the zero-fill that used to be a JS Map loop, so a day
  // with no activity is guaranteed to appear as 0 rather than go missing.
  const rows = await sql<{ date: string; production: string; sales: string; collections: string }[]>`
    with days as (
      select generate_series(
        (${start}::timestamptz at time zone ${EAT})::date,
        (${end}::timestamptz   at time zone ${EAT})::date - 1,
        interval '1 day'
      )::date as d
    ),
    prod as (
      -- Production = daily ops "Delivered" tonnage (sum of the jsonb map),
      -- bucketed to the EAT calendar day. The report's date is stored at UTC
      -- midnight of that day, so the EAT conversion lands on the same date.
      select (r.date at time zone ${EAT})::date as d,
             sum((e.value)::numeric) as n
        from daily_ops_reports r
        cross join lateral jsonb_each_text(r.delivered) as e(key, value)
       where r.date >= ${start} and r.date < ${end}
       group by 1
    ),
    -- Sales = what the sales team filed on the bot. It used to be invoices.amount,
    -- but nothing has created an invoice since the finance module was retired,
    -- so that line read flat zero.
    sales as (
      select (date at time zone ${EAT})::date as d, sum(grand_total) as n
        from sales_receipts
       where date >= ${start} and date < ${end}
       group by 1
    ),
    -- Collections = the same reports net of withholding. Payments against an
    -- invoice no longer exist as a concept.
    coll as (
      select (date at time zone ${EAT})::date as d, sum(net_pay) as n
        from sales_receipts
       where date >= ${start} and date < ${end}
       group by 1
    )
    select to_char(days.d, 'YYYY-MM-DD') as date,
           coalesce(prod.n,  0) as production,
           coalesce(sales.n, 0) as sales,
           coalesce(coll.n,  0) as collections
      from days
      left join prod  on prod.d  = days.d
      left join sales on sales.d = days.d
      left join coll  on coll.d  = days.d
     order by days.d
  `;

  return rows.map((r) => ({
    date: r.date,
    production: Number(r.production) || 0,
    sales: Number(r.sales) || 0,
    collections: Number(r.collections) || 0,
  }));
}

/**
 * Production / sales / collections over an arbitrary [start, end) window,
 * bucketed by day, week or month. This is the windowed generalisation of
 * getDailySeries used by the department reports — the daily version above stays
 * as the owner dashboard's fast path (a single 90-day day-bucketed fetch it can
 * slice), while this one serves the six department ranges and their coarser
 * buckets. Empty buckets are zero-filled by generate_series, same as above.
 */
export async function getBucketedSeries(
  start: Date,
  end: Date,
  bucket: "day" | "week" | "month"
): Promise<TrendPoint[]> {
  const step = bucket === "day" ? "1 day" : bucket === "week" ? "1 week" : "1 month";

  const rows = await sql<{ date: string; production: string; sales: string; collections: string }[]>`
    with buckets as (
      select generate_series(
        date_trunc(${bucket}, (${start}::timestamptz at time zone ${EAT})),
        date_trunc(${bucket}, (${end}::timestamptz   at time zone ${EAT}) - interval '1 second'),
        ${step}::interval
      ) as b
    ),
    -- Per DAY first, then bucketed: production_reports is the guided flow's own
    -- table, with historic pasted ops rows falling back to the delivered map. Coalescing
    -- per day means a day recorded both ways contributes once, not twice.
    prod_day as (
      select coalesce(p.d, o.d) as d, coalesce(p.n, o.n) as n
        from (select (r.date at time zone ${EAT})::date as d, sum((e.value)::numeric) as n
                from production_reports r
                cross join lateral jsonb_each_text(r.products) as e(key, value)
               where r.date >= ${start} and r.date < ${end}
               group by 1) p
        full outer join
             (select (r.date at time zone ${EAT})::date as d, sum((e.value)::numeric) as n
                from daily_ops_reports r
                cross join lateral jsonb_each_text(r.delivered) as e(key, value)
               where r.date >= ${start} and r.date < ${end}
               group by 1) o on o.d = p.d
    ),
    prod as (
      select date_trunc(${bucket}, d) as b, sum(n) as n from prod_day group by 1
    ),
    sales as (
      select date_trunc(${bucket}, date at time zone ${EAT}) as b, sum(grand_total) as n
        from sales_receipts
       where date >= ${start} and date < ${end}
       group by 1
    ),
    coll as (
      select date_trunc(${bucket}, date at time zone ${EAT}) as b, sum(net_pay) as n
        from sales_receipts
       where date >= ${start} and date < ${end}
       group by 1
    )
    select to_char(buckets.b, 'YYYY-MM-DD') as date,
           coalesce(prod.n,  0) as production,
           coalesce(sales.n, 0) as sales,
           coalesce(coll.n,  0) as collections
      from buckets
      left join prod  on prod.b  = buckets.b
      left join sales on sales.b = buckets.b
      left join coll  on coll.b  = buckets.b
     order by buckets.b
  `;

  return rows.map((r) => ({
    date: r.date,
    production: Number(r.production) || 0,
    sales: Number(r.sales) || 0,
    collections: Number(r.collections) || 0,
  }));
}

export function bestAndWorstDays(series: TrendPoint[], key: keyof Omit<TrendPoint, "date">) {
  if (series.length === 0) return null;
  let best = series[0];
  let worst = series[0];
  for (const p of series) {
    if (p[key] > best[key]) best = p;
    if (p[key] < worst[key]) worst = p;
  }
  return { best: { date: best.date, value: best[key] }, worst: { date: worst.date, value: worst[key] } };
}

const sumOf = (s: TrendPoint[], k: keyof Omit<TrendPoint, "date">) => s.reduce((a, p) => a + p[k], 0);
const pctChange = (cur: number, prev: number) =>
  prev === 0 ? null : Math.round(((cur - prev) / prev) * 1000) / 10;

/**
 * Month-on-month from an already-fetched series — no queries of its own.
 *
 * `series` must be at least 60 days, ordered oldest→newest. The last 30 entries
 * are the current window and the 30 before them are the comparison window, so a
 * single 90-day fetch serves the whole dashboard.
 *
 * BEHAVIOUR CHANGE (bug fix, carried over from the Mongo port): the original
 * built the comparison window as `getDailySeries(60, T-30).slice(0, 30)`, which
 * takes the *first* 30 days of a 60-day window — days 60–90 ago — skipping days
 * 30–60 entirely. "Previous 30 days" now means the 30 days immediately before
 * the current window, which is what the name and the UI both claim.
 */
export function monthOnMonthFrom(series: TrendPoint[]) {
  const last30 = series.slice(-30);
  const prev30 = series.slice(-60, -30);
  const cur = {
    production: sumOf(last30, "production"),
    sales: sumOf(last30, "sales"),
    collections: sumOf(last30, "collections"),
  };
  const prev = {
    production: sumOf(prev30, "production"),
    sales: sumOf(prev30, "sales"),
    collections: sumOf(prev30, "collections"),
  };
  return {
    current: cur,
    previous: prev,
    changePct: {
      production: pctChange(cur.production, prev.production),
      sales: pctChange(cur.sales, prev.sales),
      collections: pctChange(cur.collections, prev.collections),
    },
  };
}

/** Convenience wrapper for callers that don't already hold a series. */
export async function monthOnMonth(now = new Date()) {
  return monthOnMonthFrom(await getDailySeries(60, now));
}

/* ─────────────────────────── Purchase requests ────────────────────────────── */

export async function pendingPurchaseRequests() {
  const rows = await sql`
    select id as _id, title, amount, requested_by as "requestedBy", justification,
           status, legitimacy, photo_file_id as "photoFileId", created_at as "createdAt"
      from purchase_requests
     where status in ('pending', 'deferred')
     order by created_at asc
  `;
  return rows.map((r) => ({ ...r, amount: Number(r.amount) }));
}

/* ──────────────── Lot balance reconciliation (now a view) ─────────────────── */

export interface LotBalance {
  /** Kept as `_id` too so the dashboard can use it as a React key unchanged. */
  _id: string;
  lotId: string;
  lotCode: string;
  supplier: string;
  handlers: string[];
  received: number;
  filled: number;
  damagedVerified: number;
  damagedPending: number;
  disposed: number;
  inStock: number;
  gap: number;
  /** Mirrors the shape the UI read when the balance was an embedded document. */
  balance: {
    received: number;
    filled: number;
    damagedVerified: number;
    damagedPending: number;
    disposed: number;
    inStock: number;
    gap: number;
  };
}

/**
 * Reads v_lot_balances. This replaces recomputeLotBalances(), which was an N+1
 * loop that wrote an embedded sub-document and had to be re-invoked from five
 * different write paths — if any of them forgot, the stored balance went stale
 * and nothing noticed. A view cannot be stale.
 */
export async function getLotBalances(): Promise<LotBalance[]> {
  // handlers lives on bag_lots rather than the view, so join it back in — the
  // bag-control panel lists who touched a lot alongside its gap.
  const rows = await sql`
    select b.lot_id, b.lot_code, b.supplier, b.received, b.filled,
           b.damaged_verified, b.damaged_pending, b.disposed, b.in_stock, b.gap,
           l.handlers
      from v_lot_balances b
      join bag_lots l on l.id = b.lot_id
     order by b.lot_code
  `;
  return rows.map((r) => {
    const balance = {
      received: Number(r.received),
      filled: Number(r.filled),
      damagedVerified: Number(r.damaged_verified),
      damagedPending: Number(r.damaged_pending),
      disposed: Number(r.disposed),
      inStock: Number(r.in_stock),
      gap: Number(r.gap),
    };
    return {
      _id: String(r.lot_id),
      lotId: String(r.lot_id),
      lotCode: r.lot_code,
      supplier: r.supplier,
      handlers: (r.handlers as string[]) ?? [],
      ...balance,
      balance,
    };
  });
}

/** Lots whose bags don't add up — possible theft or unrecorded use. */
export async function getLotGaps(): Promise<LotBalance[]> {
  return (await getLotBalances()).filter((l) => l.gap > 0);
}

/* ───────────── Statistical tripwires: worker / shift / supplier ───────────── */

export interface TripwireRow {
  key: string;
  qty: number;
  vsMeanX: number;
  flagged: boolean;
}

export async function damageTripwires(now = new Date()) {
  const since = addDays(eatDayStart(now), -90);

  // Grouping happens in SQL; the mean / 2× flagging stays in JS because it is
  // a judgement rule rather than a query.
  const [byWorkerRows, byShiftRows, bySupplierRows] = await Promise.all([
    sql<{ key: string; qty: string }[]>`
      select worker as key, sum(quantity) as qty
        from damage_claims
       where created_at >= ${since} and worker is not null
       group by worker`,
    sql<{ key: string; qty: string }[]>`
      select shift as key, sum(quantity) as qty
        from damage_claims
       where created_at >= ${since} and shift is not null
       group by shift`,
    sql<{ key: string; qty: string }[]>`
      select l.supplier || ' / ' || l.lot_code as key, sum(c.quantity) as qty
        from damage_claims c
        join bag_lots l on l.id = c.lot_id
       where c.created_at >= ${since}
       group by 1`,
  ]);

  const rank = (rows: { key: string; qty: string }[]): TripwireRow[] => {
    const entries = rows.map((r) => ({ key: r.key, qty: Number(r.qty) }));
    const mean = entries.length ? entries.reduce((a, e) => a + e.qty, 0) / entries.length : 0;
    return entries
      .map((e) => ({
        ...e,
        vsMeanX: mean > 0 ? Math.round((e.qty / mean) * 10) / 10 : 0,
        flagged: mean > 0 && e.qty >= mean * 2,
      }))
      .sort((a, b) => b.qty - a.qty);
  };

  return {
    byWorker: rank(byWorkerRows),
    byShift: rank(byShiftRows),
    bySupplierLot: rank(bySupplierRows),
  };
}

/* ─────────────────────────── Exception detection ──────────────────────────── */

/**
 * `deps` lets a caller pass work it has already done. The dashboard fetches the
 * aging report and the lot gaps for its own payload, and without this they'd be
 * queried a second time here.
 */
export async function detectExceptions(
  now = new Date(),
  deps: { lotGaps?: LotBalance[] } = {}
): Promise<string[]> {
  const exceptions: string[] = [];
  const { start, end } = yesterdayRange(now);
  const monthStart = addDays(eatDayStart(now), -30);

  // 1. Bag damage rate vs the trailing monthly average
  const [dam] = await sql<{ yesterday: string; month: string }[]>`
    select
      (select coalesce(sum(quantity),0) from damage_claims
        where created_at >= ${start} and created_at < ${end})       as yesterday,
      (select coalesce(sum(quantity),0) from damage_claims
        where created_at >= ${monthStart} and created_at < ${start}) as month
  `;
  const yDam = Number(dam.yesterday) || 0;
  const avgDaily = (Number(dam.month) || 0) / 29;
  if (avgDaily > 0 && yDam >= avgDaily * 3) {
    exceptions.push(
      `Bag damage rate was ${(yDam / avgDaily).toFixed(1)}× the monthly average yesterday (${yDam} bags claimed vs ~${avgDaily.toFixed(1)}/day).`
    );
  }

  // 2. The month has opened with no base balance, so the finance report cannot
  //    be computed at all. Worth the owner's attention on day one, not day 20.
  const month = new Date(now.getTime() + 3 * 3600_000).toISOString().slice(0, 7);
  const filed = await sql<{ month: string }[]>`
    select month from monthly_base_balances where month = ${month}
  `.catch(() => [{ month }]);
  if (filed.length === 0) {
    exceptions.push(
      `No opening balance has been filed for ${month}, so the monthly finance report cannot be produced.`
    );
  }


  // 3. The bag stock on the floor disagrees with the vouchers.
  //
  //    Three people's records predict a fourth's count: opening balance, goods
  //    received, goods issued → what should be left. A gap means something moved
  //    that nobody wrote down, and it only gets harder to explain with age.
  try {
    const rec = await reconcileBags();
    for (const row of rec.discrepancies) {
      const gap = row.gap ?? 0;
      exceptions.push(
        `${row.label} bags: ${row.counted?.toLocaleString()} counted on ${rec.countedOn}, ` +
          `${row.expected.toLocaleString()} expected from the vouchers ` +
          `(${gap > 0 ? "+" : ""}${gap.toLocaleString()}).`
      );
    }
  } catch (e) {
    // The voucher tables arrive in 0019. A database one migration behind must
    // still produce every other exception on this list.
    console.warn("detectExceptions: bag reconciliation unavailable", e);
  }

  // 4. Lot balance gaps (possible theft / unrecorded use)
  for (const lot of deps.lotGaps ?? (await getLotGaps())) {
    exceptions.push(`Lot ${lot.lotCode} (${lot.supplier}) has ${lot.gap} unaccounted bags.`);
  }

  // 5. Suspicious damage claims awaiting review
  const [{ n: suspicious }] = await sql<{ n: string }[]>`
    select count(*) as n from damage_claims
     where status in ('pending','cosign_required')
       and flags && array['suspicious_image','duplicate_photo']
  `;
  if (Number(suspicious) > 0) {
    exceptions.push(`${suspicious} damage claim(s) flagged as suspicious are awaiting review.`);
  }

  // 6. Stale purchase requests
  const [{ n: stalePR }] = await sql<{ n: string }[]>`
    select count(*) as n from purchase_requests
     where status = 'pending' and created_at < ${addDays(now, -3)}
  `;
  if (Number(stalePR) > 0) {
    exceptions.push(`${stalePR} purchase request(s) have been waiting for approval for over 3 days.`);
  }

  return exceptions;
}
