/**
 * Generates a sales seed for one month from that month's sales sheets.
 *
 *   npm run seed:sales -- 2026-08
 *
 * Reads scripts/sales/<YYYY-MM>-cash.csv and -credit.csv and writes
 * supabase/seed/NNNN_sales_<YYYY>_<MM>.sql (an existing file for that month
 * keeps its number; a new month takes the next one).
 *
 * TypeScript, unlike the generators before it, so that it can IMPORT
 * `matchBank` from src/lib/banks.ts, the product catalogue from
 * src/lib/products.ts and the credit term from src/lib/credit.ts rather than
 * copying them. A bank spelling that resolved here and nowhere else in the
 * system would be the worst possible outcome of an import: the seeded rows
 * would group onto a bank the bot can never file against again.
 *
 * The input is each sheet exported as CSV, exactly as the owner sent it —
 * headings and TOTAL row included — kept beside this script so the original and
 * its output can be compared without reading Postgres. One invoice (Fs No)
 * becomes one row; see parseSheet for how a second product line attaches.
 *
 * NOTHING is written unless every line passes its own arithmetic. Everything
 * else a sheet gets wrong — a typo'd year, a misspelt product, an invoice
 * number used twice — is corrected or kept as written, and SAID: on the row,
 * in `extraction.notes`, and in the report this prints.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bankByExactName, matchBank } from "../src/lib/banks";
import { creditDueDate } from "../src/lib/credit";
import { PRODUCTION_PRODUCTS, PRODUCT_LABEL } from "../src/lib/products";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* ───────────────────────────────── Which month ───────────────────────────── */

const MONTH_KEY = process.argv[2] || "";
if (!/^\d{4}-\d{2}$/.test(MONTH_KEY)) {
  console.error("Usage: npm run seed:sales -- YYYY-MM   (e.g. 2026-08)");
  process.exit(1);
}
const YEAR = Number(MONTH_KEY.slice(0, 4));
const MONTH = Number(MONTH_KEY.slice(5, 7));
const MM = MONTH_KEY.slice(5, 7);
/** Day 0 of the next month is the last day of this one. */
const DAYS_IN_MONTH = new Date(Date.UTC(YEAR, MONTH, 0)).getUTCDate();
const MONTH_LONG = new Date(Date.UTC(YEAR, MONTH - 1, 1)).toLocaleString("en-GB", { month: "long", timeZone: "UTC" });
const MONTH_SHORT = new Date(Date.UTC(YEAR, MONTH - 1, 1)).toLocaleString("en-GB", { month: "short", timeZone: "UTC" });

const CASH = path.join(ROOT, "scripts", "sales", `${MONTH_KEY}-cash.csv`);
const CREDIT = path.join(ROOT, "scripts", "sales", `${MONTH_KEY}-credit.csv`);
const SEED_DIR = path.join(ROOT, "supabase", "seed");

for (const f of [CASH, CREDIT]) {
  if (!fs.existsSync(f)) {
    console.error(`Missing ${path.relative(ROOT, f)}`);
    process.exit(1);
  }
}

/** Marks every row this import writes, so re-running can clear its own work. */
const REPORTED_BY = "historical import";

/**
 * Months whose credit sales were already collected when they were imported.
 *
 * The owner's word, given on 7 October 2026, for July and August: both months
 * were over a month old, and importing them as unpaid would have put ~20.8 M ETB
 * on the overdue list and tripped the exposure alarm for four customers who had
 * in fact paid. Each such invoice gets one payment of its grand total, dated at
 * its due date — the sheet records no collection date, and the note on the
 * payment says so. September is NOT here: its credit is genuinely open.
 */
const CREDIT_SETTLED: Record<string, string> = {
  "2026-07": "the owner confirmed on 7 Oct 2026 that July's credit sales were collected",
  "2026-08": "the owner confirmed on 7 Oct 2026 that August's credit sales were collected",
};
const SETTLED = CREDIT_SETTLED[MONTH_KEY] ?? null;

/* ───────────────────────────────── Products ──────────────────────────────── */

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
  Talc: "Talk",
};

/**
 * Misspellings seen on real sheets, each read as one product WITH A NOTE.
 *
 * Kept apart from the spellings above so a correction is never silent: these
 * are someone's typing, and the row says what was typed.
 */
