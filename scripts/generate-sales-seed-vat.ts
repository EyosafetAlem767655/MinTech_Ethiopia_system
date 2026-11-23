/**
 * Generates a sales seed for one or more months from the VAT sales register.
 *
 *   npx tsx scripts/generate-sales-seed-vat.ts 2026-06 2026-07   → seed 0026
 *   npx tsx scripts/generate-sales-seed-vat.ts 2026-08 2026-09   → seed 0027
 *
 * Reads scripts/sales/<month>-vat.csv for each month (the register as the
 * owner sent it, one line per product line of a receipt):
 *
 *   VAT CATEGORY, CALENDAR, Types of Sale, Buyer TIN., Buyer name, Date of Sale.,
 *   MRC, Vat receipt, Description., Unit of Measure, Quantity., Unit Price.,
 *   Total value, vat, value after vat, Sale Type
 *
 * and writes one seed that REPLACES every sale in those months (owner's
 * decision, 16 Nov 2026), EXCEPT the rows of the owner's statement of
 * uncollected credit sales and the Oct collection summary (seed 0022): those
 * hold what is still owed, at net pay, and stay exactly as they are; the
 * register's line for the same receipt is not added a second time.
 *
 * The register names the MATERIAL (Dolomite, CaCo3, Marble Powder, Talc), not
 * the product the plant tracks, so the product is decided like this:
 *
 *   1. The product mix of the same receipt in that month's earlier import
 *      (seeds 0008 / 0007 / 0006, typed from the older cash and credit
 *      sheets), when its tonnes agree with the register.
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
const MONTHS = process.argv.slice(2).filter((a) => /^\d{4}-\d{2}$/.test(a)).sort();
if (MONTHS.length === 0) {
  console.error("Usage: npx tsx scripts/generate-sales-seed-vat.ts 2026-08 2026-09");
  process.exit(1);
}
/** Each batch has its own seed number, kept when the batch is regenerated. */
const SEED_NO: Record<string, string> = { "2026-06,2026-07": "0026", "2026-08,2026-09": "0027" };
const seedNo = SEED_NO[MONTHS.join(",")];
if (!seedNo) {
  console.error(`No seed number for ${MONTHS.join(" + ")}: add it to SEED_NO.`);
  process.exit(1);
}
const OUT = path.join(
  ROOT,
  "supabase",
  "seed",
  `${seedNo}_sales_${MONTHS[0].replace("-", "_")}_${MONTHS[MONTHS.length - 1].slice(5)}_vat_register.sql`
);
/** The earlier import of each month, typed from the older cash and credit sheets. */
const OLD_SEED: Record<string, string> = {
  "2026-07": "0008_sales_2026_07.sql",
  "2026-08": "0007_sales_2026_08.sql",
  "2026-09": "0006_sales_2026_09.sql",
};
/** Seed 0022's own rows: what is still owed (and the October collections). Never replaced. */
const KEEP_REPORTED_BY = ["credit statement 31 Oct 2026", "cash collection summary Oct 2026"];

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
  if (d.startsWith("marb")) return "Marble";
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
    29000: "3EL", 33000: "3EL", 36000: "3EL", 38000: "3EL", 40000: "3EL", 43000: "3EL",
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
  "0074337486": "0074357486", // Betelhem Tigabu
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
  "0091314834": "Platinum Ethio Manufacturing PLC",
  "0085222333": "Huanqie Shoe",
  "0103596225": "Harmony Paint & Chemicals",
  "0039521460": "Mural Paint & Chemicals",
  "0085034551": "Nice Soap & Detergent",
  "0000280751": "Birhanu Beyene",
  "0000014526": "Hakkamal Cosmetics",
  "0091656698": "Kibrom & Henok Friends",
  "0003323096": "Simret Tekle",
  "0003604159": "Simegnesh Negash Workneh",
  "0038559842": "Abdulezak Nesro",
  "0056693091": "Biruk Sew Amare",
  "0094833764": "Firehiwot Abenezer",
  "0000247932": "Tewodros Melese",
  "0058635746": "Eyob Tekeste",
  "0003452830": "Yoursa Mohammed",
  "0074923314": "Kefyalew Wederyelesh",
  "0077718940": "Leila Dry & Liquid Soap",
  "0002518138": "Wale Workneh",
  "0000073306": "Solomon Yishak",
  "0081357245": "Tana Manufacturing PLC",
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

