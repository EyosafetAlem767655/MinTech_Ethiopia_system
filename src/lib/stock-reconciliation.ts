import sql from "@/lib/sql";
import {
  BAG_SIZES,
  BAG_SIZE_LABEL,
  bagSizeTotals,
  parseBagLedgerKey,
  type BagCounts,
  type BagSize,
} from "@/lib/products";
import { monthBounds, monthLabel } from "@/lib/finance-report";

/**
 * Does the floor agree with the paperwork?
 *
 * Three independent records touch the same PP bags, kept by three different
 * people who never see each other's numbers:
 *
 *   • asset management files the month's opening balance
 *   • finance files what was bought, on a Goods Receiving Voucher
 *   • the store files what was issued, on a Store Issue Voucher
 *   • production counts what is physically left, every day
 *
 * The first three predict the fourth. Where they disagree, something happened
 * that nobody wrote down — a delivery not filed, a voucher counted twice, bags
 * taken without a voucher, or a miscount. This module states the gap; it never
 * decides which side is wrong, because it cannot know.
 *
 * The counted figure is always recorded as reported. A cross-check that edits
 * the evidence to match the expectation is not a cross-check.
 */

/**
 * Reconciled per SIZE, not per colour.
 *
 * The monthly base balance is filed by size, so a per-colour expectation has no
 * opening figure to start from — it would be a number computed from a blank and
 * would flag a "gap" on day one of every month. Colour-level movement is real
 * and is shown alongside, it simply is not checked against a balance that does
 * not exist.
 */
export interface BagReconciliation {
  size: BagSize;
  label: string;
  baseBalance: number;
  received: number;
  issued: number;
  /** baseBalance + received − issued. */
  expected: number;
  /** The day's closing count from production, or null if nobody counted. */
  counted: number | null;
  /** counted − expected. Positive means more on the floor than the paper says. */
  gap: number | null;
}

export interface ReconciliationResult {
  month: string;
  /** The day the counted figures come from. */
  countedOn: string | null;
  rows: BagReconciliation[];
  /** Movement by bag kind, for context. Not checked against a balance. */
  byKind: { key: string; received: number; issued: number }[];
  /** Rows whose gap is worth raising. */
  discrepancies: BagReconciliation[];
}

/**
 * How large a gap has to be before it is reported, in pieces.
 *
 * Zero, deliberately: every difference is surfaced. If ordinary wastage makes
 * the exception list noisy, this is the single line to raise — but it should be
 * a decision someone takes knowingly, not a tolerance that quietly hides the
 * first real discrepancy anyone would have wanted to see.
 */
export const BAG_GAP_TOLERANCE = 0;

const n = (v: unknown) => Number(v) || 0;

/**
 * Reconcile the month to date.
 *
 * Every query is guarded: a table from an unapplied migration produces an empty
 * contribution rather than taking the dashboard down. A missing SOURCE is not
 * the same as a zero, though, which is why `counted` is null rather than 0 when
 * nobody counted — a gap against a count that was never taken is not a finding.
 */
export async function reconcileBags(month = monthLabel()): Promise<ReconciliationResult> {
  const { start, end } = monthBounds(month);

  const [base, grvLines, sivLines, latestCount] = await Promise.all([
    sql<{ bags: Record<string, number> }[]>`
      select bags from monthly_base_balances where month = ${month}
    `.catch(() => []),
    sql<{ ledger_key: string; qty: string }[]>`
      select i.ledger_key, sum(i.ledger_qty) as qty
        from goods_receiving_items i
        join goods_receiving_vouchers v on v.id = i.grv_id
       where v.date >= ${start} and v.date < ${end}
         and i.ledger_kind = 'bag' and i.ledger_key is not null
       group by i.ledger_key
    `.catch(() => []),
    sql<{ ledger_key: string; qty: string }[]>`
      select i.ledger_key, sum(i.ledger_qty) as qty
        from store_issue_items i
        join store_issue_vouchers v on v.id = i.siv_id
       where v.date >= ${start} and v.date < ${end}
         and i.ledger_kind = 'bag' and i.ledger_key is not null
       group by i.ledger_key
    `.catch(() => []),
    // The most recent day production actually counted bags. Not "today": a
    // count taken on the 3rd is still the latest word on the 4th, and treating
    // its absence as zero would invent a catastrophic shortfall every morning.
    sql<{ date_label: string; bags: BagCounts }[]>`
      select date_label, bags
        from daily_ops_reports
       where date >= ${start} and date < ${end}
         and bags is not null and bags::text <> '{}'
       order by date desc
       limit 1
    `.catch(() => []),
  ]);

  const baseBags = bagSizeTotals((base[0]?.bags || {}) as BagCounts);

  const received: Record<BagSize, number> = { kg25: 0, kg40: 0 };
  const issued: Record<BagSize, number> = { kg25: 0, kg40: 0 };
  const kindMap = new Map<string, { received: number; issued: number }>();

  const add = (key: string, qty: number, into: Record<BagSize, number>, field: "received" | "issued") => {
    const parsed = parseBagLedgerKey(key);
    if (!parsed) return;
    into[parsed.size] += qty;
    const entry = kindMap.get(key) || { received: 0, issued: 0 };
    entry[field] += qty;
    kindMap.set(key, entry);
  };

  for (const row of grvLines) add(row.ledger_key, n(row.qty), received, "received");
  for (const row of sivLines) add(row.ledger_key, n(row.qty), issued, "issued");

  const countRow = latestCount[0];
  const countedTotals = countRow ? bagSizeTotals(countRow.bags) : null;

  const rows: BagReconciliation[] = BAG_SIZES.map((size) => {
    const expected = baseBags[size] + received[size] - issued[size];
    const counted = countedTotals ? countedTotals[size] : null;
    return {
      size,
      label: `${BAG_SIZE_LABEL[size]} PP`,
      baseBalance: baseBags[size],
      received: received[size],
      issued: issued[size],
      expected,
      counted,
      gap: counted === null ? null : counted - expected,
    };
  });

  return {
    month,
    countedOn: countRow?.date_label ?? null,
    rows,
    byKind: [...kindMap.entries()].map(([key, v]) => ({ key, ...v })),
    // A null gap is "nobody counted", not "no discrepancy" — it must never
    // present as a clean reconciliation.
    discrepancies: rows.filter((r) => r.gap !== null && Math.abs(r.gap) > BAG_GAP_TOLERANCE),
  };
}

/** One line per discrepancy, for the exception list and the Telegram note. */
export function describeGap(row: BagReconciliation): string {
  const gap = row.gap ?? 0;
  const direction = gap > 0 ? "ተጨማሪ" : "ጉድለት";
  return (
    `${row.label}: በመጋዘን ${row.counted?.toLocaleString()} ተቆጥሯል፣ በሒሳብ ${row.expected.toLocaleString()} ` +
    `መሆን ነበረበት (${direction} ${Math.abs(gap).toLocaleString()})`
  );
}
