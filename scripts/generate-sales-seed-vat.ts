/**
 * Generates the June and July 2026 sales seed from the VAT sales register.
 *
 *   npx tsx scripts/generate-sales-seed-vat.ts
 *
 * Reads scripts/sales/2026-06-vat.csv and 2026-07-vat.csv (the register as the
 * owner sent it, one line per product line of a receipt):
 *
 *   VAT CATEGORY, CALENDAR, Types of Sale, Buyer TIN., Buyer name, Date of Sale.,
 *   MRC, Vat receipt, Description., Unit of Measure, Quantity., Unit Price.,
 *   Total value, vat, value after vat, Sale Type
 *
 * and writes supabase/seed/0026_sales_2026_06_07_vat_register.sql, which
 * REPLACES every June and July sale (owner's decision, 16 Nov 2026).
 *
 * The register names the MATERIAL (Dolomite, CaCo3, Marble Powder, Talc), not
 * the product the plant tracks, so the product is decided like this:
 *
 *   1. July: the product mix of the same receipt in seed 0008 (typed from the
 *      older cash and credit sheets), when its tonnes agree with the register.
 *   2. Otherwise the price: PRODUCT_AT_PRICE below, which is what July's old
 *      data shows was sold at each material and price, plus June's earlier,
 *      higher prices assigned from what the same customers bought in July,
 *      as confirmed by the owner on 16 Nov 2026.
 *
 * A price that is not in the table stops the script: nothing is guessed.
 * NOTHING is written unless every line passes its own arithmetic.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCT_LABEL } from "../src/lib/products";
import { creditDueDate } from "../src/lib/credit";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MONTHS = ["2026-06", "2026-07"] as const;
const OUT = path.join(ROOT, "supabase", "seed", "0026_sales_2026_06_07_vat_register.sql");
const OLD_JULY = path.join(ROOT, "supabase", "seed", "0008_sales_2026_07.sql");

/** Marks every row this import writes, so a re-run can find its own work. */
const REPORTED_BY = "VAT sales register";
const PAYMENT_NOTE =
  "Collected: not on the owner's 31 Oct 2026 statement of uncollected credit sales. " +
  "The register records no collection date, so it is dated at the due date.";

type Material = "CaCO3" | "Dolomite" | "Marble" | "Talc";

function materialOf(description: string): Material | null {
  const d = description.trim().toLowerCase();
  if (/^ca[ck]?[ao]3$|^caco3$|^caca3$/.test(d)) return "CaCO3";
  if (d.startsWith("dolomite")) return "Dolomite";
  if (d.startsWith("marble")) return "Marble";
  if (d.startsWith("talc") || d.startsWith("talk")) return "Talc";
  return null;
}

/**
 * Material and unit price (ETB per tonne, before VAT) → product code.
 *
 * From July 2026's old data (seed 0008, matched receipt by receipt): every
 * price there was sold as one product, except CaCO3 at 35,000 (nine 2-EL, one
 * 3-EL) and 18,000 (eighteen EC-90, one EC-15), which take the majority.
 * June's earlier prices (2–10 June, before the price drop) follow what the
 * same customers bought in July; CaCO3 at 36,000 (Huanqie Shoe, no July
 * history) is 3-EL, the owner's choice.
 */
const PRODUCT_AT_PRICE: Record<Material, Record<number, string>> = {
  CaCO3: {
    18000: "EC90", 19000: "EC90", 20000: "EC90", 21000: "EC90",
    32000: "5EL",
    33000: "3EL", 36000: "3EL", 38000: "3EL", 40000: "3EL", 43000: "3EL",
    34000: "2EL", 35000: "2EL", 39000: "2EL",
  },
  Dolomite: {
    24000: "ETL9", 25000: "ETL9", 26315: "ETL9", 27000: "ETL9", 27500: "ETL9", 28000: "ETL9",
    32000: "ETL6", 35000: "ETL6",
  },
  Marble: { 30000: "ETL15", 33000: "ETL15", 35000: "ETL15" },
  Talc: {},
};
for (const table of Object.values(PRODUCT_AT_PRICE)) {
  for (const code of Object.values(table)) {
    if (!(code in PRODUCT_LABEL)) throw new Error(`price table names "${code}", which is not a product`);
  }
}

