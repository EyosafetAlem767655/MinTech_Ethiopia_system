import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/sql";
import { costsAt, recordCosts } from "@/lib/store-costs";
import { STORE_ITEM_BY_KEY } from "@/lib/store-items";
import { monthLabel } from "@/lib/finance-report";

export const dynamic = "force-dynamic";

/**
 * Warehouse item costs, and what each item did in a month — Finance → Monthly.
 *
 * GET ?month=YYYY-MM:
 *   - each item's cost in effect at the END of that month, and where it came
 *     from (the GRV number, or the web);
 *   - what the vouchers moved that month: quantity and value in (GRV) and out
 *     (SIV). A line saved before its item had any cost is valued at that cost
 *     now, so pricing an item here also prices the issues already made.
 *
 * PUT { month, costs: { itemKey: number } } records a price from the 1st of
 * that month. It is a new row in the history, never an overwrite: a GRV dated
 * later in the month still sets the price from its own date.
 */

const MONTH = /^\d{4}-\d{2}$/;

function bounds(month: string) {
  const [y, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  return { start, end, lastDay: new Date(end.getTime() - 86_400_000) };
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("month") || "";
  const month = MONTH.test(raw) ? raw : monthLabel();
  const { start, end, lastDay } = bounds(month);

  const [costs, lines] = await Promise.all([
    costsAt(lastDay),
    sql<{ item_key: string; direction: "in" | "out"; qty: string; total: string | null }[]>`
      select item_key, direction, qty, total from (
        select i.ledger_key as item_key, 'in' as direction, i.ledger_qty as qty, i.total_amount as total, v.date
          from goods_receiving_items i join goods_receiving_vouchers v on v.id = i.grv_id
         where i.ledger_kind = 'store'
        union all
        select i.ledger_key, 'out', i.ledger_qty, i.total_amount, v.date
          from store_issue_items i join store_issue_vouchers v on v.id = i.siv_id
         where i.ledger_kind = 'store'
      ) moved
      where date >= ${start} and date < ${end}
    `.catch((e) => {
      if ((e as { code?: string })?.code !== "42P01") throw e;
      return [];
    }),
  ]);

  const movements: Record<string, { inQty: number; inValue: number; outQty: number; outValue: number }> = {};
  for (const l of lines) {
    const m = (movements[l.item_key] ??= { inQty: 0, inValue: 0, outQty: 0, outValue: 0 });
    const qty = Number(l.qty) || 0;
    const value = l.total !== null ? Number(l.total) || 0 : qty * (costs.get(l.item_key)?.unitCost ?? 0);
    if (l.direction === "in") {
      m.inQty += qty;
      m.inValue += value;
    } else {
      m.outQty += qty;
      m.outValue += value;
    }
  }

  return NextResponse.json({ month, costs: Object.fromEntries(costs), movements });
}

export async function PUT(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { month?: string; costs?: Record<string, number> };
  const month = String(body.month || "");
  if (!MONTH.test(month)) return NextResponse.json({ error: "Choose a month (YYYY-MM)." }, { status: 400 });

  const entries = Object.entries(body.costs || {});
  const unknown = entries.filter(([k]) => !STORE_ITEM_BY_KEY.has(k)).map(([k]) => k);
  if (unknown.length) return NextResponse.json({ error: `Not on the store list: ${unknown.join(", ")}` }, { status: 400 });
  const bad = entries.filter(([, v]) => !(Number(v) > 0)).map(([k]) => k);
  if (bad.length) return NextResponse.json({ error: `Enter a cost above 0 for: ${bad.join(", ")}` }, { status: 400 });

  try {
    const saved = await recordCosts(
      entries.map(([itemKey, unitCost]) => ({
        itemKey,
        unitCost: Number(unitCost),
        effectiveFrom: `${month}-01`,
        source: "web" as const,
        recordedBy: "Dashboard",
      }))
    );
    return NextResponse.json({ ok: true, saved });
  } catch (e) {
    if ((e as { code?: string })?.code === "42P01") {
      return NextResponse.json(
        { error: "Item costs need migration 0037_store_movements.sql — run it in Supabase first." },
        { status: 503 }
      );
    }
    throw e;
  }
}
