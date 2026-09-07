import { NextResponse } from "next/server";
import sql from "@/lib/sql";
import { reconcileBags } from "@/lib/stock-reconciliation";

export const dynamic = "force-dynamic";

/**
 * GET — both vouchers with their line items, plus the bag reconciliation.
 *
 * One endpoint for both because the panel shows them side by side and the
 * reconciliation is meaningless without both halves: goods in minus goods out is
 * the whole point.
 *
 * Every query is guarded. The voucher tables arrive in 0019, and a database one
 * migration behind must show an empty panel rather than a 500.
 */

/**
 * Run a voucher select, falling back to one without `tg_file_ids`.
 *
 * That column arrives in 0023 and holds the Telegram file ids of vouchers that
 * were never uploaded to storage. Selecting it unguarded would fail the whole
 * query with 42703 on a database one migration behind — and because a failed
 * query here becomes an empty panel, one missing column would blank the entire
 * Goods received section rather than hide a row of thumbnails. That is exactly
 * what "the bag counts don't show at all" turned out to be last time.
 */
async function selectVoucher(withTg: string, withoutTg: string): Promise<Record<string, unknown>[] | null> {
  try {
    return await sql.unsafe<Record<string, unknown>[]>(withTg);
  } catch (e) {
    if ((e as { code?: string })?.code !== "42703") return null;
    return await sql.unsafe<Record<string, unknown>[]>(withoutTg).catch(() => null);
  }
}

// Plain strings rather than tagged templates because the two variants differ by
// one column and `sql.unsafe` takes the finished text. Nothing here interpolates
// a value — every fragment is a literal in this file.
const GRV_SELECT = `
  select id as "_id", grv_no as "voucherNo", date, supplier,
         supplier_invoice_no as "supplierInvoiceNo", purchase_order_no as "purchaseOrderNo",
         receiving_store_no as "receivingStoreNo", currency, total_amount as "totalAmount",
         remarks, prepared_by as "preparedBy", received_by as "receivedBy",
         approved_by as "approvedBy", reported_by as "reportedBy",
         photo_file_ids as "photoFileIds", receipt_check as "receiptCheck",
         extraction, created_at as "createdAt"`;
const GRV_TAIL = ` from goods_receiving_vouchers order by date desc, created_at desc limit 120`;

const SIV_SELECT = `
  select id as "_id", siv_no as "voucherNo", date, issuing_store as "issuingStore",
         issued_to as "issuedTo", department_section as "departmentSection",
         store_requisition_no as "requisitionNo", remarks, issued_by as "issuedBy",
         approved_by as "approvedBy", received_by as "receivedBy",
         reported_by as "reportedBy", photo_file_ids as "photoFileIds",
         extraction, created_at as "createdAt"`;
const SIV_TAIL = ` from store_issue_vouchers order by date desc, created_at desc limit 120`;

const TG_COLUMN = `, tg_file_ids as "tgFileIds"`;

export async function GET() {
  const [grv, grvItems, siv, sivItems] = await Promise.all([
    selectVoucher(GRV_SELECT + TG_COLUMN + GRV_TAIL, GRV_SELECT + GRV_TAIL),
    sql<Record<string, unknown>[]>`
      select i.grv_id as "voucherId", i.position, i.stock_code as "stockCode", i.description,
             i.unit, i.quantity, i.unit_cost as "unitCost", i.total_amount as "totalAmount",
             i.ledger_kind as "ledgerKind", i.ledger_key as "ledgerKey", i.ledger_qty as "ledgerQty"
        from goods_receiving_items i
        join goods_receiving_vouchers v on v.id = i.grv_id
       order by v.date desc, i.position
       limit 800
    `.catch(() => null),
    selectVoucher(SIV_SELECT + TG_COLUMN + SIV_TAIL, SIV_SELECT + SIV_TAIL),
    sql<Record<string, unknown>[]>`
      select i.siv_id as "voucherId", i.position, i.stock_code as "stockCode", i.description,
             i.unit, i.quantity, i.unit_cost as "unitCost", i.total_amount as "totalAmount",
             i.ledger_kind as "ledgerKind", i.ledger_key as "ledgerKey", i.ledger_qty as "ledgerQty"
        from store_issue_items i
        join store_issue_vouchers v on v.id = i.siv_id
       order by v.date desc, i.position
       limit 800
    `.catch(() => null),
  ]);

  // Every branch returns the SAME shape, including the one where both tables are
  // missing. It previously returned `{ rows: [], unavailable: true }` there, and
  // the panel read `data.grv.length` while rendering its tab label — so on any
  // database without migration 0019 the whole section threw and rendered blank,
  // which is exactly what "the bag counts don't show at all" looked like.
  const unavailable = grv === null || siv === null;
  const reconciliation = unavailable ? null : await reconcileBags().catch(() => null);

  return NextResponse.json({
    grv: grv ?? [],
    grvItems: grvItems ?? [],
    siv: siv ?? [],
    sivItems: sivItems ?? [],
    reconciliation,
    unavailable,
  });
}
