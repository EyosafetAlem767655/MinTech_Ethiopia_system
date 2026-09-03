import sql from "@/lib/sql";
import {
  BAG_KINDS,
  BAG_KIND_KEYS,
  bagKindCount,
  bagLabel,
  bagLedgerKey,
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
 * Reconciled per bag KIND — all six, colour included.
 *
 * The colours carry different unit prices and are packed separately, so a gap
 * that names only the size cannot say what it is worth or which pallet to go and
 * look at. The opening balance, both voucher ledgers and production's daily
 * count are all keyed on the same `bagLedgerKey` string, which is what lets the
 * four line up at all.
 */
export interface BagReconciliation {
  key: string;
  size: BagSize;
  colour: string;
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

  // All four sources key on the same string, which is the only reason they can
  // be lined up: the opening balance writes `bag:kg25:Yellow` into its jsonb,
  // both voucher ledgers write `kg25:Yellow`, and production's count nests the
  // colour under the size. `bagLedgerKey` is the single spelling they share.
  const baseMap = (base[0]?.bags || {}) as Record<string, number>;
  const received: Record<string, number> = Object.fromEntries(BAG_KIND_KEYS.map((k) => [k, 0]));
  const issued: Record<string, number> = Object.fromEntries(BAG_KIND_KEYS.map((k) => [k, 0]));

  for (const row of grvLines) {
    if (row.ledger_key in received) received[row.ledger_key] += n(row.qty);
  }
  for (const row of sivLines) {
    if (row.ledger_key in issued) issued[row.ledger_key] += n(row.qty);
  }

  const countRow = latestCount[0];

  const rows: BagReconciliation[] = BAG_KINDS.map(({ size, colour }) => {
    const key = bagLedgerKey(size, colour);
    const baseBalance = n(baseMap[key]);
    const expected = baseBalance + received[key] - issued[key];
    const counted = countRow ? bagKindCount(countRow.bags, size, colour) : null;
    return {
      key,
      size,
      colour,
      label: `${bagLabel(size, colour)} PP`,
      baseBalance,
      received: received[key],
      issued: issued[key],
      expected,
      counted,
      gap: counted === null ? null : counted - expected,
    };
  });

  return {
    month,
    countedOn: countRow?.date_label ?? null,
    rows,
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
