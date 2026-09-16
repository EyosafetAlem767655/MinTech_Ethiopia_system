import { DELIVERY_PRODUCTS, PRODUCT_ORDER, productLabel } from "@/lib/products";
import { BANKS, BANK_OTHER, matchBank } from "@/lib/banks";

/**
 * One sale, as the sales sheet records it.
 *
 * Date · Deliver to · Invoice in cash · Invoice in credit · Invoice qty · Deli ·
 * one tonnage per brand · Bank. The bot fills this receipt-first: the photos are
 * read, whatever the model could not read is asked for as ONE fill-in block, and
 * the whole row is corrected on the review card before it is saved.
 *
 * Pure by design — no `sql`, no network — so the template, the parser and the
 * merge are testable on their own, the same way production-paste.ts is.
 */

/* ───────────────────────────── Draft keys ────────────────────────────────── */

export const SALES_KEYS = {
  customer: "customer",
  invoiceCash: "invoiceCash",
  invoiceCredit: "invoiceCredit",
  deliveryNo: "deliveryNo",
  bank: "bank",
  /** The typed name, only when `bank` is "Other". */
  bankOther: "bankOther",
} as const;

/** Same prefix as the delivery report, so `draftKeyLabel` already reads it. */
export const SALES_PRODUCT_PREFIX = "prod:";

export const salesProductKey = (code: string) => `${SALES_PRODUCT_PREFIX}${code}`;

/** Total tonnes — the sum of the brand columns, never typed. */
export function salesQty(draft: Record<string, string | number>): number {
  const sum = DELIVERY_PRODUCTS.reduce((a, code) => a + (Number(draft[salesProductKey(code)]) || 0), 0);
  return Math.round(sum * 1000) / 1000;
}

/** The bank as it is stored: the list entry, or the typed name behind "Other". */
export function salesBank(draft: Record<string, string | number>): string | null {
  const bank = String(draft[SALES_KEYS.bank] || "").trim();
  if (!bank) return null;
  if (bank === BANK_OTHER) return String(draft[SALES_KEYS.bankOther] || "").trim() || BANK_OTHER;
  return bank;
}

/* ───────────────────────────── The template ──────────────────────────────── */

// Sheet wording, deliberately: the person filling this in has the paper form in
// front of them and copies its headings.
const L_CUSTOMER = "Deliver to";
const L_CASH = "Invoice cash";
const L_CREDIT = "Invoice credit";
const L_DELI = "Deli";
const L_BANK = "Bank";
const H_BRANDS = "--- Brands (Ton) ---";

const answered = (draft: Record<string, string | number>, key: string) => {
  const v = draft[key];
  return v !== undefined && v !== "";
};

/**
 * The fill-in block for whatever the receipts did not answer.
 *
 * ONLY the missing lines. After a good read this is two or three lines — the
 * bank and a delivery number, typically — and a template that re-listed every
 * brand the model had already filled would invite retyping figures that were
 * right, or blanking them by accident.
 *
 * Empty string when nothing is missing: the caller goes straight to review.
 */
export function salesTemplate(draft: Record<string, string | number> = {}): string {
  const lines: string[] = [];
  if (!answered(draft, SALES_KEYS.customer)) lines.push(`${L_CUSTOMER}=`);
  if (!answered(draft, SALES_KEYS.invoiceCash)) lines.push(`${L_CASH}=`);
  if (!answered(draft, SALES_KEYS.invoiceCredit)) lines.push(`${L_CREDIT}=`);
  if (!answered(draft, SALES_KEYS.deliveryNo)) lines.push(`${L_DELI}=`);

  const brands = DELIVERY_PRODUCTS.filter((code) => !answered(draft, salesProductKey(code)));
  if (brands.length > 0) {
    lines.push(H_BRANDS);
    for (const code of brands) lines.push(`${productLabel(code)}=`);
  }

  if (!answered(draft, SALES_KEYS.bank)) lines.push(`${L_BANK}=`);
  return lines.join("\n");
}

