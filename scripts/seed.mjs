// Seeds 90 days of realistic demo data so the dashboard, trends and
// exceptions have something to show. Run with: npm run seed
// Reads MONGODB_URI from .env.local or the environment.
import mongoose from "mongoose";
import { readFileSync, existsSync } from "fs";

if (!process.env.MONGODB_URI && existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
if (!process.env.MONGODB_URI) {
  console.error("Set MONGODB_URI (env or .env.local) first.");
  process.exit(1);
}

await mongoose.connect(process.env.MONGODB_URI);
const db = mongoose.connection.db;

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[rand(0, arr.length - 1)];
const dayAt = (daysAgo, hour = 10) => {
  const d = new Date();
  d.setUTCHours(hour - 3, rand(0, 59), 0, 0); // hour in EAT
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d;
};

console.log("Clearing existing demo collections…");
for (const c of ["stonedeliveries", "shiftreports", "invoices", "purchaserequests", "baglots", "bagevents", "damageclaims", "receipts"]) {
  await db.collection(c).deleteMany({});
}

/* Bag lots */
const suppliers = ["Hawassa Polymers", "Adama Bag Industries", "Mojo Packaging PLC"];
const lots = [];
for (let i = 0; i < 3; i++) {
  const quantity = rand(8000, 15000);
  lots.push({
    lotCode: `LOT-2026-${String(i + 1).padStart(4, "0")}`,
    supplier: suppliers[i],
    bagType: "PP woven 50kg",
    quantity,
    deliveryNote: `DN-${rand(10000, 99999)}`,
    photoIds: [],
    registeredBy: "Supervisor Bekele",
    handlers: ["Supervisor Bekele"],
    receivedAt: dayAt(80 - i * 25),
    createdAt: dayAt(80 - i * 25),
    updatedAt: new Date(),
  });
}
const lotRes = await db.collection("baglots").insertMany(lots);
const lotIds = Object.values(lotRes.insertedIds);

/* 90 days of operations */
const clients = ["Derba Cement", "Habesha Construction", "Mugher Trading", "Zemen Builders", "Awash Agro"];
const clientPhones = {
  "Derba Cement": "+251911000101",
  "Habesha Construction": "+251911000102",
  "Mugher Trading": "+251911000103",
  "Zemen Builders": "+251911000104",
  "Awash Agro": "+251911000105",
};
const workers = ["Abel T.", "Kebede M.", "Sara G.", "Yonas A.", "Marta H."];
const trucks = ["ET-3-A12345", "ET-3-B67890", "ET-1-C24680", "ET-3-D13579"];
const invoices = [];
const stone = [];
const shifts = [];
const events = [];
const claims = [];
const receipts = [];

for (let d = 90; d >= 1; d--) {
  if (rand(1, 10) <= 9) {
    // stone deliveries
    const n = rand(2, 6);
    for (let i = 0; i < n; i++) {
      stone.push({
        truckPlate: pick(trucks),
        supplier: pick(["Bishoftu Quarry", "Mojo Stone", "Adama Aggregates"]),
        quarry: pick(["Bishoftu Ridge", "Mojo East Pit", "Adama North Face"]),
        driverName: pick(["Tadesse", "Fikru", "Solomon", "Nati"]),
        gateClerk: "Gate Clerk Amanuel",
        loads: 1,
        qualityGrade: d === 1 && i === 0 ? "dark/weathered" : rand(1, 20) === 1 ? "dark/weathered" : rand(1, 6) === 1 ? "fair" : "good",
        date: dayAt(d, rand(7, 16)),
        createdAt: dayAt(d),
        updatedAt: new Date(),
      });
    }
    // shift report (production)
    const filled = rand(700, 1400);
    const lotIdx = d > 55 ? 0 : d > 28 ? 1 : 2;
    shifts.push({
      date: dayAt(d, 18),
      shift: "day",
      supervisor: pick(workers),
      filledSacks: filled,
      downtimeMinutes: rand(0, 90),
      notes: rand(1, 8) === 1 ? "Crusher belt slipped, fixed same shift" : undefined,
      lotId: lotIds[lotIdx],
      createdAt: dayAt(d, 18),
      updatedAt: new Date(),
    });
    events.push({
      lotId: lotIds[lotIdx],
      type: "filled",
      quantity: filled,
      by: "production",
      date: dayAt(d, 18),
      createdAt: dayAt(d, 18),
      updatedAt: new Date(),
    });
  }
  // invoices + payments
  if (rand(1, 10) <= 7) {
    const client = pick(clients);
    const sacks = rand(300, 900);
    const amount = sacks * rand(380, 460);
    const invoicedAt = dayAt(d, 11);
    const dueDate = new Date(invoicedAt.getTime() + 30 * 86400000);
    const paid = rand(1, 10) <= 7;
    invoices.push({
      invoiceNumber: `INV-${2026}${String(1000 + invoices.length)}`,
      client,
      clientPhone: clientPhones[client],
      sacks,
      amount,
      invoicedAt,
      dueDate,
      payments: paid ? [{ amount, date: new Date(invoicedAt.getTime() + rand(2, 25) * 86400000), method: "bank" }] : [],
      withholdingReceiptReceived: paid ? rand(1, 10) <= 8 : false,
      createdAt: invoicedAt,
      updatedAt: new Date(),
    });
  }
  // receipts and expense evidence for the monthly report
  if (rand(1, 10) <= 5) {
    receipts.push({
      vendor: pick(["Fuel Station A", "Addis Spares", "Site Canteen", "Welding Shop", "Courier Office"]),
      amount: rand(1200, 42000),
      category: pick(["Fuel", "Maintenance", "Meals", "Transport", "Office"]),
      receiptDate: dayAt(d, rand(8, 18)),
      taxInvoiceNumber: `RCPT-${2026}${String(2000 + receipts.length)}`,
      submittedBy: pick(["Telegram client", "Accountant Selam", "Site office"]),
      source: rand(1, 3) === 1 ? "app" : "telegram",
      createdAt: dayAt(d),
      updatedAt: new Date(),
    });
  }
  // damage claims (a few per week, spike yesterday for the exception demo)
  const nClaims = d === 1 ? 3 : rand(1, 7) === 1 ? 1 : 0;
  for (let i = 0; i < nClaims; i++) {
    const lotIdx = d > 55 ? 0 : d > 28 ? 1 : 2;
    const verified = rand(1, 10) <= 6 && d > 2;
    claims.push({
      lotId: lotIds[lotIdx],
      quantity: d === 1 ? rand(25, 40) : rand(3, 15),
      source: rand(1, 3) === 1 ? "telegram" : "app",
      worker: pick(workers),
      shift: pick(["day", "night"]),
      photos: [],
      flags: [],
      status: verified ? "verified" : "pending",
      reviewedBy: verified ? "Supervisor Bekele" : undefined,
      reviewedAt: verified ? dayAt(d - 1, 9) : undefined,
      disposal: verified && rand(1, 2) === 1
        ? { action: pick(["returned_to_supplier", "destroyed", "sold_as_scrap"]), amount: rand(100, 900), recordedBy: "Supervisor Bekele", recordedAt: dayAt(d - 1, 10) }
        : undefined,
      capturedAt: dayAt(d, 14),
      createdAt: dayAt(d, 14),
      updatedAt: new Date(),
    });
  }
}

// One invoice exactly 30 days overdue → triggers the "crossed 30 days" exception
invoices.push({
  invoiceNumber: "INV-20260042",
  client: "Habesha Construction",
  clientPhone: clientPhones["Habesha Construction"],
  sacks: 600,
  amount: 600 * 420,
  invoicedAt: dayAt(60, 11),
  dueDate: new Date(Date.now() - 30 * 86400000 - 6 * 3600000),
  payments: [{ amount: 100000, date: dayAt(45, 11), method: "bank" }],
  withholdingReceiptReceived: false,
  createdAt: dayAt(60),
  updatedAt: new Date(),
});

await db.collection("stonedeliveries").insertMany(stone);
await db.collection("shiftreports").insertMany(shifts);
await db.collection("invoices").insertMany(invoices);
await db.collection("damageclaims").insertMany(claims);
await db.collection("bagevents").insertMany(events);
if (receipts.length) await db.collection("receipts").insertMany(receipts);

/* Pending purchase requests for the approval demo */
await db.collection("purchaserequests").insertMany([
  {
    title: "Crusher jaw plate replacement",
    amount: 185000,
    requestedBy: "Maintenance — Dawit",
    justification: "Current plate worn below safe tolerance; risk of unplanned downtime.",
    source: "app",
    status: "pending",
    createdAt: dayAt(4),
    updatedAt: new Date(),
  },
  {
    title: "2,000L diesel for generators",
    amount: 230000,
    requestedBy: "Site office — Hana",
    source: "telegram",
    status: "pending",
    createdAt: dayAt(1),
    updatedAt: new Date(),
  },
]);

// Stock count that leaves a deliberate 120-bag gap on lot 3 → red flag demo
const lot3Filled = events.filter((e) => String(e.lotId) === String(lotIds[2])).reduce((a, e) => a + e.quantity, 0);
const lot3Verified = claims
  .filter((c) => String(c.lotId) === String(lotIds[2]) && c.status === "verified")
  .reduce((a, c) => a + c.quantity, 0);
await db.collection("bagevents").insertOne({
  lotId: lotIds[2],
  type: "stock_count",
  quantity: Math.max(0, lots[2].quantity - lot3Filled - lot3Verified - 120),
  by: "Supervisor Bekele",
  note: "Monthly physical count",
  date: dayAt(1, 17),
  createdAt: dayAt(1, 17),
  updatedAt: new Date(),
});

console.log(`✓ Seeded: ${stone.length} deliveries, ${shifts.length} shift reports, ${invoices.length} invoices, ${receipts.length} receipts, ${claims.length} claims, ${lots.length} lots.`);
console.log("Tip: call GET /api/cron/daily-brief once (with the CRON_SECRET bearer) to generate the first brief.");
await mongoose.disconnect();
