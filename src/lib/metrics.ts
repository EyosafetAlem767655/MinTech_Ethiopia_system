import {
  BagEvent,
  BagLot,
  DamageClaim,
  Invoice,
  PurchaseRequest,
  ShiftReport,
  StoneDelivery,
} from "@/lib/models";
import { addDays, daysBetween, eatDateLabel, eatDayStart, yesterdayRange } from "@/lib/dates";

/* ─────────────────────────── Yesterday's numbers ──────────────────────────── */

export interface DayNumbers {
  date: string;
  truckloads: number;
  sacksProduced: number;
  sacksSold: number;
  revenueInvoiced: number;
  cashCollected: number;
  damagedClaimed: number;
  damagedVerified: number;
}

export async function getDayNumbers(start: Date, end: Date): Promise<DayNumbers> {
  const dateMatch = { $gte: start, $lt: end };

  const [trucks, produced, sold, collected, claimed, verified] = await Promise.all([
    StoneDelivery.aggregate([{ $match: { date: dateMatch } }, { $group: { _id: null, n: { $sum: "$loads" } } }]),
    ShiftReport.aggregate([{ $match: { date: dateMatch } }, { $group: { _id: null, n: { $sum: "$filledSacks" } } }]),
    Invoice.aggregate([
      { $match: { invoicedAt: dateMatch } },
      { $group: { _id: null, sacks: { $sum: "$sacks" }, amount: { $sum: "$amount" } } },
    ]),
    Invoice.aggregate([
      { $unwind: "$payments" },
      { $match: { "payments.date": dateMatch } },
      { $group: { _id: null, n: { $sum: "$payments.amount" } } },
    ]),
    DamageClaim.aggregate([{ $match: { createdAt: dateMatch } }, { $group: { _id: null, n: { $sum: "$quantity" } } }]),
    DamageClaim.aggregate([
      { $match: { reviewedAt: dateMatch, status: "verified" } },
      { $group: { _id: null, n: { $sum: "$quantity" } } },
    ]),
  ]);

  return {
    date: eatDateLabel(start),
    truckloads: trucks[0]?.n || 0,
    sacksProduced: produced[0]?.n || 0,
    sacksSold: sold[0]?.sacks || 0,
    revenueInvoiced: sold[0]?.amount || 0,
    cashCollected: collected[0]?.n || 0,
    damagedClaimed: claimed[0]?.n || 0,
    damagedVerified: verified[0]?.n || 0,
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

  // Shift by +3h so the day boundary matches Ethiopia time (EAT, UTC+3).
  const keyed = (field: string) => ({
    $dateToString: { format: "%Y-%m-%d", date: { $add: [`$${field}`, 3 * 3600 * 1000] } },
  });

  const [production, sales, collections] = await Promise.all([
    ShiftReport.aggregate([
      { $match: { date: { $gte: start, $lt: end } } },
      { $group: { _id: keyed("date"), n: { $sum: "$filledSacks" } } },
    ]),
    Invoice.aggregate([
      { $match: { invoicedAt: { $gte: start, $lt: end } } },
      { $group: { _id: keyed("invoicedAt"), n: { $sum: "$amount" } } },
    ]),
    Invoice.aggregate([
      { $unwind: "$payments" },
      { $match: { "payments.date": { $gte: start, $lt: end } } },
      { $group: { _id: keyed("payments.date"), n: { $sum: "$payments.amount" } } },
    ]),
  ]);

  const map = new Map<string, TrendPoint>();
  for (let i = 0; i < days; i++) {
    const d = eatDateLabel(addDays(start, i));
    map.set(d, { date: d, production: 0, sales: 0, collections: 0 });
  }
  for (const row of production) if (map.has(row._id)) map.get(row._id)!.production = row.n;
  for (const row of sales) if (map.has(row._id)) map.get(row._id)!.sales = row.n;
  for (const row of collections) if (map.has(row._id)) map.get(row._id)!.collections = row.n;
  return Array.from(map.values());
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

export async function monthOnMonth(now = new Date()) {
  const todayStart = eatDayStart(now);
  const last30 = await getDailySeries(30, now);
  const prev30 = await getDailySeries(60, addDays(todayStart, -30));
  const sum = (s: TrendPoint[], k: keyof Omit<TrendPoint, "date">) => s.reduce((a, p) => a + p[k], 0);
  const pct = (cur: number, prev: number) => (prev === 0 ? null : Math.round(((cur - prev) / prev) * 1000) / 10);
  const cur = {
    production: sum(last30, "production"),
    sales: sum(last30, "sales"),
    collections: sum(last30, "collections"),
  };
  const prev = {
    production: sum(prev30.slice(0, 30), "production"),
    sales: sum(prev30.slice(0, 30), "sales"),
    collections: sum(prev30.slice(0, 30), "collections"),
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

export async function receivablesAging(now = new Date()) {
  const invoices = await Invoice.find().lean();
  const buckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
  const overdueClients: { client: string; invoiceNumber: string; outstanding: number; daysOverdue: number }[] = [];

  for (const inv of invoices) {
    const paid = (inv.payments || []).reduce((a, p) => a + (p.amount || 0), 0);
    const outstanding = inv.amount - paid;
    if (outstanding <= 0) continue;
    const overdue = daysBetween(new Date(inv.dueDate), now);
    if (overdue <= 0) buckets.current += outstanding;
    else if (overdue <= 30) buckets.d1_30 += outstanding;
    else if (overdue <= 60) buckets.d31_60 += outstanding;
    else if (overdue <= 90) buckets.d61_90 += outstanding;
    else buckets.d90_plus += outstanding;
    if (overdue > 0) {
      overdueClients.push({ client: inv.client, invoiceNumber: inv.invoiceNumber, outstanding, daysOverdue: overdue });
    }
  }
  overdueClients.sort((a, b) => b.daysOverdue - a.daysOverdue);
  return { buckets, overdueClients };
}

export async function missingWithholding() {
  return Invoice.find({ withholdingReceiptReceived: false, "payments.0": { $exists: true } })
    .select("invoiceNumber client amount invoicedAt")
    .sort({ invoicedAt: -1 })
    .lean();
}

export async function pendingPurchaseRequests() {
  return PurchaseRequest.find({ status: "pending" }).sort({ createdAt: 1 }).lean();
}

/* ──────────────── Lot balance reconciliation (daily job + UI) ─────────────── */

export async function recomputeLotBalances() {
  const lots = await BagLot.find();
  const results = [];
  for (const lot of lots) {
    const [fills, counts, claims] = await Promise.all([
      BagEvent.aggregate([
        { $match: { lotId: lot._id, type: "filled" } },
        { $group: { _id: null, n: { $sum: "$quantity" } } },
      ]),
      BagEvent.find({ lotId: lot._id, type: "stock_count" }).sort({ date: -1 }).limit(1).lean(),
      DamageClaim.find({ lotId: lot._id }).lean(),
    ]);
    const filled = fills[0]?.n || 0;
    const damagedVerified = claims.filter((c) => c.status === "verified").reduce((a, c) => a + c.quantity, 0);
    const damagedPending = claims
      .filter((c) => c.status === "pending" || c.status === "cosign_required")
      .reduce((a, c) => a + c.quantity, 0);
    const disposed = claims.filter((c) => c.disposal?.action).reduce((a, c) => a + c.quantity, 0);

    // If a physical stock count exists, trust it; otherwise derive book stock.
    const bookStock = lot.quantity - filled - damagedVerified;
    const inStock = counts[0] ? counts[0].quantity : bookStock;
    const gap = lot.quantity - filled - damagedVerified - inStock;

    lot.balance = {
      received: lot.quantity,
      filled,
      damagedVerified,
      damagedPending,
      disposed,
      inStock,
      gap,
      computedAt: new Date(),
    };
    await lot.save();
    results.push({ lotCode: lot.lotCode, gap });
  }
  return results;
}

/* ───────────── Statistical tripwires: worker / shift / supplier ───────────── */

export async function damageTripwires(now = new Date()) {
  const since = addDays(eatDayStart(now), -90);
  const claims = await DamageClaim.find({ createdAt: { $gte: since } })
    .populate<{ lotId: { supplier: string; lotCode: string } }>("lotId", "supplier lotCode")
    .lean();

  const tally = (keyFn: (c: (typeof claims)[number]) => string | undefined) => {
    const m = new Map<string, number>();
    for (const c of claims) {
      const k = keyFn(c);
      if (!k) continue;
      m.set(k, (m.get(k) || 0) + c.quantity);
    }
    const entries = Array.from(m.entries()).map(([key, qty]) => ({ key, qty }));
    const mean = entries.length ? entries.reduce((a, e) => a + e.qty, 0) / entries.length : 0;
    return entries
      .map((e) => ({ ...e, vsMeanX: mean > 0 ? Math.round((e.qty / mean) * 10) / 10 : 0, flagged: mean > 0 && e.qty >= mean * 2 }))
      .sort((a, b) => b.qty - a.qty);
  };

  return {
    byWorker: tally((c) => c.worker),
    byShift: tally((c) => c.shift),
    bySupplierLot: tally((c) => (c.lotId ? `${c.lotId.supplier} / ${c.lotId.lotCode}` : undefined)),
  };
}

/* ─────────────────────────── Exception detection ──────────────────────────── */

export async function detectExceptions(now = new Date()): Promise<string[]> {
  const exceptions: string[] = [];
  const { start, end } = yesterdayRange(now);

  // 1. Bag damage rate vs monthly average
  const monthStart = addDays(eatDayStart(now), -30);
  const [yClaims, mClaims] = await Promise.all([
    DamageClaim.aggregate([{ $match: { createdAt: { $gte: start, $lt: end } } }, { $group: { _id: null, n: { $sum: "$quantity" } } }]),
    DamageClaim.aggregate([{ $match: { createdAt: { $gte: monthStart, $lt: start } } }, { $group: { _id: null, n: { $sum: "$quantity" } } }]),
  ]);
  const yDam = yClaims[0]?.n || 0;
  const avgDaily = (mClaims[0]?.n || 0) / 29;
  if (avgDaily > 0 && yDam >= avgDaily * 3) {
    exceptions.push(
      `Bag damage rate was ${(yDam / avgDaily).toFixed(1)}× the monthly average yesterday (${yDam} bags claimed vs ~${avgDaily.toFixed(1)}/day).`
    );
  }

  // 2. Clients newly crossing 30 days overdue
  const { overdueClients } = await receivablesAging(now);
  for (const c of overdueClients) {
    if (c.daysOverdue >= 30 && c.daysOverdue <= 31) {
      exceptions.push(`${c.client} crossed 30 days overdue on invoice ${c.invoiceNumber} (ETB ${Math.round(c.outstanding).toLocaleString()} outstanding).`);
    }
  }
  const over60 = overdueClients.filter((c) => c.daysOverdue > 60);
  if (over60.length > 0) {
    exceptions.push(
      `${over60.length} invoice(s) are more than 60 days overdue, totalling ETB ${Math.round(over60.reduce((a, c) => a + c.outstanding, 0)).toLocaleString()}.`
    );
  }

  // 3. Poor stone quality at the gate yesterday
  const badLoads = await StoneDelivery.find({ date: { $gte: start, $lt: end }, qualityGrade: "dark/weathered" }).lean();
  for (const l of badLoads) {
    exceptions.push(`Truck ${l.truckPlate}'s load scored dark/weathered at the gate.`);
  }

  // 4. Lot balance gaps (possible theft / unrecorded use)
  const gapLots = await BagLot.find({ "balance.gap": { $gt: 0 } }).lean();
  for (const lot of gapLots) {
    exceptions.push(`Lot ${lot.lotCode} (${lot.supplier}) has ${lot.balance?.gap} unaccounted bags.`);
  }

  // 5. Suspicious damage claims awaiting review
  const suspicious = await DamageClaim.countDocuments({
    status: { $in: ["pending", "cosign_required"] },
    flags: { $in: ["suspicious_image", "duplicate_photo"] },
  });
  if (suspicious > 0) exceptions.push(`${suspicious} damage claim(s) flagged as suspicious are awaiting review.`);

  // 6. Stale purchase requests
  const stalePR = await PurchaseRequest.countDocuments({
    status: "pending",
    createdAt: { $lt: addDays(now, -3) },
  });
  if (stalePR > 0) exceptions.push(`${stalePR} purchase request(s) have been waiting for approval for over 3 days.`);

  return exceptions;
}