/** A TIN printed wrongly on a few lines → the customer's own TIN (every other line). */
const TIN_FIX: Record<string, string> = {
  "0083997992": "0083997492", // Ling Ying
  "0083994792": "0083997492", // Ling Ying
  "0100895403": "0100896403", // Lin-Xiao (both used; the later and more frequent one kept)
  "0089363422": "0089366422", // Widad Dawit Kassa
  "0089366423": "0089366422", // Widad Dawit Kassa
  "0037971241": "0037971214", // Netsanet Asefa
  "0054718624": "0054718684", // Maxflow Manufacturing
  "0002484610": "0002184610", // Solomon Badie
  "0079953704": "0079453704", // Milano Chemicals
  "0070453704": "0079453704", // Milano Chemicals
};

/** One spelling per customer (by TIN), where the register spells it several ways. */
const NAME_BY_TIN: Record<string, string> = {
  "0061075539": "Supreme Industry PLC",
  "0037971214": "Netsanet Asefa",
  "0054718684": "Maxflow Manufacturing PLC",
  "0086378147": "Mehapil General Business PLC",
  "0096901092": "Mulugeta & Friends Soap Manufacturing",
  "0083997492": "Ling Ying",
  "0100896403": "Lin-Xiao",
  "0005305311": "MC Baucheme",
  "0063857577": "Simentech Chemicals Manufacturing PLC",
  "0080341235": "Josam Construction Inputs",
  "0039956232": "Maruti Plastic Industry",
  "0019530237": "Merjan Ahmedin PMM",
  "0005027707": "E.N.D Global Food Complex",
  "0076124204": "Abubeker Kelil",
  "0016830747": "Mercymoy Industry PLC",
  "0083725853": "Be Awash Manufacturing PLC",
  "0066229836": "Green Forest Import Export",
  "0001539115": "Tigist Fentaw",
  "0086336545": "Selamawit & Bereket",
  "0076643528": "Dejene Kassaye",
  "0104069484": "ECO Industrial Chemicals",
  "0089366422": "Widad Dawit Kassa",
  "0054254650": "DD Chemicals",
  "0080225216": "Yasmin & Bekri Soap",
  "0051060917": "Henok Tigist & Friends",
  "0076817784": "Family Manufacturing PLC",
  "0044777820": "Redela Nasri",
  "0000015683": "Kadisco Paint",
  "0054990464": "MZ Manufacturing",
  "0059290051": "Star Chemicals",
  "0056397381": "Amen Detergent",
  "0042537509": "Gidabo Soap",
  "0002184610": "Solomon Badie",
  "0074357486": "Betelhem Tigabu",
  "0089852103": "Juhar Yasin Adem",
  "0079453704": "Milano Chemicals",
  "0058028434": "Harmony Paint",
  "0041702587": "Mela Soap & Detergent",
};

const problems: string[] = [];
const notes: string[] = [];
const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;
const money = (n: number) => n.toLocaleString("en-US");
const isNum = (t: string) => /^\d+(\.\d+)?$/.test(t);
const sqlString = (s: string) => `'${String(s).replace(/'/g, "''")}'`;
const sqlJson = (v: unknown) => `${sqlString(JSON.stringify(v))}::jsonb`;
const dateLabel = (d: Date) => `${d.getUTCDate()}/${d.getUTCMonth() + 1}/${d.getUTCFullYear()}`;

/** A uuid derived from the receipt, so a re-run writes the same ids. */
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
  return rows.filter((r) => r.some((c) => c.trim()));
}

/** The old July rows (seed 0008) by receipt number: products, tonnes, bank. */
function oldJuly(): Map<string, { products: Record<string, number>; qty: number; bank: string }[]> {
  const out = new Map<string, { products: Record<string, number>; qty: number; bank: string }[]>();
  const text = fs.readFileSync(OLD_JULY, "utf8");
  const re = /\('[^']+', '[^']+', '[^']+', '(?:[^']|'')*', [0-9.]+, [0-9.]+, ([0-9.]+), '([0-9]+)', '(\{[^}]*\})'::jsonb, '((?:[^']|'')*)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.set(m[2], [...(out.get(m[2]) ?? []), { qty: Number(m[1]), products: JSON.parse(m[3]), bank: m[4].replace(/''/g, "'") }]);
  }
  return out;
}

