import { DELIVERY_PRODUCTS, PRODUCT_ORDER, productLabel } from "@/lib/products";
import { BANKS, BANK_OTHER, matchBank } from "@/lib/banks";

/**
 * One sale, as the sales sheet records it.
 *
 * Date · Deliver to · TIN · Invoice in cash · Invoice in credit · Invoice qty ·
 * one tonnage per brand · Bank(s). "Deli" was dropped from the sheet; old rows
 * keep theirs in `delivery_no`. The bot fills this receipt-first: the photos are
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
  /** The buyer's TIN — 10 digits, or "none" when the receipt has none. */
  tin: "tin",
  /** Kept for drafts started before Deli was dropped; no step asks for it. */
  deliveryNo: "deliveryNo",
  /** One bank, or several comma-joined — the tick-list's answer. */
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

/** What a single bank received, when a sale was paid into more than one. */
export const salesBankAmountKey = (bank: string) => `bankAmt:${bank}`;

/** The banks ticked, in list order. */
export function salesBanksTicked(draft: Record<string, string | number>): string[] {
  const chosen = String(draft[SALES_KEYS.bank] || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return BANKS.filter((b) => chosen.includes(b));
}

/** Several banks: each needs its own amount. One bank simply takes the cash. */
export const needsBankAmounts = (draft: Record<string, string | number>) => salesBanksTicked(draft).length > 1;

/** A bank as it is stored: the list entry, or the typed name behind "Other". */
const bankName = (draft: Record<string, string | number>, bank: string) =>
  bank === BANK_OTHER ? String(draft[SALES_KEYS.bankOther] || "").trim() || BANK_OTHER : bank;

/**
 * Where the sale's money went: one entry per bank.
 *
 * A single bank received the whole cash invoice. Several banks each carry the
 * amount on their own slip — the per-bank cash report adds these up, and
 * crediting the whole sale to each of them would count it twice.
 */
export function salesBanks(draft: Record<string, string | number>): { bank: string; amount: number }[] {
  const ticked = salesBanksTicked(draft);
  if (ticked.length === 0) return [];
  if (ticked.length === 1) {
    return [{ bank: bankName(draft, ticked[0]), amount: Number(draft[SALES_KEYS.invoiceCash]) || 0 }];
  }
  return ticked.map((b) => ({ bank: bankName(draft, b), amount: Number(draft[salesBankAmountKey(b)]) || 0 }));
}

/** The bank column as older readers expect it: "CBE + Awash". */
export function salesBank(draft: Record<string, string | number>): string | null {
  const list = salesBanks(draft);
  return list.length ? list.map((b) => b.bank).join(" + ") : null;
}

/** The TIN to store, or null when the receipt carried none. */
export function salesTin(draft: Record<string, string | number>): string | null {
  const v = String(draft[SALES_KEYS.tin] || "").trim();
  return /^\d{10}$/.test(v) ? v : null;
}

/**
 * An Ethiopian TIN: exactly ten digits. Spaces and dashes as printed are
 * dropped. "-" / "none" means the receipt has no TIN, which is an answer.
 */
export function normaliseTin(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const t = String(raw || "").trim();
  if (/^(-+|none|no|n\/a|የለም)$/i.test(t)) return { ok: true, value: "none" };
  const digits = t.replace(/[\s\-.]/g, "");
  if (/^\d{10}$/.test(digits)) return { ok: true, value: digits };
  return { ok: false, error: '⚠️ TIN 10 አሃዝ መሆን አለበት (ለምሳሌ 0012345678)። ከሌለ "-" ይላኩ።' };
}

/* ───────────────────────────── The template ──────────────────────────────── */

// Sheet wording, deliberately: the person filling this in has the paper form in
// front of them and copies its headings.
const L_CUSTOMER = "Deliver to";
const L_CASH = "Invoice cash";
const L_CREDIT = "Invoice credit";
const L_TIN = "TIN";
const bankAmountLabel = (bank: string) => `${bank} amount`;
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
  if (!answered(draft, SALES_KEYS.tin)) lines.push(`${L_TIN}=`);

  const brands = DELIVERY_PRODUCTS.filter((code) => !answered(draft, salesProductKey(code)));
  if (brands.length > 0) {
    lines.push(H_BRANDS);
    for (const code of brands) lines.push(`${productLabel(code)}=`);
  }

  if (!answered(draft, SALES_KEYS.bank)) lines.push(`${L_BANK}=`);
  if (needsBankAmounts(draft)) {
    for (const b of salesBanksTicked(draft)) {
      if (!answered(draft, salesBankAmountKey(b))) lines.push(`${bankAmountLabel(b)}=`);
    }
  }
  return lines.join("\n");
}

