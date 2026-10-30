import { NextResponse } from "next/server";
import sql from "@/lib/sql";
import { loadCustomStoreItems } from "@/lib/store-custom";
import { allStoreItems } from "@/lib/store-items";
import { ledgerLabel } from "@/lib/products";

export const dynamic = "force-dynamic";

/**
 * GET — every line received on a Goods Receiving Voucher, for Finance →
 * 🛍 Purchase status. What was bought, from whom, when and at what price,
 * read straight off the vouchers already filed: nobody types a purchase twice.
 *
 * A USD voucher is converted with that month's dollar rate from the price list
 * (`etb`); a month without a rate leaves `etb` null and the line is shown in
 * USD only. A voucher filed with no lines counts once, at its header total.
 */

interface LineRow {
  grvId: string;
  grvNo: string | null;
  date: Date;
  supplier: string | null;
  currency: string | null;
  headerTotal: string | null;
  description: string | null;
  unit: string | null;
  quantity: string | null;
  unitCost: string | null;
  totalAmount: string | null;
  ledgerKind: string | null;
  ledgerKey: string | null;
}

const num = (v: string | null) => (v === null || v === undefined || v === "" ? null : Number(v));

export async function GET() {
  await loadCustomStoreItems().catch(() => []);

  const rows = await sql<LineRow[]>`
    select v.id as "grvId", v.grv_no as "grvNo", v.date, v.supplier, v.currency,
           v.total_amount::text as "headerTotal",
           i.description, i.unit, i.quantity::text as quantity, i.unit_cost::text as "unitCost",
           i.total_amount::text as "totalAmount", i.ledger_kind as "ledgerKind", i.ledger_key as "ledgerKey"
      from goods_receiving_vouchers v
      left join goods_receiving_items i on i.grv_id = v.id
     order by v.date desc, v.created_at desc, i.position asc
     limit 5000
  `.catch((e) => {
    // The voucher tables arrive in 0019.
    if ((e as { code?: string })?.code !== "42P01") throw e;
    return null;
  });
  if (rows === null) return NextResponse.json({ rows: [], unavailable: true });

  const rates = new Map<string, number>();
  for (const r of await sql<{ month: string; usd_rate: string | null }[]>`
    select month, usd_rate::text from monthly_price_lists where usd_rate is not null
  `.catch(() => [])) {
    if (Number(r.usd_rate) > 0) rates.set(r.month, Number(r.usd_rate));
  }

  const storeName = new Map(allStoreItems().map((it) => [it.key, it.name]));

  const out = rows.map((r) => {
    const month = new Date(new Date(r.date).getTime() + 3 * 3_600_000).toISOString().slice(0, 7);
    const noLines = r.description === null;
    const qty = num(r.quantity);
    const unitCost = num(r.unitCost);
    const total = noLines ? num(r.headerTotal) : (num(r.totalAmount) ?? (qty !== null && unitCost !== null ? qty * unitCost : null));
    const unitPrice = unitCost ?? (total !== null && qty ? total / qty : null);
    const usd = r.currency === "USD";
    const rate = usd ? rates.get(month) ?? null : null;

    // The item a line is: its store-list / ledger identity when someone matched
    // it, otherwise the description as typed (case and spacing ignored).
    const item = noLines
      ? "(voucher with no lines)"
      : r.ledgerKind === "store" && r.ledgerKey && storeName.has(r.ledgerKey)
        ? storeName.get(r.ledgerKey)!
        : r.ledgerKind && r.ledgerKey && r.ledgerKind !== "store"
          ? ledgerLabel(r.ledgerKind, r.ledgerKey)
          : String(r.description).trim();
    const itemKey = r.ledgerKind && r.ledgerKey ? `${r.ledgerKind}:${r.ledgerKey}` : `d:${item.toLowerCase().replace(/\s+/g, " ")}`;

    return {
      grvId: r.grvId,
      grvNo: r.grvNo,
      date: r.date,
      month,
      supplier: (r.supplier || "").trim() || "— no supplier —",
      currency: usd ? "USD" : "ETB",
      item,
      itemKey,
      description: r.description,
      unit: r.unit,
      qty,
      unitPrice,
      total,
      usdRate: rate,
      // ETB: the line in birr, converted for USD when the month has a rate.
      etb: total === null ? null : usd ? (rate ? Math.round(total * rate * 100) / 100 : null) : total,
    };
  });

  return NextResponse.json({ rows: out });
}
