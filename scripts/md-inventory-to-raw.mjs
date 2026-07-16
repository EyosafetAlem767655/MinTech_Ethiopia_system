/**
 * Converts the Markdown "Inventory Records" paste into the raw bot format that
 * src/lib/ops-report.ts parses. Converting rather than hand-writing SQL keeps a
 * single implementation of the format.
 *
 * Convention carried over from the existing data: within a
 * "D1 Delivered — D2 Received" block, Delivered belongs to D1 while Received,
 * Stock and the bag counts belong to D2.
 */
import fs from "node:fs";

const src = fs.readFileSync(process.argv[2], "utf8");

const DATE = /(\d{1,2}\/\d{1,2}\/\d{4})/g;
const anomalies = [];

/**
 * Confirmed source typos. "3/5/2026 Delivered — 4/6/2026 Received" sits between
 * the 2/6 and 4/6 blocks; every other block runs day N → N+1, and 3/6 otherwise
 * has Received/Stock but no Delivered. Confirmed with the owner as 3 June.
 */
const DATE_FIX = { "3/5/2026": "3/6/2026" };
const fixDate = (d) => {
  if (d && DATE_FIX[d]) {
    anomalies.push(`DATE FIX — "${d}" → "${DATE_FIX[d]}" (confirmed typo)`);
    return DATE_FIX[d];
  }
  return d;
};

// date -> { delivered:{}, received:{}, stock:{}, kg25:{}, kg40:{} }
const days = new Map();
const dayOf = (d) => {
  if (!days.has(d)) days.set(d, { delivered: {}, received: {}, stock: {}, kg25: {}, kg40: {} });
  return days.get(d);
};

/** Product-name normalisation, each case evidenced in the source. */
function normKey(k, ctx) {
  if (k === "Talc") { // Stock always spells it "Talk"; same product (LABEL maps Talk→"Talc")
    anomalies.push(`${ctx}: "Talc" → "Talk" (same product, Stock spells it Talk)`);
    return "Talk";
  }
  if (k === "EL15") { // every other row says ETL15
    anomalies.push(`${ctx}: "EL15" → "ETL15" (typo)`);
    return "ETL15";
  }
  return k;
}

const blocks = src.split(/^## /m).slice(1);

for (const raw of blocks) {
  const [headerLine, ...rest] = raw.split(/\r?\n/);
  const body = rest.join("\n");
  const headerDates = headerLine.match(DATE) || [];

  let deliveredDate = null;
  let receivedDate = null;

  if (/Delivered/i.test(headerLine) && /Received/i.test(headerLine)) {
    deliveredDate = fixDate(headerDates[0] || null);
    receivedDate = fixDate(headerDates[1] || null);
  } else if (/Received/i.test(headerLine)) {
    receivedDate = fixDate(headerDates[0] || null);
  } else if (/Stock/i.test(headerLine)) {
    receivedDate = fixDate(headerDates[0] || null); // stock-only block
  }

  // Section headings inside the block; `### Delivered — D` restates the date.
  const sections = body.split(/^### /m).slice(1);
  for (const sec of sections) {
    const [secHeader, ...secRest] = sec.split(/\r?\n/);
    const items = secRest
      .map((l) => l.trim())
      .filter((l) => l.startsWith("- "))
      .map((l) => l.slice(2).trim());

    const own = fixDate((secHeader.match(DATE) || [])[0]);

    let target = null;
    let bucket = null;
    if (/^Delivered/i.test(secHeader)) { target = own || deliveredDate; bucket = "delivered"; }
    else if (/^Received/i.test(secHeader)) { target = own || receivedDate; bucket = "received"; }
    else if (/^Stock/i.test(secHeader)) { target = receivedDate; bucket = "stock"; }
    else if (/^25Kg Bag/i.test(secHeader)) { target = receivedDate; bucket = "kg25"; }
    else if (/^40Kg Bag/i.test(secHeader)) { target = receivedDate; bucket = "kg40"; }
    else if (/^Correction/i.test(secHeader)) {
      // e.g. "- 23/6/2026" then "- ETL6 Stock = 95.96 Ton"
      const cDate = (sec.match(DATE) || [])[0];
      for (const it of items) {
        const m = it.match(/^([A-Za-z0-9]+)\s+Stock\s*=\s*([\d.]+)/i);
        if (m && cDate) {
          const before = dayOf(cDate).stock[m[1]];
          dayOf(cDate).stock[m[1]] = parseFloat(m[2]);
          anomalies.push(
            `CORRECTION applied — ${cDate} stock ${m[1]}: ${before ?? "(unset)"} → ${m[2]}`
          );
        }
      }
      continue;
    }

    if (!target || !bucket) continue;

    for (const it of items) {
      const m = it.match(/^([A-Za-z0-9]+)\s*=\s*([-\d.]+)/);
      if (!m) continue;
      const key = normKey(m[1], `${target} ${bucket}`);
      const val = parseFloat(m[2]);
      if (Number.isNaN(val)) continue;
      dayOf(target)[bucket][key] = val;
    }
  }
}

// Emit raw bot format, chronologically.
const parseDMY = (s) => { const [d, m, y] = s.split("/").map(Number); return Date.UTC(y, m - 1, d); };
const sorted = [...days.entries()].sort((a, b) => parseDMY(a[0]) - parseDMY(b[0]));

const out = [];
const kv = (o) => Object.entries(o).map(([k, v]) => `${k}=${v},`);
for (const [date, d] of sorted) {
  out.push(date);
  if (Object.keys(d.delivered).length) { out.push("Delivered-"); out.push(...kv(d.delivered)); }
  if (Object.keys(d.received).length) { out.push("Received-"); out.push(...kv(d.received)); }
  if (Object.keys(d.stock).length) { out.push("Stock -"); out.push(...kv(d.stock)); }
  if (Object.keys(d.kg25).length) { out.push("25Kg Bag"); out.push(...kv(d.kg25)); }
  if (Object.keys(d.kg40).length) { out.push("40Kg Bag"); out.push(...kv(d.kg40)); }
}

fs.writeFileSync(process.argv[3], out.join("\n") + "\n", "utf8");

console.log(`dates: ${sorted.length}  (${sorted[0][0]} → ${sorted[sorted.length - 1][0]})`);
const totalDelivered = sorted.reduce((a, [, d]) => a + Object.values(d.delivered).reduce((x, y) => x + y, 0), 0);
console.log(`total Delivered: ${Math.round(totalDelivered * 1000) / 1000} tonnes`);
console.log("\nAnomalies found in the source:");
for (const a of [...new Set(anomalies)]) console.log("  • " + a);
console.log("\nAll dates:");
console.log("  " + sorted.map(([d]) => d).join(", "));