interface Line {
  material: Material;
  qty: number;
  price: number;
}

interface Invoice {
  month: string;
  kind: "cash" | "credit";
  receipt: string;
  /** As the other seeds store it: "FS00002641" → "2641"; "M0004032" → "M4032". */
  fsNo: string;
  tin: string | null;
  customer: string;
  date: Date;
  lines: Line[];
  products: Record<string, number>;
  qty: number;
  afterVat: number;
  bank: string | null;
  /** Where the product split came from. */
  productFrom: "old July data" | "price";
}

const nameCounts = new Map<string, Map<string, number>>();
const tinFixes = new Map<string, number>();

function parseMonth(month: string): Invoice[] {
  const file = path.join(ROOT, "scripts", "sales", `${month}-vat.csv`);
  if (!fs.existsSync(file)) {
    problems.push(`missing ${path.relative(ROOT, file)}`);
    return [];
  }
  const rows = parseCsv(fs.readFileSync(file, "utf8"));
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
    type: col("Sale Type"),
  };
  const missing = Object.entries(C).filter(([, i]) => i < 0).map(([k]) => k);
  if (missing.length) {
    problems.push(`${month}: no column for ${missing.join(", ")}`);
    return [];
  }
  const [Y, M] = month.split("-").map(Number);
  const byReceipt = new Map<string, Invoice>();

  rows.forEach((r, n) => {
    const cell = (i: number) => (r[i] ?? "").trim();
    const where = `${month} line ${n + 2} (${cell(C.receipt) || "no receipt"})`;

    const material = materialOf(cell(C.product));
    if (!material) return void problems.push(`${where}: "${cell(C.product)}" is not a material this import knows`);
    const bad = (["qty", "price", "sub", "vat", "after"] as const).filter((k) => !isNum(cell(C[k])));
    if (bad.length) return void problems.push(`${where}: ${bad.join(", ")} is not a number`);
    const [qty, price, sub, vat, after] = (["qty", "price", "sub", "vat", "after"] as const).map((k) => Number(cell(C[k])));
    if (round(qty * price) !== round(sub)) problems.push(`${where}: ${qty} × ${money(price)} ≠ ${money(sub)}`);
    if (round(sub + vat) !== round(after)) problems.push(`${where}: ${money(sub)} + ${money(vat)} ≠ ${money(after)}`);

    const dm = cell(C.date).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!dm || Number(dm[3]) !== Y || Number(dm[2]) !== M) {
      return void problems.push(`${where}: date "${cell(C.date)}" is not a day in ${month}`);
    }
    const date = new Date(Date.UTC(Y, M - 1, Number(dm[1])));

    const type = cell(C.type).toLowerCase();
    const kind = type.startsWith("credit") ? "credit" : type.startsWith("cash") ? "cash" : null;
    if (!kind) return void problems.push(`${where}: sale type "${cell(C.type)}" is neither cash nor credit`);

    let tin = cell(C.tin);
    if (tin && !/^\d{10}$/.test(tin)) problems.push(`${where}: TIN "${tin}" is not ten digits`);
    if (TIN_FIX[tin]) {
      tinFixes.set(`${tin} → ${TIN_FIX[tin]}`, (tinFixes.get(`${tin} → ${TIN_FIX[tin]}`) ?? 0) + 1);
      tin = TIN_FIX[tin];
    }
    const name = cell(C.customer).replace(/\s+/g, " ");
    const counts = nameCounts.get(tin) ?? new Map<string, number>();
    counts.set(name, (counts.get(name) ?? 0) + 1);
    nameCounts.set(tin, counts);

    const receipt = cell(C.receipt).toUpperCase();
    if (!receipt) return void problems.push(`${where}: no VAT receipt number`);
    const fsNo = receipt.startsWith("FS") ? String(Number(receipt.slice(2))) : `M${Number(receipt.replace(/\D/g, ""))}`;

    const seen = byReceipt.get(receipt);
    if (seen) {
      if (seen.tin !== tin || +seen.date !== +date || seen.kind !== kind) {
        problems.push(`${where}: receipt ${receipt} repeats under a different customer, date or sale type`);
      }
      seen.lines.push({ material, qty, price });
      seen.qty = round(seen.qty + qty, 3);
      seen.afterVat = round(seen.afterVat + after);
      return;
    }
    byReceipt.set(receipt, {
      month,
      kind,
      receipt,
      fsNo,
      tin: tin || null,
      customer: name,
      date,
      lines: [{ material, qty, price }],
      products: {},
      qty,
      afterVat: after,
      bank: null,
      productFrom: "price",
    });
  });
  return [...byReceipt.values()];
}