const CODE_BY_TYPO: Record<string, { code: string; why: string }> = {
  Talck: { code: "Talk", why: "a misspelling of Talc" },
  "EETL-9": { code: "ETL9", why: "a doubled first letter" },
  "2-E": { code: "2EL", why: "the L is missing" },
  // July 2026, Fs 2854: "ETL-915" at 15 t and 24,000 a tonne. 24,000 was
  // July's ETL-9 price; ETL-15 sold at 30,000. Read as ETL-9 with the quantity
  // run into the product cell.
  "ETL-915": { code: "ETL9", why: "read as ETL-9 by its unit price (24,000 was the ETL-9 price; ETL-15 sold at 30,000)" },
};

for (const [spelling, code] of Object.entries(CODE_BY_SPELLING)) {
  if (!(code in PRODUCT_LABEL)) throw new Error(`"${spelling}" maps to "${code}", which is not a product`);
}
for (const [spelling, t] of Object.entries(CODE_BY_TYPO)) {
  if (!(t.code in PRODUCT_LABEL)) throw new Error(`typo "${spelling}" maps to "${t.code}", which is not a product`);
}

/* ─────────────────────────────────── Types ───────────────────────────────── */

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
  /** The sale date, after any correction. */
  date: Date;
  dateRaw: string;
  customer: string;
  fsNo: string;
  attNo: string;
  lines: Line[];
  notes: string[];
}

interface ParsedSheet {
  invoices: Invoice[];
  totals: SheetTotals | null;
  /** Whether the sheet has a Deposit Date column at all (July's cash sheet does not). */
  hasDeposit: boolean;
}

const problems: string[] = [];
const warnings: string[] = [];

const isNum = (t: string) => /^\d+(\.\d+)?$/.test(t);
const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;
const money = (n: number) => n.toLocaleString("en-US");
/** For comparing customer names on a repeated row: case, "&" and spacing are noise. */
const sameName = (a: string, b: string) => {
  const n = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/\s+/g, " ").trim();
  return n(a) === n(b);
};

/** `delete`-safe SQL literal. */
const sqlString = (s: string) => `'${String(s).replace(/'/g, "''")}'`;
const sqlJson = (v: unknown) => `${sqlString(JSON.stringify(v))}::jsonb`;

/**
 * A uuid derived from the invoice's identity, so a re-run writes the same ids.
 *
 * Needed because the settled-credit payments reference their invoice, and an
 * Fs No cannot be the key: the same number appears twice on more than one of
 * these sheets. Laid out as an RFC 4122 version-5 (name-based) uuid so it is a
 * valid value for the uuid column.
 */
function stableId(...parts: string[]): string {
  const h = createHash("sha1").update(parts.join("|")).digest("hex");
  const variant = ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

/**
 * RFC 4180 CSV: commas inside double quotes are part of the field, and a doubled
 * quote is a literal one. The sheets need both — `"C.B,E"` and
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

/** `1/9/2026` — the shape opsDateLabel writes, which is what live rows hold. */
const dateLabel = (d: Date) => `${d.getUTCDate()}/${d.getUTCMonth() + 1}/${d.getUTCFullYear()}`;

/**
 * D/M/YYYY in the month being imported.
 *
 * Two repairs, each noted: a doubled slash is collapsed (`07/08//2026`), and a
 * wrong year is corrected to the month's own (`28/08/2029`). A wrong MONTH is
 * not repaired — a sale filed in another month cannot be imported as this one —
 * and a day this month does not have is refused.
 */
function parseSaleDate(raw: string, where: string): { date: Date; notes: string[] } | null {
  const notes: string[] = [];
  const cleaned = raw.replace(/\/{2,}/g, "/");
  const m = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) {
    problems.push(`${where}: "${raw}" is not a date`);
    return null;
  }
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3].length === 2 ? `20${m[3]}` : m[3]);
  if (month !== MONTH) {
    problems.push(`${where}: dated month ${month}, which is not ${MONTH} — a sale in the wrong month cannot be imported as ${MONTH_LONG}`);
    return null;
  }
  if (day < 1 || day > DAYS_IN_MONTH) {
    problems.push(`${where}: day ${day} is not a day in ${MONTH_LONG}`);
    return null;
  }
  const date = new Date(Date.UTC(YEAR, MONTH - 1, day));
  if (cleaned !== raw) notes.push(`sale date written as ${raw}, read as ${dateLabel(date)}`);
  else if (year !== YEAR) notes.push(`sale date read as ${raw} and corrected to ${dateLabel(date)}`);
  return { date, notes };
}

