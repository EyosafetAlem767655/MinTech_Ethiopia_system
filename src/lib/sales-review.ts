import sql from "@/lib/sql";
import { DELIVERY_PRODUCTS, productLabel } from "@/lib/products";
import { BANKS, BANK_OTHER, matchBank } from "@/lib/banks";
import {
  SALES_KEYS,
  salesBank,
  salesBankAmountKey,
  salesBanks,
  salesProductKey,
  salesQty,
  salesTin,
} from "@/lib/sales-invoice";
import { linkCustomerTin } from "@/lib/sales-tin";

/**
 * 📋 Sales data manager: yesterday's sales, one tap each, to approve or correct.
 *
 * Every morning the manager gets the day's sales as buttons. A sale opens as a
 * card with ✅ Approve and ✏️ Edit; Edit sends the sale as the same copyable
 * block the sales report uses (salesEditBlock), and what comes back is saved
 * over the row. Nothing here interprets text with a model: what is sent back is
 * what is saved.
 */

export const SALES_MANAGER_CAP = "sales_manager";

export interface ReviewSale {
  id: string;
  /** YYYY-MM-DD, the sale's day in EAT. */
  day: string;
  customer: string;
  cash: number;
  credit: number;
  qty: number;
  products: Record<string, number>;
  banks: { bank: string; amount: number }[];
  bank: string | null;
  tin: string | null;
  reportedBy: string;
  reviewStatus: "approved" | "edited" | null;
  reviewedBy: string | null;
}

const n = (v: unknown) => Number(v) || 0;
const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const money = (v: number) => Math.round(v).toLocaleString("en-US");
const tons = (v: number) => (Math.round(v * 1000) / 1000).toLocaleString("en-US");

