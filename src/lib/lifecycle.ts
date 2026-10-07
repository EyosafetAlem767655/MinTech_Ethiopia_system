import sql from "@/lib/sql";
import { ARCHIVE_TABLES } from "@/lib/archive";

/**
 * How long things stay in this database, and what moves to the Neon archive.
 *
 * The owner's policy (7 Oct 2026):
 *   - production, asset, sales and finance records stay here for 12 FULL
 *     months, then move to a permanent archive in Neon, once a quarter;
 *   - logs (bot activity, chat usage, resolved errors, job runs) stay 3 months;
 *   - photos are deleted 3 months after the thing they evidence is decided
 *     (src/lib/storage.ts — they do not go to the archive).
 *
 * This module is the ONE statement of that policy. The quarterly job
 * (scripts/archive-to-neon.ts) moves exactly what `moveRules` says, and the
 * System Admin view counts exactly the same thing when it says what the next
 * run would move — so the reminder can never promise something the job then
 * does differently.
 *
 * Twelve months, not six, because the dashboard's longest window is a year:
 * moving anything younger would quietly make every "Yearly" view, the AI
 * chat's 365-day answers and "have we bought this before?" wrong.
 */

export const STATS_KEEP_MONTHS = 12;
export const LOG_KEEP_MONTHS = 3;

/** Quarterly runs: 1 January, April, July, October (UTC). */
export const QUARTER_MONTHS = [0, 3, 6, 9];

/**
 * Rows dated before this moves: the first day of the month `keep` months before
 * the run month. Cut on a month boundary so no month is ever half here and half
 * in the archive — a finance month split in two would show half its figures.
 */
export function cutoffFor(now: Date, keepMonths: number): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - keepMonths, 1));
}

/** The next quarterly run at or after `now` (a date, UTC midnight). */
export function nextQuarterlyRun(now = new Date()): Date {
  const y = now.getUTCFullYear();
  for (const add of [0, 1]) {
    for (const m of QUARTER_MONTHS) {
      const d = new Date(Date.UTC(y + add, m, 1));
      if (d.getTime() >= Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) return d;
    }
  }
  return new Date(Date.UTC(y + 1, 0, 1));
}

/** Whole days from today (UTC) to `d`. */
export function daysUntil(d: Date, now = new Date()): number {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((d.getTime() - today) / 86400000);
}

export interface MoveRule {
  table: string;
  /** SQL expression for the row's date, on alias `t`. */
  dateExpr: string;
  keepMonths: number;
  /**
   * SQL predicate (alias `t`) for rows that STAY whatever their age.
   *
   * Each one exists because moving the row would change a figure on today's
   * dashboard: an unpaid invoice is still owed, a lot with bags left is still
   * being drawn from, an undecided request still needs deciding.
   */
  keepWhere?: string;
}

/** Live state and identity — never moved, whatever their age. */
const NEVER_MOVE = new Set([
  "telegram_sessions", // a bot conversation in progress
  "telegram_updates", // the redelivery guard; already cleared daily
  "stored_files", // photo records; photos have their own rule in storage.ts
]);

const LOG_TABLES = new Set(["bot_activity", "ai_chat_usage", "system_errors", "system_jobs"]);

/** Tables whose rows belong to a MONTH (a 'YYYY-MM' text column), not a day. */
const MONTH_KEYED: Record<string, string> = {
  monthly_base_balances: "month",
  monthly_price_lists: "month",
};

/** Lots with bags still in them, from the same view every balance reads. */
const LOTS_IN_STOCK = `(select lot_id from v_lot_balances where in_stock > 0)`;

const KEEP_WHERE: Record<string, string> = {
  // Still owed: credit less every payment against it, beyond the one-birr
  // tolerance the Credit tab uses (SETTLED_TOLERANCE_ETB in credit.ts).
  sales_invoices:
    `t.invoice_credit > 0 and t.invoice_credit - coalesce(` +
    `(select sum(p.amount) from sales_credit_payments p where p.invoice_id = t.id), 0) > 1`,
  // A lot's balance is the sum of its whole history; moving a lot that still
  // has stock — or the claims against it — would change today's figures.
  bag_lots: `t.id in ${LOTS_IN_STOCK}`,
  damage_claims: `(to_jsonb(t)->>'status') in ('pending', 'cosign_required') or t.lot_id in ${LOTS_IN_STOCK}`,
  // Undecided work stays where the people deciding it can see it.
  purchase_requests: `(to_jsonb(t)->>'status') in ('pending', 'deferred')`,
  pp_bag_damage_reports: `coalesce(to_jsonb(t)->>'status', 'pending') = 'pending'`,
  wht_holders: `(to_jsonb(t)->>'status') = 'pending'`,
  // Unresolved errors are open work, not history.
  system_errors: `t.resolved_at is null`,
  // The archive runs are the record of what moved where; they stay.
  system_jobs: `t.job = 'archive'`,
};

/**
 * Every table the quarterly move touches, and how.
 *
 * Derived from ARCHIVE_TABLES (src/lib/archive.ts), which is itself derived
 * from the submissions registry — so a new report type is covered without
 * anyone remembering to add it here. Child tables (voucher lines, lot events,
 * payments) are not listed: the job finds them by their foreign keys and moves
 * them WITH their parent, never on their own.
 */
export function moveRules(): MoveRule[] {
  const rules: MoveRule[] = [];
  const seen = new Set<string>();
  for (const t of ARCHIVE_TABLES) {
    if (t.parent || NEVER_MOVE.has(t.table) || seen.has(t.table)) continue;
    seen.add(t.table);
    const monthCol = MONTH_KEYED[t.table];
    rules.push({
      table: t.table,
      dateExpr: monthCol ? `to_date(t.${monthCol}, 'YYYY-MM')` : `t.${t.dateColumn}`,
      keepMonths: LOG_TABLES.has(t.table) ? LOG_KEEP_MONTHS : STATS_KEEP_MONTHS,
      keepWhere: KEEP_WHERE[t.table],
    });
  }
  // The job log is not in the export registry, but it is a log like the others.
  if (!seen.has("system_jobs")) {
    rules.push({ table: "system_jobs", dateExpr: "t.started_at", keepMonths: LOG_KEEP_MONTHS, keepWhere: KEEP_WHERE.system_jobs });
  }
  return rules;
}

/** The WHERE clause selecting a rule's movable rows, for `cutoff` as $1. */
export function movableWhere(rule: MoveRule): string {
  return `${rule.dateExpr} < $1` + (rule.keepWhere ? ` and not (${rule.keepWhere})` : "");
}

/**
 * What a run at `now` would move, per table — the dry run behind the reminder
 * and the System Admin "Archive" view. Tables missing from this database (a
 * migration behind) are skipped, not fatal.
 */
export async function countMovable(now = new Date()): Promise<{ table: string; rows: number }[]> {
  const out: { table: string; rows: number }[] = [];
  for (const rule of moveRules()) {
    try {
      const [r] = await sql.unsafe<{ n: string }[]>(
        `select count(*) as n from ${quoteIdent(rule.table)} t where ${movableWhere(rule)}`,
        [cutoffFor(now, rule.keepMonths)]
      );
      const n = Number(r?.n) || 0;
      if (n > 0) out.push({ table: rule.table, rows: n });
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === "42P01" || code === "42703") continue;
      throw e;
    }
  }
  return out.sort((a, b) => b.rows - a.rows);
}

/** Identifiers here come from our own registry, but they are quoted all the same. */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
