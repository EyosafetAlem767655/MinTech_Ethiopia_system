import sql from "@/lib/sql";
import { SUBMISSIONS, SUBMISSION_COLLECTIONS, type SubmissionCollection } from "@/lib/submissions";
import { rawMaterialLedger, type LedgerDay } from "@/lib/raw-material-usage";
import { rmCreditLoads } from "@/lib/rm-credit";
import { buildFinanceReport, monthBounds } from "@/lib/finance-report";
import { storeNetWorth } from "@/lib/store-net-worth";
import { itemStatuses, recentCounts, storeMovements } from "@/lib/store-inventory";
import { costsAt } from "@/lib/store-costs";
import { loadCustomStoreItems } from "@/lib/store-custom";
import { STORE_GROUPS } from "@/lib/store-items";
import {
  COMPANY_BAG_KINDS,
  FINANCE_RAW_MATERIALS,
  PRODUCT_ORDER,
  bagKindCount,
  bagLabel,
  parseBagLedgerKey,
  productLabel,
  type BagCounts,
} from "@/lib/products";
import { GET as creditGET } from "@/app/api/finance/credit/route";
import { EXPORT_DATASETS, type ExportDatasetKey } from "@/lib/export-keys";

/**
 * ⬇ Excel: what each section exports for a date range.
 *
 * Every sheet names its own columns, in order, with a reader for each (the
 * owner approved the lists, 23 Nov 2026). Nothing is dumped: no ids, no JSON,
 * no raw pasted text, no import notes. Products always come as one column per
 * product in the catalogue order, bags as one column per kind, so two exports
 * line up column for column.
 *
 * Where a section shows something worked out (the raw material ledger, credit
 * due dates, the monthly report, the store), the export runs the same
 * calculation the screen does. Server-only: it reads the database.
 */

export interface ExportRange {
  /** "YYYY-MM-DD", both included, EAT. */
  from: string;
  to: string;
  start: Date;
  end: Date;
}

export type ColumnKind = "text" | "number" | "date";

export interface ExportColumn<R = any> {
  header: string;
  kind?: ColumnKind;
  value: (row: R) => unknown;
}

export interface ExportSheet<R = any> {
  name: string;
  columns: ExportColumn<R>[];
  rows: R[];
}

type Row = Record<string, any>;

/** No sheet runs away with the server: far more than any range here holds. */
const ROW_CAP = 20_000;

const notThere = (e: unknown) => {
  const code = (e as { code?: string })?.code;
  return code === "42P01" || code === "42703";
};

const n = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** A timestamp or stored day, as its EAT calendar day "YYYY-MM-DD". */
export function eatDay(v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const t = v instanceof Date ? v.getTime() : new Date(s).getTime();
  return isNaN(t) ? "" : new Date(t + 3 * 3_600_000).toISOString().slice(0, 10);
}

/* ─────────────────────────────── column helpers ─────────────────────────────── */

const text = (header: string, value: (r: Row) => unknown): ExportColumn => ({ header, kind: "text", value });
const num = (header: string, value: (r: Row) => unknown): ExportColumn => ({ header, kind: "number", value: (r) => n(value(r)) });
const day = (header: string, value: (r: Row) => unknown): ExportColumn => ({ header, kind: "date", value: (r) => eatDay(value(r)) });

/** One column per product, catalogue order. */
const productColumns = (pick: (r: Row) => Record<string, unknown> | null | undefined, suffix = " (t)"): ExportColumn[] =>
  PRODUCT_ORDER.map((code) => num(`${productLabel(code)}${suffix}`, (r) => n((pick(r) || {})[code]) ?? null));

const sumProducts = (p: Record<string, unknown> | null | undefined) =>
  r3(Object.values(p || {}).reduce<number>((a, v) => a + (Number(v) || 0), 0));

/** "Yellow@great-wall" bag ledger key → "25KG Yellow · Great Wall PP". */
function bagName(key: string | null | undefined): string {
  const k = parseBagLedgerKey(String(key || ""));
  return k ? `${bagLabel(k.size, k.colour)} PP` : String(key || "");
}

/* ─────────────────────────────── reading rows ─────────────────────────────── */