type OldRow = { products: Record<string, number>; qty: number; bank: string };

/** A month's earlier import by receipt number: products, tonnes, bank (null on credit rows). */
function oldRows(month: string): Map<string, OldRow[]> {
  const out = new Map<string, OldRow[]>();
  const file = OLD_SEED[month];
  if (!file) return out;
  const text = fs.readFileSync(path.join(ROOT, "supabase", "seed", file), "utf8");
  const re = /\('[^']+', '[^']+', '[^']+', '(?:[^']|'')*', [0-9.]+, [0-9.]+, ([0-9.]+), '([0-9]+)', '(\{[^}]*\})'::jsonb, (?:'((?:[^']|'')*)'|null)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.set(m[2], [...(out.get(m[2]) ?? []), { qty: Number(m[1]), products: JSON.parse(m[3]), bank: (m[4] ?? "").replace(/''/g, "'") }]);
  }
  return out;
}

/** The receipts on seed 0022's statement of uncollected credit sales. */
function statementReceipts(): Set<string> {
  const file = path.join(ROOT, "supabase", "seed", "0022_credit_sales_fresh_start_2026_10_31.sql");
  const out = new Set<string>();
  for (const m of fs.readFileSync(file, "utf8").matchAll(/\('\d{4}-\d{2}-\d{2}', '[^']+', '(?:[^']|'')*', [0-9.]+, [0-9.]+, '([0-9]+)', '\{/g)) {
    out.add(String(Number(m[1])));
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
  productFrom: "earlier import" | "price";
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
const old = new Map(MONTHS.map((m) => [m, oldRows(m)]));
const onStatement = statementReceipts();

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
  // The earlier import's product mix and bank for the same receipt, when its tonnes agree.
  const prev = old.get(v.month)?.get(v.fsNo);
  const same = prev?.filter((p) => Math.abs(p.qty - v.qty) < 1e-6) ?? [];
  if (same.length === 1) {
    v.products = { ...same[0].products };
    v.bank = same[0].bank || null;
    v.productFrom = "earlier import";
    continue;
  }
  // The bank is still the receipt's own when there is one row for it.
  if (prev?.length === 1) v.bank = prev[0].bank || null;
  if (prev && prev.length > 0) {
    notes.push(
      `Fs ${v.fsNo}: the earlier import had ${prev.map((p) => `${p.qty} t`).join(" and ")} on it, the register ${v.qty} t, so its product follows the price`
    );
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

const first = MONTHS[0];
const last = MONTHS[MONTHS.length - 1];
const rangeStart = `${first}-01`;
const rangeEnd = (() => {
  const [y, m] = last.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
})();
const monthName = (m: string) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleString("en-GB", { month: "long", timeZone: "UTC" });
const span = MONTHS.map(monthName).join(" and ");
const tag = MONTHS.map((m) => m.replace("-", "_")).join("_");
const backupSales = `sales_reset_backup_${tag}`;
const backupPays = `sales_reset_backup_payments_${tag}`;

/** Register receipts that are already on the 0022 statement: kept as the statement has them. */
const skipped = all.filter((v) => v.kind === "credit" && onStatement.has(v.fsNo));
const written = all.filter((v) => !skipped.includes(v));

function summary(month: string) {
  const list = written.filter((v) => v.month === month);
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
    fromOld: list.filter((v) => v.productFrom === "earlier import").length,
    skipped: skipped.filter((v) => v.month === month),
    products: list.reduce((p, v) => {
      for (const [c, q] of Object.entries(v.products)) add(p, c, q);
      return p;
    }, {} as Record<string, number>),
  };
}
const sums = MONTHS.map(summary);

const values = written
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

const credits = written.filter((v) => v.kind === "credit");
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
const keepList = KEEP_REPORTED_BY.map(sqlString).join(", ");
const inRange = (alias: string) =>
  `(${alias}.date at time zone 'Africa/Addis_Ababa')::date >= date '${rangeStart}'\n   and (${alias}.date at time zone 'Africa/Addis_Ababa')::date < date '${rangeEnd}'`;
const oldSeeds = MONTHS.map((m) => OLD_SEED[m]).filter(Boolean);

const out = `-- MinTech Ethiopia — sales, ${span} ${first.slice(0, 4)}, from the VAT sales register.
-- GENERATED by scripts/generate-sales-seed-vat.ts ${MONTHS.join(" ")} from
-- ${MONTHS.map((m) => `scripts/sales/${m}-vat.csv`).join(" and ")} — do not edit by hand.
--
${sums
  .map(
    (s) =>
      `-- ${s.month}: ${s.invoices} sales (${s.cash} cash, ${s.credit} credit), ${s.tonnes} t,\n` +
      `--   ${money(s.cashEtb)} ETB cash and ${money(s.creditEtb)} ETB credit, after VAT.\n` +
      `--   Products: ${fmtProducts(s.products)}.` +
      (s.skipped.length
        ? `\n--   Not added again (already on the 31 Oct statement of uncollected credit sales, kept as it is):\n` +
          s.skipped.map((v) => `--     Fs ${v.fsNo} · ${v.customer} · ${v.qty} t`).join("\n")
        : "")
  )
  .join("\n")}
--
-- REPLACES every ${span} sale (owner's decision, 16 Nov 2026), except seed
-- 0022's statement of uncollected credit sales and its October collections,
-- which hold what is still owed and stay exactly as they are. What is replaced
-- is copied first into ${backupSales} (and its payments into
-- ${backupPays}). Every line was checked: qty × unit price = total value,
-- and total value + VAT = value after VAT.
--
-- One sale per receipt; a receipt's product lines are summed into \`products\`.
-- \`delivery_no\` is the receipt: FS00002641 → "2641"; M-receipts keep their
-- letter (M0004032 → "M4032").
--
-- PRODUCTS. The register names only the material. A receipt takes its product
-- (and bank) from the month's earlier import${oldSeeds.length ? ` (${oldSeeds.join(", ")})` : ""} when
-- its tonnes agree (${sums.map((s) => `${s.month}: ${s.fromOld} of ${s.invoices}`).join("; ")}); every other line
-- follows the price-to-product table in the script, confirmed by the owner.
--
-- CREDIT. Credit sales not on the 31 Oct uncollected statement were collected,
-- so each is written with a payment of the full amount at its due date: settled
-- on the Credit tab and never counted as owed.
--
-- Corrections made to the register's own text:
${tinLines.join("\n") || "--   (no TIN corrections)"}
${nameLines.join("\n") || "--   (no name corrections)"}
${notes.map((n) => `--   ${n}`).join("\n")}
--
-- SAFE TO RE-RUN: it removes its own rows too and writes the same ids.${
  oldSeeds.length ? ` Do not\n-- re-run ${oldSeeds.join(" / ")} after this: they would put the old rows back beside these.` : ""
}

begin;

create table if not exists ${backupSales} as select * from sales_invoices where false;
create table if not exists ${backupPays} as select * from sales_credit_payments where false;
alter table ${backupSales} enable row level security;
alter table ${backupPays} enable row level security;

/* A backup made by an earlier run has the columns the tables had then. A later
   migration (0049 added five) would leave it a column short and the copy below
   would fail, so any column added since is added to the backup too, in order. */
do $$
declare
  pair record;
  c record;
begin
  for pair in select * from (values ('sales_invoices', '${backupSales}'), ('sales_credit_payments', '${backupPays}')) as t(src, dst) loop
    for c in
      select a.attname, format_type(a.atttypid, a.atttypmod) as typ
        from pg_attribute a
       where a.attrelid = pair.src::regclass and a.attnum > 0 and not a.attisdropped
         and not exists (
           select 1 from pg_attribute b
            where b.attrelid = pair.dst::regclass and b.attname = a.attname and not b.attisdropped)
       order by a.attnum
    loop
      execute format('alter table %I add column %I %s', pair.dst, c.attname, c.typ);
    end loop;
  end loop;
end $$;

/* 1. A copy of what is replaced (not this seed's own rows, nor the statement's). */
insert into ${backupPays}
select p.* from sales_credit_payments p
  join sales_invoices i on i.id = p.invoice_id
 where ${inRange("i")}
   and i.reported_by <> ${sqlString(REPORTED_BY)}
   and i.reported_by not in (${keepList})
   and not exists (select 1 from ${backupPays} b where b.id = p.id);

insert into ${backupSales}
select i.* from sales_invoices i
 where ${inRange("i")}
   and i.reported_by <> ${sqlString(REPORTED_BY)}
   and i.reported_by not in (${keepList})
   and not exists (select 1 from ${backupSales} b where b.id = i.id);

/* 2. Every ${span} sale out, with its payments — the statement's rows stay. */
delete from sales_credit_payments p using sales_invoices i
 where p.invoice_id = i.id
   and ${inRange("i")}
   and i.reported_by not in (${keepList});

delete from sales_invoices i
 where ${inRange("i")}
   and i.reported_by not in (${keepList});

/* 3. The register, except a receipt the statement already holds. */
insert into sales_invoices (id, date, date_label, customer, tin, invoice_cash, invoice_credit, qty,
                            delivery_no, products, bank, reported_by, source)
select v.id::uuid, v.date::timestamptz, v.date_label, v.customer, v.tin, v.invoice_cash, v.invoice_credit, v.qty,
       v.delivery_no, v.products, v.bank, v.reported_by, v.source from (values
${values}
) as v(id, date, date_label, customer, tin, invoice_cash, invoice_credit, qty, delivery_no, products, bank, reported_by, source)
 where not exists (
   select 1 from sales_invoices s
    where s.reported_by in (${keepList})
      and s.delivery_no = v.delivery_no
      and ${inRange("s")}
 );
${
  payments
    ? `
/* 4. The credit sales, collected (only those written above). */
insert into sales_credit_payments (invoice_id, amount, collected_on, note, recorded_by)
select v.invoice_id::uuid, v.amount, v.collected_on::date, v.note, v.recorded_by from (values
${payments}
) as v(invoice_id, amount, collected_on, note, recorded_by)
 where exists (select 1 from sales_invoices i where i.id = v.invoice_id::uuid);
`
    : ""
}
/* 5. WHT off what qualifies (migration 0049), so a re-run never leaves invoices
      at their full amount. A database without 0049 skips this; running 0049
      and seed 0028 later applies it. */
do $$ begin
  perform apply_sales_wht();
exception when undefined_function then null;
end $$;

commit;

-- Expect, per month (the register's own sales, BEFORE WHT; the statement's rows are added on top):
${sums.map((s) => `--   ${s.month}: ${s.invoices} sales, ${s.tonnes} t, ${money(s.cashEtb)} cash + ${money(s.creditEtb)} credit, all settled`).join("\n")}
select to_char((i.date at time zone 'Africa/Addis_Ababa')::date, 'YYYY-MM') as month,
       count(*) filter (where i.reported_by = ${sqlString(REPORTED_BY)}) as register_sales,
       round(sum(i.qty) filter (where i.reported_by = ${sqlString(REPORTED_BY)}), 3) as register_tonnes,
       round(sum(coalesce((to_jsonb(i) ->> 'gross_cash')::numeric, i.invoice_cash)) filter (where i.reported_by = ${sqlString(REPORTED_BY)}), 2) as register_cash,
       round(sum(coalesce((to_jsonb(i) ->> 'gross_credit')::numeric, i.invoice_credit)) filter (where i.reported_by = ${sqlString(REPORTED_BY)}), 2) as register_credit,
       round(sum(coalesce((to_jsonb(i) ->> 'wht_amount')::numeric, 0)) filter (where i.reported_by = ${sqlString(REPORTED_BY)}), 2) as wht_3pct,
       round(sum(i.invoice_cash + i.invoice_credit) filter (where i.reported_by = ${sqlString(REPORTED_BY)}), 2) as net_after_wht,
       count(*) filter (where i.reported_by in (${keepList})) as statement_sales_kept,
       round(sum(i.invoice_credit) - coalesce(sum((select sum(p.amount) from sales_credit_payments p where p.invoice_id = i.id)), 0), 2) as credit_still_owed
  from sales_invoices i
 where ${inRange("i")}
 group by 1
 order by 1;
`;

fs.writeFileSync(OUT, out, "utf8");
console.log(`Wrote ${path.relative(ROOT, OUT)}`);
for (const s of sums) {
  console.log(
    `  ${s.month}: ${s.invoices} sales (${s.cash} cash, ${s.credit} credit) · ${s.tonnes} t · ` +
      `${money(s.cashEtb)} cash · ${money(s.creditEtb)} credit · product from earlier import: ${s.fromOld}`
  );
  console.log(`    ${fmtProducts(s.products)}`);
  for (const v of s.skipped) console.log(`    kept from the statement, not added again: Fs ${v.fsNo} ${v.customer} ${v.qty} t (${money(v.afterVat)} on the register)`);
}
console.log(`  TIN fixes: ${[...tinFixes.entries()].map(([k, n]) => `${k} ×${n}`).join("; ") || "none"}`);
for (const n of notes) console.log(`  note: ${n}`);
