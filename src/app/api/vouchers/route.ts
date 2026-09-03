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
export async function GET() {
  const [grv, grvItems, siv, sivItems] = await Promise.all([
    sql<Record<string, unknown>[]>`
      select id as "_id", grv_no as "voucherNo", date, supplier,
             supplier_invoice_no as "supplierInvoiceNo", purchase_order_no as "purchaseOrderNo",
             receiving_store_no as "receivingStoreNo", currency, total_amount as "totalAmount",
             remarks, prepared_by as "preparedBy", received_by as "receivedBy",
             approved_by as "approvedBy", reported_by as "reportedBy",
             photo_file_ids as "photoFileIds", receipt_check as "receiptCheck",
             extraction, created_at as "createdAt"
        from goods_receiving_vouchers
       order by date desc, created_at desc
       limit 120
    `.catch(() => null),
    sql<Record<string, unknown>[]>`
      select i.grv_id as "voucherId", i.position, i.stock_code as "stockCode", i.description,
             i.unit, i.quantity, i.unit_cost as "unitCost", i.total_amount as "totalAmount",
             i.ledger_kind as "ledgerKind", i.ledger_key as "ledgerKey", i.ledger_qty as "ledgerQty"
        from goods_receiving_items i
        join goods_receiving_vouchers v on v.id = i.grv_id
       order by v.date desc, i.position
       limit 800
    `.catch(() => null),
    sql<Record<string, unknown>[]>`
      select id as "_id", siv_no as "voucherNo", date, issuing_store as "issuingStore",
             issued_to as "issuedTo", department_section as "departmentSection",
             store_requisition_no as "requisitionNo", remarks, issued_by as "issuedBy",
             approved_by as "approvedBy", received_by as "receivedBy",
             reported_by as "reportedBy", photo_file_ids as "photoFileIds",
             extraction, created_at as "createdAt"
        from store_issue_vouchers
       order by date desc, created_at desc
       limit 120
    `.catch(() => null),
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