/** Which of the flow's fields are still unanswered — for the "N missing" note. */
export function salesMissing(draft: Record<string, string | number>): string[] {
  const out: string[] = [];
  if (!answered(draft, SALES_KEYS.customer)) out.push(L_CUSTOMER);
  if (!answered(draft, SALES_KEYS.invoiceCash)) out.push(L_CASH);
  if (!answered(draft, SALES_KEYS.invoiceCredit)) out.push(L_CREDIT);
  if (!answered(draft, SALES_KEYS.tin)) out.push(L_TIN);
  for (const code of DELIVERY_PRODUCTS) if (!answered(draft, salesProductKey(code))) out.push(productLabel(code));
  if (!answered(draft, SALES_KEYS.bank)) out.push(L_BANK);
  if (needsBankAmounts(draft)) {
    for (const b of salesBanksTicked(draft)) if (!answered(draft, salesBankAmountKey(b))) out.push(bankAmountLabel(b));
  }
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
  add(SALES_KEYS.tin, L_TIN, "tin no", "tin number", "buyer tin", "customer tin", "ቲን");
  add(SALES_KEYS.bank, L_BANK, "banks", "bank name", "ባንክ");
  for (const b of BANKS) add(salesBankAmountKey(b), bankAmountLabel(b));
  for (const code of PRODUCT_ORDER) add(salesProductKey(code), code, productLabel(code));
  return m;
})();

const isProductKey = (key: string) => key.startsWith(SALES_PRODUCT_PREFIX);
const isMoneyKey = (key: string) =>
  key === SALES_KEYS.invoiceCash || key === SALES_KEYS.invoiceCredit || key.startsWith("bankAmt:");

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

    if (key === SALES_KEYS.tin) {
      const tin = normaliseTin(value);
      if (tin.ok) values[key] = tin.value;
      else invalid.push(line);
      continue;
    }

    if (key === SALES_KEYS.bank) {
      // Several banks may be listed: "CBE, Awash" or "CBE + Awash".
      const banks: string[] = [];
      let bad = false;
      for (const piece of value.split(/\s*[,+&]\s*|\s+and\s+/i).filter(Boolean)) {
        const bank = matchBank(piece);
        if (!bank) {
          bad = true;
          break;
        }
        if (!banks.includes(bank)) banks.push(bank);
        // A name that only matched "Other" carries no bank of its own; the typed
        // text is kept so the row still says which bank it was.
        if (bank === BANK_OTHER && norm(piece) !== norm(BANK_OTHER)) values[SALES_KEYS.bankOther] = piece;
      }
      if (bad || banks.length === 0) {
        invalid.push(line);
        continue;
      }
      values[key] = banks.join(",");
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
  /** The buyer's TIN as printed, "" if none. */
  tin: string;
  /** Tonnes per product CODE (ETL15, 3EL, …). Only known codes are kept. */
  products: Record<string, number>;
  /** One entry per bank slip; names matched onto the list here, not by the model. */
  banks: { bank: string; amount: number }[];
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
  if (read.tin.trim()) {
    const tin = normaliseTin(read.tin);
    if (tin.ok && tin.value !== "none") put(SALES_KEYS.tin, tin.value);
  }

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

  // Every slip whose bank is on the list. An unmatched name is left for the
  // person to pick rather than guessed.
  const merged = new Map<string, number>();
  for (const slip of read.banks || []) {
    const bank = String(slip.bank || "").trim() ? matchBank(slip.bank) : null;
    if (!bank || bank === BANK_OTHER) continue;
    merged.set(bank, (merged.get(bank) ?? 0) + (Number(slip.amount) || 0));
  }
  if (merged.size > 0 && !answered(draft, SALES_KEYS.bank)) {
    put(SALES_KEYS.bank, BANKS.filter((b) => merged.has(b)).join(","));
    if (merged.size > 1) {
      for (const [bank, amount] of merged) {
        if (amount > 0) put(salesBankAmountKey(bank), Math.round(amount * 100) / 100);
      }
    }
  }

  return { filled };
}

/** The choice list for the bank step. */
export function bankChoices(): { label: string; value: string }[] {
  return BANKS.map((b) => ({ label: b === BANK_OTHER ? "➕ ሌላ (Other)" : `🏦 ${b}`, value: b }));
}