/** Which of the flow's fields are still unanswered — for the "N missing" note. */
export function salesMissing(draft: Record<string, string | number>): string[] {
  const out: string[] = [];
  if (!answered(draft, SALES_KEYS.customer)) out.push(L_CUSTOMER);
  if (!answered(draft, SALES_KEYS.invoiceCash)) out.push(L_CASH);
  if (!answered(draft, SALES_KEYS.invoiceCredit)) out.push(L_CREDIT);
  if (!answered(draft, SALES_KEYS.deliveryNo)) out.push(L_DELI);
  for (const code of DELIVERY_PRODUCTS) if (!answered(draft, salesProductKey(code))) out.push(productLabel(code));
  if (!answered(draft, SALES_KEYS.bank)) out.push(L_BANK);
  return out;
}

/* ─────────────────────────────── Parsing ─────────────────────────────────── */

/** Loose key match: case, spaces, hyphens, dots and underscores are noise. */
const norm = (s: string) => String(s || "").toLowerCase().replace(/[\s\-_.]/g, "");

/** Every spelling of a column heading → the draft key it fills. */
const FIELD_LOOKUP: Map<string, string> = (() => {
  const m = new Map<string, string>();
  const add = (key: string, ...names: string[]) => names.forEach((n) => m.set(norm(n), key));
  add(SALES_KEYS.customer, L_CUSTOMER, "customer", "client", "deliverto", "ደንበኛ");
  add(SALES_KEYS.invoiceCash, L_CASH, "cash", "invoice in cash", "ጥሬ ገንዘብ");
  add(SALES_KEYS.invoiceCredit, L_CREDIT, "credit", "invoice in credit", "ብድር", "ዱቤ");
  add(SALES_KEYS.deliveryNo, L_DELI, "delivery", "delivery no", "deli no", "deli.");
  add(SALES_KEYS.bank, L_BANK, "bank name", "ባንክ");
  for (const code of PRODUCT_ORDER) add(salesProductKey(code), code, productLabel(code));
  return m;
})();

const isProductKey = (key: string) => key.startsWith(SALES_PRODUCT_PREFIX);
const isMoneyKey = (key: string) => key === SALES_KEYS.invoiceCash || key === SALES_KEYS.invoiceCredit;

