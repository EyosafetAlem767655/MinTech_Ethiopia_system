/**
 * Generates supabase/seed/0003_production_2026_08.sql from the August
 * production sheet.
 *
 *   node scripts/generate-production-seed.mjs
 *
 * Why a generator rather than hand-written SQL, as with the ops history: a
 * month of figures typed twice is a month of figures typed differently once.
 * The sheet stays in the repo beside its output, so the two can be compared
 * without reading Postgres.
 *
 * The one check that matters runs here: every row's product cells are summed
 * and compared against the sheet's own Total column. A mismatch aborts rather
 * than emitting SQL — a silently wrong tonne in the database is worse than no
 * import at all.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "scripts", "august-2026-production.csv");
const OUT = path.join(ROOT, "supabase", "seed", "0003_production_2026_08.sql");

/**
 * The sheet's column headings, as product codes.
 *
 * Mirrors PRODUCT_LABEL in src/lib/products.ts, inverted. Written out rather
 * than imported because that module is TypeScript and this script is plain
 * node — but any heading NOT in this map is a hard error below, so a column the
 * app does not know about cannot slip in as a new product code.
 */
const CODE_BY_HEADING = {
  "ETL-15": "ETL15",
  "ETL-9": "ETL9",
  "ETL-6": "ETL6",
  "5-EL": "5EL",
  "3-EL": "3EL",
  "W-2-EL": "W2EL",
  "2-EL": "2EL",
  "1-EL": "1EL",
  Talc: "Talk",
  "EC-15": "EC15",
  "EC-90": "EC90",
};

/** The month the sheet covers. Day numbers come from the Date column. */
const YEAR = 2026;
const MONTH = 8; // August

/** Marks every row this import writes, so re-running can clear its own work. */
const REPORTED_BY = "historical import";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const rows = fs
  .readFileSync(SOURCE, "utf8")
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter(Boolean)
  .map((l) => l.split(",").map((c) => c.trim()));

const headings = rows.shift();
const iDate = headings.indexOf("Date");
const iTotal = headings.indexOf("Total");
const fgrColumns = headings.map((h, i) => (/^FGR No/i.test(h) ? i : -1)).filter((i) => i >= 0);

if (iDate !== 0 || iTotal < 0 || fgrColumns.length === 0) {
  throw new Error("The sheet is missing its Date, FGR or Total columns.");
}

/** Which column holds which product code, checked against the app's list. */
const productColumns = [];
headings.forEach((h, i) => {
  if (i === iDate || i === iTotal || fgrColumns.includes(i)) return;
  const code = CODE_BY_HEADING[h];
  if (!code) throw new Error(`Unknown column heading "${h}" — is it a new product?`);
  productColumns.push({ index: i, code, heading: h });
});

const round3 = (n) => Math.round(n * 1000) / 1000;
const sqlString = (s) => `'${String(s).replace(/'/g, "''")}'`;

const problems = [];
const entries = [];

