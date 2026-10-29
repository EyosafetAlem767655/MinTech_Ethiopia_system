/**
 * Generates a sales seed for one month from the "Buyer TIN" sales sheets.
 *
 *   npm run seed:sales-tin -- 2026-10
 *
 * The layout the sheets took from October 2026:
 *
 *   Buyer TIN., Buyer name, Date of Sale., Vat receipt, Description.,
 *   Unit of Measure, Quantity., Unit Price., Total value, vat, value after vat
 *
 * It has no Att.No, bank, withholding or TOTAL row, so it is not the layout
 * scripts/generate-sales-seed.ts reads; that script and the months it wrote are
 * left as they are.
 *
 * Reads scripts/sales/<YYYY-MM>-cash.csv and -credit.csv and writes
 * supabase/seed/NNNN_sales_<YYYY>_<MM>.sql (an existing file for that month
 * keeps its number; a new month takes the next one).
 *
 * ONLY the columns the dashboard's sales sheet shows are written: date,
 * customer, TIN, invoice cash / credit, qty, the products and the bank (none on
 * this sheet, so blank). The invoice amount is the VALUE AFTER VAT. The unit
 * price, VAT and unit of measure are checked, then dropped — no `extraction`.
 *
 * NOTHING is written unless every line passes its own arithmetic.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCT_LABEL } from "../src/lib/products";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const MONTH_KEY = process.argv[2] || "";
if (!/^\d{4}-\d{2}$/.test(MONTH_KEY)) {
  console.error("Usage: npm run seed:sales-tin -- YYYY-MM   (e.g. 2026-10)");
  process.exit(1);
}
const YEAR = Number(MONTH_KEY.slice(0, 4));
const MONTH = Number(MONTH_KEY.slice(5, 7));
const MM = MONTH_KEY.slice(5, 7);
const MONTH_SHORT = new Date(Date.UTC(YEAR, MONTH - 1, 1)).toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
const monthStart = new Date(Date.UTC(YEAR, MONTH - 1, 1)).toISOString();
const monthEnd = new Date(Date.UTC(YEAR, MONTH, 1)).toISOString();

const SEED_DIR = path.join(ROOT, "supabase", "seed");
const SHEETS = {
  cash: path.join(ROOT, "scripts", "sales", `${MONTH_KEY}-cash.csv`),
  credit: path.join(ROOT, "scripts", "sales", `${MONTH_KEY}-credit.csv`),
} as const;
for (const f of Object.values(SHEETS)) {
  if (!fs.existsSync(f)) {
    console.error(`Missing ${path.relative(ROOT, f)}`);
    process.exit(1);
  }
}

/** Marks every row this import writes, so re-running can clear its own work. */
const REPORTED_BY = "historical import";

/** Sheet spelling → catalogue code, as in generate-sales-seed.ts. */
const CODE_BY_SPELLING: Record<string, string> = {
  "ETL-15": "ETL15",
  "ETL-9": "ETL9",
  "ETL-6": "ETL6",
  "5-EL": "5EL",
  "3-EL": "3EL",
  "W-2-EL": "W2EL",
  "2-EL": "2EL",
  "EC-15": "EC15",
  "EC-90": "EC90",
  Talc: "Talk",
};
for (const [spelling, code] of Object.entries(CODE_BY_SPELLING)) {
  if (!(code in PRODUCT_LABEL)) throw new Error(`"${spelling}" maps to "${code}", which is not a product`);
}

const problems: string[] = [];
const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;
const money = (n: number) => n.toLocaleString("en-US");
const isNum = (t: string) => /^\d+(\.\d+)?$/.test(t);
const sqlString = (s: string) => `'${String(s).replace(/'/g, "''")}'`;
const sqlJson = (v: unknown) => `${sqlString(JSON.stringify(v))}::jsonb`;
const dateLabel = (d: Date) => `${d.getUTCDate()}/${d.getUTCMonth() + 1}/${d.getUTCFullYear()}`;

/** A uuid derived from the invoice's identity, so a re-run writes the same ids. */
function stableId(...parts: string[]): string {
  const h = createHash("sha1").update(parts.join("|")).digest("hex");
  const variant = ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

/** RFC 4180 CSV: commas inside double quotes belong to the field. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

interface Invoice {
  kind: "cash" | "credit";
  receipt: string;
  /** The receipt number as the earlier seeds store it: "FS00003157" → "3157". */
  fsNo: string;
  tin: string | null;
  customer: string;
  date: Date;
  products: Record<string, number>;
  qty: number;
  afterVat: number;
}

