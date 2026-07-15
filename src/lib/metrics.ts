import sql from "@/lib/sql";
import { addDays, daysBetween, eatDateLabel, eatDayStart, yesterdayRange } from "@/lib/dates";

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
  truckloads: number;
  tonsProduced: number;
  tonsSold: number;
  revenueInvoiced: number;
  cashCollected: number;
  damagedClaimed: number;
  damagedVerified: number;
}

export async function getDayNumbers(start: Date, end: Date): Promise<DayNumbers> {
  // Six separate Mongo aggregates collapse into one round trip.
  const [r] = await sql<
    {
      truckloads: string;
      tons_produced: string;
      tons_sold: string;
      revenue_invoiced: string;
      cash_collected: string;
      damaged_claimed: string;
      damaged_verified: string;
    }[]
  >`
    select
      (select coalesce(sum(loads), 0)
         from stone_deliveries where date >= ${start} and date < ${end})            as truckloads,

      (select coalesce(sum(case when bag_weight_kg > 0
                                then filled_sacks * bag_weight_kg / 1000.0
                                else 0 end), 0)
         from shift_reports where date >= ${start} and date < ${end})               as tons_produced,

      (select coalesce(sum(case when bag_weight_kg > 0
                                then sacks * bag_weight_kg / 1000.0
                                else 0 end), 0)
         from invoices where invoiced_at >= ${start} and invoiced_at < ${end})      as tons_sold,

      (select coalesce(sum(amount), 0)
         from invoices where invoiced_at >= ${start} and invoiced_at < ${end})      as revenue_invoiced,

      -- payments is a real table now, so no $unwind
      (select coalesce(sum(amount), 0)
         from payments where date >= ${start} and date < ${end})                    as cash_collected,

      (select coalesce(sum(quantity), 0)
         from damage_claims where created_at >= ${start} and created_at < ${end})   as damaged_claimed,

      (select coalesce(sum(quantity), 0)
         from damage_claims
        where reviewed_at >= ${start} and reviewed_at < ${end}
          and status = 'verified')                                                  as damaged_verified
  `;

  return {
    date: eatDateLabel(start),
    truckloads: Number(r.truckloads) || 0,
    tonsProduced: Math.round(Number(r.tons_produced) * 1000) / 1000,
    tonsSold: Math.round(Number(r.tons_sold) * 1000) / 1000,
    revenueInvoiced: Number(r.revenue_invoiced) || 0,
    cashCollected: Number(r.cash_collected) || 0,
    damagedClaimed: Number(r.damaged_claimed) || 0,
    damagedVerified: Number(r.damaged_verified) || 0,
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
      select (date at time zone ${EAT})::date as d,
             sum(case when bag_weight_kg > 0
                      then filled_sacks * bag_weight_kg / 1000.0
                      else 0 end) as n
        from shift_reports
       where date >= ${start} and date < ${end}
       group by 1
    ),
    sales as (
      select (invoiced_at at time zone ${EAT})::date as d, sum(amount) as n
        from invoices
       where invoiced_at >= ${start} and invoiced_at < ${end}
       group by 1
    ),
    coll as (
      select (date at time zone ${EAT})::date as d, sum(amount) as n
        from payments
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

/**
 * BEHAVIOUR CHANGE (bug fix). The Mongo version built the comparison window as
 * `getDailySeries(60, todayStart-30).slice(0, 30)`, which takes the *first* 30
 * days of a 60-day window — i.e. days 60–90 ago — and skips days 30–60
 * entirely. "Previous 30 days" now means the 30 days immediately before the
 * current window, which is what the name and the UI both claim.
 *
 * Month-on-month percentages will therefore differ from the old dashboard.
 * That is intended: the old ones were comparing against the wrong month.
 */
export async function monthOnMonth(now = new Date()) {
  const todayStart = eatDayStart(now);
  const last30 = await getDailySeries(30, now);          // [T-30, T)
  const prev30 = await getDailySeries(30, addDays(todayStart, -30)); // [T-60, T-30)
  const sum = (s: TrendPoint[], k: keyof Omit<TrendPoint, "date">) => s.reduce((a, p) => a + p[k], 0);
  const pct = (cur: number, prev: number) => (prev === 0 ? null : Math.round(((cur - prev) / prev) * 1000) / 10);
  const cur = {
    production: sum(last30, "production"),
    sales: sum(last30, "sales"),
    collections: sum(last30, "collections"),
  };
  const prev = {
    production: sum(prev30, "production"),
    sales: sum(prev30, "sales"),
    collections: sum(prev30, "collections"),
  };
  return {
    current: cur,
    previous: prev,
    changePct: {
      production: pct(cur.production, prev.production),
      sales: pct(cur.sales, prev.sales),
      collections: pct(cur.collections, prev.collections),
    },
  };
}

/* ─────────────────────────────── Money section ────────────────────────────── */

export interface AgingBuckets {
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90_plus: number;
}

export interface OverdueClient {
  client: string;
  invoiceNumber: string;
  outstanding: number;
  daysOverdue: number;
}

export async function receivablesAging(now = new Date()) {
  // The Mongo version pulled EVERY invoice into Node and bucketed in JS — an
  // unbounded scan that grew with the business. Net the payments off in SQL and
  // return only what is actually outstanding.
  const rows = await sql<{ client: string; invoice_number: string; outstanding: string; due_date: Date }[]>`
    select i.client,
           i.invoice_number,
           i.due_date,
           i.amount - coalesce((select sum(p.amount) from payments p where p.invoice_id = i.id), 0) as outstanding
      from invoices i
     where i.amount - coalesce((select sum(p.amount) from payments p where p.invoice_id = i.id), 0) > 0
  `;

  const buckets: AgingBuckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
  const overdueClients: OverdueClient[] = [];

  for (const r of rows) {
    const outstanding = Number(r.outstanding);
    const overdue = daysBetween(new Date(r.due_date), now);
    if (overdue <= 0) buckets.current += outstanding;
    else if (overdue <= 30) buckets.d1_30 += outstanding;
    else if (overdue <= 60) buckets.d31_60 += outstanding;
    else if (overdue <= 90) buckets.d61_90 += outstanding;
    else buckets.d90_plus += outstanding;

    if (overdue > 0) {
      overdueClients.push({
        client: r.client,
        invoiceNumber: r.invoice_number,
        outstanding,
        daysOverdue: overdue,
      });
    }
  }
  overdueClients.sort((a, b) => b.daysOverdue - a.daysOverdue);
  return { buckets, overdueClients };
}

export async function missingWithholding() {
  const rows = await sql`
    select i.id as _id, i.invoice_number as "invoiceNumber", i.client, i.amount, i.invoiced_at as "invoicedAt"
      from invoices i
     where i.withholding_receipt_received = false
       and exists (select 1 from payments p where p.invoice_id = i.id)
     order by i.invoiced_at desc
  `;
  return rows.map((r) => ({ ...r, amount: Number(r.amount) }));
}

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
  lotId: string;
  lotCode: string;
  supplier: string;
  received: number;
  filled: number;
  damagedVerified: number;
  damagedPending: number;
  disposed: number;
  inStock: number;
  gap: number;
}

/**
 * Reads v_lot_balances. This replaces recomputeLotBalances(), which was an N+1
 * loop that wrote an embedded sub-document and had to be re-invoked from five
 * different write paths — if any of them forgot, the stored balance went stale
 * and nothing noticed. A view cannot be stale.
 */
export async function getLotBalances(): Promise<LotBalance[]> {
  const rows = await sql`
    select lot_id, lot_code, supplier, received, filled,
           damaged_verified, damaged_pending, disposed, in_stock, gap
      from v_lot_balances
     order by lot_code
  `;
  return rows.map((r) => ({
    lotId: String(r.lot_id),
    lotCode: r.lot_code,
    supplier: r.supplier,
    received: Number(r.received),
    filled: Number(r.filled),
    damagedVerified: Number(r.damaged_verified),
    damagedPending: Number(r.damaged_pending),
    disposed: Number(r.disposed),
    inStock: Number(r.in_stock),
    gap: Number(r.gap),
  }));
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

export async function detectExceptions(now = new Date()): Promise<string[]> {
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

  // 2. Clients newly crossing 30 days overdue
  const { overdueClients } = await receivablesAging(now);
  for (const c of overdueClients) {
    if (c.daysOverdue >= 30 && c.daysOverdue <= 31) {
      exceptions.push(
        `${c.client} crossed 30 days overdue on invoice ${c.invoiceNumber} (ETB ${Math.round(c.outstanding).toLocaleString()} outstanding).`
      );
    }
  }
  const over60 = overdueClients.filter((c) => c.daysOverdue > 60);
  if (over60.length > 0) {
    exceptions.push(
      `${over60.length} invoice(s) are more than 60 days overdue, totalling ETB ${Math.round(
        over60.reduce((a, c) => a + c.outstanding, 0)
      ).toLocaleString()}.`
    );
  }

  // 3. Poor stone quality at the gate yesterday
  const badLoads = await sql<{ truck_plate: string }[]>`
    select truck_plate from stone_deliveries
     where date >= ${start} and date < ${end} and quality_grade = 'dark/weathered'
  `;
  for (const l of badLoads) {
    exceptions.push(`Truck ${l.truck_plate}'s load scored dark/weathered at the gate.`);
  }

  // 4. Lot balance gaps (possible theft / unrecorded use)
  for (const lot of await getLotGaps()) {
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
