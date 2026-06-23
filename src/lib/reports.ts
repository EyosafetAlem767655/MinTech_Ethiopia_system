import { Invoice, Receipt } from "@/lib/models";

const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;

export function currentEatMonth(now = new Date()): string {
  const shifted = new Date(now.getTime() + EAT_OFFSET_MS);
  return shifted.toISOString().slice(0, 7);
}

export function eatMonthRange(month = currentEatMonth()) {
  const [year, monthIndex] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, monthIndex - 1, 1) - EAT_OFFSET_MS);
  const end = new Date(Date.UTC(year, monthIndex, 1) - EAT_OFFSET_MS);
  return { month, start, end };
}

export async function monthlySalesReport(month = currentEatMonth()) {
  const { start, end } = eatMonthRange(month);
  const dateMatch = { $gte: start, $lt: end };

  const [sales, collections, expenseRows, clientRows, categoryRows] = await Promise.all([
    Invoice.aggregate([
      { $match: { invoicedAt: dateMatch } },
      { $group: { _id: null, sacks: { $sum: "$sacks" }, amount: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]),
    Invoice.aggregate([
      { $unwind: "$payments" },
      { $match: { "payments.date": dateMatch } },
      { $group: { _id: null, amount: { $sum: "$payments.amount" }, count: { $sum: 1 } } },
    ]),
    Receipt.aggregate([
      { $match: { receiptDate: dateMatch } },
      { $group: { _id: null, amount: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]),
    Invoice.aggregate([
      { $match: { invoicedAt: dateMatch } },
      { $group: { _id: "$client", amount: { $sum: "$amount" }, sacks: { $sum: "$sacks" } } },
      { $sort: { amount: -1 } },
      { $limit: 6 },
    ]),
    Receipt.aggregate([
      { $match: { receiptDate: dateMatch } },
      { $group: { _id: { $ifNull: ["$category", "Uncategorized"] }, amount: { $sum: "$amount" }, count: { $sum: 1 } } },
      { $sort: { amount: -1 } },
      { $limit: 6 },
    ]),
  ]);

  const revenueInvoiced = sales[0]?.amount || 0;
  const cashCollected = collections[0]?.amount || 0;
  const receiptExpenses = expenseRows[0]?.amount || 0;

  return {
    month,
    sacksSold: sales[0]?.sacks || 0,
    revenueInvoiced,
    cashCollected,
    receiptExpenses,
    netCash: cashCollected - receiptExpenses,
    invoiceCount: sales[0]?.count || 0,
    receiptCount: expenseRows[0]?.count || 0,
    paymentCount: collections[0]?.count || 0,
    topClients: clientRows.map((r) => ({ client: r._id || "Unknown", amount: r.amount || 0, sacks: r.sacks || 0 })),
    expenseCategories: categoryRows.map((r) => ({ category: r._id || "Uncategorized", amount: r.amount || 0, count: r.count || 0 })),
  };
}
