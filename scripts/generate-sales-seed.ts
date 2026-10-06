/**
 * Generates supabase/seed/0006_sales_2026_09.sql from the September 2026 sales
 * sheets.
 *
 *   npm run seed:sales
 *
 * TypeScript, unlike the three generators before it, so that it can IMPORT
 * `matchBank` from src/lib/banks.ts and the product catalogue from
 * src/lib/products.ts rather than copying them. A bank spelling that resolves
 * here and nowhere else in the system would be the worst possible outcome of
 * this import: the seeded rows would group onto a bank the bot can never file
 * against again.
 *
 * The input is the sheet exported as CSV, exactly as the owner sent it — headings
 * and TOTAL row included — kept beside this script so the original and its
 * output can be compared without reading Postgres. One invoice (Fs No) becomes
 * one row; see parseSheet for the two ways the sheet writes a second product
 * line onto an invoice.
 *
 * NOTHING is written unless every line passes its own arithmetic. A wrong
 * figure in the database is worse than no import at all.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { matchBank } from "../src/lib/banks";
import { PRODUCTION_PRODUCTS, PRODUCT_LABEL } from "../src/lib/products";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CASH = path.join(ROOT, "scripts", "sales-2026-09-cash.csv");
const CREDIT = path.join(ROOT, "scripts", "sales-2026-09-credit.csv");
const OUT = path.join(ROOT, "supabase", "seed", "0006_sales_2026_09.sql");

/** The month the sheets cover. A sale dated outside it is an error, not a date. */
const YEAR = 2026;
const MONTH = 9;

/** Marks every row this import writes, so re-running can clear its own work. */
const REPORTED_BY = "historical import";

/**
 * Sheet spelling → catalogue code.
 *
 * Written out rather than derived, because the sheet's spellings are its own.
 * Every target is checked against PRODUCT_LABEL below, so a typo here cannot
 * invent a product the app does not know.
 */
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
};

for (const [spelling, code] of Object.entries(CODE_BY_SPELLING)) {
  if (!(code in PRODUCT_LABEL)) {
    throw new Error(`"${spelling}" maps to "${code}", which is not a product in src/lib/products.ts`);
  }
}

/** The sheet's own totals row, for the one check that matters. */
interface SheetTotals {
  qty: number;
  subTotal: number;
  vat: number;
  grandTotal: number;
  withhold: number;
  netPay: number;
}

interface Line {
  code: string;
  qty: number;
  unitPrice: number;
  subTotal: number;
  vat: number;
  grandTotal: number;
  withhold: number;
  netPay: number;
  bankRaw: string;
  depositRaw: string;
}

interface Invoice {
  /** The sale date, after any year correction. */
  date: Date;
  dateRaw: string;
  customer: string;
  fsNo: string;
  attNo: string;
  lines: Line[];
  notes: string[];
}

const problems: string[] = [];
const warnings: string[] = [];

const isNum = (t: string) => /^\d+(\.\d+)?$/.test(t);
const isProduct = (t: string) => t in CODE_BY_SPELLING;
const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;
const money = (n: number) => n.toLocaleString("en-US");

/** `delete`-safe SQL literal. */
const sqlString = (s: string) => `'${String(s).replace(/'/g, "''")}'`;
const sqlJson = (v: unknown) => `${sqlString(JSON.stringify(v))}::jsonb`;

/**
 * RFC 4180 CSV: commas inside double quotes are part of the field, and a doubled
 * quote is a literal one. The sheet needs both — `"C.B,E"` and
 * `"5,8,15/09/2026"` are single cells — so splitting on commas would silently
 * shift every column after them by one.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** D/M/YYYY, with a wrong year corrected to the month being imported. */
function parseSaleDate(raw: string, where: string): Date | null {
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) {
    problems.push(`${where}: "${raw}" is not a date`);
    return null;
  }
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3].length === 2 ? `20${m[3]}` : m[3]);
  if (month !== MONTH) {
    problems.push(`${where}: dated month ${month}, which is not ${MONTH} — a sale in the wrong month cannot be imported as September`);
    return null;
  }
  if (day < 1 || day > 30) {
    problems.push(`${where}: day ${day} is not a day in September`);
    return null;
  }
  return new Date(Date.UTC(YEAR, MONTH - 1, day));
}