const all = MONTHS.flatMap(parseMonth);
const old = oldJuly();

const add = (p: Record<string, number>, code: string, qty: number) => {
  p[code] = round((p[code] ?? 0) + qty, 3);
};

for (const v of all) {
  // One spelling per customer.
  if (v.tin) {
    const fixed = NAME_BY_TIN[v.tin];
    const counts = [...(nameCounts.get(v.tin) ?? new Map()).entries()].sort((a, b) => b[1] - a[1]);
    v.customer = fixed ?? counts[0]?.[0] ?? v.customer;
  }
  // July: the old data's product mix and bank for the same receipt, when its tonnes agree.
  const prev = v.month === "2026-07" ? old.get(v.fsNo) : undefined;
  if (prev && prev.length === 1 && Math.abs(prev[0].qty - v.qty) < 1e-6) {
    v.products = { ...prev[0].products };
    v.bank = prev[0].bank || null;
    v.productFrom = "old July data";
    continue;
  }
  if (prev && prev.length === 1) {
    notes.push(`Fs ${v.fsNo}: the old July data had ${prev[0].qty} t on it, the register ${v.qty} t, so its product follows the price`);
    v.bank = prev[0].bank || null;
  }
  for (const l of v.lines) {
    const code = l.material === "Talc" ? "Talk" : PRODUCT_AT_PRICE[l.material][l.price];
    if (!code) {
      problems.push(`${v.receipt} (${v.customer}): no product for ${l.material} at ${money(l.price)} — add it to PRODUCT_AT_PRICE`);
      continue;
    }
    add(v.products, code, l.qty);
  }
}