function parseSheet(kind: "cash" | "credit"): Invoice[] {
  const rows = parseCsv(fs.readFileSync(SHEETS[kind], "utf8"));
  const head = (rows.shift() ?? []).map((h) => h.trim().toLowerCase());
  const col = (name: string) => head.indexOf(name.toLowerCase());
  const C = {
    tin: col("Buyer TIN."),
    customer: col("Buyer name"),
    date: col("Date of Sale."),
    receipt: col("Vat receipt"),
    product: col("Description."),
    qty: col("Quantity."),
    price: col("Unit Price."),
    sub: col("Total value"),
    vat: col("vat"),
    after: col("value after vat"),
  };
  const missing = Object.entries(C).filter(([, i]) => i < 0).map(([k]) => k);
  if (missing.length) {
    problems.push(`${kind}: no column for ${missing.join(", ")} — check the heading row`);
    return [];
  }

  const invoices: Invoice[] = [];
  rows.forEach((r, n) => {
    const cell = (i: number) => (r[i] ?? "").trim();
    if (r.every((c) => !c.trim())) return;
    const where = `${kind} row ${n + 2} (${cell(C.receipt) || "no receipt"})`;

    const code = CODE_BY_SPELLING[cell(C.product)];
    if (!code) return void problems.push(`${where}: product "${cell(C.product)}" is not one this import knows`);
    const bad = (["qty", "price", "sub", "vat", "after"] as const).filter((k) => !isNum(cell(C[k])));
    if (bad.length) return void problems.push(`${where}: ${bad.join(", ")} is not a number`);
    const [qty, price, sub, vat, after] = (["qty", "price", "sub", "vat", "after"] as const).map((k) => Number(cell(C[k])));
    if (round(qty * price) !== round(sub)) problems.push(`${where}: ${qty} × ${money(price)} ≠ ${money(sub)}`);
    if (round(sub + vat) !== round(after)) problems.push(`${where}: ${money(sub)} + ${money(vat)} ≠ ${money(after)}`);

    const m = cell(C.date).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m || Number(m[1]) !== YEAR || Number(m[2]) !== MONTH) {
      return void problems.push(`${where}: date "${cell(C.date)}" is not a day in ${MONTH_KEY}`);
    }
    const date = new Date(Date.UTC(YEAR, MONTH - 1, Number(m[3])));

    const tin = cell(C.tin);
    if (tin && !/^\d{10}$/.test(tin)) problems.push(`${where}: TIN "${tin}" is not ten digits`);
    const receipt = cell(C.receipt);
    if (!receipt) return void problems.push(`${where}: no VAT receipt number`);

    // A second product line repeats its invoice's receipt on the next row.
    const prev = invoices[invoices.length - 1];
    if (prev && prev.receipt === receipt) {
      if (prev.customer !== cell(C.customer) || +prev.date !== +date) {
        problems.push(`${where}: repeats receipt ${receipt} under a different customer or date`);
      }
      prev.products[code] = round((prev.products[code] ?? 0) + qty, 3);
      prev.qty = round(prev.qty + qty, 3);
      prev.afterVat = round(prev.afterVat + after);
      return;
    }
    if (invoices.some((v) => v.receipt === receipt)) problems.push(`${where}: receipt ${receipt} is used twice`);

    invoices.push({
      kind,
      receipt,
      fsNo: receipt.replace(/^FS0*/i, ""),
      tin: tin || null,
      customer: cell(C.customer),
      date,
      products: { [code]: qty },
      qty,
      afterVat: after,
    });
  });
  if (invoices.length === 0) problems.push(`${kind}: no invoices could be found`);
  return invoices;
}

const all = [...parseSheet("cash"), ...parseSheet("credit")].sort(
  (a, b) => +a.date - +b.date || Number(a.fsNo) - Number(b.fsNo)
);

