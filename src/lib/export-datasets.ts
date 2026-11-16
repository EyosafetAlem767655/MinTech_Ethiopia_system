import sql from "@/lib/sql";
import { SUBMISSIONS, SUBMISSION_COLLECTIONS, type SubmissionCollection } from "@/lib/submissions";
import { rawMaterialLedger } from "@/lib/raw-material-usage";
import { rmCreditLoads } from "@/lib/rm-credit";
import { buildFinanceReport, monthBounds } from "@/lib/finance-report";
import { storeNetWorth } from "@/lib/store-net-worth";
import { itemStatuses, recentCounts, storeMovements } from "@/lib/store-inventory";
import { costsAt } from "@/lib/store-costs";
import { loadCustomStoreItems } from "@/lib/store-custom";
import { GET as creditGET } from "@/app/api/finance/credit/route";
import { EXPORT_DATASETS, type ExportDatasetKey } from "@/lib/export-keys";

/**
 * ⬇ Excel: what each section exports for a date range.
 *
 * The records themselves, one row per entry, for the days picked. Every section
 * that shows a table has one entry here (export-keys.ts lists them for the
 * button). Where a section shows something worked out rather than stored (the
 * raw material ledger, credit due dates, the monthly report, the store), the
 * export runs the same calculation the screen does, so the two cannot differ.
 *
 * Server-only: it reads the database.
 */

export interface ExportRange {
  /** "YYYY-MM-DD", both included, EAT. */
  from: string;
  to: string;
  start: Date;
  end: Date;
}

export interface ExportSheet {
  name: string;
  rows: Record<string, unknown>[];
}

/** No sheet runs away with the server: far more than any range here holds. */
const ROW_CAP = 20_000;

const notThere = (e: unknown) => {
  const code = (e as { code?: string })?.code;
  return code === "42P01" || code === "42703";
};

/** A table's rows in the range, by its date column; empty if the table is not in this database. */
async function tableRows(
  table: string,
  dateColumn: string,
  mode: "ts" | "text" | "month",
  r: ExportRange,
  opts: { onlyWhereSet?: string } = {}
): Promise<Record<string, unknown>[]> {
  const lo = mode === "ts" ? r.start : mode === "text" ? r.from : r.from.slice(0, 7);
  const hiCond =
    mode === "ts"
      ? sql`${sql(dateColumn)} < ${r.end}`
      : sql`${sql(dateColumn)} <= ${mode === "text" ? r.to : r.to.slice(0, 7)}`;
  try {
    return await sql<Record<string, unknown>[]>`
      select * from ${sql(table)}
       where ${sql(dateColumn)} >= ${lo} and ${hiCond}
         and ${opts.onlyWhereSet ? sql`${sql(opts.onlyWhereSet)} is not null` : sql`true`}
       order by ${sql(dateColumn)}
       limit ${ROW_CAP}
    `;
  } catch (e) {
    if (notThere(e)) return [];
    throw e;
  }
}

/** A registered submission type's rows, with its own date column. */
function specRows(key: SubmissionCollection, r: ExportRange) {
  const spec = SUBMISSIONS[key];
  return tableRows(spec.table, spec.dateColumn, spec.dateIsText ? "text" : "ts", r, { onlyWhereSet: spec.onlyWhereSet });
}

/**
 * The line items of `parents`, each carrying its parent's identifying columns
 * first (voucher number, date), so a line read on its own still says where it
 * belongs.
 */
async function childRows(
  table: string,
  foreignKey: string,
  parents: Record<string, unknown>[],
  carry: string[]
): Promise<Record<string, unknown>[]> {
  if (parents.length === 0) return [];
  const byId = new Map(parents.map((p) => [String(p.id), p]));
  try {
    const rows = await sql<Record<string, unknown>[]>`
      select * from ${sql(table)} where ${sql(foreignKey)} = any(${[...byId.keys()]}) limit ${ROW_CAP}
    `;
    return rows.map((c) => {
      const p = byId.get(String(c[foreignKey])) ?? {};
      const head = Object.fromEntries(carry.map((k) => [k, p[k]]));
      return { ...head, ...c };
    });
  } catch (e) {
    if (notThere(e)) return [];
    throw e;
  }
}