if (problems.length) {
  console.error(`Nothing written — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}

all.sort((a, b) => +a.date - +b.date || a.fsNo.localeCompare(b.fsNo, "en", { numeric: true }));

const monthStart = "2026-06-01";
const monthEnd = "2026-08-01";

function summary(month: string) {
  const list = all.filter((v) => v.month === month);
  const cash = list.filter((v) => v.kind === "cash");
  const credit = list.filter((v) => v.kind === "credit");
  return {
    month,
    invoices: list.length,
    cash: cash.length,
    credit: credit.length,
    tonnes: round(list.reduce((a, v) => a + v.qty, 0), 3),
    cashEtb: round(cash.reduce((a, v) => a + v.afterVat, 0)),
    creditEtb: round(credit.reduce((a, v) => a + v.afterVat, 0)),
    fromOld: list.filter((v) => v.productFrom === "old July data").length,
    products: list.reduce((p, v) => {
      for (const [c, q] of Object.entries(v.products)) add(p, c, q);
      return p;
    }, {} as Record<string, number>),
  };
}
const sums = MONTHS.map(summary);

const values = all
  .map((v) => {
    const label = dateLabel(v.date);
    return (
      `  -- ${label} · ${v.receipt} · ${v.customer} · ${v.qty} t · ${money(v.afterVat)} ETB ${v.kind} · product by ${v.productFrom}\n` +
      `  (${[
        sqlString(stableId("sales-vat", v.receipt)),
        sqlString(v.date.toISOString()),
        sqlString(label),
        sqlString(v.customer),
        v.tin ? sqlString(v.tin) : "null",
        v.kind === "cash" ? v.afterVat : 0,
        v.kind === "credit" ? v.afterVat : 0,
        v.qty,
        sqlString(v.fsNo),
        sqlJson(v.products),
        v.bank ? sqlString(v.bank) : "null",
        sqlString(REPORTED_BY),
        "'app'",
      ].join(", ")})`
    );
  })
  .join(",\n");

const credits = all.filter((v) => v.kind === "credit");
const payments = credits
  .map((v) => {
    const due = creditDueDate(v.date).toISOString().slice(0, 10);
    return (
      `  -- ${v.receipt} · ${v.customer} · ${money(v.afterVat)} ETB, due ${due}\n` +
      `  (${[sqlString(stableId("sales-vat", v.receipt)), v.afterVat, sqlString(due), sqlString(PAYMENT_NOTE), sqlString(REPORTED_BY)].join(", ")})`
    );
  })
  .join(",\n");

const tinLines = [...tinFixes.entries()].map(([k, n]) => `--   TIN ${k} (${n} line${n === 1 ? "" : "s"})`);
const nameLines = [...nameCounts.entries()]
  .filter(([tin, c]) => c.size > 1 || (NAME_BY_TIN[tin] && !c.has(NAME_BY_TIN[tin])))
  .map(([tin, c]) => `--   ${tin}: ${[...c.keys()].map((n) => `"${n}"`).join(", ")} → "${NAME_BY_TIN[tin] ?? [...c.entries()].sort((a, b) => b[1] - a[1])[0][0]}"`);
const fmtProducts = (p: Record<string, number>) =>
  Object.entries(p)
    .sort((a, b) => b[1] - a[1])
    .map(([c, q]) => `${PRODUCT_LABEL[c] ?? c} ${round(q, 3)}`)
    .join(", ");

const out = `-- MinTech Ethiopia — sales, June and July 2026, from the VAT sales register.
-- GENERATED by scripts/generate-sales-seed-vat.ts from scripts/sales/2026-06-vat.csv
-- and scripts/sales/2026-07-vat.csv — do not edit by hand.
--
${sums
  .map(
    (s) =>
      `-- ${s.month}: ${s.invoices} sales (${s.cash} cash, ${s.credit} credit), ${s.tonnes} t,\n` +
      `--   ${money(s.cashEtb)} ETB cash and ${money(s.creditEtb)} ETB credit, after VAT.\n` +
      `--   Products: ${fmtProducts(s.products)}.`
  )
  .join("\n")}
--
-- REPLACES every June and July sale (owner's decision, 16 Nov 2026). They are
-- copied first into sales_reset_backup_2026_06_07 and their payments into
-- sales_reset_backup_payments_2026_06_07, then removed, including any filed
-- through the bot, and the register goes in. Every line was checked: qty × unit
-- price = total value, and total value + VAT = value after VAT.
--
-- One sale per receipt; a receipt's product lines are summed into \`products\`.
-- \`delivery_no\` is the receipt: FS00002641 → "2641"; the early-June M-receipts
-- keep their letter (M0004032 → "M4032").
--
-- PRODUCTS. The register names only the material. July takes each receipt's
-- product from the old July data (seed 0008) when its tonnes agree
-- (${sums[1].fromOld} of ${sums[1].invoices}); everything else follows the price-to-product table in the
-- script, built from July's data and confirmed by the owner for June's prices.
-- The bank is the old July data's for the same receipt; June has none.
--
-- CREDIT. The credit sales are written as credit WITH a payment of the full
-- amount at the due date: the owner's statement of uncollected credit sales
-- (seed 0022) has none from June or July, so they were collected. They show as
-- settled on the Credit tab and are never counted as owed.
--
-- Corrections made to the register's own text:
${tinLines.join("\n") || "--   (no TIN corrections)"}
${nameLines.join("\n") || "--   (no name corrections)"}
${notes.map((n) => `--   ${n}`).join("\n")}
--
-- SAFE TO RE-RUN: it removes its own rows too and writes the same ids. Do not
-- re-run seed 0008 after this: it would put the old July rows back beside these.

begin;

create table if not exists sales_reset_backup_2026_06_07 as select * from sales_invoices where false;
create table if not exists sales_reset_backup_payments_2026_06_07 as select * from sales_credit_payments where false;
alter table sales_reset_backup_2026_06_07 enable row level security;
alter table sales_reset_backup_payments_2026_06_07 enable row level security;

/* 1. A copy of what is there now (not this seed's own rows, which it rewrites). */
insert into sales_reset_backup_payments_2026_06_07
select p.* from sales_credit_payments p
  join sales_invoices i on i.id = p.invoice_id
 where (i.date at time zone 'Africa/Addis_Ababa')::date >= date '${monthStart}'
   and (i.date at time zone 'Africa/Addis_Ababa')::date < date '${monthEnd}'
   and i.reported_by <> ${sqlString(REPORTED_BY)}
   and not exists (select 1 from sales_reset_backup_payments_2026_06_07 b where b.id = p.id);

insert into sales_reset_backup_2026_06_07
select i.* from sales_invoices i
 where (i.date at time zone 'Africa/Addis_Ababa')::date >= date '${monthStart}'
   and (i.date at time zone 'Africa/Addis_Ababa')::date < date '${monthEnd}'
   and i.reported_by <> ${sqlString(REPORTED_BY)}
   and not exists (select 1 from sales_reset_backup_2026_06_07 b where b.id = i.id);

/* 2. Every June and July sale out, with its payments. */
delete from sales_credit_payments p using sales_invoices i
 where p.invoice_id = i.id
   and (i.date at time zone 'Africa/Addis_Ababa')::date >= date '${monthStart}'
   and (i.date at time zone 'Africa/Addis_Ababa')::date < date '${monthEnd}';

delete from sales_invoices
 where (date at time zone 'Africa/Addis_Ababa')::date >= date '${monthStart}'
   and (date at time zone 'Africa/Addis_Ababa')::date < date '${monthEnd}';

/* 3. The register. */
insert into sales_invoices (id, date, date_label, customer, tin, invoice_cash, invoice_credit, qty,
                            delivery_no, products, bank, reported_by, source) values
${values};

/* 4. The credit sales, collected. */
insert into sales_credit_payments (invoice_id, amount, collected_on, note, recorded_by) values
${payments};

commit;

-- Expect, per month:
${sums.map((s) => `--   ${s.month}: ${s.invoices} sales, ${s.tonnes} t, ${money(s.cashEtb)} cash + ${money(s.creditEtb)} credit, ${s.credit} credit sales all settled`).join("\n")}
select to_char((i.date at time zone 'Africa/Addis_Ababa')::date, 'YYYY-MM') as month,
       count(*)                        as sales,
       round(sum(i.qty), 3)            as tonnes,
       round(sum(i.invoice_cash), 2)   as cash_etb,
       round(sum(i.invoice_credit), 2) as credit_etb,
       round(sum(i.invoice_credit) - coalesce(sum((select sum(p.amount) from sales_credit_payments p where p.invoice_id = i.id)), 0), 2) as credit_still_owed
  from sales_invoices i
 where (i.date at time zone 'Africa/Addis_Ababa')::date >= date '${monthStart}'
   and (i.date at time zone 'Africa/Addis_Ababa')::date < date '${monthEnd}'
 group by 1
 order by 1;
`;

fs.writeFileSync(OUT, out, "utf8");
console.log(`Wrote ${path.relative(ROOT, OUT)}`);
for (const s of sums) {
  console.log(
    `  ${s.month}: ${s.invoices} sales (${s.cash} cash, ${s.credit} credit) · ${s.tonnes} t · ` +
      `${money(s.cashEtb)} cash · ${money(s.creditEtb)} credit · product from old July data: ${s.fromOld}`
  );
  console.log(`    ${fmtProducts(s.products)}`);
}
console.log(`  TIN fixes: ${[...tinFixes.entries()].map(([k, n]) => `${k} ×${n}`).join("; ")}`);
for (const n of notes) console.log(`  note: ${n}`);