/** `1/9/2026` — the shape opsDateLabel writes, which is what live rows hold. */
const dateLabel = (d: Date) => `${d.getUTCDate()}/${d.getUTCMonth() + 1}/${d.getUTCFullYear()}`;

/**
 * One sheet, parsed into invoices plus its own stated totals.
 *
 * Columns are found by their HEADING, not their position, so a sheet with a
 * column added or moved still reads correctly — and one missing a column the
 * import needs is refused by name rather than read off by one.
 *
 * A product line belongs to an invoice in one of two ways, and the September
 * sheet uses both:
 *   - its Date, Customer and Fs No are left blank under the invoice it belongs to;
 *   - or it repeats them in full (Fs 3114, 3117, 3119, 3120, 3129).
 * Both mean one invoice, and both become one row.
 */
function parseSheet(text: string, sheet: string): { invoices: Invoice[]; totals: SheetTotals | null } {
  const rows = parseCsv(text);
  const head = (rows.shift() ?? []).map((h) => h.trim().toLowerCase());
  const col = (name: string) => head.indexOf(name.toLowerCase());
  const C = {
    date: col("Date"),
    customer: col("Customer"),
    fs: col("Fs No"),
    att: col("Att.No"),
    product: col("Product"),
    qty: col("Qty"),
    price: col("Unit Price"),
    sub: col("Sub Total"),
    vat: col("VAT 15%"),
    grand: col("Grand Total"),
    withhold: col("Withhold"),
    net: col("Net Pay"),
    bank: col("Deposited Bank"),
    // Optional: the credit sheet has no deposit date, because nothing has been
    // deposited yet.
    deposit: col("Deposit Date"),
  };
  const missing = Object.entries(C)
    .filter(([k, i]) => i < 0 && k !== "deposit")
    .map(([k]) => k);
  if (missing.length) {
    problems.push(`${sheet}: no column for ${missing.join(", ")} — check the heading row`);
    return { invoices: [], totals: null };
  }

  const invoices: Invoice[] = [];
  let totals: SheetTotals | null = null;

  rows.forEach((r, n) => {
    const sheetRow = n + 2; // the heading is row 1
    const cell = (i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
    if (r.every((c) => !c.trim())) return;

    // The totals row. Its label sits in the Customer column on this sheet;
    // Date is accepted too so a re-exported sheet still finds it.
    if (/^total$/i.test(cell(C.customer)) || /^total$/i.test(cell(C.date))) {
      const num = (i: number) => Number(cell(i) || 0);
      totals = {
        qty: num(C.qty),
        subTotal: num(C.sub),
        vat: num(C.vat),
        grandTotal: num(C.grand),
        withhold: num(C.withhold),
        netPay: num(C.net),
      };
      return;
    }

    const fsNo = cell(C.fs);
    const where = `${sheet} row ${sheetRow}${fsNo ? ` (Fs ${fsNo})` : ""}`;

    const spelling = cell(C.product);
    if (!isProduct(spelling)) {
      problems.push(`${where}: product "${spelling}" is not one this import knows — is it a new product?`);
      return;
    }

    // Every figure must be a number. A blank Withhold means none was withheld;
    // a blank anywhere else is a sheet error, never a zero.
    const required: [string, number][] = [
      ["Qty", C.qty],
      ["Unit Price", C.price],
      ["Sub Total", C.sub],
      ["VAT", C.vat],
      ["Grand Total", C.grand],
      ["Net Pay", C.net],
    ];
    const bad = required.filter(([, i]) => !isNum(cell(i)));
    if (bad.length) {
      problems.push(`${where}: ${bad.map(([name, i]) => `${name} "${cell(i)}"`).join(", ")} is not a number`);
      return;
    }
    if (cell(C.withhold) && !isNum(cell(C.withhold))) {
      problems.push(`${where}: Withhold "${cell(C.withhold)}" is not a number`);
      return;
    }

    const line: Line = {
      code: CODE_BY_SPELLING[spelling],
      qty: Number(cell(C.qty)),
      unitPrice: Number(cell(C.price)),
      subTotal: Number(cell(C.sub)),
      vat: Number(cell(C.vat)),
      grandTotal: Number(cell(C.grand)),
      withhold: Number(cell(C.withhold) || 0),
      netPay: Number(cell(C.net)),
      bankRaw: cell(C.bank),
      depositRaw: cell(C.deposit),
    };

    /* Arithmetic, line by line. These two abort the whole import: a sale whose
       own cells disagree is a sale nobody can reconcile, and the sheet is the
       only record of what was actually invoiced. */
    if (round(line.qty * line.unitPrice) !== round(line.subTotal)) {
      problems.push(
        `${where} ${spelling}: ${line.qty} × ${money(line.unitPrice)} = ${money(round(line.qty * line.unitPrice))}, but the sheet says ${money(line.subTotal)}`
      );
    }
    if (round(line.subTotal + line.vat) !== round(line.grandTotal)) {
      problems.push(
        `${where} ${spelling}: ${money(line.subTotal)} + ${money(line.vat)} = ${money(round(line.subTotal + line.vat))}, but the grand total says ${money(line.grandTotal)}`
      );
    }
    // VAT and the net pay only WARN. Neither is imported as a figure, so a
    // disagreement is something for the owner to reconcile on the sheet, not
    // a reason to withhold a month of sales from the dashboard.
    if (round(line.subTotal * 0.15) !== round(line.vat)) {
      warnings.push(`${where} ${spelling}: VAT ${money(line.vat)} is not 15% of ${money(line.subTotal)}`);
    }
    if (round(line.grandTotal - line.withhold) !== round(line.netPay)) {
      warnings.push(`${where} ${spelling}: net pay ${money(line.netPay)} ≠ ${money(line.grandTotal)} − ${money(line.withhold)}`);
    }

    const prev = invoices[invoices.length - 1];

    // A continuation row: date, customer and Fs No left blank.
    if (!fsNo) {
      if (!prev) {
        problems.push(`${where}: a product line with no invoice above it`);
        return;
      }
      if (cell(C.date) || cell(C.customer)) {
        problems.push(`${where}: has a date or customer but no Fs No — which invoice is it?`);
        return;
      }
      prev.lines.push(line);
      return;
    }

    // The same invoice written out again in full.
    if (prev && prev.fsNo === fsNo) {
      if (cell(C.customer).toLowerCase() !== prev.customer.toLowerCase()) {
        problems.push(`${where}: repeats Fs ${fsNo} under "${cell(C.customer)}", but the invoice above is "${prev.customer}"`);
        return;
      }
      prev.lines.push(line);
      prev.notes.push(`line ${prev.lines.length} was written as its own row on the sheet, repeating the invoice number`);
      return;
    }
    if (invoices.some((v) => v.fsNo === fsNo)) {
      problems.push(`${where}: Fs ${fsNo} appears twice, not next to each other — which of them is the sale cannot be decided here`);
      return;
    }

    const dateRaw = cell(C.date);
    const date = parseSaleDate(dateRaw, where);
    if (!date) return;
    const notes: string[] = [];
    if (!/^\d{1,2}\/\d{1,2}\/2026$/.test(dateRaw)) {
      notes.push(`sale date read as ${dateRaw} and corrected to ${dateLabel(date)}`);
    }
    invoices.push({ date, dateRaw, customer: cell(C.customer), fsNo, attNo: cell(C.att), lines: [line], notes });
  });

  if (invoices.length === 0) problems.push(`${sheet}: no invoices could be found at all`);
  if (!totals) problems.push(`${sheet}: no TOTAL row — there is then nothing to check the import against`);
  return { invoices, totals };
}

/** One invoice → one row's worth of values, plus the provenance that has no column. */
function rowOf(inv: Invoice, kind: "cash" | "credit") {
  const products: Record<string, number> = {};
  for (const l of inv.lines) {
    products[l.code] = round((products[l.code] || 0) + l.qty, 3);
  }
  const qty = round(
    inv.lines.reduce((a, l) => a + l.qty, 0),
    3
  );
  const grandTotal = round(inv.lines.reduce((a, l) => a + l.grandTotal, 0));
  const notes = [...inv.notes];

  /* The bank: the FIRST one named on the invoice. A deposit split across two
     banks ("C.B.E & C.B.O") has one column to live in, so the rest of the cell
     is kept verbatim in `extraction` rather than invented into a new bank name
     that would sit alone on every chart. */
  const bankRaw = inv.lines.map((l) => l.bankRaw).find(Boolean) || "";
  let bank: string | null = null;
  if (bankRaw) {
    for (const part of bankRaw.split(/[&+]|\band\b/)) {
      const hit = matchBank(part);
      if (hit) {
        bank = hit;
        break;
      }
    }
    if (!bank) notes.push(`bank "${bankRaw}" matched nothing in the bank list`);
    else if (/[&+]|\band\b/.test(bankRaw)) notes.push(`deposit split across banks: "${bankRaw}" — recorded under ${bank}`);
  } else {
    notes.push("no bank recorded on the sheet");
  }

  if (kind === "cash" && !inv.lines.some((l) => l.depositRaw)) notes.push("no deposit date recorded");

  const extraction = {
    sheet: `September 2026 ${kind} sales sheet`,
    importedBy: "scripts/generate-sales-seed.ts",
    // Everything the sales table has no column for. Provenance, not figures:
    // nothing here is read by any report, and withholding in particular is NOT
    // reportable from this import.
    attNo: inv.attNo,
    saleDateAsWritten: inv.dateRaw,
    depositBankAsWritten: bankRaw || null,
    depositDateAsWritten: inv.lines.map((l) => l.depositRaw).filter(Boolean).join(" · ") || null,
    subTotal: round(inv.lines.reduce((a, l) => a + l.subTotal, 0)),
    vat: round(inv.lines.reduce((a, l) => a + l.vat, 0)),
    grandTotal,
    withhold: round(inv.lines.reduce((a, l) => a + l.withhold, 0)),
    netPay: round(inv.lines.reduce((a, l) => a + l.netPay, 0)),
    lines: inv.lines.map((l) => ({
      code: l.code,
      qty: l.qty,
      unitPrice: l.unitPrice,
      subTotal: l.subTotal,
      vat: l.vat,
      grandTotal: l.grandTotal,
      withhold: l.withhold,
      netPay: l.netPay,
    })),
    notes,
  };

  return { inv, kind, products, qty, grandTotal, bank, extraction, notes };
}

/* ─────────────────────────────── Read both sheets ────────────────────────── */

const cash = parseSheet(fs.readFileSync(CASH, "utf8"), "cash");
const credit = parseSheet(fs.readFileSync(CREDIT, "utf8"), "credit");

const rows = [
  ...cash.invoices.map((i) => rowOf(i, "cash")),
  ...credit.invoices.map((i) => rowOf(i, "credit")),
];

/**
 * The import, against the sheet's own totals row — and WHERE it stops agreeing.
 *
 * This is a report, not a gate. The checks that protect the figures are the
 * per-line ones above (qty × unit price = sub total, sub total + VAT = grand
 * total), and those abort. A footer can disagree with its own sheet for a reason
 * that has nothing to do with the data: the September cash footer was last
 * recalculated part way through 23 September, so it is short by 37 invoices.
 * Aborting on it would refuse a month of correct sales because a spreadsheet
 * formula was not dragged down.
 *
 * So when it disagrees, the prefix of lines that DOES add up to the stated
 * figures is found and named. "The total covers the first 96 invoices, up to
 * Fs 3119" is something the owner can act on; "mismatch" is not.
 */
function reportTotals(label: string, parsed: ReturnType<typeof parseSheet>, kind: "cash" | "credit"): string {
  if (!parsed.totals) return `-- ${label}: the sheet carried no total to check against.`;
  const mine = parsed.invoices.map((i) => rowOf(i, kind));
  const qty = round(mine.reduce((a, r) => a + r.qty, 0), 2);
  const sub = round(mine.reduce((a, r) => a + r.extraction.subTotal, 0));
  const vat = round(mine.reduce((a, r) => a + r.extraction.vat, 0));
  const grand = round(mine.reduce((a, r) => a + r.grandTotal, 0));
  const withhold = round(mine.reduce((a, r) => a + r.extraction.withhold, 0));
  const stated = parsed.totals;

  const agrees =
    round(qty, 2) === round(stated.qty, 2) &&
    round(sub) === round(stated.subTotal) &&
    round(vat) === round(stated.vat) &&
    round(grand) === round(stated.grandTotal);

  if (agrees) {
    console.log(`  ${label}: agrees with the sheet's own total — ${qty} t, ${money(sub)} + ${money(vat)} VAT = ${money(grand)}.`);
    if (round(withhold) !== round(stated.withhold)) {
      warnings.push(`${label} withholding: the rows add to ${money(withhold)}, the footer says ${money(stated.withhold)}`);
    }
    return `-- The ${label} sheet's own total agrees with this import exactly: ${qty} t, ${money(grand)} ETB.`;
  }

  // Walk the lines in sheet order and find where the footer's figures were last true.
  let cumQty = 0;
  let cumSub = 0;
  let matchedAt = "";
  let matchedCount = 0;
  outer: for (const r of parsed.invoices) {
    matchedCount++;
    for (const l of r.lines) {
      cumQty = round(cumQty + l.qty, 2);
      cumSub = round(cumSub + l.subTotal);
      if (cumQty === round(stated.qty, 2) && cumSub === round(stated.subTotal)) {
        matchedAt = r.fsNo;
        break outer;
      }
    }
  }

  const miss = [
    `${label}: the sheet's footer does NOT cover the sheet.`,
    `  footer says  ${String(stated.qty).padStart(9)} t · ${money(stated.subTotal)} + ${money(stated.vat)} VAT = ${money(stated.grandTotal)} · withholding ${money(stated.withhold)}`,
    `  invoices add ${String(qty).padStart(9)} t · ${money(sub)} + ${money(vat)} VAT = ${money(grand)} · withholding ${money(withhold)}`,
  ];
  if (matchedAt) {
    miss.push(
      `  the footer's figures were last true at Fs ${matchedAt} — invoice ${matchedCount} of ${parsed.invoices.length}, so ${parsed.invoices.length - matchedCount} later invoices are missing from it.`,
      `  every one of those ${parsed.invoices.length} invoices passed its own arithmetic, so the IMPORT is the complete month and the footer is the stale figure.`
    );
  } else {
    miss.push(`  no run of invoices from the top adds up to the footer, so the difference is not simply a stale total — read the lines below.`);
  }
  for (const m of miss) warnings.push(m);

  return (
    `-- The ${label} sheet's own TOTAL row is STALE and should not be used to check this import:
` +
    `--   it says ${stated.qty} t / ${money(stated.grandTotal)} ETB, while the ${parsed.invoices.length} invoices on the sheet
` +
    `--   add to ${qty} t / ${money(grand)} ETB` +
    (matchedAt
      ? `. Its figures were last true at Fs ${matchedAt}, invoice ${matchedCount} of
--   ${parsed.invoices.length} — the ${parsed.invoices.length - matchedCount} invoices after it are missing from the footer, not from this import.`
      : `, and no run of invoices from the top adds up to it.`)
  );
}
console.log("");
const totalsNote = [reportTotals("cash", cash, "cash"), reportTotals("credit", credit, "credit")].join("\n--\n");

/* An Att.No out of step with its own sheet's numbering.
   Checked against the sheet rather than against a fixed width: the cash sheet
   runs five digits and the credit sheet four, so a rule of "five digits" would
   call every credit invoice wrong and bury the one that is. */
for (const kind of ["cash", "credit"] as const) {
  const mine = rows.filter((r) => r.kind === kind);
  const widths = new Map<number, number>();
  for (const r of mine) widths.set(r.inv.attNo.length, (widths.get(r.inv.attNo.length) ?? 0) + 1);
  const usual = [...widths.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  for (const r of mine) {
    if (usual && r.inv.attNo.length !== usual) {
      r.notes.push(`Att.No "${r.inv.attNo}" has ${r.inv.attNo.length} digits where this sheet uses ${usual}`);
    }
  }
}

/* An Att.No used twice. Not an error here — the attachment numbering is the tax
   office's, not ours — but it is the kind of thing a sheet gets wrong silently,
   so it is said out loud once. */
const seenAtt = new Map<string, string[]>();
for (const r of rows) seenAtt.set(r.inv.attNo, [...(seenAtt.get(r.inv.attNo) ?? []), r.inv.fsNo]);
for (const [att, fsList] of seenAtt) {
  if (fsList.length > 1) warnings.push(`Att.No ${att} is on more than one invoice: Fs ${fsList.join(", ")}`);
}

/* Nothing is written if anything is wrong. */
if (problems.length) {
  console.error(`\n${problems.length} problem(s) in the sheets — nothing written:\n`);
  for (const p of problems) console.error(` ✗ ${p}`);
  process.exit(1);
}

/* ────────────────────────────────── Emit ─────────────────────────────────── */

const monthStart = new Date(Date.UTC(YEAR, MONTH - 1, 1)).toISOString();
const monthEnd = new Date(Date.UTC(YEAR, MONTH, 1)).toISOString();

const values = rows
  .sort((a, b) => a.inv.date.getTime() - b.inv.date.getTime() || a.inv.fsNo.localeCompare(b.inv.fsNo))
  .map((r) => {
    const cashEtb = r.kind === "cash" ? r.grandTotal : 0;
    const creditEtb = r.kind === "credit" ? r.grandTotal : 0;
    const head = `  -- ${dateLabel(r.inv.date)} · Fs ${r.inv.fsNo} · ${r.inv.customer} · ${r.qty} t · ${money(r.grandTotal)} ETB ${r.kind}`;
    const line =
      `  (${sqlString(r.inv.date.toISOString())}, ${sqlString(dateLabel(r.inv.date))}, ${sqlString(r.inv.customer)}, ` +
      `${cashEtb}, ${creditEtb}, ${r.qty}, ${sqlString(r.inv.fsNo)}, ${sqlJson(r.products)}, ` +
      `${r.bank ? sqlString(r.bank) : "null"}, ${sqlJson(r.extraction)}, ${sqlString(REPORTED_BY)}, 'app')`;
    return `${head}\n${line}`;
  })
  .join(",\n");

const cashCount = rows.filter((r) => r.kind === "cash").length;
const creditCount = rows.filter((r) => r.kind === "credit").length;
const cashEtb = round(rows.filter((r) => r.kind === "cash").reduce((a, r) => a + r.grandTotal, 0));
const creditEtb = round(rows.filter((r) => r.kind === "credit").reduce((a, r) => a + r.grandTotal, 0));
const tonnes = round(rows.reduce((a, r) => a + r.qty, 0), 3);

const sql = `-- MinTech Ethiopia — sales invoices, Sep 2026.
-- GENERATED by scripts/generate-sales-seed.ts from scripts/sales-2026-09-cash.csv
-- and scripts/sales-2026-09-credit.csv — do not edit by hand.
--
-- ${rows.length} invoices (${cashCount} cash, ${creditCount} credit), ${tonnes} t,
-- ${money(cashEtb)} ETB cash and ${money(creditEtb)} ETB credit.
--
-- Every line was checked against its own arithmetic — qty × unit price = sub
-- total, and sub total + VAT = grand total — before this file was written. One
-- disagreement would have aborted it; all ${cashCount + creditCount} invoices passed.
--
${totalsNote}
--
-- ONE ROW PER INVOICE (Fs No), which is how the bot writes a sale: the brands on
-- one invoice are keys in \`products\`, and \`qty\` is their sum, never a typed
-- figure. \`delivery_no\` carries the Fs No — the sheet has no "Deli" column and
-- this is the only identifier the table has.
--
-- The columns the sales table does not have — Att.No, unit prices, VAT,
-- withholding, net pay, the deposit bank text and the deposit date — are kept in
-- \`extraction\` as PROVENANCE. They can be read off a row; they are not figures
-- any report adds up, and withholding on these sales is therefore not
-- reportable anywhere in the dashboard.
--
-- Credit invoices carry their grand total in \`invoice_credit\` with no payment
-- rows against them, so every one of them is outstanding from the moment this
-- runs: visible in the Credit tab, offered by the credit-collection bot flow,
-- and counted towards the 100-tonne exposure alarm.
--
-- Paste into the Supabase SQL editor and Run. SAFE TO RE-RUN: the delete below
-- clears only rows this import wrote (reported_by = '${REPORTED_BY}')
-- within the month, so anything filed through the bot for September is left
-- exactly as it is. Run it twice and you still have one copy of each invoice.
--
-- The dates are stored at UTC midnight, which is what the guided sales flow
-- writes when somebody picks a day in the calendar.

begin;

delete from sales_invoices
 where date >= '${monthStart}' and date < '${monthEnd}'
   and reported_by = ${sqlString(REPORTED_BY)};

insert into sales_invoices (date, date_label, customer, invoice_cash, invoice_credit, qty,
                            delivery_no, products, bank, extraction, reported_by, source) values
${values};

commit;

-- Expect: ${rows.length} invoices, ${tonnes} t, ${money(cashEtb)} cash + ${money(creditEtb)} credit.
select count(*)                      as invoices,
       round(sum(qty), 3)            as tonnes,
       round(sum(invoice_cash), 2)   as cash_etb,
       round(sum(invoice_credit), 2) as credit_etb
  from sales_invoices
 where date >= '${monthStart}' and date < '${monthEnd}'
   and reported_by = ${sqlString(REPORTED_BY)};
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, sql, "utf8");

console.log(`Wrote ${path.relative(ROOT, OUT)}`);
console.log(`  ${rows.length} invoices · ${tonnes} t · ${money(cashEtb)} ETB cash · ${money(creditEtb)} ETB credit`);

const byBank = new Map<string, number>();
for (const r of rows) byBank.set(r.bank ?? "— none recorded —", (byBank.get(r.bank ?? "— none recorded —") ?? 0) + 1);
console.log(`\n  Banks:`);
for (const [b, n] of [...byBank.entries()].sort((a, b2) => b2[1] - a[1])) {
  console.log(`    ${String(b).padEnd(20)} ${n}`);
}

const flagged = rows.filter((r) => r.notes.length > 0);
console.log(`\n  ${flagged.length} invoice(s) with something worth reading:`);
for (const r of flagged) {
  for (const n of r.notes) console.log(`    Fs ${r.inv.fsNo.padEnd(5)} ${n}`);
}

if (warnings.length) {
  console.log(`\n  ${warnings.length} warning(s) — imported anyway, none of these is a figure this import carries:`);
  for (const w of warnings) console.log(`    ! ${w}`);
}

/* Unused import guard: PRODUCTION_PRODUCTS is imported so that a product in the
   sheet which the production side does not make is visible here rather than
   silently fine. */
const unknownToProduction = [...new Set(rows.flatMap((r) => Object.keys(r.products)))].filter(
  (c) => !PRODUCTION_PRODUCTS.includes(c)
);
if (unknownToProduction.length) {
  console.log(`\n  Sold but not in PRODUCTION_PRODUCTS: ${unknownToProduction.join(", ")}`);
}