/** Every "YYYY-MM" the range touches, oldest first. */
function monthsIn(r: ExportRange): string[] {
  const out: string[] = [];
  let [y, m] = r.from.slice(0, 7).split("-").map(Number);
  const [ty, tm] = r.to.slice(0, 7).split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    if (out.length > 120) break;
  }
  return out;
}

/** True when a day ("YYYY-MM-DD", a Date, or a date's text) falls in the range, in EAT. */
const inDays = (day: unknown, r: ExportRange) => {
  const text = String(day ?? "");
  let d = /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
  if (!d) {
    const t = day instanceof Date ? day.getTime() : new Date(text).getTime();
    if (isNaN(t)) return false;
    d = new Date(t + 3 * 3_600_000).toISOString().slice(0, 10);
  }
  return d >= r.from && d <= r.to;
};

const withMonth = (month: string, rows: unknown[] | null | undefined) =>
  (rows ?? []).map((row) => ({ month, ...(row as Record<string, unknown>) }));

type Builder = (r: ExportRange) => Promise<ExportSheet[]>;

const BUILDERS: Record<ExportDatasetKey, Builder> = {
  /* ── Production ─────────────────────────────────────────────── */
  production: async (r) => [{ name: "Production", rows: await specRows("production", r) }],
  downtime: async (r) => [{ name: "Downtime", rows: await tableRows("production_hours", "month", "month", r) }],
  whiteness: async (r) => [{ name: "Whiteness", rows: await specRows("whiteness", r) }],

  /* ── Asset management ───────────────────────────────────────── */
  "raw-material": async (r) => {
    const ledgers = await Promise.all(monthsIn(r).map((m) => rawMaterialLedger(m).catch(() => null)));
    const days = (stream: "normal" | "grade1") =>
      ledgers.flatMap((l) => (l?.[stream]?.days ?? []).filter((d) => inDays(d.day, r)));
    const sheets: ExportSheet[] = [
      { name: "Raw material by day", rows: days("normal") as unknown as Record<string, unknown>[] },
    ];
    const g1 = days("grade1");
    if (g1.length > 0) sheets.push({ name: "Grade 1 raw by day", rows: g1 as unknown as Record<string, unknown>[] });
    sheets.push({ name: "Received (filed)", rows: await specRows("raw_material", r) });
    sheets.push({ name: "Counts (filed)", rows: await specRows("raw_material_daily", r) });
    return sheets;
  },
  vouchers: async (r) => {
    const [grv, siv] = await Promise.all([specRows("grv", r), specRows("store_issue", r)]);
    return [
      { name: "GRV", rows: grv },
      { name: "GRV lines", rows: await childRows("goods_receiving_items", "grv_id", grv, ["grv_no", "date", "supplier"]) },
      { name: "SIV", rows: siv },
      { name: "SIV lines", rows: await childRows("store_issue_items", "siv_id", siv, ["siv_no", "date", "issued_to"]) },
    ];
  },
  "stock-on-hand": async (r) => [{ name: "Stock on hand", rows: await specRows("ops", r) }],
  "pp-bag-usage": async (r) => {
    const usage = await specRows("pp_bag_usage", r);
    return [
      { name: "PP bag usage", rows: usage },
      { name: "PP bag usage lines", rows: await childRows("pp_bag_usage_items", "usage_id", usage, ["date", "reported_by"]) },
    ];
  },
  "pp-bag-damage": async (r) => [{ name: "PP bag damage", rows: await specRows("pp_bag_damage", r) }],
  "purchase-requests": async (r) => [{ name: "Purchase requests", rows: await specRows("tool_request", r) }],
  store: async (r) => {
    await loadCustomStoreItems();
    const [counts, movements, costs] = await Promise.all([recentCounts(), storeMovements(), costsAt(new Date())]);
    return [
      { name: "Store now", rows: itemStatuses(counts, movements, costs) as unknown as Record<string, unknown>[] },
      { name: "Store counts", rows: await specRows("store_count", r) },
    ];
  },
  "bag-control": async (r) => [{ name: "Damaged bag claims", rows: await specRows("damage_claim", r) }],

  /* ── Sales ──────────────────────────────────────────────────── */
  sales: async (r) => [{ name: "Sales", rows: await specRows("sales_invoice", r) }],

  /* ── Finance ────────────────────────────────────────────────── */
  "rm-credit": async (r) => {
    const loads = (await rmCreditLoads().catch(() => [])).filter((l) => inDays(l.date, r));
    return [
      { name: "RM credit loads", rows: loads.map(({ payments, ...l }) => ({ ...l, payments: payments.length })) },
      {
        name: "RM credit payments",
        rows: loads.flatMap((l) => l.payments.map((p) => ({ loadDate: l.date, supplier: l.supplier, truckPlate: l.truckPlate, ...p }))),
      },
    ];
  },
  monthly: async (r) => {
    const months = monthsIn(r);
    const reports = await Promise.all(
      months.map(async (m) => ({
        m,
        report: await buildFinanceReport(m).catch(() => null),
        store: await storeNetWorth(monthBounds(m).end).catch(() => null),
      }))
    );
    return [
      { name: "Production", rows: reports.flatMap(({ m, report }) => withMonth(m, report?.production)) },
      { name: "Raw materials & bags", rows: reports.flatMap(({ m, report }) => withMonth(m, report?.rawMaterials)) },
      {
        name: "Grade 1",
        rows: reports.flatMap(({ m, report }) => [
          ...withMonth(m, report?.grade1?.products),
          ...withMonth(m, report?.grade1?.rawMaterials),
        ]),
      },
      { name: "Store net worth", rows: reports.flatMap(({ m, store }) => withMonth(m, store?.blocks)) },
      { name: "Totals", rows: reports.map(({ m, report }) => ({ month: m, ...(report?.totals ?? {}) })) },
    ];
  },
  credit: async (r) => {
    const body = (await (await creditGET()).json()) as { rows?: Record<string, unknown>[] };
    const rows = (body.rows ?? []).filter((x) => inDays(x.date, r));
    return [
      { name: "Credit sales", rows: rows.map(({ payments, ...x }) => ({ ...x, payments: (payments as unknown[])?.length ?? 0 })) },
      {
        name: "Credit payments",
        rows: rows.flatMap((x) =>
          ((x.payments as Record<string, unknown>[]) ?? []).map((p) => ({ saleDate: x.date, customer: x.customer, deliveryNo: x.deliveryNo, ...p }))
        ),
      },
    ];
  },
  wht: async (r) => [{ name: "WHT", rows: await specRows("wht_holder", r) }],
  banks: async (r) => [{ name: "Bank collections", rows: await specRows("bank_collection", r) }],
  purchases: async (r) => {
    const batches = await specRows("tool_purchase", r);
    return [
      { name: "Item purchases", rows: await specRows("item_purchase", r) },
      { name: "Purchase batches", rows: batches },
      { name: "Purchase batch lines", rows: await childRows("finance_purchase_items", "batch_id", batches, ["date", "supplier"]) },
      { name: "PP bag purchases", rows: await specRows("pp_bag_purchase", r) },
    ];
  },

  /* ── Settings ───────────────────────────────────────────────── */
  submissions: async (r) => {
    const sheets = await Promise.all(
      SUBMISSION_COLLECTIONS.map(async (k) => ({ name: SUBMISSIONS[k].label, rows: await specRows(k, r).catch(() => []) }))
    );
    // Only the kinds that have something in the range: thirty empty tabs help nobody.
    const filled = sheets.filter((s) => s.rows.length > 0);
    return filled.length > 0 ? filled : [{ name: "Submissions", rows: [] }];
  },
};

export function isExportDataset(v: unknown): v is ExportDatasetKey {
  return typeof v === "string" && v in EXPORT_DATASETS;
}

export async function buildExport(key: ExportDatasetKey, r: ExportRange): Promise<ExportSheet[]> {
  return BUILDERS[key](r);
}