for (const cells of rows) {
  // "7-Aug" → the 7th. The sheet names no year; the month is declared above.
  const m = /^(\d{1,2})-([A-Za-z]{3})/.exec(cells[iDate]);
  if (!m) {
    problems.push(`Unreadable date "${cells[iDate]}"`);
    continue;
  }
  const day = Number(m[1]);
  if (MONTHS.indexOf(m[2]) + 1 !== MONTH) {
    problems.push(`${cells[iDate]} is not in the month this sheet declares`);
    continue;
  }

  const products = {};
  for (const col of productColumns) {
    const raw = cells[col.index] ?? "";
    if (raw === "") continue;
    const value = Number(raw);
    if (!isFinite(value)) {
      problems.push(`${cells[iDate]}: ${col.heading} reads "${raw}"`);
      continue;
    }
    // A zero is not a production figure, it is the absence of one — and storing
    // it would print a 0 in a grid where every other blank day is blank.
    if (value === 0) continue;
    products[col.code] = value;
  }

  // The check this script exists for.
  const summed = round3(Object.values(products).reduce((a, b) => a + b, 0));
  const stated = round3(Number(cells[iTotal] || 0));
  if (summed !== stated) {
    problems.push(`${cells[iDate]}: cells add to ${summed} but the sheet says ${stated}`);
  }

  // Two FGR numbers on the later days, and nothing says which products belong
  // to which. Both are kept on the one row rather than inventing a split: the
  // reference is what the paper record is found by, and half a reference finds
  // nothing.
  const fgr = fgrColumns.map((i) => cells[i]).filter(Boolean).join(" / ");

  entries.push({
    day,
    date: new Date(Date.UTC(YEAR, MONTH - 1, day)).toISOString(),
    label: cells[iDate],
    fgr: fgr || null,
    products,
    total: summed,
  });
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s) in the sheet — nothing written:\n`);
  for (const p of problems) console.error(` ✗ ${p}`);
  process.exit(1);
}

entries.sort((a, b) => a.day - b.day);

const monthStart = new Date(Date.UTC(YEAR, MONTH - 1, 1)).toISOString();
const monthEnd = new Date(Date.UTC(YEAR, MONTH, 1)).toISOString();
const grand = round3(entries.reduce((a, e) => a + e.total, 0));
const codes = [...new Set(entries.flatMap((e) => Object.keys(e.products)))];

// The day's label goes ABOVE its row, never trailing it: a `-- comment` after
// the tuple swallows the comma that separates it from the next one, and the
// whole insert stops parsing.
const values = entries
  .map((e) => {
    const products = JSON.stringify(e.products);
    return (
      `  -- ${e.label} · ${e.total} t\n` +
      `  ('${e.date}', ${e.fgr ? sqlString(e.fgr) : "null"}, ${sqlString(REPORTED_BY)}, ` +
      `'${products}'::jsonb, 'app')`
    );
  })
  .join(",\n");

const sql = `-- MinTech Ethiopia — daily production reports, ${MONTHS[MONTH - 1]} ${YEAR}.
-- GENERATED by scripts/generate-production-seed.mjs from
-- scripts/august-2026-production.csv — do not edit by hand.
--
-- ${entries.length} days, ${grand} t in total, products: ${codes.join(", ")}.
-- Every row's cells were checked against the sheet's own Total column before
-- this file was written; a single disagreement would have aborted it.
--
-- Paste into the Supabase SQL editor and Run. SAFE TO RE-RUN: the delete below
-- clears only rows this import wrote (reported_by = '${REPORTED_BY}')
-- within the month, so anything filed through the bot for those days is left
-- exactly as it is. Run it twice and you still have one copy of each day.
--
-- The dates are stored at UTC midnight, which is what the guided production
-- flow writes when somebody picks a day in the calendar.

begin;

delete from production_reports
 where date >= '${monthStart}' and date < '${monthEnd}'
   and reported_by = ${sqlString(REPORTED_BY)};

insert into production_reports (date, fgr_no, reported_by, products, source) values
${values};

commit;

-- Expect: ${entries.length} days, ${grand} t.
select count(*) as days,
       round(sum((select coalesce(sum(value::numeric), 0) from jsonb_each_text(products))), 3) as tonnes
  from production_reports
 where date >= '${monthStart}' and date < '${monthEnd}'
   and reported_by = ${sqlString(REPORTED_BY)};
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, sql, "utf8");

console.log(`Wrote ${path.relative(ROOT, OUT)}`);
console.log(`  ${entries.length} days · ${grand} t · ${codes.join(", ")}`);
for (const e of entries) {
  const line = Object.entries(e.products)
    .map(([c, v]) => `${c}=${v}`)
    .join(" ");
  console.log(`  ${e.label.padEnd(7)} ${String(e.fgr ?? "—").padEnd(14)} ${String(e.total).padStart(8)} t  ${line}`);
}