/**
 * One sheet, parsed into invoices plus its own stated totals.
 *
 * Columns are found by their HEADING, not their position, and each column has
 * the names the sheets have actually used — "Customer", "Customers Name",
 * "Credit Customers Name". A sheet missing a column the import needs is refused
 * by name rather than read off by one.
 *
 * A product line belongs to an invoice in one of two ways, and the sheets use
 * both:
 *   - its Date, Customer and Fs No are left blank under the invoice it belongs to;
 *   - or it repeats them in full, with the same Fs No and Att.No.
 * Both mean one invoice, and both become one row.
 *
 * The same Fs No with a DIFFERENT Att.No, or further down the sheet, is two
 * sales sharing one number — a numbering slip, not a second line. Both are
 * imported, as separate rows, and the slip is reported.
 */
function parseSheet(text: string, sheet: string): ParsedSheet {
  const rows = parseCsv(text);
  const head = (rows.shift() ?? []).map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => {
    for (const n of names) {
      const i = head.indexOf(n.toLowerCase());
      if (i >= 0) return i;
    }
    return -1;
  };
  const C = {
    date: col("Date"),
    customer: col("Customer", "Customers Name", "Credit Customers Name"),
    fs: col("Fs No", "Fs/No"),
    att: col("Att.No"),
    product: col("Product", "Product Ty"),
    qty: col("Qty"),
    price: col("Unit Price"),
    sub: col("Sub Total"),
    vat: col("VAT 15%"),
    grand: col("Grand Total"),
    withhold: col("Withhold"),
    net: col("Net Pay"),
    bank: col("Deposited Bank", "Bank"),
    // Optional: a credit sheet has nothing deposited yet, and July's cash sheet
    // simply never had the column.
    deposit: col("Deposit Date"),
  };
  const missing = Object.entries(C)
    .filter(([k, i]) => i < 0 && k !== "deposit")
    .map(([k]) => k);
  if (missing.length) {
    problems.push(`${sheet}: no column for ${missing.join(", ")} — check the heading row`);
    return { invoices: [], totals: null, hasDeposit: false };
  }

  const invoices: Invoice[] = [];
  let totals: SheetTotals | null = null;

  rows.forEach((r, n) => {
    const sheetRow = n + 2; // the heading is row 1
    const cell = (i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
    if (r.every((c) => !c.trim())) return;

    // The totals row. Its label sits in the Customer column on some sheets and
    // the Date column on others.
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
    const attNo = cell(C.att);
    const where = `${sheet} row ${sheetRow}${fsNo ? ` (Fs ${fsNo})` : ""}`;
    const lineNotes: string[] = [];

    const spelling = cell(C.product);
    let code = CODE_BY_SPELLING[spelling];
    if (!code && CODE_BY_TYPO[spelling]) {
      code = CODE_BY_TYPO[spelling].code;
      lineNotes.push(`product written as "${spelling}", read as ${PRODUCT_LABEL[code]} — ${CODE_BY_TYPO[spelling].why}`);
    }
    if (!code) {
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
      code,
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
    // VAT and net pay only WARN: neither is imported as a figure.
    if (round(line.subTotal * 0.15) !== round(line.vat)) {
      warnings.push(`${where} ${spelling}: VAT ${money(line.vat)} is not 15% of ${money(line.subTotal)}`);
    }
    if (round(line.grandTotal - line.withhold) !== round(line.netPay)) {
      warnings.push(`${where} ${spelling}: net pay ${money(line.netPay)} ≠ ${money(line.grandTotal)} − ${money(line.withhold)}`);
    }
    // A price with fractions of a birr was worked back from a total, not quoted.
    if (!Number.isInteger(line.unitPrice)) {
      lineNotes.push(`unit price ${line.unitPrice} is not a whole number — probably worked back from a total`);
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
      prev.notes.push(...lineNotes);
      return;
    }

    // The same invoice written out again in full: same Fs No, same Att.No.
    if (prev && prev.fsNo === fsNo && prev.attNo === attNo) {
      if (!sameName(cell(C.customer), prev.customer)) {
        problems.push(`${where}: repeats Fs ${fsNo} under "${cell(C.customer)}", but the invoice above is "${prev.customer}"`);
        return;
      }
      prev.lines.push(line);
      prev.notes.push(...lineNotes, `line ${prev.lines.length} was written as its own row on the sheet, repeating the invoice number`);
      return;
    }

    const parsedDate = parseSaleDate(cell(C.date), where);
    if (!parsedDate) return;
    const notes = [...parsedDate.notes, ...lineNotes];

    // One Fs No, two sales: imported separately and reported.
    const clash = invoices.filter((v) => v.fsNo === fsNo);
    if (clash.length > 0) {
      for (const other of clash) {
        other.notes.push(`Fs ${fsNo} is also on another invoice on this sheet (${dateLabel(parsedDate.date)}, ${cell(C.customer)}, Att.No ${attNo})`);
      }
      notes.push(
        `Fs ${fsNo} is also on another invoice on this sheet (${clash.map((v) => `${dateLabel(v.date)}, ${v.customer}, Att.No ${v.attNo}`).join("; ")})`
      );
      warnings.push(`${sheet}: Fs ${fsNo} is used by ${clash.length + 1} invoices — imported separately, the invoice number is wrong on the paper`);
    }

    invoices.push({ date: parsedDate.date, dateRaw: cell(C.date), customer: cell(C.customer), fsNo, attNo, lines: [line], notes });
  });

  // An Fs No out of sequence with both its neighbours — "2335" among the 2700s.
  invoices.forEach((inv, i) => {
    const me = Number(inv.fsNo);
    const before = Number(invoices[i - 1]?.fsNo);
    const after = Number(invoices[i + 1]?.fsNo);
    if (Number.isFinite(before) && Number.isFinite(after) && Math.abs(me - before) > 100 && Math.abs(me - after) > 100) {
      inv.notes.push(`Fs ${inv.fsNo} is out of sequence (the invoices around it are ${invoices[i - 1].fsNo} and ${invoices[i + 1].fsNo})`);
    }
  });

  if (invoices.length === 0) problems.push(`${sheet}: no invoices could be found at all`);
  if (!totals) problems.push(`${sheet}: no TOTAL row — there is then nothing to check the import against`);
  return { invoices, totals, hasDeposit: C.deposit >= 0 };
}

/**
 * The bank a deposit cell names, or null.
 *
 * A cell can name several banks — "C.B.E & A.I.B and Absniya", "A.I.B/A.B/C.B.E"
 * — and there is one column to put it in, so the FIRST bank named is used and
 * the whole cell is kept verbatim in `extraction`. Inside a piece separated by
 * "/", the longest run that is an exact bank name wins, so "A.B/Dukem" (one
 * bank, a branch) stays one bank while "A.I.B/A.B/C.B.E" is three.
 */
function firstBank(cell: string): { bank: string | null; several: boolean } {
  const pieces = cell.split(/[&+]|\band\b/).map((p) => p.trim()).filter(Boolean);
  const found: string[] = [];
  for (const piece of pieces) {
    if (piece.includes("/")) {
      const segs = piece.split("/").map((s) => s.trim());
      let i = 0;
      let any = false;
      while (i < segs.length) {
        let hit: string | null = null;
        let used = 1;
        for (let j = segs.length; j > i; j--) {
          const candidate = bankByExactName(segs.slice(i, j).join("/"));
          if (candidate) {
            hit = candidate;
            used = j - i;
            break;
          }
        }
        if (hit) {
          found.push(hit);
          any = true;
        }
        i += used;
      }
      if (any) continue;
    }
    const hit = matchBank(piece);
    if (hit) found.push(hit);
  }
  return { bank: found[0] ?? null, several: new Set(found).size > 1 || pieces.length > 1 };
}

/** One invoice → one row's worth of values, plus the provenance that has no column. */
function rowOf(inv: Invoice, kind: "cash" | "credit", hasDeposit: boolean) {
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

  const bankRaw = inv.lines.map((l) => l.bankRaw).find(Boolean) || "";
  let bank: string | null = null;
  if (bankRaw) {
    const res = firstBank(bankRaw);
    bank = res.bank;
    if (!bank) notes.push(`bank "${bankRaw}" matched nothing in the bank list`);
    else if (res.several) notes.push(`deposit split across banks: "${bankRaw}" — recorded under ${bank}`);
  } else {
    notes.push("no bank recorded on the sheet");
  }

  if (kind === "cash" && hasDeposit && !inv.lines.some((l) => l.depositRaw)) notes.push("no deposit date recorded");

  const extraction = {
    sheet: `${MONTH_LONG} ${YEAR} ${kind} sales sheet`,
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

  return { inv, kind, products, qty, grandTotal, bank, extraction, notes, id: "" };
}

/* ─────────────────────────────── Read both sheets ────────────────────────── */

const cash = parseSheet(fs.readFileSync(CASH, "utf8"), "cash");
const credit = parseSheet(fs.readFileSync(CREDIT, "utf8"), "credit");

const rows = [
  ...cash.invoices.map((i) => rowOf(i, "cash", cash.hasDeposit)),
  ...credit.invoices.map((i) => rowOf(i, "credit", credit.hasDeposit)),
];

// Ids: the invoice's identity, plus its ordinal among invoices that share it.
{
  const seen = new Map<string, number>();
  for (const r of rows) {
    const key = [MONTH_KEY, r.kind, r.inv.fsNo, r.inv.attNo].join("|");
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    r.id = stableId("sales_invoices", key, String(n));
  }
}

// One Fs No on both sheets — a cash sale and a credit sale under one number.
{
  const cashFs = new Map(rows.filter((r) => r.kind === "cash").map((r) => [r.inv.fsNo, r] as const));
  for (const r of rows.filter((x) => x.kind === "credit")) {
    const other = cashFs.get(r.inv.fsNo);
    if (!other) continue;
    r.notes.push(`Fs ${r.inv.fsNo} is also on the cash sheet (${dateLabel(other.inv.date)}, ${other.inv.customer})`);
    other.notes.push(`Fs ${other.inv.fsNo} is also on the credit sheet (${dateLabel(r.inv.date)}, ${r.inv.customer})`);
    warnings.push(`Fs ${r.inv.fsNo} is on both the cash and the credit sheet — both imported`);
  }
}

/**
 * The import, against each sheet's own totals row — and WHERE it stops agreeing.
 *
 * A report, not a gate. The checks that protect the figures are the per-line
 * ones above, and those abort. A footer can disagree with its own sheet for a
 * reason that has nothing to do with the data — September's cash footer had
 * simply stopped being recalculated part way through the month — and refusing
 * a month of correct sales over a formula is the wrong trade.
 */
function reportTotals(label: string, parsed: ParsedSheet, kind: "cash" | "credit"): string {
  if (!parsed.totals) return `-- ${label}: the sheet carried no total to check against.`;
  const mine = rows.filter((r) => r.kind === kind);
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
    `${label}: the sheet's footer does NOT match the sheet.`,
    `  footer says  ${String(stated.qty).padStart(9)} t · ${money(stated.subTotal)} + ${money(stated.vat)} VAT = ${money(stated.grandTotal)} · withholding ${money(stated.withhold)}`,
    `  invoices add ${String(qty).padStart(9)} t · ${money(sub)} + ${money(vat)} VAT = ${money(grand)} · withholding ${money(withhold)}`,
  ];
  if (matchedAt) {
    miss.push(
      `  the footer's figures were last true at Fs ${matchedAt} — invoice ${matchedCount} of ${parsed.invoices.length}, so ${parsed.invoices.length - matchedCount} later invoices are missing from it.`,
      `  every one of those ${parsed.invoices.length} invoices passed its own arithmetic, so the IMPORT is the complete month and the footer is the stale figure.`
    );
  } else {
    miss.push(`  no run of invoices from the top adds up to the footer, so the difference is not simply a stale total — compare the sheet by hand.`);
  }
  for (const m of miss) warnings.push(m);

  return (
    `-- The ${label} sheet's own TOTAL row does NOT match its invoices and should not be used to check this import:\n` +
    `--   it says ${stated.qty} t / ${money(stated.grandTotal)} ETB, while the ${parsed.invoices.length} invoices on the sheet\n` +
    `--   add to ${qty} t / ${money(grand)} ETB` +
    (matchedAt
      ? `. Its figures were last true at Fs ${matchedAt}, invoice ${matchedCount} of\n--   ${parsed.invoices.length} — the ${parsed.invoices.length - matchedCount} invoices after it are missing from the footer, not from this import.`
      : `, and no run of invoices from the top adds up to it.`)
  );
}
console.log("");
const totalsNote = [reportTotals("cash", cash, "cash"), reportTotals("credit", credit, "credit")].join("\n--\n");

/* An Att.No out of step with its own sheet's numbering — checked against the
   sheet, because the cash sheets run five digits and the credit sheets four. */
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

/* An Att.No used twice — not ours to correct, but said out loud once. */
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

const ordered = rows.sort(
  (a, b) => a.inv.date.getTime() - b.inv.date.getTime() || a.inv.fsNo.localeCompare(b.inv.fsNo) || a.kind.localeCompare(b.kind)
);

const values = ordered
  .map((r) => {
    const cashEtb = r.kind === "cash" ? r.grandTotal : 0;
    const creditEtb = r.kind === "credit" ? r.grandTotal : 0;
    const head = `  -- ${dateLabel(r.inv.date)} · Fs ${r.inv.fsNo} · ${r.inv.customer} · ${r.qty} t · ${money(r.grandTotal)} ETB ${r.kind}`;
    const line =
      `  (${sqlString(r.id)}, ${sqlString(r.inv.date.toISOString())}, ${sqlString(dateLabel(r.inv.date))}, ${sqlString(r.inv.customer)}, ` +
      `${cashEtb}, ${creditEtb}, ${r.qty}, ${sqlString(r.inv.fsNo)}, ${sqlJson(r.products)}, ` +
      `${r.bank ? sqlString(r.bank) : "null"}, ${sqlJson(r.extraction)}, ${sqlString(REPORTED_BY)}, 'app')`;
    return `${head}\n${line}`;
  })
  .join(",\n");

/* Settled credit: one payment per credit invoice, for its grand total, dated at
   its due date. */
const credits = ordered.filter((r) => r.kind === "credit");
const payments = SETTLED
  ? credits
      .map((r) => {
        const due = creditDueDate(r.inv.date).toISOString().slice(0, 10);
        const note = `Settled — ${SETTLED}. The sheet records no collection date, so it is dated at the due date.`;
        return (
          `  -- Fs ${r.inv.fsNo} · ${r.inv.customer} · ${money(r.grandTotal)} ETB, due ${due}\n` +
          `  (${sqlString(r.id)}, ${r.grandTotal}, ${sqlString(due)}, ${sqlString(note)}, ${sqlString(REPORTED_BY)})`
        );
      })
      .join(",\n")
  : "";

const cashCount = ordered.filter((r) => r.kind === "cash").length;
const creditCount = credits.length;
const cashEtb = round(ordered.filter((r) => r.kind === "cash").reduce((a, r) => a + r.grandTotal, 0));
const creditEtb = round(credits.reduce((a, r) => a + r.grandTotal, 0));
const tonnes = round(ordered.reduce((a, r) => a + r.qty, 0), 3);

const creditParagraph = SETTLED
  ? `-- Credit invoices carry their grand total in \`invoice_credit\` AND a payment of the same
-- amount, because ${SETTLED}. They show as settled in the Credit tab,
-- are never offered by the collection bot, and do not count towards the exposure
-- alarm. The payments are dated at each invoice's due date and say why.`
  : `-- Credit invoices carry their grand total in \`invoice_credit\` with no payment
-- rows against them, so every one of them is outstanding from the moment this
-- runs: visible in the Credit tab, offered by the credit-collection bot flow,
-- and counted towards the 100-tonne exposure alarm.`;

const seedName =
  fs.readdirSync(SEED_DIR).find((f) => f.endsWith(`_sales_${YEAR}_${MM}.sql`)) ??
  `${String(
    Math.max(0, ...fs.readdirSync(SEED_DIR).map((f) => Number(f.slice(0, 4))).filter((n) => Number.isFinite(n))) + 1
  ).padStart(4, "0")}_sales_${YEAR}_${MM}.sql`;
const OUT = path.join(SEED_DIR, seedName);

const sql = `-- MinTech Ethiopia — sales invoices, ${MONTH_SHORT} ${YEAR}.
-- GENERATED by scripts/generate-sales-seed.ts from scripts/sales/${MONTH_KEY}-cash.csv
-- and scripts/sales/${MONTH_KEY}-credit.csv — do not edit by hand.
--
-- ${ordered.length} invoices (${cashCount} cash, ${creditCount} credit), ${tonnes} t,
-- ${money(cashEtb)} ETB cash and ${money(creditEtb)} ETB credit.
--
-- Every line was checked against its own arithmetic — qty × unit price = sub
-- total, and sub total + VAT = grand total — before this file was written. One
-- disagreement would have aborted it; all ${ordered.length} invoices passed.
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
-- reportable anywhere in the dashboard. Every correction this import made — a
-- year, a product spelling, an invoice number used twice — is in
-- \`extraction.notes\` on the row it was made to.
--
${creditParagraph}
--
-- Paste into the Supabase SQL editor and Run. SAFE TO RE-RUN: the delete below
-- clears only rows this import wrote (reported_by = '${REPORTED_BY}')
-- within the month — their payments go with them — so anything filed through
-- the bot for ${MONTH_LONG} is left exactly as it is. Run it twice and you still
-- have one copy of each invoice. Invoice ids are derived from the sheet, so a
-- re-run writes the same ids.
--
-- The dates are stored at UTC midnight, which is what the guided sales flow
-- writes when somebody picks a day in the calendar.

begin;

delete from sales_invoices
 where date >= '${monthStart}' and date < '${monthEnd}'
   and reported_by = ${sqlString(REPORTED_BY)};

insert into sales_invoices (id, date, date_label, customer, invoice_cash, invoice_credit, qty,
                            delivery_no, products, bank, extraction, reported_by, source) values
${values};
${
  payments
    ? `
insert into sales_credit_payments (invoice_id, amount, collected_on, note, recorded_by) values
${payments};
`
    : ""
}
commit;

-- Expect: ${ordered.length} invoices, ${tonnes} t, ${money(cashEtb)} cash + ${money(creditEtb)} credit${
  SETTLED ? `, ${creditCount} settled payments totalling ${money(creditEtb)}` : ""
}.
select count(*)                      as invoices,
       round(sum(qty), 3)            as tonnes,
       round(sum(invoice_cash), 2)   as cash_etb,
       round(sum(invoice_credit), 2) as credit_etb,
       (select round(coalesce(sum(p.amount), 0), 2)
          from sales_credit_payments p
          join sales_invoices i on i.id = p.invoice_id
         where i.date >= '${monthStart}' and i.date < '${monthEnd}'
           and i.reported_by = ${sqlString(REPORTED_BY)}) as credit_collected_etb
  from sales_invoices
 where date >= '${monthStart}' and date < '${monthEnd}'
   and reported_by = ${sqlString(REPORTED_BY)};
`;

fs.mkdirSync(SEED_DIR, { recursive: true });
fs.writeFileSync(OUT, sql, "utf8");

console.log(`Wrote ${path.relative(ROOT, OUT)}`);
console.log(
  `  ${ordered.length} invoices · ${tonnes} t · ${money(cashEtb)} ETB cash · ${money(creditEtb)} ETB credit` +
    (SETTLED ? ` (all settled)` : ` (outstanding)`)
);

const byBank = new Map<string, number>();
for (const r of ordered) byBank.set(r.bank ?? "— none recorded —", (byBank.get(r.bank ?? "— none recorded —") ?? 0) + 1);
console.log(`\n  Banks:`);
for (const [b, n] of [...byBank.entries()].sort((a, b2) => b2[1] - a[1])) {
  console.log(`    ${String(b).padEnd(20)} ${n}`);
}

const flagged = ordered.filter((r) => r.notes.length > 0);
console.log(`\n  ${flagged.length} invoice(s) with something worth reading:`);
for (const r of flagged) {
  for (const n of r.notes) console.log(`    Fs ${r.inv.fsNo.padEnd(5)} ${n}`);
}

if (warnings.length) {
  console.log(`\n  ${warnings.length} warning(s) — imported anyway, none of these is a figure this import carries:`);
  for (const w of warnings) console.log(`    ! ${w}`);
}

const unknownToProduction = [...new Set(ordered.flatMap((r) => Object.keys(r.products)))].filter(
  (c) => !PRODUCTION_PRODUCTS.includes(c)
);
if (unknownToProduction.length) {
  console.log(`\n  Sold but not in PRODUCTION_PRODUCTS: ${unknownToProduction.join(", ")}`);
}