/** The day before `day` (YYYY-MM-DD). */
export function dayBefore(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

/** Yesterday in EAT. */
export function yesterdayEat(now = new Date()): string {
  return dayBefore(new Date(now.getTime() + 3 * 3_600_000).toISOString().slice(0, 10));
}

function fromRow(r: Record<string, unknown>): ReviewSale {
  const date = new Date(String(r.date));
  return {
    id: String(r.id),
    day: new Date(date.getTime() + 3 * 3_600_000).toISOString().slice(0, 10),
    customer: String(r.customer || ""),
    cash: n(r.invoice_cash),
    credit: n(r.invoice_credit),
    qty: n(r.qty),
    products: (r.products as Record<string, number>) || {},
    banks: Array.isArray(r.banks) ? (r.banks as { bank: string; amount: number }[]) : [],
    bank: (r.bank as string) || null,
    tin: (r.tin as string) || null,
    reportedBy: String(r.reported_by || ""),
    reviewStatus: r.review_status === "approved" || r.review_status === "edited" ? r.review_status : null,
    reviewedBy: (r.reviewed_by as string) || null,
  };
}

/** One day's sales, in the order they were filed. `to_jsonb` reads whichever columns exist. */
export async function salesOfDay(day: string): Promise<ReviewSale[]> {
  const rows = await sql<{ r: Record<string, unknown> }[]>`
    select to_jsonb(i) as r from sales_invoices i
     where (i.date at time zone 'Africa/Addis_Ababa')::date = ${day}::date
     order by i.created_at asc
  `;
  return rows.map((x) => fromRow(x.r));
}

export async function saleById(id: string): Promise<ReviewSale | null> {
  const [row] = await sql<{ r: Record<string, unknown> }[]>`
    select to_jsonb(i) as r from sales_invoices i where i.id = ${id}::uuid
  `.catch(() => []);
  return row ? fromRow(row.r) : null;
}

/**
 * A saved sale as the sales report's draft, so it can be shown in, and read back
 * from, the same copyable block the bot already uses.
 */
export function invoiceToDraft(s: ReviewSale): Record<string, string | number> {
  const d: Record<string, string | number> = {
    [SALES_KEYS.customer]: s.customer,
    [SALES_KEYS.invoiceCash]: s.cash,
    [SALES_KEYS.invoiceCredit]: s.credit,
    [SALES_KEYS.tin]: s.tin || "none",
  };
  for (const code of DELIVERY_PRODUCTS) d[salesProductKey(code)] = n(s.products[code]);

  // Banks back onto the list: a name the list does not know is "Other".
  const slips = s.banks.length > 0 ? s.banks : s.bank ? s.bank.split("+").map((b) => ({ bank: b.trim(), amount: s.cash })) : [];
  const ticked: string[] = [];
  for (const slip of slips) {
    const matched = matchBank(slip.bank) || BANK_OTHER;
    if (!ticked.includes(matched)) ticked.push(matched);
    if (matched === BANK_OTHER) d[SALES_KEYS.bankOther] = slip.bank;
    d[salesBankAmountKey(matched)] = n(slip.amount);
  }
  if (ticked.length > 0) d[SALES_KEYS.bank] = BANKS.filter((b) => ticked.includes(b)).join(",");
  return d;
}

/** The card a sale opens as. */
export function reviewCard(s: ReviewSale): string {
  const brands = DELIVERY_PRODUCTS.filter((c) => n(s.products[c]) > 0)
    .map((c) => `  • ${productLabel(c)}: ${tons(n(s.products[c]))} t`)
    .join("\n");
  const status =
    s.reviewStatus === "approved"
      ? `✅ Approved by ${esc(s.reviewedBy || "—")}`
      : s.reviewStatus === "edited"
        ? `✏️ Edited by ${esc(s.reviewedBy || "—")}`
        : "⏳ Not reviewed yet";
  return (
    `🧾 <b>${esc(s.customer || "—")}</b> · ${s.day}\n` +
    `🆔 TIN: ${esc(s.tin || "—")}\n` +
    `💵 Cash: <b>${money(s.cash)}</b> · 🧾 Credit: <b>${money(s.credit)}</b>\n` +
    `🏦 Bank: ${esc(s.banks.length ? s.banks.map((b) => `${b.bank} ${money(b.amount)}`).join(" + ") : s.bank || "—")}\n` +
    `⚖️ ${tons(s.qty)} t\n${brands || "  —"}\n\n` +
    `👤 Filed by ${esc(s.reportedBy || "—")}\n${status}`
  );
}

export function cardKeyboard(s: ReviewSale) {
  return {
    inline_keyboard: [
      [
        { text: "✅ Approve", callback_data: `sm:ok:${s.id}` },
        { text: "✏️ Edit", callback_data: `sm:ed:${s.id}` },
      ],
      [{ text: "◀ Back to the list", callback_data: `sm:d:${s.day}` }],
    ],
  };
}

/** A day's sales as one message with a button per sale. */
export function dayList(day: string, sales: ReviewSale[]): { text: string; reply_markup: unknown } {
  const done = sales.filter((s) => s.reviewStatus).length;
  const text =
    sales.length === 0
      ? `📋 <b>Sales data manager</b> · ${day}\n\nNo sales were filed for this day.`
      : `📋 <b>Sales data manager</b> · ${day}\n\n${sales.length} sale${sales.length === 1 ? "" : "s"}, ${done} reviewed.\n` +
        `Tap a sale to approve or edit it.`;
  const rows = sales.map((s) => [
    {
      text: `${s.reviewStatus === "approved" ? "✅" : s.reviewStatus === "edited" ? "✏️" : "⏳"} ${s.customer || "—"} · ${tons(s.qty)} t · ${money(s.cash + s.credit)}`.slice(0, 60),
      callback_data: `sm:v:${s.id}`,
    },
  ]);
  rows.push([{ text: "◀ Previous day", callback_data: `sm:d:${dayBefore(day)}` }]);
  return { text, reply_markup: { inline_keyboard: rows } };
}

const missingReviewColumns = (e: unknown) => (e as { code?: string })?.code === "42703";

/** Mark a sale approved. Throws a readable error if migration 0047 is missing. */
export async function approveSale(id: string, who: string): Promise<void> {
  await sql`
    update sales_invoices set review_status = 'approved', reviewed_by = ${who}, reviewed_at = now() where id = ${id}::uuid
  `.catch((e) => {
    if (missingReviewColumns(e)) throw new Error("Approving needs migration 0047 (sales review) to be run first.");
    throw e;
  });
}

/** Save a corrected sale over its row, the same columns the sales report writes. */
export async function saveEditedSale(id: string, d: Record<string, string | number>, who: string): Promise<void> {
  const products: Record<string, number> = {};
  for (const code of DELIVERY_PRODUCTS) {
    const v = n(d[salesProductKey(code)]);
    if (v !== 0) products[code] = v;
  }
  const values = {
    customer: String(d[SALES_KEYS.customer] || "").trim(),
    cash: n(d[SALES_KEYS.invoiceCash]),
    credit: n(d[SALES_KEYS.invoiceCredit]),
    qty: salesQty(d),
    bank: salesBank(d),
    banks: salesBanks(d),
    tin: salesTin(d),
  };
  await sql`
    update sales_invoices set
      customer = ${values.customer}, invoice_cash = ${values.cash}, invoice_credit = ${values.credit},
      qty = ${values.qty}, products = ${sql.json(products)}, bank = ${values.bank},
      banks = ${sql.json(values.banks)}, tin = ${values.tin},
      review_status = 'edited', reviewed_by = ${who}, reviewed_at = now(), updated_at = now()
     where id = ${id}::uuid
  `.catch(async (e) => {
    if (!missingReviewColumns(e)) throw e;
    // Before 0047: save the correction anyway, without the review mark.
    await sql`
      update sales_invoices set
        customer = ${values.customer}, invoice_cash = ${values.cash}, invoice_credit = ${values.credit},
        qty = ${values.qty}, products = ${sql.json(products)}, bank = ${values.bank}, updated_at = now()
       where id = ${id}::uuid
    `;
  });
  await linkCustomerTin(id).catch((e) => console.error("TIN back-fill skipped:", e));
}
