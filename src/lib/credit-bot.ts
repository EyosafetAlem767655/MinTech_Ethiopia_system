import sql from "@/lib/sql";
import { creditFigures } from "@/lib/credit";
import { withSalesFallback } from "@/lib/sales-sql";

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
  /** The buyer's TIN when recorded — the customer's identity. */
  tin?: string | null;
  /** "YYYY-MM-DD", the sale date. */
  date: string;
  outstanding: number;
  daysLeft: number;
  status: string;
}

/** Every invoice with money still owed on it, newest first. */
export async function openCreditInvoices(now = new Date()): Promise<OpenInvoice[]> {
  const rows = await withSalesFallback((legacy) => sql<
    { id: string; customer: string; tin: string | null; date: string; credit: string; paid: string }[]
  >`
    select i.id, i.customer, ${legacy ? sql`null::text` : sql`i.tin`} as tin, i.date, i.invoice_credit as credit,
           coalesce((select sum(p.amount) from sales_credit_payments p where p.invoice_id = i.id), 0) as paid
      from sales_invoices i
     where i.invoice_credit > 0
     order by i.date desc
     limit 300
  `);

  return rows
    .map((r) => {
      const f = creditFigures(
        { date: r.date, invoiceCredit: Number(r.credit) || 0, paid: Number(r.paid) || 0 },
        now
      );
      return {
        id: String(r.id),
        customer: String(r.customer || "").trim(),
        tin: r.tin ?? null,
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

/**
 * Who a sale belongs to: the TIN where recorded, else the name with case and
 * spacing ignored — the same identity the Sales tab groups by.
 */
export const customerIdentity = (r: Pick<OpenInvoice, "customer" | "tin">) =>
  r.tin ? `tin:${r.tin}` : `name:${r.customer.toLowerCase().replace(/\s+/g, " ").trim()}`;

/**
 * The customers with something outstanding — the NAME only, each once, most
 * owed first. What they owe is shown after they are picked, on the card, where
 * it is worked out against the payment; the list itself is just who.
 *
 * Two different buyers with the same name are told apart by their TIN's last
 * digits, since the person picks by the label.
 */
export function customerChoices(draft: Record<string, string | number>) {
  const byCustomer = new Map<string, { name: string; tin: string | null; total: number }>();
  for (const r of decodeInvoices(draft)) {
    const id = customerIdentity(r);
    const seen = byCustomer.get(id) ?? { name: r.customer, tin: r.tin ?? null, total: 0 };
    byCustomer.set(id, { ...seen, total: seen.total + r.outstanding });
  }
  const list = [...byCustomer.entries()].sort((a, b) => b[1].total - a[1].total);
  const nameCount = new Map<string, number>();
  for (const [, v] of list) nameCount.set(v.name.toLowerCase(), (nameCount.get(v.name.toLowerCase()) ?? 0) + 1);
  return list.map(([id, v]) => ({
    label: nameCount.get(v.name.toLowerCase())! > 1 && v.tin ? `${v.name} (TIN …${v.tin.slice(-4)})` : v.name,
    value: id,
  }));
}

/**
 * The open sales of the customer picked. A draft from before the change holds
 * the plain name as `customer`, and still finds its sales.
 */
export function invoicesFor(draft: Record<string, string | number>): OpenInvoice[] {
  const picked = String(draft.customer || "");
  return decodeInvoices(draft).filter((r) => customerIdentity(r) === picked || r.customer === picked);
}

/** The customer's name, for the card. */
export function chosenCustomerName(draft: Record<string, string | number>): string {
  return invoicesFor(draft)[0]?.customer || String(draft.customer || "").replace(/^(tin|name):/, "");
}

/** That customer's unpaid invoices, oldest first — the one most overdue leads. */
export function invoiceChoices(draft: Record<string, string | number>) {
  return invoicesFor(draft)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r) => ({
      label: `${r.date} · ${money(r.outstanding)} ${r.daysLeft < 0 ? `⚠️ ${-r.daysLeft}d late` : `${r.daysLeft}d`}`,
      value: r.id,
    }));
}

/**
 * The invoice a draft has settled on, or null. When the customer has only ONE
 * open sale the payment is for it — the "which sale?" question is not asked.
 */
export function chosenInvoice(draft: Record<string, string | number>): OpenInvoice | null {
  const id = String(draft.invoiceId || "");
  if (id) return decodeInvoices(draft).find((r) => r.id === id) ?? null;
  const open = invoicesFor(draft);
  return open.length === 1 ? open[0] : null;
}