if (problems.length) {
  console.error(`Nothing written — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}

const cash = all.filter((v) => v.kind === "cash");
const credit = all.filter((v) => v.kind === "credit");
const tonnes = round(all.reduce((a, v) => a + v.qty, 0), 3);
const cashEtb = round(cash.reduce((a, v) => a + v.afterVat, 0));
const creditEtb = round(credit.reduce((a, v) => a + v.afterVat, 0));

const values = all
  .map((v) => {
    const label = dateLabel(v.date);
    return (
      `  -- ${label} · ${v.receipt} · ${v.customer} · ${v.qty} t · ${money(v.afterVat)} ETB ${v.kind}\n` +
      `  (${[
        sqlString(stableId("sales-tin", MONTH_KEY, v.kind, v.receipt)),
        sqlString(v.date.toISOString()),
        sqlString(label),
        sqlString(v.customer),
        v.tin ? sqlString(v.tin) : "null",
        v.kind === "cash" ? v.afterVat : 0,
        v.kind === "credit" ? v.afterVat : 0,
        v.qty,
        sqlString(v.fsNo),
        sqlJson(v.products),
        "null",
        sqlString(REPORTED_BY),
        "'app'",
      ].join(", ")})`
    );
  })
  .join(",\n");

const seedName =
  fs.readdirSync(SEED_DIR).find((f) => f.endsWith(`_sales_${YEAR}_${MM}.sql`)) ??
  `${String(
    Math.max(0, ...fs.readdirSync(SEED_DIR).map((f) => Number(f.slice(0, 4))).filter((n) => Number.isFinite(n))) + 1
  ).padStart(4, "0")}_sales_${YEAR}_${MM}.sql`;
const OUT = path.join(SEED_DIR, seedName);

const out = `-- MinTech Ethiopia — sales invoices, ${MONTH_SHORT} ${YEAR}.
-- GENERATED by scripts/generate-sales-seed-tin.ts from scripts/sales/${MONTH_KEY}-cash.csv
-- and scripts/sales/${MONTH_KEY}-credit.csv — do not edit by hand.
--
-- ${all.length} invoices (${cash.length} cash, ${credit.length} credit), ${tonnes} t,
-- ${money(cashEtb)} ETB cash and ${money(creditEtb)} ETB credit, after VAT.
--
-- Every line was checked — qty × unit price = total value, and total value +
-- VAT = value after vat — before this file was written.
--
-- Only the columns the dashboard's sales sheet shows are written: date,
-- customer, TIN, invoice cash / credit (the value AFTER VAT), qty, products,
-- and the receipt number in \`delivery_no\`. The sheet names no bank, so bank is
-- blank. Unit price, VAT and unit of measure are not stored.
--
-- Credit invoices have no payments against them: they are outstanding from the
-- moment this runs, in the Credit tab and towards the exposure alarm.
--
-- Run migration 0046 FIRST: the last statement gives older sales under the same
-- or a similar customer name the TIN this sheet prints (empty TINs only).
--
-- SAFE TO RE-RUN: the delete clears only rows this import wrote
-- (reported_by = '${REPORTED_BY}') within the month, so anything filed through
-- the bot is left exactly as it is.

begin;

delete from sales_invoices
 where date >= '${monthStart}' and date < '${monthEnd}'
   and reported_by = ${sqlString(REPORTED_BY)};

insert into sales_invoices (id, date, date_label, customer, tin, invoice_cash, invoice_credit, qty,
                            delivery_no, products, bank, reported_by, source) values
${values};

select fill_customer_tins() as older_sales_given_a_tin;

commit;

-- Expect: ${all.length} invoices, ${tonnes} t, ${money(cashEtb)} cash + ${money(creditEtb)} credit.
select count(*)                      as invoices,
       round(sum(qty), 3)            as tonnes,
       round(sum(invoice_cash), 2)   as cash_etb,
       round(sum(invoice_credit), 2) as credit_etb
  from sales_invoices
 where date >= '${monthStart}' and date < '${monthEnd}'
   and reported_by = ${sqlString(REPORTED_BY)};
`;

fs.writeFileSync(OUT, out, "utf8");
console.log(`Wrote ${path.relative(ROOT, OUT)}`);
console.log(`  ${all.length} invoices (${cash.length} cash, ${credit.length} credit) · ${tonnes} t`);
console.log(`  ${money(cashEtb)} ETB cash · ${money(creditEtb)} ETB credit (after VAT, outstanding)`);