function parseNumber(raw: string): number | null {
  const cleaned = raw.replace(/,/g, "").replace(/\s*(etb|birr|ብር|t|ton|tons)\s*$/i, "").trim();
  if (!cleaned) return null;
  if (!/^-?\d*\.?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return isFinite(n) ? n : null;
}

export interface ParsedSalesPaste {
  /** Draft keys → values, ready to merge into the flow draft. */
  values: Record<string, string | number>;
  /** Lines that looked like data but matched no known column. */
  unknown: string[];
  /** Lines whose value could not be read (a non-number, an unknown bank). */
  invalid: string[];
}

/**
 * Read a filled-in block back.
 *
 * Blank rules follow what a blank plainly means on this sheet: a brand or a
 * money line left empty is ZERO (nothing of that brand, nothing on credit); a
 * blank customer, delivery number or bank is simply not answered, and the flow
 * asks for it — "nobody" is not a customer and "" is not a bank.
 *
 * A bank is accepted only if it matches the fixed list. Anything else is
 * reported as invalid and the choice step asks with buttons, which is where
 * "Other" can be picked deliberately rather than arrived at by a typo.
 */
export function parseSalesPaste(text: string): ParsedSalesPaste {
  const values: Record<string, string | number> = {};
  const unknown: string[] = [];
  const invalid: string[] = [];

  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^[-—#>/(]/.test(line)) continue; // headers, guidance
    const m = line.match(/^([^=:]+)[=:](.*)$/);
    if (!m) continue;
    const key = FIELD_LOOKUP.get(norm(m[1]));
    // "-" is how every other step spells "none"; here it reads as blank.
    const value = /^(-+|none|n\/a|የለም)$/i.test(m[2].trim()) ? "" : m[2].trim();
    if (!key) {
      unknown.push(line);
      continue;
    }

    if (isProductKey(key) || isMoneyKey(key)) {
      if (!value) {
        values[key] = 0;
        continue;
      }
      const n = parseNumber(value);
      if (n === null || n < 0) invalid.push(line);
      else values[key] = n;
      continue;
    }

    if (!value) continue;

    if (key === SALES_KEYS.bank) {
      const bank = matchBank(value);
      if (!bank) {
        invalid.push(line);
        continue;
      }
      values[key] = bank;
      // A name that only matched "Other" carries no bank of its own; the typed
      // text is kept so the row still says which bank it was.
      if (bank === BANK_OTHER && norm(value) !== norm(BANK_OTHER)) values[SALES_KEYS.bankOther] = value;
      continue;
    }

    values[key] = value;
  }

  return { values, unknown, invalid };
}

/* ───────────────────── Receipt extraction → draft ────────────────────────── */

/** What the model reads off one transaction's receipts. */
export interface SalesInvoiceRead {
  customer: string;
  invoiceCash: number;
  invoiceCredit: number;
  deliveryNo: string;
  /** Tonnes per product CODE (ETL15, 3EL, …). Only known codes are kept. */
  products: Record<string, number>;
  /** Bank as printed; matched onto the list here, not by the model. */
  bank: string;
  confidence: number; // 0-100
  notes: string;
}

/**
 * Merge a read into the draft, touching only what is still unanswered.
 *
 * The same safety property as the voucher merge: a field the reporter has
 * already typed is never overwritten, and a value the model returned nothing
 * for stays unanswered so it is asked — never recorded as a confident zero.
 *
 * Brands are the one exception, and a deliberate one. A receipt names the
 * brands sold, not the eight it did not; once the model has read at least one
 * tonnage, the others ARE zero for this sale, and asking the reporter to type
 * eight zeros is the tedium this flow exists to remove. They are filled as 0 and
 * NOT marked as read — the card only lists brands above zero, so a misread
 * brand shows up as a missing line to correct, not as a plausible figure.
 *
 * Returns the keys the model actually supplied, for the 🤖 marks on the card.
 */
export function applySalesExtraction(
  draft: Record<string, string | number>,
  read: SalesInvoiceRead
): { filled: string[] } {
  const filled: string[] = [];
  const put = (key: string, value: string | number) => {
    if (answered(draft, key)) return;
    draft[key] = value;
    filled.push(key);
  };

  if (read.customer.trim()) put(SALES_KEYS.customer, read.customer.trim());
  if (read.invoiceCash > 0) put(SALES_KEYS.invoiceCash, read.invoiceCash);
  if (read.invoiceCredit > 0) put(SALES_KEYS.invoiceCredit, read.invoiceCredit);
  // One of the two was read: the other is zero for this sale, not unknown. A
  // cash receipt with no credit line is the ordinary case, not a gap to ask about.
  if (read.invoiceCash > 0 && !answered(draft, SALES_KEYS.invoiceCredit)) draft[SALES_KEYS.invoiceCredit] = 0;
  if (read.invoiceCredit > 0 && !answered(draft, SALES_KEYS.invoiceCash)) draft[SALES_KEYS.invoiceCash] = 0;
  if (read.deliveryNo.trim()) put(SALES_KEYS.deliveryNo, read.deliveryNo.trim());

  let anyBrand = false;
  for (const code of DELIVERY_PRODUCTS) {
    const t = Number(read.products?.[code]) || 0;
    if (t > 0) {
      put(salesProductKey(code), Math.round(t * 1000) / 1000);
      anyBrand = true;
    }
  }
  if (anyBrand) {
    for (const code of DELIVERY_PRODUCTS) {
      if (!answered(draft, salesProductKey(code))) draft[salesProductKey(code)] = 0;
    }
  }

  const bank = read.bank.trim() ? matchBank(read.bank) : null;
  if (bank && bank !== BANK_OTHER) put(SALES_KEYS.bank, bank);

  return { filled };
}

/** The choice list for the bank step. */
export function bankChoices(): { label: string; value: string }[] {
  return BANKS.map((b) => ({ label: b === BANK_OTHER ? "➕ ሌላ (Other)" : `🏦 ${b}`, value: b }));
}
