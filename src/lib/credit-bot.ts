import sql from "@/lib/sql";
import { creditFigures } from "@/lib/credit";

/**
 * The credit sales a collection can be recorded against, for the bot.
 *
 * Reads the same two tables and runs the same `creditFigures` the Finance tab
 * and `/api/finance/credit` use — one arithmetic, three surfaces. A bot that
 * computed "outstanding" its own way would eventually disagree with the screen
 * the money is reconciled on, and nobody would know which to believe.
 *
 * The list is seeded into the flow draft when the flow starts, because the step
 * tables are static and these choices are whatever is unpaid right now.
 */

export interface OpenInvoice {
  id: string;
  customer: string;
  /** "YYYY-MM-DD", the sale date. */
  date: string;
  outstanding: number;
  daysLeft: number;
  status: string;
}

/** Every invoice with money still owed on it, newest first. */
export async function openCreditInvoices(now = new Date()): Promise<OpenInvoice[]> {
  const rows = await sql<
    { id: string; customer: string; date: string; credit: string; paid: string }[]
  >`
    select i.id, i.customer, i.date, i.invoice_credit as credit,
           coalesce((select sum(p.amount) from sales_credit_payments p where p.invoice_id = i.id), 0) as paid
      from sales_invoices i
     where i.invoice_credit > 0
     order by i.date desc
     limit 300
  `;

  return rows
    .map((r) => {
      const f = creditFigures(
        { date: r.date, invoiceCredit: Number(r.credit) || 0, paid: Number(r.paid) || 0 },
        now
      );
      return {
        id: String(r.id),
        customer: String(r.customer || "").trim(),
        date: new Date(r.date).toISOString().slice(0, 10),
        outstanding: f.outstanding,
        daysLeft: f.daysLeft,
        status: f.status,
      };
    })
    // Settled invoices are not choices. `creditFigures` already applies the
    // one-birr tolerance, so an account cleared to within a few cents drops off
    // here rather than sitting in the list forever.
    .filter((r) => r.status !== "settled" && r.outstanding > 0);
}

/* ─────────────────── carrying the list through the flow ───────────────────── */

/**
 * The draft key the seeded list lives under.
 *
 * Serialised rather than held in a side table: the draft is what survives a
 * session being persisted between messages, and everything else in this system
 * answers a step by writing a string into it.
 */
export const INVOICES_KEY = "_invoices";

export function encodeInvoices(rows: OpenInvoice[]): string {
  return JSON.stringify(rows);
}

export function decodeInvoices(draft: Record<string, string | number>): OpenInvoice[] {
  try {
    const raw = draft[INVOICES_KEY];
    const parsed = typeof raw === "string" && raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as OpenInvoice[]) : [];
  } catch {
    // A corrupt draft must not break the flow — it falls back to no choices,
    // which the step reports as "nothing is outstanding" rather than crashing.
    return [];
  }
}

const money = (n: number) => Math.round(n).toLocaleString("en-US");

/** The customers with something outstanding, each once, most owed first. */
export function customerChoices(draft: Record<string, string | number>) {
  const byCustomer = new Map<string, { total: number; count: number }>();
  for (const r of decodeInvoices(draft)) {
    const seen = byCustomer.get(r.customer) ?? { total: 0, count: 0 };
    byCustomer.set(r.customer, { total: seen.total + r.outstanding, count: seen.count + 1 });
  }
  return [...byCustomer.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([customer, v]) => ({
      label: `${customer} · ${money(v.total)}${v.count > 1 ? ` (${v.count})` : ""}`,
      value: customer,
    }));
}

/** That customer's unpaid invoices, oldest first — the one most overdue leads. */
export function invoiceChoices(draft: Record<string, string | number>) {
  const customer = String(draft.customer || "");
  return decodeInvoices(draft)
    .filter((r) => r.customer === customer)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r) => ({
      label: `${r.date} · ${money(r.outstanding)} ${r.daysLeft < 0 ? `⚠️ ${-r.daysLeft}d late` : `${r.daysLeft}d`}`,
      value: r.id,
    }));
}

/** The invoice a draft has settled on, or null. */
export function chosenInvoice(draft: Record<string, string | number>): OpenInvoice | null {
  const id = String(draft.invoiceId || "");
  return decodeInvoices(draft).find((r) => r.id === id) ?? null;
}