/** A table's rows in the range, by its date column; empty if the table is not in this database. */
async function tableRows(
  table: string,
  dateColumn: string,
  mode: "ts" | "text" | "month",
  r: ExportRange,
  opts: { onlyWhereSet?: string } = {}
): Promise<Row[]> {
  const lo = mode === "ts" ? r.start : mode === "text" ? r.from : r.from.slice(0, 7);
  const hiCond =
    mode === "ts" ? sql`${sql(dateColumn)} < ${r.end}` : sql`${sql(dateColumn)} <= ${mode === "text" ? r.to : r.to.slice(0, 7)}`;
  try {
    return await sql<Row[]>`
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

/** Child rows of `parents`, each carrying its parent as `_parent`. */
async function withChildren(table: string, foreignKey: string, parents: Row[], order = "position"): Promise<Row[]> {
  if (parents.length === 0) return [];
  const byId = new Map(parents.map((p) => [String(p.id), p]));
  try {
    const rows = await sql<Row[]>`
      select * from ${sql(table)} where ${sql(foreignKey)} = any(${[...byId.keys()]}) limit ${ROW_CAP}
    `;
    return rows
      .map((c): Row => ({ ...c, _parent: byId.get(String(c[foreignKey])) ?? {} }))
      .sort(
        (a, b) =>
          String(a._parent.date ?? "").localeCompare(String(b._parent.date ?? "")) ||
          (Number(a[order]) || 0) - (Number(b[order]) || 0)
      );
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
  while ((y < ty || (y === ty && m <= tm)) && out.length <= 120) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

const inDays = (d: unknown, r: ExportRange) => {
  const s = eatDay(d);
  return s !== "" && s >= r.from && s <= r.to;
};

/* ─────────────────────────────── the sections ─────────────────────────────── */

/** How a sale was paid: the bank(s), Cheque, or Receivable for credit not yet in a bank. */
function payment(s: Row): string {
  const banks: { bank: string }[] = Array.isArray(s.banks) ? s.banks : [];
  const names = banks.length > 0 ? banks.map((b) => b.bank).join(" + ") : s.bank || "";
  if (s.paid_by_cheque === true) return names ? `Cheque (${names})` : "Cheque";
  if (!names && Number(s.invoice_credit) > 0 && !(Number(s.invoice_cash) > 0)) return "Receivable";
  return names;
}

const grossCash = (s: Row) => Number(s.gross_cash ?? s.invoice_cash) || 0;
const grossCredit = (s: Row) => Number(s.gross_credit ?? s.invoice_credit) || 0;

const SALES_COLUMNS: ExportColumn[] = [
  day("Date", (s) => s.date),
  text("Receipt No", (s) => s.delivery_no),
  text("Customer", (s) => s.customer),
  text("TIN", (s) => s.tin),
  num("Cash", grossCash),
  num("Credit", grossCredit),
  num("WHT 3%", (s) => Number(s.wht_amount) || 0),
  num("Net", (s) => (Number(s.invoice_cash) || 0) + (Number(s.invoice_credit) || 0)),
  text("Payment", payment),
  num("Qty (t)", (s) => s.qty),
  ...productColumns((s) => s.products),
  text("Review", (s) => (s.review_status === "approved" ? "Approved" : s.review_status === "edited" ? "Edited" : "")),
  text("Filed by", (s) => s.reported_by),
];

/** Minutes → hours, one decimal. */
const hours = (v: unknown) => (n(v) === null ? null : Math.round(((Number(v) || 0) / 60) * 10) / 10);
const DOWNTIME_PARTS: [string, string][] = [
  ["working", "Working"],
  ["power", "Power"],
  ["mech", "Mechanical"],
  ["elec", "Electrical"],
  ["raw", "Raw material"],
  ["total", "Total"],
];

const ledgerColumns = (prefix = ""): ExportColumn<LedgerDay>[] => [
  { header: "Date", kind: "date", value: (d) => d.day },
  ...FINANCE_RAW_MATERIALS.flatMap((m) => [
    { header: `${prefix}${m} received (t)`, kind: "number" as const, value: (d: LedgerDay) => r3(Number(d.received[m]) || 0) },
    { header: `${prefix}${m} used (t)`, kind: "number" as const, value: (d: LedgerDay) => r3(Number(d.used[m]) || 0) },
    { header: `${prefix}${m} remaining (t)`, kind: "number" as const, value: (d: LedgerDay) => r3(Number(d.remaining[m]) || 0) },
  ]),
];

type Builder = (r: ExportRange) => Promise<ExportSheet[]>;

const BUILDERS: Record<ExportDatasetKey, Builder> = {
  /* ── Production ─────────────────────────────────────────────── */
  production: async (r) => [
    {
      name: "Production",
      rows: await specRows("production", r),
      columns: [
        day("Date", (p) => p.date),
        text("FGR No", (p) => p.fgr_no),
        ...productColumns((p) => p.products),
        num("Total (t)", (p) => sumProducts(p.products)),
        num("Grade 1 total (t)", (p) => sumProducts(p.grade1?.products)),
        text("Filed by", (p) => p.reported_by),
      ],
    },
  ],
  downtime: async (r) => [
    {
      name: "Downtime",
      rows: await tableRows("production_hours", "month", "month", r),
      columns: [
        text("Month", (h) => h.month),
        num("Line", (h) => h.line),
        ...DOWNTIME_PARTS.flatMap(([k, label]) => [
          num(`${label} (hours)`, (h) => hours(h[`${k}_minutes`])),
          num(`${label} (days)`, (h) => h[`${k}_days`]),
        ]),
        text("Filed by", (h) => h.reported_by),
      ],
    },
  ],
  whiteness: async (r) => [
    {
      name: "Whiteness",
      rows: await specRows("whiteness", r),
      columns: [
        day("Date", (w) => w.date_label || w.date),
        num("Round", (w) => w.quarter),
        text("Product", (w) => productLabel(String(w.product_code || ""))),
        num("Line", (w) => w.line),
        ...[1, 2, 3, 4, 5, 6].map((i) =>
          text(`Reading ${i}`, (w) => {
            const v = (w.readings || {})[`wb${i}`];
            return v === undefined || v === null ? "" : /^\d+(\.\d+)?$/.test(String(v)) ? Number(v) : String(v);
          })
        ),
        num("Average %", (w) => w.avg),
        text("Filed by", (w) => w.reported_by),
      ],
    },
  ],

  /* ── Asset management ───────────────────────────────────────── */
  "raw-material": async (r) => {
    const ledgers = await Promise.all(monthsIn(r).map((m) => rawMaterialLedger(m).catch(() => null)));
    const days = (stream: "normal" | "grade1") => ledgers.flatMap((l) => (l?.[stream]?.days ?? []).filter((d) => inDays(d.day, r)));
    const sheets: ExportSheet[] = [{ name: "Raw material by day", rows: days("normal"), columns: ledgerColumns() }];
    const g1 = days("grade1");
    if (g1.length > 0) sheets.push({ name: "Grade 1 raw by day", rows: g1, columns: ledgerColumns("Grade 1 ") });
    return sheets;
  },
  vouchers: async (r) => {
    const [grv, siv] = await Promise.all([specRows("grv", r), specRows("store_issue", r)]);
    const [grvLines, sivLines] = await Promise.all([
      withChildren("goods_receiving_items", "grv_id", grv),
      withChildren("store_issue_items", "siv_id", siv),
    ]);
    return [
      {
        name: "GRV lines",
        rows: grvLines,
        columns: [
          text("GRV No", (l) => l._parent.grv_no),
          day("Date", (l) => l._parent.date),
          text("Supplier", (l) => l._parent.supplier),
          text("Item code", (l) => l.stock_code),
          text("Description", (l) => l.description),
          text("Unit", (l) => l.unit),
          num("Qty", (l) => l.quantity),
          num("Unit cost", (l) => l.unit_cost),
          num("Total", (l) => l.total_amount),
        ],
      },
      {
        name: "SIV lines",
        rows: sivLines,
        columns: [
          text("SIV No", (l) => l._parent.siv_no),
          day("Date", (l) => l._parent.date),
          text("Issued to", (l) => l._parent.issued_to),
          text("Department", (l) => l._parent.department_section),
          text("Machine", (l) => l.machine),
          text("Item code", (l) => l.stock_code),
          text("Description", (l) => l.description),
          text("Unit", (l) => l.unit),
          num("Qty", (l) => l.quantity),
        ],
      },
    ];
  },
  "stock-on-hand": async (r) => [
    {
      name: "Stock on hand",
      rows: await specRows("ops", r),
      columns: [
        day("Date", (o) => o.date),
        ...productColumns((o) => o.stock, " stock (t)"),
        ...productColumns((o) => o.delivered, " delivered (t)"),
        ...COMPANY_BAG_KINDS.map(({ size, colour }) =>
          num(`${bagLabel(size, colour)} PP (bags)`, (o) => (o.bags ? bagKindCount(o.bags as BagCounts, size, colour) : null))
        ),
      ],
    },
  ],
  "pp-bag-usage": async (r) => {
    const usage = await specRows("pp_bag_usage", r);
    return [
      {
        name: "PP bag usage",
        rows: await withChildren("pp_bag_usage_items", "usage_id", usage),
        columns: [
          day("Date", (l) => l._parent.date),
          text("Bag", (l) => bagName(l.ledger_key)),
          num("Qty", (l) => l.quantity),
          text("Reference No", (l) => l.reference_no),
          text("Filed by", (l) => l._parent.reported_by),
        ],
      },
    ];
  },
  "pp-bag-damage": async (r) => {
    const reports = await specRows("pp_bag_damage", r);
    const items = await withChildren("pp_bag_damage_items", "report_id", reports);
    // A report filed before the per-pile lines is one row of its own.
    const withLines = new Set(items.map((i) => String(i.report_id)));
    const rows = [
      ...items,
      ...reports.filter((p) => !withLines.has(String(p.id))).map((p) => ({ _parent: p, ledger_key: null, quantity: p.quantity })),
    ].sort((a, b) => String(a._parent.date).localeCompare(String(b._parent.date)));
    return [
      {
        name: "PP bag damage",
        rows,
        columns: [
          day("Date", (l) => l._parent.date),
          text("Bag", (l) => (l.ledger_key ? bagName(l.ledger_key) : "")),
          num("Qty", (l) => l.quantity),
          text("Reason", (l) => l._parent.reason),
          text("Status", (l) => l._parent.status),
          text("Filed by", (l) => l._parent.reported_by),
        ],
      },
    ];
  },
  "purchase-requests": async (r) => [
    {
      name: "Purchase requests",
      rows: await specRows("tool_request", r),
      columns: [
        day("Date", (p) => p.created_at),
        text("Department", (p) => p.department),
        text("Item", (p) => p.title || p.description),
        num("Qty", (p) => p.quantity),
        text("Unit", (p) => p.unit),
        text("Machine", (p) => p.machine),
        text("Status", (p) => p.status),
        text("Requested by", (p) => p.requested_by),
      ],
    },
  ],
  store: async () => {
    await loadCustomStoreItems();
    const [counts, movements, costs] = await Promise.all([recentCounts(), storeMovements(), costsAt(new Date())]);
    const groupName = new Map(STORE_GROUPS.map((g) => [g.key, g.label]));
    const rows = itemStatuses(counts, movements, costs)
      .slice()
      .sort((a, b) => String(groupName.get(a.item.group) ?? a.item.group).localeCompare(String(groupName.get(b.item.group) ?? b.item.group)) || a.item.name.localeCompare(b.item.name));
    return [
      {
        name: "Store",
        rows,
        columns: [
          text("Section", (s) => groupName.get(s.item.group) ?? s.item.group),
          text("Item", (s) => s.item.name),
          text("Unit", (s) => s.item.unit),
          num("Stock now", (s) => s.balance),
          num("Unit price", (s) => s.unitCost),
          num("Value", (s) => s.value),
          day("Last counted", (s) => s.countedAt),
        ],
      },
    ];
  },
  "bag-control": async (r) => [
    {
      name: "Damaged bag claims",
      rows: await specRows("damage_claim", r),
      columns: [
        day("Date", (c) => c.captured_at || c.created_at),
        text("Worker", (c) => c.worker),
        num("Bags", (c) => c.quantity),
        text("Status", (c) => c.status),
      ],
    },
  ],

  /* ── Sales ──────────────────────────────────────────────────── */
  sales: async (r) => [{ name: "Sales", rows: await specRows("sales_invoice", r), columns: SALES_COLUMNS }],

  /* ── Finance ────────────────────────────────────────────────── */
  "rm-credit": async (r) => {
    const loads = (await rmCreditLoads().catch(() => [])).filter((l) => inDays(l.date, r));
    return [
      {
        name: "RM credit loads",
        rows: loads,
        columns: [
          day("Load date", (l) => l.date),
          text("Quarry owner", (l) => l.quarryOwner || l.supplier),
          text("Agent", (l) => l.salesAgent),
          text("Driver", (l) => l.driverName),
          text("Truck", (l) => l.truckPlate),
          text("Material", (l) => l.material),
          num("Tonnes", (l) => l.tonnes),
          num("Price per t", (l) => l.pricePerTonne),
          num("Amount", (l) => l.amount),
          num("Driver fee", (l) => l.driverFee),
          num("Paid", (l) => l.paid),
          num("Owed", (l) => Math.max(0, l.remaining)),
          text("Status", (l) => (l.status === "open" ? (l.paid > 0 ? "Part paid" : "Unpaid") : "Paid")),
        ],
      },
      {
        name: "RM credit payments",
        rows: loads.flatMap((l) => l.payments.map((p) => ({ ...p, _load: l }))),
        columns: [
          day("Paid on", (p) => p.paidOn),
          day("Load date", (p) => p._load.date),
          text("Truck", (p) => p._load.truckPlate),
          text("Paid to", (p) => (p.part === "driver" ? p._load.driverName || "Driver" : p._load.quarryOwner || p._load.supplier)),
          text("For", (p) => (p.part === "driver" ? "Driver fee" : "Raw material")),
          num("Amount", (p) => p.amount),
          text("Note", (p) => p.note),
          text("Recorded by", (p) => p.recordedBy),
        ],
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
    const tag = <T,>(m: string, rows: T[] | null | undefined) => (rows ?? []).map((x) => ({ ...(x as object), _month: m }) as Row);
    return [
      {
        name: "Production",
        rows: reports.flatMap(({ m, report }) => tag(m, report?.production)),
        columns: [
          text("Month", (x) => x._month),
          text("Product", (x) => x.label),
          num("Opening (t)", (x) => x.baseBalance),
          num("Produced (t)", (x) => x.received),
          num("Total (t)", (x) => x.total),
          num("Sold (t)", (x) => x.sold),
          num("Revenue", (x) => x.revenue),
          num("Closing stock (t)", (x) => x.stock),
          num("Unit price", (x) => x.unitPrice),
          num("Net worth", (x) => x.netWorth),
        ],
      },
      {
        name: "Raw materials & bags",
        rows: reports.flatMap(({ m, report }) => tag(m, report?.rawMaterials)),
        columns: [
          text("Month", (x) => x._month),
          text("Item", (x) => x.label),
          text("Unit", (x) => x.unit),
          num("Opening", (x) => x.baseBalance),
          num("Received", (x) => x.received),
          num("Total", (x) => x.total),
          num("Used / issued", (x) => x.issue),
          num("Closing", (x) => x.stock),
          num("Unit price", (x) => x.unitPrice),
          num("Net worth", (x) => x.netWorth),
        ],
      },
      {
        name: "Store net worth",
        rows: reports.flatMap(({ m, store }) => tag(m, store?.blocks)),
        columns: [text("Month", (x) => x._month), text("Block", (x) => x.label), num("Net worth", (x) => x.netWorth), num("Items without a price", (x) => x.unpriced)],
      },
      {
        name: "Totals",
        rows: reports.map(({ m, report }) => ({ _month: m, ...(report?.totals ?? {}) })),
        columns: [
          text("Month", (x) => x._month),
          ...Object.keys(reports.find((x) => x.report?.totals)?.report?.totals ?? {}).map((k) =>
            num(k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase()), (x) => x[k])
          ),
        ],
      },
    ];
  },
  credit: async (r) => {
    const body = (await (await creditGET()).json()) as { rows?: Row[] };
    const rows = (body.rows ?? []).filter((x) => inDays(x.date, r));
    return [
      {
        name: "Credit sales",
        rows,
        columns: [
          day("Date", (x) => x.date),
          text("Receipt No", (x) => x.deliveryNo),
          text("Customer", (x) => x.customer),
          text("TIN", (x) => x.tin),
          num("Qty (t)", (x) => x.qty),
          num("Credit", (x) => x.credit),
          num("Paid", (x) => x.paid),
          num("Owed", (x) => x.outstanding),
          day("Due date", (x) => x.dueDate),
          text("Status", (x) => (x.status === "settled" ? "Settled" : x.status === "overdue" ? "Overdue" : "Open")),
        ],
      },
      {
        name: "Credit payments",
        rows: rows.flatMap((x) => ((x.payments as Row[]) ?? []).map((p) => ({ ...p, _sale: x }))),
        columns: [
          day("Collected on", (p) => p.collectedOn),
          day("Sale date", (p) => p._sale.date),
          text("Receipt No", (p) => p._sale.deliveryNo),
          text("Customer", (p) => p._sale.customer),
          num("Amount", (p) => p.amount),
          text("Note", (p) => p.note),
          text("Recorded by", (p) => p.recordedBy),
        ],
      },
    ];
  },
  wht: async (r) => {
    const holders = await specRows("wht_holder", r);
    const ids = holders.map((h) => String(h.id));
    const sms = ids.length
      ? await sql<{ holder_id: string; n: string }[]>`
          select holder_id, count(*) filter (where ok) as n from wht_sms_log where holder_id = any(${ids}) group by holder_id
        `.catch(() => [])
      : [];
    const sent = new Map(sms.map((s) => [String(s.holder_id), Number(s.n)]));
    return [
      {
        name: "WHT",
        rows: holders,
        columns: [
          text("Company", (h) => h.company),
          text("Phone", (h) => h.phone),
          text("Description", (h) => h.description),
          text("Status", (h) => h.status),
          num("SMS sent", (h) => sent.get(String(h.id)) ?? 0),
          day("Registered", (h) => h.created_at),
          day("Resolved", (h) => h.resolved_at),
        ],
      },
    ];
  },
  banks: async (r) => {
    const months = await tableRows("bank_collections", "month", "month", r);
    const rows = months.flatMap((m) =>
      Object.entries((m.banks as Record<string, unknown>) || {}).map(([bank, amount]) => ({ month: m.month, bank, amount }))
    );
    return [{ name: "Bank collections", rows, columns: [text("Month", (x) => x.month), text("Bank", (x) => x.bank), num("Amount", (x) => x.amount)] }];
  },
  purchases: async (r) => [
    {
      name: "Purchases",
      rows: await specRows("item_purchase", r),
      columns: [
        day("Date", (p) => p.date),
        text("Item", (p) => p.item_name),
        num("Qty", (p) => p.qty),
        text("Unit", (p) => p.unit),
        num("Unit price", (p) => p.unit_price),
        num("Total", (p) => p.total),
        text("Note", (p) => p.note),
        text("Filed by", (p) => p.reported_by),
      ],
    },
  ],

  /* ── Settings ───────────────────────────────────────────────── */
  submissions: async (r) => {
    const sheets = await Promise.all(
      SUBMISSION_COLLECTIONS.map(async (k) => {
        const spec = SUBMISSIONS[k];
        let rows = await specRows(k, r).catch(() => [] as Row[]);
        // The load a payment paid, beside it (as Settings shows it).
        if (spec.parentFields && rows.length) {
          const pf = spec.parentFields;
          const ids = [...new Set(rows.map((x) => String(x[pf.foreignKey])))];
          const parents = await sql<Row[]>`select * from ${sql(pf.table)} where id = any(${ids})`.catch(() => [] as Row[]);
          const byId = new Map(parents.map((p) => [String(p.id), p]));
          rows = rows.map((x) => {
            const p = byId.get(String(x[pf.foreignKey])) ?? {};
            return { ...x, ...Object.fromEntries(pf.columns.map((c) => [c.as, p[c.column]])) };
          });
        }
        const json = spec.jsonFields;
        // Long pasted text is not a column anyone reads in a sheet; a type that
        // already shows its own "Date" does not get a second one.
        const fields = spec.displayFields.filter((f) => f.type !== "longtext" && f.column !== spec.dateColumn);
        const hasDate = fields.some((f) => f.label.toLowerCase() === "date");
        const columns: ExportColumn[] = [
          ...(hasDate ? [] : [day("Date", (x) => x[spec.dateColumn] ?? x.created_at)]),
          ...fields
            .map((f) => {
              const read = (x: Row) => (json && json.keys.includes(f.key) ? (x[json.column] || {})[f.key] : x[f.column]);
              const scalar = (v: unknown) => (v !== null && typeof v === "object" ? "" : v);
              return f.type === "number" ? num(f.label, (x) => scalar(read(x))) : text(f.label, (x) => scalar(read(x)));
            }),
        ];
        return { name: spec.label, rows, columns };
      })
    );
    // Only the kinds that have something in the range: thirty empty tabs help nobody.
    const filled = sheets.filter((s) => s.rows.length > 0);
    return filled.length > 0 ? filled : [{ name: "Submissions", rows: [], columns: [text("Nothing was filed in these dates", () => "")] }];
  },
};

export function isExportDataset(v: unknown): v is ExportDatasetKey {
  return typeof v === "string" && v in EXPORT_DATASETS;
}

export async function buildExport(key: ExportDatasetKey, r: ExportRange): Promise<ExportSheet[]> {
  return BUILDERS[key](r);
}
